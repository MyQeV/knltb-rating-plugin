/* Structuur van een afvalschema uitlezen.
 *
 * De opmaak op mijnknltb:
 *   .bracket
 *     swiper-container
 *       swiper-slide (aria-label="1 / 4")     <- ronde 0
 *         .bracket-round__match-group
 *           .match   .match   ...
 *       swiper-slide (aria-label="2 / 4")     <- ronde 1
 *       ...
 *
 * De winnaar van wedstrijd j in ronde r speelt wedstrijd ⌊j/2⌋ in ronde r+1,
 * en komt daar in rij j mod 2 te staan. Dat is de standaardindeling van een
 * afvalschema en klopt met de HTML van de site: wedstrijd 1 en 2 van de
 * achtste finales voeden samen de eerste kwartfinale.
 */

const Bracket = (() => {
  "use strict";

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

  /** Alle schema's op de pagina, elk met zijn rondes en wedstrijden. */
  function build(root = document) {
    const out = [];

    for (const el of root.querySelectorAll(".bracket")) {
      let slides = [...el.querySelectorAll("swiper-slide")];
      if (!slides.length) slides = [...el.querySelectorAll(".bracket-round__item")];
      if (!slides.length) continue;

      // op volgorde zetten via aria-label="2 / 4", anders DOM-volgorde
      slides = slides
        .map((s, i) => {
          const m = (s.getAttribute("aria-label") || "").match(/(\d+)\s*\/\s*(\d+)/);
          return { s, index: m ? Number(m[1]) - 1 : i };
        })
        .sort((a, b) => a.index - b.index)
        .map((x) => x.s);

      const rounds = slides.map((s) => [...s.querySelectorAll(".match")]);
      if (rounds.some((r) => r.length)) out.push({ el, slides, rounds });
    }

    return out;
  }

  /**
   * De twee kanten van een wedstrijd.
   *   team  = er staan spelerslinks in de rij
   *   bye   = letterlijk "Bye", er wordt niet gespeeld
   *   empty = nog niet bekend; hier komt de winnaar van een eerdere ronde
   */
  function slots(matchEl) {
    return [...matchEl.querySelectorAll(".match__row")].map((row) => {
      const anchors = [...row.querySelectorAll("a[href]")].filter((a) =>
        /player/i.test(a.getAttribute("href") || "")
      );
      const text = norm(row.textContent);

      if (anchors.length) return { kind: "team", anchors, row, text };
      if (/^bye$/i.test(text)) return { kind: "bye", row, text };
      return { kind: "empty", row, text };
    });
  }

  /** Waar gaat de winnaar van wedstrijd j in ronde r naartoe? */
  function successor(bracket, r, j) {
    const next = bracket.rounds[r + 1];
    if (!next) return null;
    const el = next[Math.floor(j / 2)];
    if (!el) return null;
    return { matchEl: el, slot: j % 2 };
  }

  /** Index van de rij die gewonnen heeft, of -1. */
  function decided(matchEl) {
    return [...matchEl.querySelectorAll(".match__row")].findIndex((r) =>
      r.classList.contains("has-won")
    );
  }

  return { build, slots, successor, decided };
})();

if (typeof module !== "undefined") module.exports = Bracket;
