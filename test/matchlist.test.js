/* De wedstrijdenlijst van een toernooi (/Matches).
 *
 * Daar staan wedstrijden uit alle onderdelen door elkaar en niet op
 * toernooivolgorde. Rondes op elkaar stapelen levert daar getallen op die
 * nergens op slaan; elke wedstrijd hoort op zichzelf gerekend te worden,
 * steeds vanaf de huidige rating van de speler.
 *
 *   A 6,0000 wint van B 7,0000   ->  6,0000 -> 5,9618
 *   A 6,0000 wint van C 6,5000   ->  6,0000 -> 5,9212   (los gerekend)
 *                                    5,9618 -> 5,8868   (gestapeld: fout hier)
 *
 * En: de chips horen op een eigen regel onder de namen, want in deze lijst
 * is de rij zo breed als de pagina.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let fail = 0;
const ok = (c, l, e = "") => {
  console.log((c ? "  ok   " : "  FOUT ") + l + (e ? "  " + e : ""));
  if (!c) fail++;
};

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const files = manifest.content_scripts[0].js;

const TOERNOOI = "cccccccc-1111-2222-3333-444444444444";

const SPELERS = {
  11: { uuid: "cccccccc-0000-0000-0000-000000000001", naam: "Speler A", rating: "6,0000", dubbel: "6,2000" },
  12: { uuid: "cccccccc-0000-0000-0000-000000000002", naam: "Speler B", rating: "7,0000", dubbel: "7,2000" },
  13: { uuid: "cccccccc-0000-0000-0000-000000000003", naam: "Speler C", rating: "6,5000", dubbel: "6,7000" },
  15: { uuid: "cccccccc-0000-0000-0000-000000000005", naam: "Speler E", rating: "7,0000", dubbel: "7,4000" },
  // komt bewust nergens in de eerste lading voor: pas als de nieuwe dag
  // binnenkomt moet hij opgehaald worden
  16: { uuid: "cccccccc-0000-0000-0000-000000000006", naam: "Speler F", rating: "6,2000", dubbel: "6,6000" },
};

const link = (nr) =>
  `<a href="/sport/player.aspx?id=${TOERNOOI}&amp;player=${nr}" class="nav-link"><span class="nav-link__value">${SPELERS[nr].naam}</span></a>`;
const rij = (nr, gewonnen) =>
  `<div class="match__row${gewonnen ? " has-won" : ""}"><div class="match__row-title">
     <div class="match__row-title-value"><span class="match__row-title-value-content">${link(nr)}</span></div>
   </div></div>`;
/* Dubbel waarbij aan één kant de partner geen profiellink heeft: er staat
   maar één naam die de extensie kan lezen. Dan valt er geen teamrating te
   maken en hoort er niets getoond te worden. */
const dubbelHalf = (id) =>
  `<div class="match" id="${id}"><div class="match__body"><div class="match__row-wrapper">
     <div class="match__row has-won"><div class="match__row-title">
       <div class="match__row-title-value"><span class="match__row-title-value-content">${link(11)}</span></div>
       <div class="match__row-title-value"><span class="match__row-title-value-content">${link(15)}</span></div>
     </div></div>
     <div class="match__row"><div class="match__row-title">
       <div class="match__row-title-value"><span class="match__row-title-value-content">${link(13)}</span></div>
       <div class="match__row-title-value"><span class="match__row-title-value-content">
         <span class="nav-link"><span class="nav-link__value">Gastspeler</span></span></span></div>
     </div></div>
   </div></div><div class="match__result"><ul class="points"><li>6</li></ul></div></div>`;

/* Walkover zoals de wedstrijdenlijst hem markeert: een los label in de rij,
   niet in .match__status of bij de uitslag. Er is niet gespeeld, dus er valt
   niets te berekenen. */
const walkover = (id, a, b) =>
  `<div class="match" id="${id}"><div class="match__body"><div class="match__row-wrapper">
     <div class="match__row has-won"><div class="match__row-title">
       <div class="match__row-title-value"><span class="match__row-title-value-content">${link(a)}</span></div>
     </div></div>
     <div class="match__row"><div class="match__row-title">
       <div class="match__row-title-value"><span class="match__row-title-value-content">${link(b)}</span></div>
     </div><span class="tag--warning tag match__message">Walkover</span></div>
   </div></div><div class="match__result"></div></div>`;

/* Opgave is géén walkover: er is wél gespeeld en de tegenstander heeft
   gewonnen, dus de KNLTB rekent die partij mee. */
const opgave = (id, a, b) =>
  `<div class="match" id="${id}"><div class="match__body"><div class="match__row-wrapper">
     <div class="match__row has-won"><div class="match__row-title">
       <div class="match__row-title-value"><span class="match__row-title-value-content">${link(a)}</span></div>
     </div></div>
     <div class="match__row"><div class="match__row-title">
       <div class="match__row-title-value"><span class="match__row-title-value-content">${link(b)}</span></div>
     </div><span class="tag--warning tag match__message">Opgave</span></div>
   </div></div><div class="match__result"><ul class="points"><li>6</li></ul></div></div>`;

/* Valstrik: "wo 26-8-2026" in de voettekst is woensdag, geen walkover.
   Deze stond eerder in de boot-test, maar die draait op een ratingpagina en
   daar staan geen chips meer. Hier wel, dus hier hoort hij. */
const woensdag = (id, a, b) =>
  `<div class="match" id="${id}"><div class="match__body"><div class="match__row-wrapper">
     ${rij(a, true)}${rij(b, false)}
   </div></div><div class="match__result"><ul class="points"><li>6</li></ul></div>
   <div class="match__footer"><span class="nav-link__value">wo 26-8-2026 20:30</span></div></div>`;

const wedstrijd = (id, a, b) =>
  `<div class="match" id="${id}"><div class="match__body"><div class="match__row-wrapper">
     ${rij(a, true)}${rij(b, false)}
   </div></div><div class="match__result"><ul class="points"><li>6</li></ul></div></div>`;

const PAGINA = `<!doctype html><html><body>
<div class="masthead"><div class="dropdown-menu"><ul class="dropdown-list">
  <li><a href="/player-profile/13e57c28-14f9-424e-83c4-c7e96c9546a7" title="Mijn profiel">Mijn profiel</a></li>
</ul></div></div>
<ul class="list">
  <li class="list__item">${wedstrijd("w1", 11, 12)}</li>
  <li class="list__item">${wedstrijd("w2", 11, 13)}</li>
  <li class="list__item">${dubbelHalf("w3")}</li>
  <li class="list__item">${walkover("w4", 12, 13)}</li>
  <li class="list__item">${opgave("w6", 15, 12)}</li>
  <li class="list__item">${woensdag("w7", 13, 15)}</li>
</ul>
</body></html>`;

const dom = new JSDOM(PAGINA, {
  url: "https://mijnknltb.toernooi.nl/tournament/" + TOERNOOI + "/Matches",
  pretendToBeVisual: true,
  runScripts: "outside-only",
});
const win = dom.window;

const opslag = {};
win.chrome = {
  runtime: { id: "t", onMessage: { addListener(f) { win.__onMsg = f; } }, sendMessage() {}, lastError: null },
  storage: {
    local: {
      get(keys, cb) {
        if (keys === null) return cb({ ...opslag });
        const out = {};
        for (const k of [].concat(keys)) if (k in opslag) out[k] = opslag[k];
        cb(out);
      },
      set(o, cb) { Object.assign(opslag, o); if (cb) cb(); },
      remove(keys, cb) { for (const k of [].concat(keys)) delete opslag[k]; if (cb) cb(); },
    },
  },
};

win.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ target: el, isIntersecting: true }]); }
  unobserve() {}
  disconnect() {}
};

win.fetch = (url) => {
  let html = "<html><body></body></html>";
  const aspx = String(url).match(/player=(\d+)/);
  const prof = String(url).match(/player-profile\/([0-9a-f-]{36})/i);

  if (aspx && SPELERS[aspx[1]]) {
    const s = SPELERS[aspx[1]];
    html = `<div class="masthead"><div class="dropdown-menu">
        <a href="/player-profile/13e57c28-14f9-424e-83c4-c7e96c9546a7">Mijn profiel</a></div></div>
      <div class="page-head"><div class="media__content">
        <h2 class="media__title"><a href="/player-profile/${s.uuid}"><span class="nav-link__value">${s.naam}</span></a></h2>
      </div></div>`;
  } else if (prof) {
    const s = Object.values(SPELERS).find((x) => x.uuid.toLowerCase() === prof[1].toLowerCase());
    if (s) {
      html = `<div class="page-head"><div class="media__content">
        <h2 class="media__title"><span class="nav-link__value">${s.naam}</span></h2>
        <div id="mediaContentSubinfo">
          <span title="Enkel" class="tag-duo"><span class="tag-duo__title">6</span><span class="tag-duo__value">${s.rating}</span></span>
          <span title="Dubbel" class="tag-duo"><span class="tag-duo__title">6</span><span class="tag-duo__value">${s.dubbel}</span></span>
        </div></div></div>`;
    }
  }
  return Promise.resolve({
    ok: true, status: 200, url: String(url),
    headers: { get: () => null }, text: () => Promise.resolve(html),
  });
};

const fouten = [];
win.console.error = (...a) => fouten.push(a.join(" "));

const code = files.map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
win.eval(code);

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wacht(2000);

  ok(fouten.length === 0, "geen fouten", fouten.join(" | "));

  const stap1 = win.document.querySelector("#w1 .knltb-tag.step .v");
  ok(stap1 && stap1.textContent === "6,0000 → 5,9618",
     "eerste wedstrijd doorgerekend", stap1 ? stap1.textContent : "geen");

  const stap2 = win.document.querySelector("#w2 .knltb-tag.step .v");
  ok(stap2 && stap2.textContent === "6,0000 → 5,9212",
     "tweede wedstrijd rekent los, vanaf de huidige rating",
     stap2 ? stap2.textContent : "geen");
  ok(!stap2 || !stap2.textContent.startsWith("5,9618"),
     "en stapelt dus niet door op de vorige wedstrijd",
     stap2 ? stap2.textContent : "");

  // ---- chips op een eigen regel ------------------------------------
  const regels = [...win.document.querySelectorAll("#w1 .knltb-regel, #w2 .knltb-regel")];
  ok(regels.length === 4, "elke kant krijgt een eigen regel", regels.length + " regels");
  // in het naamblok, niet in de rij: de rij bevat ook de W-markering en
  // dan zou de regel net iets anders uitlijnen dan de namen erboven
  ok(regels.every((r) => r.parentElement.classList.contains("match__row-title")),
     "die regel hangt in het naamblok");
  ok(win.document.querySelectorAll(".match__row > .knltb-delta").length === 0,
     "geen losse chips meer achter de namen");
  ok(regels.every((r) => r.closest(".match__row").classList.contains("knltb-heeft-regel")),
     "en de rij is als zodanig gemarkeerd, zodat de opmaak niet op :has() leunt");
  ok(regels.every((r) => r.querySelector(".knltb-odds") && r.querySelector(".knltb-delta")),
     "percentage en mutatie staan samen op die regel");
  ok(
    regels.every(
      (r) =>
        r.firstElementChild.classList.contains("knltb-odds") &&
        r.lastElementChild.classList.contains("knltb-delta")
    ),
    "in dezelfde volgorde, zodat ze uitlijnen"
  );

  // ---- dubbel met een onbekende partner wordt overgeslagen ----------
  ok(win.document.querySelectorAll("#w3 .knltb-delta").length === 0,
     "geen mutatie bij een dubbel waarvan één kant maar één speler heeft",
     win.document.querySelectorAll("#w3 .knltb-delta").length + " chips");
  ok(win.document.querySelectorAll("#w3 .knltb-odds").length === 0,
     "en dus ook geen winstkans");
  ok(win.document.querySelectorAll("#w3 .knltb-tag.step").length === 0,
     "en geen stap achter de namen");

  // ---- walkover volgens het label van de lijst ----------------------
  ok(win.document.querySelectorAll("#w4 .knltb-delta.wo").length === 2,
     "walkover krijgt een w.o.-chip in plaats van een mutatie",
     win.document.querySelectorAll("#w4 .knltb-delta.wo").length + " chips");
  ok(win.document.querySelectorAll("#w4 .knltb-delta.gain, #w4 .knltb-delta.drop").length === 0,
     "en dus geen doorgerekende mutatie",
     win.document.querySelectorAll("#w4 .knltb-delta.gain, #w4 .knltb-delta.drop").length + " chips");
  ok(win.document.querySelectorAll("#w4 .knltb-tag.step").length === 0,
     "en geen stap achter de namen");
  ok(win.document.querySelectorAll("#w4 .knltb-regel .knltb-delta").length === 2,
     "de w.o.-chip staat op dezelfde eigen regel als de rest",
     win.document.querySelectorAll("#w4 .knltb-regel .knltb-delta").length + "");

  // ---- opgave telt wél mee ------------------------------------------
  ok(win.document.querySelectorAll("#w6 .knltb-delta.wo").length === 0,
     "opgave krijgt geen w.o.-chip",
     win.document.querySelectorAll("#w6 .knltb-delta.wo").length + " chips");
  ok(win.document.querySelectorAll("#w6 .knltb-delta.gain, #w6 .knltb-delta.drop").length === 2,
     "maar wordt gewoon doorgerekend",
     win.document.querySelectorAll("#w6 .knltb-delta.gain, #w6 .knltb-delta.drop").length + " chips");

  // ---- woensdag is geen walkover ------------------------------------
  ok(win.document.querySelectorAll("#w7 .knltb-delta.wo").length === 0,
     "'wo 26-8-2026' in de voettekst is woensdag, geen walkover",
     win.document.querySelectorAll("#w7 .knltb-delta.wo").length + " chips");
  ok(win.document.querySelectorAll("#w7 .knltb-delta.gain, #w7 .knltb-delta.drop").length === 2,
     "en wordt gewoon doorgerekend",
     win.document.querySelectorAll("#w7 .knltb-delta.gain, #w7 .knltb-delta.drop").length + " chips");

  // ---- paneel telt de losse wedstrijden wél op ---------------------
  const paneel = win.document.getElementById("knltb-summary");
  ok(!!paneel, "het overzichtspaneel staat er nog");
  ok(paneel && paneel.textContent.includes("5,8830"),
     "en telt de mutaties van beide wedstrijden op (6,0000 − 0,1170)",
     paneel ? paneel.textContent.replace(/\s+/g, " ").slice(0, 200) : "");

  // ---- opnieuw scannen laat geen dubbele regels achter -------------
  const voor = win.document.querySelectorAll(".knltb-regel").length;
  win.__onMsg({ type: "rescan" }, {}, () => {});
  await wacht(1800);
  ok(win.document.querySelectorAll(".knltb-regel").length === voor,
     "geen regels erbij na opnieuw scannen",
     voor + " -> " + win.document.querySelectorAll(".knltb-regel").length);
  ok(win.document.querySelector("#w2 .knltb-tag.step .v").textContent === "6,0000 → 5,9212",
     "en de waarden blijven kloppen",
     win.document.querySelector("#w2 .knltb-tag.step .v").textContent);

  /* ---- wisselen van dag ------------------------------------------
     De lijst wisselt van dag via AJAX: de hele inhoud wordt vervangen.
     De observer zag dat wel, maar het ophaalbudget liep op over de
     levensduur van het tabblad en was na de eerste dag op — dus bleef
     elke volgende dag zonder ratings staan. */
  const nieuweDag = win.document.createElement("li");
  nieuweDag.className = "list__item";
  nieuweDag.innerHTML = wedstrijd("w5", 16, 13); // 16 staat nog niet in de cache
  win.document.querySelector("ul.list").appendChild(nieuweDag);
  await wacht(2500);

  // op .knltb-tag, niet op .knltb-tags: die omhulling wordt ook geplaatst
  // als er niets opgehaald is, en dan bewijst de telling niets
  ok(win.document.querySelectorAll("#w5 .knltb-tag").length === 4,
     "later ingeladen wedstrijden krijgen alsnog hun ratings (2 spelers × S en D)",
     win.document.querySelectorAll("#w5 .knltb-tag").length + " badges");
  ok(win.document.querySelectorAll("#w5 .knltb-delta").length === 2,
     "en worden ook doorgerekend",
     win.document.querySelectorAll("#w5 .knltb-delta").length + " chips");

  /* ---- diagnose kent de opmaak ------------------------------------
     Zonder deze sectie is een klacht over uitlijning niet na te rekenen:
     hoe de site zijn wedstrijden opmaakt verschilt per weergave en die
     opmaak komt niet mee in de HTML. jsdom rekent geen layout, dus de
     getallen zijn hier nul — het gaat om de structuur en om het feit dat
     het meten zelf niet omvalt. */
  let diag = null;
  win.__onMsg({ type: "diagnose" }, {}, (r) => (diag = r));
  await wacht(1500);

  ok(!!diag && !!diag.opmaak, "diagnose bevat een opmaak-sectie");
  ok(diag && diag.opmaak && !diag.opmaak.error,
     "en het meten valt niet om", diag && diag.opmaak && diag.opmaak.error);
  ok(diag && diag.opmaak && diag.opmaak.kanten && diag.opmaak.kanten.length === 2,
     "met beide kanten van de wedstrijd erin");
  const kant = diag && diag.opmaak && diag.opmaak.kanten && diag.opmaak.kanten[0];
  ok(kant && kant.chips && kant.chips.length === 2,
     "en de chips van die kant", kant && kant.chips ? kant.chips.length + "" : "geen");
  ok(kant && kant.chipregelIn === "match__row-title",
     "inclusief waar de chipregel hangt", kant ? String(kant.chipregelIn) : "-");
  ok(kant && "uitlijning" in kant,
     "en de tekstuitlijning die de chips volgen");

  /* De opmaak van de site zelf. jsdom laadt geen stylesheets, dus er staan
     hier geen regels in — het gaat erom dat het uitlezen niet omvalt en dat
     beide kanten apart worden opgenomen. Dat de regels in een echte browser
     wél gevonden worden is los nagemeten in Chromium. */
  const css = diag && diag.siteCss;
  ok(!!css && !css.error, "diagnose leest de opmaak van de site uit",
     css && css.error ? css.error : "");
  ok(css && css.elementen && css.elementen.length > 0,
     "met de sleutelelementen erin",
     css && css.elementen ? css.elementen.length + "" : "geen");
  ok(css && css.elementen &&
     css.elementen.filter((e) => e.selector.startsWith(".match__row-title ")).length === 2,
     "en allebei de kanten apart, want daar zit het verschil",
     css && css.elementen
       ? css.elementen.filter((e) => e.selector.startsWith(".match__row-title ")).length + ""
       : "-");

  ok(fouten.length === 0, "geen fouten aan het eind", fouten.join(" | "));
  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})();
