/* Ratingverloop van een speler uitlezen en tekenen.
 *
 * De site laadt Chartist op het tabblad /player-profile/<uuid>/Rating, dus de
 * historie staat vrijwel zeker als reeks in een inline script — net zoals de
 * winst/verlies-taartgrafiek op het overzicht:
 *
 *   new Chartist.Pie('#pie_…', { series: [{"value":7,…},{"value":5,…}] }, {…});
 *
 * Omdat de opbouw van die pagina niet vastligt, leest de parser drie bronnen na
 * elkaar. Wat als eerste iets bruikbaars oplevert, wint.
 */

const History = (() => {
  "use strict";

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const num = (s) => parseFloat(String(s).replace(",", "."));

  // een rating: 1 t/m 10 met decimalen
  const RATING = /(?:^|[^\d.,])((?:10|[1-9])[.,]\d{1,4})(?![\d])/g;

  /** Haalt een gebalanceerd [...] of {...} blok op vanaf een positie. */
  function balanced(text, from, open = "[", close = "]") {
    const start = text.indexOf(open, from);
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }

  /** Bron 1: de reeksen die aan Chartist worden meegegeven. */
  function fromChartist(doc) {
    for (const script of doc.querySelectorAll("script")) {
      const t = script.textContent || "";
      if (!/Chartist|series\s*:/.test(t)) continue;

      const sIx = t.search(/series\s*:/);
      if (sIx < 0) continue;

      const block = balanced(t, sIx);
      if (!block) continue;

      const values = [...block.matchAll(RATING)].map((m) => num(m[1]));
      if (values.length < 2) continue;

      // labels zijn optioneel; vaak datums of maandnamen
      let labels = [];
      const lIx = t.search(/labels\s*:/);
      if (lIx >= 0) {
        const lb = balanced(t, lIx);
        if (lb) labels = (lb.match(/"([^"]*)"|'([^']*)'/g) || []).map((x) => x.slice(1, -1));
      }

      return { values, labels, how: "chartist" };
    }
    return null;
  }

  /** Bron 2: een tabel met per rij een datum en een rating. */
  function fromTable(doc) {
    for (const table of doc.querySelectorAll("table")) {
      const rows = [...table.querySelectorAll("tr")];
      const points = [];

      for (const tr of rows) {
        const text = norm(tr.textContent);
        const hits = [...text.matchAll(RATING)].map((m) => num(m[1]));
        if (!hits.length) continue;

        const time = tr.querySelector("time[datetime]");
        const dm = text.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
        const label = time ? time.getAttribute("datetime") : dm ? dm[0] : null;

        points.push({ value: hits[hits.length - 1], label });
      }

      if (points.length >= 2) {
        return {
          values: points.map((p) => p.value),
          labels: points.map((p) => p.label || ""),
          how: "table",
        };
      }
    }
    return null;
  }

  /**
   * Het seizoensoverzicht op /player-profile/<uuid>/Rating.
   *
   *   Enkel  8  Startrating 8,2719  Wedstrijden 6   Huidige rating 7,8265  0,4454
   *   Dubbel 6  Startrating 6,6096  Wedstrijden 42  Huidige rating 5,7033  0,9063
   *
   * Dit is echte informatie: waar je het seizoen begon, hoeveel je speelde en
   * waar je nu staat. Veel bruikbaarder dan losse getallen van de pagina
   * schrapen, wat de vorige versie deed — die pikte de kopregel mee en maakte
   * er een grafiek van die nergens op sloeg.
   */
  const SEASON_RE =
    /(Enkel|Dubbel)\s+(\d+)\s+Startrating\s+([\d.,]+)\s+Wedstrijden\s+(\d+)\s+Huidige rating\s+([\d.,]+)\s+([\d.,]+)/gi;

  function season(doc) {
    const text = norm(doc.body ? doc.body.textContent : "");
    const out = {};

    for (const m of text.matchAll(SEASON_RE)) {
      const [, disc, level, start, played, now, delta] = m;
      const key = /enkel/i.test(disc) ? "single" : "double";
      out[key] = {
        level: Number(level),
        start: num(start),
        now: num(now),
        played: Number(played),
        delta: num(delta),
      };
    }

    return out.single || out.double ? out : null;
  }

  function parse(doc) {
    // losse getallen van de pagina schrapen leverde onzin op (de kopregel
    // met je huidige ratings werd meegepakt), dus die terugval is eruit
    const found = fromChartist(doc) || fromTable(doc);
    if (!found) return null;

    // uitschieters eruit: alles buiten 1..10 is geen rating
    const values = found.values.filter((v) => isFinite(v) && v >= 1 && v <= 10);
    if (values.length < 2) return null;

    return { ...found, values };
  }

  /**
   * Klein lijngrafiekje. Let op de omkering: een lagere rating is sterker,
   * dus die hoort bovenaan te staan. Anders lees je vooruitgang als verval.
   */
  function sparkline(values, opts = {}) {
    const w = opts.width || 140;
    const h = opts.height || 30;
    const pad = 3;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;

    const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1);
    // omgekeerd: kleinste waarde bovenaan
    const y = (v) => pad + ((v - min) / span) * (h - 2 * pad);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("class", "knltb-spark");
    svg.setAttribute("role", "img");

    const line = document.createElementNS(svg.namespaceURI, "polyline");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("stroke-linejoin", "round");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("points", values.map((v, i) => `${x(i)},${y(v)}`).join(" "));
    svg.appendChild(line);

    const dot = document.createElementNS(svg.namespaceURI, "circle");
    dot.setAttribute("cx", x(values.length - 1));
    dot.setAttribute("cy", y(values[values.length - 1]));
    dot.setAttribute("r", "2");
    dot.setAttribute("fill", "currentColor");
    svg.appendChild(dot);

    return svg;
  }

  return { parse, season, sparkline };
})();

if (typeof module !== "undefined") module.exports = History;
