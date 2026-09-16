/* Diagnose: verzamelt wat de extensie op deze pagina ziet, voor een bugrapport.
 *
 * Staat apart van content.js omdat het alleen op verzoek van de popup draait
 * en niets aan de werking bijdraagt. Alles wat het uit het content script
 * nodig heeft komt binnen via `ctx` — zo is zichtbaar wat het leest.
 */

const Diagnose = (() => {
  "use strict";

  async function run(ctx, forcedUrl) {
    const {
      registry, ratedAnchors, ratingOf, playerIdFromHref,
      parsePlayerDoc, subjectOfPage, officialDelta, isWalkover,
      collectMatches, isDrawPage, projectBrackets,
    } = ctx;
    const { norm, NUM_RE_G } = Parse;

    const anchors = [...document.querySelectorAll("a[href]")];
    const candidates = anchors.filter((a) => {
      try {
        const u = new URL(a.href, location.href);
        return u.origin === location.origin && !!playerIdFromHref(u);
      } catch {
        return false;
      }
    });

    const out = {
      page: location.href,
      totalLinks: anchors.length,
      urlCandidates: candidates.length,
      badgesPlaced: registry.length,
      // dit is het interessante deel: waar is een badge gezet en wat kwam eruit
      placed: registry.slice(0, 40),
      sampleHrefs: [...new Set(candidates.map((a) => a.getAttribute("href")))].slice(0, 12),
      sampleAnchorHtml: candidates.slice(0, 3).map((a) => a.outerHTML.slice(0, 300)),
      profile: null,

      /* Waar staan de dingen op het scherm? Zonder dit is een klacht als
         "het staat niet in het midden" niet na te rekenen: hoe de site zijn
         wedstrijden opmaakt verschilt per weergave, en die opmaak levert hij
         niet mee. Hier staan de gemeten randen van de namen, de ratingbadge
         en de chips, plus de tekstuitlijning die de extensie volgt. Wijkt de
         chipregel af van de naamregel, dan is dat hier meteen te zien. */
      opmaak: (() => {
        try {
          const kaart = document.querySelector(".match");
          if (!kaart) return null;
          const rijen = [...kaart.querySelectorAll(".match__row-wrapper > .match__row")];
          if (!rijen.length) return null;

          const rond = (n) => (isFinite(n) ? Math.round(n) : null);
          const rand = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { links: rond(r.left), rechts: rond(r.right), breed: rond(r.width) };
          };

          /* Staan de twee kanten naast elkaar of onder elkaar? Niet af te
             leiden uit een klasse — .match--list staat er in beide gevallen —
             dus meten we het gewoon. */
          const tops = rijen.map((r) => r.getBoundingClientRect().top);
          const weergave =
            rijen.length < 2 ? "onbekend"
            : Math.abs(tops[0] - tops[1]) < 5 ? "raster (naast elkaar)"
            : "lijst (onder elkaar)";

          return {
            weergave,
            kaart: rand(kaart),
            kanten: rijen.slice(0, 2).map((rij) => {
              const titel = rij.querySelector(".match__row-title");
              const namen = [...rij.querySelectorAll(".match__row-title-value")];
              const laatste = namen[namen.length - 1];
              const regel = rij.querySelector(".knltb-regel");
              return {
                naam: norm(rij.textContent).slice(0, 60),
                uitlijning: titel ? getComputedStyle(titel).textAlign : null,
                naamblok: rand(titel),
                laatsteNaam: rand(laatste),
                ratingbadge: rand(rij.querySelector(".knltb-tag")),
                chipregel: rand(regel),
                chips: regel
                  ? [...regel.children].map((c) => ({
                      wat: c.className.replace(/knltb-/g, ""),
                      tekst: norm(c.textContent),
                      ...rand(c),
                    }))
                  : null,
                chipregelIn: regel && regel.parentElement
                  ? regel.parentElement.className.split(" ")[0]
                  : null,
              };
            }),
          };
        } catch (e) {
          return { error: String(e && e.message) };
        }
      })(),

      /* Waarom staat de controle ("eigen som naast die van de KNLTB") niet
         bij elke wedstrijd? Die heeft twee dingen nodig: een officiële
         mutatie in de kop van het blok, en een speler in de wedstrijd die
         de speler van deze pagina is. Hier staat per wedstrijd zonder
         vinkje welke van die twee ontbreekt, zodat het niet bij gissen
         blijft. Alle wedstrijden op de pagina, niet alleen de eerste. */
      controle: (() => {
        try {
          const blokken = [...document.querySelectorAll(".match")];
          if (!blokken.length) return null;
          const subject = subjectOfPage();
          const uit = {
            wedstrijden: blokken.length,
            metOfficieel: 0,
            metVinkje: 0,
            subject: subject ? { sleutel: subject.key, naam: subject.name } : null,
            zonderVinkje: [],
          };
          for (const b of blokken) {
            const off = officialDelta(b);
            const vink = !!b.querySelector(".knltb-check");
            if (off != null) uit.metOfficieel++;
            if (vink) uit.metVinkje++;
            if (!vink && uit.zonderVinkje.length < 8) {
              uit.zonderVinkje.push({
                wie: norm(b.textContent).slice(0, 70),
                officieel: off,
                doorgerekend: !!b.dataset.knltbDelta,
                walkover: isWalkover(b),
                ratingBijWedstrijd: !!b.querySelector(".match__row-title-aside"),
                kopTekst: norm((b.querySelector(".match__header-aside") || {}).textContent || "").slice(0, 60),
                kopHtml: (b.querySelector(".match__header-aside") || {}).innerHTML
                  ? norm(b.querySelector(".match__header-aside").innerHTML).slice(0, 200)
                  : null,
                spelers: [...b.querySelectorAll(".match__row")].map((r) =>
                  norm(r.textContent).slice(0, 40)
                ),
              });
            }
          }
          return uit;
        } catch (e) {
          return { error: String(e && e.message) };
        }
      })(),

      /* De opmaak van de site zelf. De extensie draait ín de pagina, dus ze
         kan de stylesheets gewoon lezen: per sleutelelement staan hier de
         regels die erop van toepassing zijn én wat er uiteindelijk uitkomt.
         Daarmee is de opmaak na te bouwen zonder te hoeven raden — precies
         wat er ontbrak toen "in het midden" per weergave iets anders bleek
         te betekenen.

         Alleen eigen stylesheets van de site: een blad van een ander domein
         gooit een fout bij het lezen van cssRules, en dat van onszelf slaan
         we over — dat kennen we al. */
      siteCss: (() => {
        try {
          const doel = [
            ".match", ".match__body", ".match__row-wrapper", ".match__row",
            ".match__row-title", ".match__row-title-value",
            ".match__row-title-value-content", ".match__status", ".match__result",
          ];

          /* Per selector de eerste twee voorkomens, niet alleen de eerste:
             juist het verschil tussen de linker- en de rechterkant zit in
             regels als `.match__row:last-child .match__row-title`, en die
             zie je nooit als je alleen naar het eerste element kijkt. */
          const elementen = [];
          for (const sel of doel) {
            const gevonden = [...document.querySelectorAll(sel)].slice(0, 2);
            gevonden.forEach((el, i) => {
              elementen.push([gevonden.length > 1 ? sel + " #" + (i + 1) : sel, el]);
            });
          }
          if (!elementen.length) return null;

          // 1. de regels die de site zelf meelevert, per element
          const regels = new Map(elementen.map(([sel]) => [sel, []]));
          let overgeslagen = 0;

          for (const blad of document.styleSheets) {
            let lijst;
            try {
              lijst = blad.cssRules;
            } catch {
              overgeslagen++; // ander domein: niet leesbaar
              continue;
            }
            if (!lijst) continue;
            const bron = blad.href || "";
            if (/content\.css$/.test(bron)) continue; // dat zijn wij

            const loop = (rs, media) => {
              for (const r of rs) {
                if (r.cssRules && r.conditionText != null) {
                  loop(r.cssRules, (media ? media + " en " : "") + r.conditionText);
                  continue;
                }
                if (!r.selectorText || !r.style) continue;
                for (const [sel, el] of elementen) {
                  let raakt = false;
                  try {
                    raakt = el.matches(r.selectorText);
                  } catch {
                    continue; // selector die deze browser niet kent
                  }
                  if (!raakt) continue;
                  const bak = regels.get(sel);
                  if (bak.length < 10) {
                    bak.push({
                      selector: r.selectorText.slice(0, 160),
                      media: media || null,
                      stijl: r.style.cssText.slice(0, 400),
                    });
                  }
                }
              }
            };
            loop(lijst, null);
          }

          // 2. en wat er uiteindelijk uitkomt — dat is de doorslag
          const BOEIEND = [
            "display", "flex-direction", "flex-wrap", "justify-content",
            "align-items", "flex", "text-align", "width", "padding", "margin",
            "position", "float",
          ];

          return {
            bladenNietLeesbaar: overgeslagen,
            elementen: elementen.map(([sel, el]) => {
              const c = getComputedStyle(el);
              const berekend = {};
              for (const k of BOEIEND) berekend[k] = c.getPropertyValue(k);
              const r = el.getBoundingClientRect();
              return {
                selector: sel,
                klassen: el.className.slice(0, 120),
                berekend,
                doos: { links: Math.round(r.left), rechts: Math.round(r.right), breed: Math.round(r.width) },
                regels: regels.get(sel),
              };
            }),
          };
        } catch (e) {
          return { error: String(e && e.message) };
        }
      })(),

      /* Wat leest hij per wedstrijd uit? Dit maakt zichtbaar of de ratings
         van de juiste spelers komen — bij twijfel is dit het eerste dat je
         wilt zien. */
      matches: (() => {
        try {
          return collectMatches(isDrawPage() ? projectBrackets() : null)
            .slice(0, 5)
            .map((m) => ({
              disc: m.isDouble ? "dubbel" : "enkel",
              wo: m.wo,
              wonBy: m.wonBy,
              official: officialDelta(m.block),
              teams: m.teams.map((t) =>
                t.map((p) => ({
                  naam: p.name,
                  rating: p.start,
                  vanDePagina: !!p.atTime,
                  sleutel: String(p.key).slice(0, 90),
                }))
              ),
            }));
        } catch (e) {
          return { error: String(e && e.message) };
        }
      })(),

      /* En welke ratings zitten er in het geheugen voor de ankers op deze
         pagina? Staan hier overal dezelfde getallen, dan zit de fout in het
         ophalen en niet in het rekenen. */
      ratings: [...ratedAnchors]
        .filter((a) => document.contains(a))
        .slice(0, 15)
        .map((a) => {
          const d = ratingOf.get(a) || {};
          return {
            link: norm(a.textContent).slice(0, 30),
            naamOpProfiel: d.name,
            enkel: d.single,
            dubbel: d.double,
            via: d.via,
          };
        }),
    };

    const target =
      forcedUrl ||
      (candidates[0]
        ? new URL(candidates[0].href, location.href).href
        : /player|profile/i.test(location.pathname)
        ? location.href
        : null);

    if (target) {
      try {
        const html = await (await fetch(target, { credentials: "include" })).text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const text = norm(doc.body ? doc.body.textContent : "");
        const idx = text.toLowerCase().search(/rating|speelsterkte/);

        // welke tabbladen/sublinks heeft dit profiel?
        const id = (target.match(/[0-9a-f-]{36}/i) || [])[0];
        const tabs = [
          ...new Set(
            [...doc.querySelectorAll("a[href]")]
              .map((a) => a.getAttribute("href") || "")
              .filter((h) => (id && h.includes(id)) || /rating|speelsterkte/i.test(h))
          ),
        ].slice(0, 20);

        out.profile = {
          url: target,
          httpTitle: norm((doc.querySelector("title") || {}).textContent || ""),
          htmlLength: html.length,
          mentionsRating: /rating/i.test(html),
          mentionsSpeelsterkte: /speelsterkte/i.test(html),
          parsed: parsePlayerDoc(doc),
          history: History.parse(doc),
          scriptsWithSeries: [...doc.querySelectorAll("script")]
            .map((x) => x.textContent || "")
            .filter((t) => /Chartist|series\s*:/.test(t))
            .map((t) => t.slice(0, 700)),
          tabs,
          // alle rating-achtige getallen op de pagina, met wat context
          numbers: [...text.matchAll(NUM_RE_G)]
            .slice(0, 12)
            .map((m) => ({ n: m[1], ctx: text.slice(Math.max(0, m.index - 60), m.index + 40) })),
          textAroundRating: idx >= 0 ? text.slice(Math.max(0, idx - 250), idx + 700) : null,
          htmlAroundRating: htmlAround(html, /rating|speelsterkte/i),
        };
      } catch (e) {
        out.profile = { url: target, error: String(e) };
      }
    }

    return out;
  }

  function htmlAround(html, re) {
    const m = html.match(re);
    if (!m) return null;
    const i = html.indexOf(m[0]);
    return html.slice(Math.max(0, i - 800), i + 1600);
  }

  return { run };
})();

if (typeof module !== "undefined") module.exports = Diagnose;
