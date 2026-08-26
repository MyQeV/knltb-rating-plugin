/* Gedeelde parsers voor mijnknltb-pagina's.
 *
 * Zowel het content script als het dashboard leest dezelfde pagina's, dus
 * die kennis hoort op één plek te staan. Alles hier is puur: het krijgt een
 * Document en geeft gegevens terug, zonder DOM te wijzigen of iets op te halen.
 */

const Parse = (() => {
  "use strict";

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const toNumber = (s) => parseFloat(String(s).replace(",", "."));

  // een rating: 1 t/m 10 met decimalen
  const NUM_RE = /(?:^|[^\d.,])((?:10|[1-9])[.,]\d{1,4})(?![\d])/;
  const NUM_RE_G = new RegExp(NUM_RE.source, "g");

  const UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

  // navigatie, koptekst en voettekst bevatten koppen die niets met het
  // onderdeel te maken hebben
  const CHROME_SEL =
    'nav, header, footer, aside, [role="navigation"], [role="banner"], ' +
    ".primary-nav, .masthead, .page-foot, .dropdown-menu, .page-nav";


  const SINGLE_LABELS = ["enkel", "enkelspel", "enkelrating", "single", "singles"];
  const DOUBLE_LABELS = ["dubbel", "dubbelspel", "dubbelrating", "double", "doubles"];

  /* ------------------------------------------------------- profielpagina */

  /**
   * De ratings staan in de kop van de pagina, in het blok van de persoon
   * waar de pagina over gaat:
   *   <span title="Enkel" class="tag-duo tag">
   *     <span class="tag-duo__title"> 8</span>       <- speelsterkte
   *     <span class="tag-duo__value">7,8265</span>   <- rating
   * Bij de dubbel zit het label in data-original-title (bootstrap tooltip).
   */
  function subjectScope(doc) {
    return (
      doc.querySelector("#mediaContentSubinfo") ||
      doc.querySelector(".page-head .media__content") ||
      doc.querySelector(".page-head") ||
      null
    );
  }

  function tagDuo(doc) {
    const scope = subjectScope(doc);
    if (!scope) return null;

    const res = {
      single: null, double: null,
      singleRaw: null, doubleRaw: null,
      singleLevel: null, doubleLevel: null,
    };
    let found = false;

    for (const tag of scope.querySelectorAll(".tag-duo")) {
      const label = norm(
        tag.getAttribute("title") || tag.getAttribute("data-original-title") || ""
      ).toLowerCase();

      const valueEl = tag.querySelector(".tag-duo__value");
      if (!valueEl) continue;

      const raw = norm(valueEl.textContent);
      const value = toNumber(raw);
      if (!isFinite(value) || value <= 0 || value > 10) continue;

      const levelEl = tag.querySelector(".tag-duo__title");
      const level = levelEl ? norm(levelEl.textContent) : null;

      if (/^(enkel|single)/.test(label)) {
        Object.assign(res, { single: value, singleRaw: raw, singleLevel: level });
        found = true;
      } else if (/^(dubbel|double)/.test(label)) {
        Object.assign(res, { double: value, doubleRaw: raw, doubleLevel: level });
        found = true;
      }
    }

    return found ? { ...res, how: "tag-duo", name: playerName(doc) } : null;
  }

  /**
   * Naam van de speler waar de pagina over gáát.
   *
   * Let op: de masthead rechtsboven bevat óók een .media__title, met de naam
   * van de ingelogde gebruiker, en die staat vroeger in het document dan de
   * paginakop. Zoeken op de eerste .media__title levert dus op élk profiel
   * jouw eigen naam op. Daarom eerst binnen het kopblok kijken, en de
   * masthead expliciet uitsluiten.
   */
  function playerName(doc) {
    const scopes = [
      doc.querySelector(".page-head .media__content"),
      doc.querySelector(".page-head"),
      doc.querySelector(".page-subhead"),
    ].filter(Boolean);

    for (const scope of scopes) {
      const h =
        scope.querySelector(".media__title .nav-link__value") ||
        scope.querySelector(".media__title") ||
        scope.querySelector(".page__header-title,.player__name");
      if (h) {
        const n = norm(h.textContent).slice(0, 60);
        if (n && n.toLowerCase() !== "mijnknltb") return n;
      }
    }

    // laatste redmiddel: overal zoeken, maar niet in de menubalk
    for (const h of doc.querySelectorAll(".media__title, .page__header-title, .player__name")) {
      if (h.closest(".masthead, .dropdown-menu, nav, header")) continue;
      const n = norm(h.textContent).slice(0, 60);
      if (n && n.toLowerCase() !== "mijnknltb") return n;
    }

    return null;
  }

  /** Terugval: label zoeken en het getal ernaast pakken. */
  function byLabel(doc, labels) {
    for (const el of doc.querySelectorAll("th,td,dt,dd,span,div,li,strong,b,p,label,small")) {
      const t = norm(el.textContent);
      if (!t || t.length > 45) continue;

      const low = t.toLowerCase().replace(/:/g, " ").replace(/\s+/g, " ").trim();
      if (!labels.some((l) => low === l || low.startsWith(l + " ") || low.endsWith(" " + l))) {
        continue;
      }

      let m = t.match(NUM_RE);
      if (m) return toNumber(m[1]);

      let sib = el.nextElementSibling;
      for (let i = 0; i < 3 && sib; i++, sib = sib.nextElementSibling) {
        const s = norm(sib.textContent);
        if (s && s.length <= 30) {
          m = s.match(NUM_RE);
          if (m) return toNumber(m[1]);
        }
      }
    }
    return null;
  }

  function playerDoc(doc) {
    const exact = tagDuo(doc);
    if (exact) return exact;

    const single = byLabel(doc, SINGLE_LABELS);
    const double = byLabel(doc, DOUBLE_LABELS);
    if (single == null && double == null) return null;

    return { single, double, singleRaw: null, doubleRaw: null, how: "label", name: playerName(doc) };
  }

  /* --------------------------------------------------- inschrijvingslijst */

  /**
   * De oude inschrijvingspagina (/sport/event.aspx?id=…&event=N) heeft de
   * ratings al in een kolom staan. Bij dubbel staat het hele koppel in één
   * rij, met twee <p>'s per cel.
   */
  /**
   * Een cel opdelen in losse regels.
   *
   * Nodig omdat textContent van <td><p>5,8576</p><p>6,8564</p></td> de string
   * "5,85766,8564" oplevert — zonder scheidingsteken. Beide getallen zijn dan
   * niet meer terug te vinden, en erger: een naïeve regex leest er één fout
   * getal uit. Dus per blokelement lezen in plaats van de cel als geheel.
   */
  function cellParts(cell) {
    if (!cell) return [];

    const blocks = [...cell.querySelectorAll("p, div, li")].filter(
      (b) => !b.querySelector("p, div, li") // alleen de binnenste
    );
    if (blocks.length) return blocks.map((b) => norm(b.textContent)).filter(Boolean);

    const html = cell.innerHTML || "";
    if (/<br\s*\/?>/i.test(html)) {
      return html
        .split(/<br\s*\/?>/i)
        .map((x) => norm(x.replace(/<[^>]*>/g, "")))
        .filter(Boolean);
    }

    const t = norm(cell.textContent);
    return t ? [t] : [];
  }

  /** Eerste rating in een stuk tekst, of null. */
  function ratingIn(text) {
    const m = norm(text).match(NUM_RE);
    if (!m) return null;
    const v = toNumber(m[1]);
    return isFinite(v) && v >= 1 && v <= 10 ? v : null;
  }

  function entryTable(doc) {
    for (const table of doc.querySelectorAll("table")) {
      const heads = [...table.querySelectorAll("thead td, thead th")].map((x) =>
        norm(x.textContent).toLowerCase()
      );
      if (!heads.length) continue;

      const iName = heads.findIndex((h) => /speler|player|naam|team/.test(h));
      const iRate = heads.findIndex((h) => /rating/.test(h));
      const iClub = heads.findIndex((h) => /club|vereniging/.test(h));
      const iSeed = heads.findIndex((h) => /plaatsing|seed/.test(h));
      if (iName < 0 || iRate < 0) continue;

      const rows = [];

      for (const tr of table.querySelectorAll("tbody tr")) {
        const cells = [...tr.children];
        if (cells.length <= Math.max(iName, iRate)) continue;

        const ratings = cellParts(cells[iRate]).map(ratingIn).filter((v) => v != null);
        if (!ratings.length) continue;

        const nameCell = cells[iName];
        const links = [...nameCell.querySelectorAll("a[href]")];
        const linkNames = links.map((x) => norm(x.textContent)).filter(Boolean);
        const textNames = cellParts(nameCell).filter(Boolean);

        /* Bij een dubbelkoppel heeft lang niet altijd allebei de spelers een
           profiellink — een gastspeler staat er als kale tekst. Namen alleen
           uit de links halen gooit die tweede weg, en `ratings.slice` haalt
           dan ook zijn rating weg: het koppel belandt met de rating van één
           speler in het veld in plaats van met het gemiddelde. Dus wint de
           langste lijst. De links blijven los meegaan; die worden alleen als
           verzameling gebruikt, niet op volgorde. */
        const finalNames = textNames.length > linkNames.length ? textNames : linkNames;
        if (!finalNames.length) continue;

        const clubs = iClub >= 0 ? cellParts(cells[iClub]) : [];

        rows.push({
          names: finalNames,
          name: finalNames.join(" / "),
          ratings: ratings.slice(0, finalNames.length),
          hrefs: links.map((x) => x.getAttribute("href")),
          club: [...new Set(clubs)].filter(Boolean).join(" / "),
          seed: iSeed >= 0 && cells[iSeed] ? norm(cells[iSeed].textContent) : "",
        });
      }

      if (rows.length >= 2) {
        const cap = table.querySelector("caption");
        return { rows, caption: cap ? norm(cap.textContent) : null, table };
      }
    }
    return null;
  }

  /**
   * Enkel of dubbel? HE/DE is enkelspel, HD/DD/GD dubbel.
   * Let op de cijfers: "Tennis HD6" heeft geen woordgrens na de D.
   */
  function discipline(text) {
    const t = norm(text);
    if (!t) return null;
    if (/\b(HD|DD|GD|MD|XD)\d*\b/i.test(t) || /dubbel|mixed|gemengd/i.test(t)) return "D";
    if (/\b(HE|DE|ME)\d*\b/i.test(t) || /enkel|single/i.test(t)) return "S";
    return null;
  }

  const outsideChrome = (el) => el && !el.closest(CHROME_SEL);

  /**
   * Titel van het onderdeel.
   *
   * Bewust NIET <title> als terugval: dat is de titel van het browsertabblad
   * ("Schema - Open Dubbeltoernooi … | MijnKNLTB") en die bevat vrijwel altijd
   * een woord als "dubbel", waardoor elk enkelonderdeel als dubbel gelezen zou
   * worden. Liever niets weten dan iets verkeerds.
   */
  function eventTitle(doc) {
    const el =
      [doc.querySelector(".page-subhead .media__title")].find(outsideChrome) ||
      [...doc.querySelectorAll("h3")].find(outsideChrome) ||
      [doc.querySelector(".page-head .media__title")].find(outsideChrome) ||
      [...doc.querySelectorAll("h1, h2")].find(outsideChrome);
    return el ? norm(el.textContent) : "";
  }

  /**
   * Links naar een landelijk profiel, op volgorde van betrouwbaarheid.
   *
   * De menubalk rechtsboven bevat "Mijn profiel" — een link naar het profiel
   * van de INGELOGDE gebruiker. Die staat vroeger in het document dan de
   * paginakop, dus wie simpelweg de eerste /player-profile/-link pakt, krijgt
   * op élke spelerspagina zichzelf terug. Dezelfde valkuil als bij de naam.
   */
  function profileLinks(doc) {
    const uuid = new RegExp("/player-profile/" + UUID_SRC, "i");
    const gezien = new Set();
    const out = [];

    const verzamel = (scope) => {
      if (!scope) return;
      for (const a of scope.querySelectorAll('a[href*="player-profile"]')) {
        if (a.closest(CHROME_SEL)) continue; // menubalk, voettekst, dropdowns
        const href = a.getAttribute("href") || "";
        if (!uuid.test(href)) continue;
        if (gezien.has(href)) continue;
        gezien.add(href);
        out.push(href);
      }
    };

    // eerst de kop van de pagina: dáár staat de speler waar het over gaat
    verzamel(doc.querySelector(".page-head"));
    verzamel(doc.querySelector(".page-subhead"));
    verzamel(doc.querySelector("#content, main, .content"));
    verzamel(doc);

    return out;
  }

  return {
    norm, toNumber, NUM_RE, NUM_RE_G,
    playerDoc, tagDuo, playerName, profileLinks,
    entryTable, discipline, eventTitle,
  };
})();

if (typeof module !== "undefined") module.exports = Parse;
