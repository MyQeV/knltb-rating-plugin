/* Opstarttest voor een schemapagina (/tournament/<id>/draw/N).
 *
 * Aparte pagina, aparte code: hier draaien projectBrackets(), de swiper-
 * kolommen, byes en lege plekken. Als het content script hier omvalt kun je
 * niet eens diagnostiseren, want dan is er niemand die de vraag beantwoordt.
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

const rij = (naam, nr) => `<div class="match__row-title"><div class="match__row-title-value">
  <span class="match__row-title-value-content">
    <a href="/sport/player.aspx?id=E8&amp;player=${nr}" class="nav-link"><span class="nav-link__value">${naam}</span></a>
  </span></div></div>`;

const PAGINA = `<!doctype html><html><body>
<div class="masthead"><div class="dropdown-menu"><ul class="dropdown-list">
  <li><a href="/player-profile/13e57c28-14f9-424e-83c4-c7e96c9546a7" title="Mijn profiel">
    <span class="nav-link__value">Mijn profiel</span></a></li></ul></div></div>

<div class="page-subhead"><h4 class="media__title">Tennis HD6</h4></div>

<div class="bracket js-bracket">
  <div class="swiper-bracket-header"><div class="swiper-subheadings-container">
    <div class="subheading js-subheading">Ronde van 16</div>
    <div class="subheading js-subheading">Kwartfinale</div>
  </div></div>
  <swiper-container>
    <swiper-slide class="bracket-round__item" aria-label="1 / 2">
      <div class="bracket-round__match-group">
        <div class="match"><div class="match__body"><div class="match__row-wrapper">
          <div class="match__row has-won">${rij("Bas van der Berg", 202)}</div>
          <div class="match__row"><div class="match__row-title"><div class="match__row-title-value">
            <span class="match__row-title-value-content"><span class="nav-link"><span class="nav-link__value">Bye</span></span></span>
          </div></div></div>
        </div></div>
        <div class="match__footer"><span class="nav-link__value"></span></div></div>

        <div class="match"><div class="match__body"><div class="match__row-wrapper">
          <div class="match__row">${rij("Ren\u00e9 Visser", 208)}</div>
          <div class="match__row has-won">${rij("Jesse de Wit", 209)}</div>
        </div></div>
        <div class="match__footer"><span class="nav-link__value">di 25-8-2026 18:30</span></div></div>
      </div>
    </swiper-slide>
    <swiper-slide class="bracket-round__item" aria-label="2 / 2">
      <div class="bracket-round__match-group">
        <div class="match"><div class="match__body"><div class="match__row-wrapper">
          <div class="match__row"><div class="match__row-title"></div></div>
          <div class="match__row"><div class="match__row-title"></div></div>
        </div></div>
        <div class="match__footer"><span class="nav-link__value">wo 26-8-2026 21:30</span></div></div>
      </div>
    </swiper-slide>
  </swiper-container>
</div>
</body></html>`;

const dom = new JSDOM(PAGINA, {
  url: "https://mijnknltb.toernooi.nl/tournament/CCCCCCCC-1111-2222-3333-444444444444/draw/12",
  pretendToBeVisual: true,
  runScripts: "outside-only",
});
const win = dom.window;

const opslag = {};
let luisteraars = 0;
win.chrome = {
  runtime: {
    id: "test",
    onMessage: { addListener() { luisteraars++; } },
    sendMessage() {},
    lastError: null,
  },
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
win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
win.fetch = () => Promise.resolve({
  ok: true, status: 200, url: "x", headers: { get: () => null },
  text: () => Promise.resolve("<html></html>"),
});

const fouten = [];
win.console.error = (...a) => fouten.push(a.join(" "));

const code = files.map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");

console.log("schemapagina, " + files.length + " scripts");
let crash = null;
try { win.eval(code); } catch (e) { crash = e; }

ok(!crash, "scripts laden zonder uitzondering", crash ? String(crash) : "");
ok(luisteraars > 0, "luistert naar berichten (anders kun je niet diagnostiseren)", luisteraars + " luisteraar(s)");
ok(fouten.length === 0, "geen fouten tijdens opstarten", fouten.join(" | "));

setTimeout(() => {
  ok(!!win.document.getElementById("knltb-dash-btn"), "dashboardknop staat er");
  ok(fouten.length === 0, "ook daarna geen fouten", fouten.join(" | "));
  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
}, 900);
