/* Een winnaar die doorschuift naar een ronde waar de tegenstander nog
 * onbekend is.
 *
 * Zo'n wedstrijd valt buiten de doorrekening — er valt niets te rekenen
 * zolang de andere kant leeg is. Het gevolg was dat de badge van de
 * doorgeschoven speler op zijn live rating bleef staan, alsof hij die
 * vorige ronde nooit gewonnen had.
 *
 *   ronde 1   A 6,0000 wint van B 7,0000   ->  A wordt 5,9618
 *             C tegen D is nog niet gespeeld
 *   ronde 2   A staat er alleen
 *             fout  : 6,0000   (live rating)
 *             goed  : 5,9618   (na de gewonnen ronde)
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

const SPELERS = {
  11: { uuid: "bbbbbbbb-0000-0000-0000-000000000001", naam: "Speler A", rating: "6,0000" },
  12: { uuid: "bbbbbbbb-0000-0000-0000-000000000002", naam: "Speler B", rating: "7,0000" },
  13: { uuid: "bbbbbbbb-0000-0000-0000-000000000003", naam: "Speler C", rating: "6,5000" },
  14: { uuid: "bbbbbbbb-0000-0000-0000-000000000004", naam: "Speler D", rating: "6,6000" },
};

const link = (nr) =>
  `<a href="/sport/player.aspx?id=T1&amp;player=${nr}" class="nav-link"><span class="nav-link__value">${SPELERS[nr].naam}</span></a>`;
const rij = (nr, gewonnen) =>
  `<div class="match__row${gewonnen ? " has-won" : ""}"><div class="match__row-title">
     <div class="match__row-title-value"><span class="match__row-title-value-content">${link(nr)}</span></div>
   </div></div>`;

// leeg vak: twee rijen met een lege cel, precies zoals de site die laat staan
const leegVak = `<div class="match__row"><div class="match__row-title">
    <div class="match__row-title-value"></div>
  </div></div>`;

const PAGINA = `<!doctype html><html><body>
<div class="masthead"><div class="dropdown-menu"><ul class="dropdown-list">
  <li><a href="/player-profile/13e57c28-14f9-424e-83c4-c7e96c9546a7" title="Mijn profiel">Mijn profiel</a></li>
</ul></div></div>
<div class="page-subhead"><h4 class="media__title">Tennis HE6</h4></div>
<div class="bracket">
  <swiper-container>
    <swiper-slide class="bracket-round__item" aria-label="1 / 2">
      <div class="bracket-round__match-group">
        <div class="match" id="m1"><div class="match__body"><div class="match__row-wrapper">
          ${rij(11, true)}${rij(12, false)}
        </div></div><div class="match__result"><ul class="points"><li>6</li></ul></div></div>
        <div class="match" id="m2"><div class="match__body"><div class="match__row-wrapper">
          ${rij(13, false)}${rij(14, false)}
        </div></div><div class="match__result"></div></div>
      </div>
    </swiper-slide>
    <swiper-slide class="bracket-round__item" aria-label="2 / 2">
      <div class="bracket-round__match-group">
        <div class="match" id="m3"><div class="match__body"><div class="match__row-wrapper">
          ${leegVak}${leegVak}
        </div></div></div>
      </div>
    </swiper-slide>
  </swiper-container>
</div>
</body></html>`;

const dom = new JSDOM(PAGINA, {
  url: "https://mijnknltb.toernooi.nl/tournament/bbbbbbbb-1111-2222-3333-444444444444/draw/1",
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

const waarde = (sel) => {
  const v = win.document.querySelector(sel);
  return v ? v.textContent : "";
};

(async () => {
  await wacht(2000);

  ok(fouten.length === 0, "geen fouten", fouten.join(" | "));

  ok(waarde("#m1 .knltb-tag.step .v") === "6,0000 → 5,9618",
     "ronde 1 wordt doorgerekend", waarde("#m1 .knltb-tag.step .v"));

  const proj = [...win.document.querySelectorAll("#m3 .knltb-proj")];
  ok(proj.length === 1, "alleen de winnaar staat in de volgende ronde",
     proj.length + " gevonden");

  const tag = win.document.querySelector("#m3 .knltb-proj .knltb-tag");
  const v = tag && tag.querySelector(".v");

  ok(v && v.textContent === "5,9618",
     "en toont de rating na zijn gewonnen ronde, niet de live rating",
     v ? v.textContent : "geen badge");
  ok(v && v.dataset.live === "6,0000", "de live rating blijft bewaard",
     v ? String(v.dataset.live) : "-");
  ok(tag && tag.classList.contains("carried"),
     "gemarkeerd als meegenomen stand");

  // de tegenoverliggende kant is nog onbekend: daar hoort niets te staan
  ok(win.document.querySelectorAll("#m3 .knltb-delta").length === 0,
     "geen mutatie zolang de tegenstander onbekend is");

  // en na een hertekening nog steeds goed
  win.__onMsg({ type: "rescan" }, {}, () => {});
  await wacht(1800);
  ok(waarde("#m3 .knltb-proj .knltb-tag .v") === "5,9618",
     "ook na opnieuw scannen", waarde("#m3 .knltb-proj .knltb-tag .v"));

  ok(fouten.length === 0, "geen fouten aan het eind", fouten.join(" | "));
  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})();
