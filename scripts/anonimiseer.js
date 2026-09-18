/* Anonimiseer een mijnknltb-pagina voor schermafbeeldingen.
 *
 * Spelersnamen worden "Speler 1", "Speler 2", … — dezelfde persoon krijgt overal
 * hetzelfde nummer. Clubs worden "Club A", plaatsen "Plaats A", het toernooi
 * "Voorbeeldtoernooi", en je eigen naam en initialen gaan er ook uit. Ratings,
 * uitslagen en speelsterktes blijven staan: die zeggen niets over wie iemand is.
 *
 * Alles wordt uit de pagina zelf afgeleid, dus dit werkt ook op een toernooi van
 * een andere club in een andere plaats. Controleer na afloop met anon.report()
 * wat er gevonden is; wat de detectie mist zet je in HANDMATIG.
 *
 * Draaien: F12 -> Sources -> Snippets -> New snippet, dit erin plakken, opslaan,
 * daarna op elke pagina uitvoeren met Ctrl+Enter. Plakken in de Console kan ook,
 * maar Chrome laat je de eerste keer letterlijk "allow pasting" typen.
 *
 * Dit leeft in het tabblad. Na F5 of een echte navigatie is het weg en draai je
 * het opnieuw. Binnen dezelfde pagina blijft het werken terwijl de extensie
 * doorrekent — daar is de observer voor, want bij elke herberekening zet de
 * plugin de echte namen terug uit zijn cache.
 *
 *   anon.report()  -> tabel met alles wat gevonden en vervangen is
 *   anon.again()   -> handmatig opnieuw vegen
 *   anon.stop()    -> observer uit, vervangingen blijven staan
 */
(() => {
  "use strict";

  /** Vangnet voor wat de detectie mist. Paren van [zoek, vervang]. */
  const HANDMATIG = [
    // ["Sponsornaam in de toernooititel", "Voorbeeld"],
  ];

  const TITEL = "Voorbeeldtoernooi";

  /* Onze eigen uitvoer. Die mag nooit als echte naam geleerd worden, anders
     nummeren we nummers en groeit de kaart bij elke veegbeurt.
     Twee valkuilen zitten hierin verwerkt:
       - schoon() haalt cijfers weg, dus "Speler 12" komt binnen als kaal
         "Speler" — vandaar de optionele \s+\d+;
       - matchen op alleen het voorvoegsel is te grof: dan zou een echte club
         "Clubhuis Jansen" of "Plaatsmakers" als eigen uitvoer gelden en juist
         níét geanonimiseerd worden. Daarom exacte vormen met ^…$. */
  const PSEUDONIEM =
    /^(?:Speler(?:\s+\d+)?|Club\s+[A-Z]\d*|Plaats\s+[A-Z]\d*|Voorbeeldtoernooi(?:\s+20\d\d)?|Voorbeeld Gebruiker|VG)$/;

  /* Menu-items staan in dezelfde klassen als de dingen die we zoeken. Zonder
     deze lijst wordt "Log uit" een clubnaam en "Berichten" jouw naam. */
  const MENU =
    /^(Home|Toernooien|Competities|Clubs|Spelers|Ranking|Mijn profiel|Accountinstellingen|Lidmaatschappen|Berichten|Inschrijvingen|Head to Head|Favorieten|Favoriet|Log uit|Overzicht|Wedstrijden|Schema's|Onderdelen|Plaatsingen|Winnaars|Meer|Menu|Zoeken)$/i;

  const letter = (i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : "");

  const schoon = (s) =>
    s
      .replace(/\s*\[\d+\]\s*/g, "")   // plaatsingscijfer
      .replace(/D:\s*[\d,]+/g, "")     // badge van de extensie
      .split("→")[0]                   // projectie erachter
      .replace(/[\d,]+/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const bruikbaar = (t) =>
    t.length > 2 &&
    t.length < 45 &&
    /[a-z]/.test(t) &&
    !PSEUDONIEM.test(t) &&
    !MENU.test(t) &&
    !/^(Bye|Walkover)/i.test(t);

  /** Ziet het eruit als een persoonsnaam, en niet als een menu-item? */
  const persoonlijk = (t) => {
    const w = t.split(" ");
    return w.length >= 2 && w.length <= 5 && /^[A-Z]/.test(t) && t.length < 40 && bruikbaar(t);
  };

  const spelers = new Map();  // echte naam -> "Speler N"
  const clubs = new Map();    // club en schrijfvarianten -> "Club A"
  const plaatsen = new Map(); // plaats -> "Plaats A"
  const overig = new Map();   // toernooinaam, eigen naam, initialen
  let teller = 0;

  /* ---------------------------------------------------------------- spelers */

  function leerSpelers() {
    const kandidaten = new Set();

    document.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (!/player\.aspx|\/player\/\d+|player-profile/i.test(href)) return;
      const t = schoon(a.textContent);
      if (bruikbaar(t)) kandidaten.add(t);
    });

    document.querySelectorAll(".match__row-title-value").forEach((el) => {
      const t = schoon(el.textContent);
      if (bruikbaar(t) && /^[A-Z]/.test(t)) kandidaten.add(t);
    });

    for (const t of kandidaten) if (!spelers.has(t)) spelers.set(t, "Speler " + ++teller);
  }

  /* ------------------------------------------------- toernooi, club, plaats */

  /* "L.T. Kockengen" en "LT Kockengen" zijn dezelfde club. De site gebruikt
     beide vormen door elkaar — baannamen laten de punten weg. */
  function varianten(club) {
    const v = new Set([club, club.replace(/\./g, ""), club.replace(/\.\s*/g, "")]);
    return [...v].map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 2);
  }

  function leerOverig() {
    // toernooinaam, jaartal mag blijven staan
    document
      .querySelectorAll(".hgroup__heading, .media__title--large, .page__header-title")
      .forEach((el) => {
        const t = el.textContent.replace(/\s+/g, " ").trim();
        if (!t || t.length < 4 || t.length > 90 || PSEUDONIEM.test(t) || overig.has(t)) return;
        const jaar = /\b(20\d\d)\s*$/.exec(t);
        overig.set(t, jaar ? TITEL + " " + jaar[1] : TITEL);
      });

    // eigen naam: uitsluitend de titel naast het initialenbolletje
    const abbr = document.querySelector(".profile-icon__abbr");
    if (abbr) {
      const init = abbr.textContent.trim();
      if (/^[A-Z]{1,3}$/.test(init) && init !== "VG" && !overig.has(init)) overig.set(init, "VG");

      const doos = abbr.closest("a, li, div");
      const titel = doos && doos.querySelector("h5.media__title, .media__title");
      if (titel) {
        const t = titel.textContent.replace(/\s+/g, " ").trim();
        if (persoonlijk(t) && !overig.has(t)) overig.set(t, "Voorbeeld Gebruiker");
      }
    }

    /* Club en plaats staan als "T.V. Iets | Plaats" in een span die dezelfde
       klasse heeft als het hoofdmenu. De eis dat er een | in zit maakt die
       klasse bruikbaar zonder het halve menu mee te slepen. */
    document
      .querySelectorAll(".nav-link__value, .media__subtitle, .hgroup__subheading")
      .forEach((el) => {
        if (el.children.length) return;
        const t = el.textContent.replace(/\s+/g, " ").trim();
        if (!t || t.length > 70 || !t.includes("|") || PSEUDONIEM.test(t)) return;

        const [club, plaats] = t.split("|").map((s) => s.trim());

        if (club && club.length > 2 && !MENU.test(club) && !clubs.has(club)) {
          const nep = "Club " + letter(new Set([...clubs.values()]).size);
          varianten(club).forEach((v) => clubs.set(v, nep));
        }
        if (plaats && /^[A-Z][\p{L}' -]{2,28}$/u.test(plaats) && !MENU.test(plaats) && !plaatsen.has(plaats)) {
          plaatsen.set(plaats, "Plaats " + letter(plaatsen.size));
        }
      });
  }

  /* ---------------------------------------------------------------- vegen */

  /* Langste eerst. Dat is niet cosmetisch: een plaatsnaam zit vaak ín de
     toernooinaam ("Kockengen" in "Kockengens Open Enkel toernooi"), en zonder
     deze volgorde blijft daar "Plaats As Open Enkel toernooi" van over. */
  const paren = () =>
    [...spelers, ...clubs, ...plaatsen, ...overig, ...HANDMATIG]
      .filter(([echt, nep]) => echt !== nep) // zelfvervanging is zinloos werk
      .sort((a, b) => b[0].length - a[0].length);

  function vervang(tekst, lijst) {
    let v = tekst;
    for (const [echt, nep] of lijst) {
      // Zou de vervanging het origineel bevatten, dan voedt de replace zichzelf
      // bij de volgende veegbeurt en groeit de tekst aan. Overslaan dus.
      if (nep.includes(echt)) continue;
      if (v.includes(echt)) v = v.split(echt).join(nep);
    }
    return v;
  }

  let observer = null;

  function veeg() {
    // Losknippen tijdens het vegen: anders ziet de observer zijn eigen
    // wijzigingen als aanleiding en veegt hij eindeloos over eigen uitvoer.
    if (observer) observer.disconnect();
    try {
      leerSpelers();
      leerOverig();
      const lijst = paren();

      const loop = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (loop.nextNode()) nodes.push(loop.currentNode);

      for (const n of nodes) {
        const v = n.nodeValue;
        if (!v || !v.trim()) continue;
        const x = vervang(v, lijst);
        if (x !== v) n.nodeValue = x;
      }

      // tooltips lekken net zo hard als zichtbare tekst
      document.querySelectorAll("[title],[aria-label],[alt]").forEach((el) => {
        for (const attr of ["title", "aria-label", "alt"]) {
          const v = el.getAttribute(attr);
          if (!v) continue;
          const x = vervang(v, lijst);
          if (x !== v) el.setAttribute(attr, x);
        }
      });

      document.querySelectorAll("img").forEach((img) => {
        if (/profile|player|avatar|member|club|logo/i.test(img.src || "")) {
          img.style.visibility = "hidden";
        }
      });

      const titel = vervang(document.title, lijst);
      if (document.title !== titel) document.title = titel;
    } finally {
      if (observer) {
        observer.takeRecords(); // wat we zelf net deden weggooien
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
    }
  }

  if (window.anon && window.anon.stop) window.anon.stop();

  observer = new MutationObserver(() => veeg());
  veeg();

  window.anon = {
    again: veeg,
    spelers,
    clubs,
    plaatsen,
    overig,
    stop() {
      observer.disconnect();
      console.log("[anon] observer uit");
    },
    report() {
      const tekst = document.body.textContent.replace(/\s+/g, " ");
      const alles = [...spelers.keys(), ...clubs.keys(), ...plaatsen.keys(), ...overig.keys()];
      const lek = alles.filter((n) => tekst.includes(n));
      const rommel = /Speler \d+\s+\d/.test(tekst); // aangroei betrapt

      console.table([
        ...[...spelers].map(([echt, nep]) => ({ soort: "speler", echt, nep })),
        ...[...clubs].map(([echt, nep]) => ({ soort: "club", echt, nep })),
        ...[...plaatsen].map(([echt, nep]) => ({ soort: "plaats", echt, nep })),
        ...[...overig].map(([echt, nep]) => ({ soort: "overig", echt, nep })),
      ]);

      const uit = {
        spelers: spelers.size,
        clubs: new Set([...clubs.values()]).size,
        plaatsen: plaatsen.size,
        overig: overig.size,
        lek,
        rommel,
      };
      console.log(lek.length || rommel ? "[anon] LET OP:" : "[anon] schoon", uit);
      return uit;
    },
  };

  console.log("[anon] actief. anon.report() om te zien wat er gevonden is.");
  return window.anon.report();
})();
