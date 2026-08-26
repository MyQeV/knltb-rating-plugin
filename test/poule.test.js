/* Een poule (/draw/N zonder afvalschema).
 *
 * Ook hier mag er niet gestapeld worden: een poule is een raster, geen
 * tijdlijn — uit de opmaak valt niet af te leiden welke wedstrijd eerder
 * gespeeld is. Alleen in een afvalschema ligt die volgorde vast.
 *
 *   A 6,0000 wint van B 7,0000   ->  6,0000 -> 5,9618
 *   A 6,0000 wint van C 6,5000   ->  6,0000 -> 5,9212   (los gerekend)
 *                                    5,9618 -> 5,8868   (gestapeld: fout hier)
 *
 * De chips blijven hier wél achter de namen staan: dat is alleen op de
 * wedstrijdenlijst een probleem.
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
  11: { uuid: "dddddddd-0000-0000-0000-000000000001", naam: "Speler A", rating: "6,0000" },
  12: { uuid: "dddddddd-0000-0000-0000-000000000002", naam: "Speler B", rating: "7,0000" },
  13: { uuid: "dddddddd-0000-0000-0000-000000000003", naam: "Speler C", rating: "6,5000" },
};

const link = (nr) =>
  `<a href="/sport/player.aspx?id=${TOERNOOI}&amp;player=${nr}" class="nav-link"><span class="nav-link__value">${SPELERS[nr].naam}</span></a>`;
const rij = (nr, gewonnen) =>
  `<div class="match__row${gewonnen ? " has-won" : ""}"><div class="match__row-title">
     <div class="match__row-title-value"><span class="match__row-title-value-content">${link(nr)}</span></div>
   </div></div>`;
const wedstrijd = (id, a, b) =>
  `<div class="match" id="${id}"><div class="match__body"><div class="match__row-wrapper">
     ${rij(a, true)}${rij(b, false)}
   </div></div><div class="match__result"><ul class="points"><li>6</li></ul></div></div>`;

const PAGINA = `<!doctype html><html><body>
<div class="masthead"><div class="dropdown-menu"><ul class="dropdown-list">
  <li><a href="/player-profile/13e57c28-14f9-424e-83c4-c7e96c9546a7" title="Mijn profiel">Mijn profiel</a></li>
</ul></div></div>
<div class="page-subhead"><h4 class="media__title">Tennis HE6 poule A</h4></div>
<table class="ruler"><caption>Poule A</caption><tbody><tr><td>Speler A</td></tr></tbody></table>
<ul class="list">
  <li class="list__item">${wedstrijd("w1", 11, 12)}</li>
  <li class="list__item">${wedstrijd("w2", 11, 13)}</li>
</ul>
</body></html>`;

const dom = new JSDOM(PAGINA, {
  url: "https://mijnknltb.toernooi.nl/tournament/" + TOERNOOI + "/draw/4",
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

  // ---- chips blijven hier achter de namen staan ---------------------
  ok(win.document.querySelectorAll(".knltb-regel").length === 0,
     "geen aparte regel in een poule",
     win.document.querySelectorAll(".knltb-regel").length + " regels");
  ok(win.document.querySelectorAll(".match__row > .knltb-delta").length === 4,
     "de mutatie staat gewoon achter de namen",
     win.document.querySelectorAll(".match__row > .knltb-delta").length + " chips");

  // ---- paneel telt de losse wedstrijden wél op ---------------------
  const paneel = win.document.getElementById("knltb-summary");
  ok(!!paneel, "het overzichtspaneel staat er nog");
  ok(paneel && paneel.textContent.includes("5,8830"),
     "en telt de mutaties van beide wedstrijden op (6,0000 − 0,1170)",
     paneel ? paneel.textContent.replace(/\s+/g, " ").slice(0, 200) : "");

  // ---- opnieuw scannen laat geen dubbele chips achter --------------
  const voor = win.document.querySelectorAll(".knltb-delta").length;
  win.__onMsg({ type: "rescan" }, {}, () => {});
  await wacht(1800);
  ok(win.document.querySelectorAll(".knltb-delta").length === voor,
     "geen chips erbij na opnieuw scannen",
     voor + " -> " + win.document.querySelectorAll(".knltb-delta").length);
  ok(win.document.querySelector("#w2 .knltb-tag.step .v").textContent === "6,0000 → 5,9212",
     "en de waarden blijven kloppen",
     win.document.querySelector("#w2 .knltb-tag.step .v").textContent);

  ok(fouten.length === 0, "geen fouten aan het eind", fouten.join(" | "));
  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})();
