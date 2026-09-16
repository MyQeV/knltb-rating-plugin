/* De ratingpagina van een speler (/player-profile/<uuid>/Rating).
 *
 * Daar zet de site zelf al bij elke wedstrijd de rating van dat moment en de
 * mutatie die de KNLTB heeft toegepast. De extensie rekent die na en zet er
 * een vinkje bij. Dat vinkje viel bij een deel van de wedstrijden weg, en de
 * diagnose wees twee oorzaken aan:
 *
 *   1. De officiële mutatie staat niet altijd in een `.tag`. Bij een deel
 *      van de wedstrijden is het kale tekst in dezelfde kop, met een eigen
 *      minteken. Alleen naar de tag kijken liet die vorm onopgemerkt.
 *   2. De sleutel van de pagina komt van de profiel-URL, die van de spelers
 *      in de wedstrijden van hun bondsnummer — die matchen nooit, dus hing
 *      de controle volledig op de naamvergelijking.
 *
 * Verder hoort hier géén badge achter de naam en géén "voor → na": dat staat
 * er van de site al. De winstkans wél.
 *
 * En alleen een link naar een speler telt als speler. De H2H-knop en een
 * clublink staan in hetzelfde naamblok als de rating van dat moment; wie
 * elke <a> in de rij meeneemt leest voor allebei die rating af en maakt van
 * een enkel een kant met drie spelers.
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

const MIJ = "13e57c28-14f9-424e-83c4-c7e96c9546a7";

/* Twee enkelwedstrijden met precies dezelfde cijfers, zodat het verschil
   tussen beide alleen in de vorm van de kop zit:

     8,2719 verliest van 9,1191   ->  q 1,824 ; P = 0,8241 ; K(P-1) = -0,0484
   De KNLTB toont -0,0483; dat scheelt een halve honderdduizendste door
   afronding, dus het vinkje mag daar "niet gelijk" van maken — waar het hier
   om gaat is dát er een vinkje staat. */
const speler = (nr, naam, rating, gewonnen, extra = "") =>
  `<div class="match__row${gewonnen ? " has-won" : ""}"><div class="match__row-title">
     <div class="match__row-title-value">
       <span class="match__row-title-value-content">
         <a href="/sport/player.aspx?id=DDDDDDDD-1111-2222-3333-444444444444&amp;player=${nr}"
            class="nav-link"><span class="nav-link__value">${naam}</span></a>${extra}
       </span>
       <span class="match__row-title-aside">(${rating})</span>
     </div>
   </div></div>`;

const wedstrijd = (id, kop, extra) => `
<div class="match" id="${id}">
  <div class="match__header">
    <ul class="match__header-title"><li>Voorbeeld Open Tennis HE C (8.0546 - 9.2975) Finale</li></ul>
    <div class="match__header-aside">${kop}</div>
  </div>
  <div class="match__body"><div class="match__row-wrapper">
    ${speler(1359, "Mike Verhaar", "8,2719", false, extra)}
    ${speler(1880, "Stijn van Es", "9,1191", true)}
  </div>
  <div class="match__result"><ul class="points"><li>2</li></ul></div>
  </div>
</div>`;

/* Naast de spelerslink de H2H-knop en een clublink, in hetzelfde naamblok
   als de rating van dat moment. Geen van beide wijst naar een speler. */
const KNOPPEN =
  ' <a class="match__btn-h2h" href="/head-2-head?OrganizationCode=630BAE5F-36FE-42EA-A2E5-999630ABFEB8' +
  '&amp;T1P1MemberID=30340969&amp;T2P1MemberID=12345678">H2H</a>' +
  ' <a href="/club/l-t-c-smash">L.T.C. Smash</a>';

const PAGINA = `<!doctype html><html><body>
<div class="masthead"><div class="dropdown-menu"><ul class="dropdown-list">
  <li><a href="/player-profile/${MIJ}" title="Mijn profiel">Mijn profiel</a></li>
</ul></div></div>

<div class="page-head"><div class="media__content">
  <h2 class="media__title"><span class="nav-link__value">Mike Verhaar</span>
    <span class="media__title-aside">(30340969)</span></h2>
  <div id="mediaContentSubinfo">
    <span title="Enkel" class="tag-duo"><span class="tag-duo__title">8</span><span class="tag-duo__value">7,8265</span></span>
  </div>
</div></div>

<ul class="list">
  <!-- vorm 1: in een tag, teken uit de kleur -->
  <li>${wedstrijd("m1", '<span class="tag"><span>0,0483</span></span>')}</li>
  <!-- vorm 2: kale tekst met een eigen minteken -->
  <li>${wedstrijd("m2", "1h 20m −0,0483")}</li>
  <!-- vorm 3: een getal zonder teken; richting onbekend, dus niets beweren -->
  <li>${wedstrijd("m3", "1h 20m 0,0483")}</li>
  <!-- vorm 4: zoals de site het echt doet — eerst de speelduur als tag,
       dan pas de mutatie. Bij verlies (tag--danger) staat er geen teken in
       de tekst, dus wie de eerste tag pakt vindt hier nooit iets. -->
  <li>${wedstrijd(
    "m4",
    '<span class="tag tag--placeholder"> <time datetime="PT47M">47m</time> </span>' +
      ' <span class="tag tag--danger"> <span>0,0483</span> </span>'
  )}</li>
  <!-- vorm 5: als m1, maar met de H2H-knop en een clublink naast de naam -->
  <li>${wedstrijd("m5", '<span class="tag"><span>0,0483</span></span>', KNOPPEN)}</li>
</ul>
</body></html>`;

const dom = new JSDOM(PAGINA, {
  url: "https://mijnknltb.toernooi.nl/player-profile/" + MIJ + "/Rating",
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

// de ratings staan hier op de pagina zelf, dus er hoort niets opgehaald te worden
let fetches = 0;
win.fetch = (url) => {
  fetches++;
  return Promise.resolve({
    ok: true, status: 200, url: String(url),
    headers: { get: () => null },
    text: () => Promise.resolve("<html><body></body></html>"),
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

  const tel = (sel) => win.document.querySelectorAll(sel).length;

  // ---- de controle staat er bij beide vormen van de kop ---------------
  ok(tel("#m1 .knltb-check") === 1,
     "vinkje bij een mutatie in een tag", tel("#m1 .knltb-check") + "");
  ok(tel("#m2 .knltb-check") === 1,
     "vinkje bij een mutatie als kale tekst", tel("#m2 .knltb-check") + "");
  ok(tel("#m3 .knltb-check") === 0,
     "maar niet bij een getal zonder teken — dan is de richting onbekend",
     tel("#m3 .knltb-check") + "");
  ok(tel("#m4 .knltb-check") === 1,
     "vinkje ook als de speelduur als eerste tag voor de mutatie staat",
     tel("#m4 .knltb-check") + "");

  // ---- wat hier niet hoort -------------------------------------------
  ok(tel(".knltb-tag") === 0,
     "geen ratingbadge achter de namen: die staat er van de site al",
     tel(".knltb-tag") + "");
  ok(tel(".knltb-tag.step") === 0, "en geen voor → na");

  // ---- wat hier wel hoort --------------------------------------------
  ok(tel("#m1 .knltb-odds") === 2,
     "winstkans per kant blijft staan", tel("#m1 .knltb-odds") + "");
  ok(tel(".knltb-delta") === 0,
     "geen mutatiechip per rij: dat getal staat al in de controle bovenaan",
     tel(".knltb-delta") + "");

  // ---- alleen een spelerslink telt als speler ------------------------
  ok(tel("#m5 .knltb-check") === 1,
     "vinkje ook met de H2H-knop en een clublink naast de naam",
     tel("#m5 .knltb-check") + "");
  ok(tel("#m5 .knltb-odds") === 2,
     "één winstkans per kant: de knoppen zijn geen extra speler",
     tel("#m5 .knltb-odds") + "");
  const kansen = (id) =>
    [...win.document.querySelectorAll("#" + id + " .knltb-odds")].map((e) => e.textContent).join(" ");
  ok(kansen("m5") === kansen("m1"),
     "en dezelfde winstkansen als zonder die knoppen: een enkel van twee spelers",
     kansen("m5") + " tegenover " + kansen("m1"));

  // wat de doorrekening per wedstrijd aan spelers ziet
  let diag = null;
  win.__onMsg({ type: "diagnose" }, {}, (r) => (diag = r));
  await wacht(1500);
  const teams = diag && Array.isArray(diag.matches)
    ? diag.matches.map((m) => m.teams.map((t) => t.map((p) => p.naam).join(" + ")).join(" tegen "))
    : null;
  ok(teams && teams.length === 5,
     "alle vijf wedstrijden worden doorgerekend", teams ? teams.length + "" : "geen diagnose");
  ok(teams && teams.every((t) => t === "Mike Verhaar tegen Stijn van Es"),
     "elk met precies de twee spelers: H2H en L.T.C. Smash zijn geen naam",
     teams ? teams.join(" | ") : "");

  ok(fouten.length === 0, "geen fouten aan het eind", fouten.join(" | "));
  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})();
