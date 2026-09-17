/* Opstarttest.
 *
 * Laadt alle content scripts precies zoals Chrome dat doet — in volgorde,
 * in één scope — en kijkt of de extensie zonder fouten opstart en zijn werk
 * doet op een nagebootste mijnknltb-pagina.
 *
 * Aanleiding: bij een refactor verdween addDashboardButton() terwijl de
 * aanroep bleef staan. Die aanroep stond vóór start(), dus de extensie deed
 * op élke pagina niets meer — en dat was aan niets te zien. Een losse
 * syntaxcontrole vindt zoiets niet; dit wel.
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

const PAGINA = `<!doctype html><html><body>
<div class="masthead"><div class="dropdown-menu"><ul class="dropdown-list">
  <li><a href="/player-profile/13e57c28-14f9-424e-83c4-c7e96c9546a7" title="Mijn profiel">
    <span class="nav-link__value">Mijn profiel</span></a></li>
</ul></div></div>
<div class="page-head"><div class="media__content">
  <h2 class="media__title"><span class="nav-link__value">Mike Verhaar</span></h2>
  <div id="mediaContentSubinfo">
    <span title="Enkel" class="tag-duo"><span class="tag-duo__title">8</span><span class="tag-duo__value">7,8265</span></span>
    <span title="Dubbel" class="tag-duo"><span class="tag-duo__title">6</span><span class="tag-duo__value">5,7033</span></span>
  </div>
</div></div>
<div class="match">
  <div class="match__header"><div class="match__header-aside">
    <span class="tag tag--danger"><span>0,1221</span></span></div></div>
  <div class="match__row-wrapper">
    <div class="match__row has-won"><div class="match__row-title">
      <div class="match__row-title-value"><span class="match__row-title-value-content">
        <a href="/sport/player.aspx?id=E5&amp;player=101" class="nav-link"><span class="nav-link__value">Fleur Jansen</span></a>
        <span class="match__row-title-aside"> (6,7593)</span></span></div>
      <div class="match__row-title-value"><span class="match__row-title-value-content">
        <a href="/sport/player.aspx?id=E5&amp;player=102" class="nav-link"><span class="nav-link__value">Bram Smit</span></a>
        <span class="match__row-title-aside"> (5,8261)</span></span></div>
    </div></div>
    <div class="match__row"><div class="match__row-title">
      <div class="match__row-title-value"><span class="match__row-title-value-content">
        <a href="/sport/player.aspx?id=E5&amp;player=3868" class="nav-link"><span class="nav-link__value">Mike Verhaar</span></a>
        <span class="match__row-title-aside"> (5,5812)</span></span></div>
      <div class="match__row-title-value"><span class="match__row-title-value-content">
        <a href="/sport/player.aspx?id=E5&amp;player=103" class="nav-link"><span class="nav-link__value">Lotte van Dijk</span></a>
        <span class="match__row-title-aside"> (7,2280)</span></span></div>
    </div></div>
  </div>
  <div class="match__btn"><a class="match__btn-h2h" href="/head-2-head?OrganizationCode=630BAE5F-36FE-42EA-A2E5-999630ABFEB8&amp;T1P1MemberID=12345678&amp;T1P2MemberID=23456789&amp;T2P1MemberID=30340969&amp;T2P2MemberID=34567890">H2H</a></div>
</div>

<!-- walkover, met de valstrik: de voettekst zegt "wo 26-8-2026" (woensdag) -->
<div class="match" id="wo-match">
  <div class="match__header"><div class="match__header-aside">
    <span class="tag tag--danger"><span>0,0500</span></span></div></div>
  <div class="match__row-wrapper">
    <div class="match__row has-won"><div class="match__row-title">
      <div class="match__row-title-value"><span class="match__row-title-value-content">
        <a href="/sport/player.aspx?id=E5&amp;player=101" class="nav-link"><span class="nav-link__value">Fleur Jansen</span></a>
        <span class="match__row-title-aside"> (6,7593)</span></span></div>
    </div><span class="tag match__status">w.o.</span></div>
    <div class="match__row"><div class="match__row-title">
      <div class="match__row-title-value"><span class="match__row-title-value-content">
        <a href="/sport/player.aspx?id=E5&amp;player=3868" class="nav-link"><span class="nav-link__value">Mike Verhaar</span></a>
        <span class="match__row-title-aside"> (5,5812)</span></span></div>
    </div></div>
  </div>
  <div class="match__result"></div>
  <div class="match__footer"><span class="nav-link__value">wo 26-8-2026</span></div>
</div>

<!-- gewone enkelwedstrijd, ook met "wo" in de voet -->
<div class="match" id="gewoon-match">
  <div class="match__header"><div class="match__header-aside"></div></div>
  <div class="match__row-wrapper">
    <div class="match__row has-won"><div class="match__row-title">
      <div class="match__row-title-value"><span class="match__row-title-value-content">
        <a href="/sport/player.aspx?id=E5&amp;player=102" class="nav-link"><span class="nav-link__value">Bram Smit</span></a>
        <span class="match__row-title-aside"> (5,8261)</span></span></div>
    </div></div>
    <div class="match__row"><div class="match__row-title">
      <div class="match__row-title-value"><span class="match__row-title-value-content">
        <a href="/sport/player.aspx?id=E5&amp;player=103" class="nav-link"><span class="nav-link__value">Lotte van Dijk</span></a>
        <span class="match__row-title-aside"> (7,2280)</span></span></div>
    </div></div>
  </div>
  <div class="match__result"><ul class="points"><li>6</li><li>3</li></ul></div>
  <div class="match__footer"><span class="nav-link__value">wo 26-8-2026</span></div>
</div>
</body></html>`;

const dom = new JSDOM(PAGINA, {
  url: "https://mijnknltb.toernooi.nl/player-profile/13e57c28-14f9-424e-83c4-c7e96c9546a7/Rating",
  pretendToBeVisual: true,
  // zonder dit draait window.eval in de Node-scope in plaats van in de pagina
  runScripts: "outside-only",
});
const win = dom.window;

// wat Chrome levert en jsdom niet heeft
const opslag = {};
win.chrome = {
  runtime: { id: "test", onMessage: { addListener() {} }, sendMessage() {}, lastError: null },
  storage: {
    local: {
      get(keys, cb) {
        if (keys === null) return cb({ ...opslag });
        const lijst = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of lijst) if (k in opslag) out[k] = opslag[k];
        cb(out);
      },
      set(obj, cb) {
        Object.assign(opslag, obj);
        if (cb) cb();
      },
      remove(keys, cb) {
        for (const k of [].concat(keys)) delete opslag[k];
        if (cb) cb();
      },
    },
  },
};
win.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
win.fetch = () =>
  Promise.resolve({ ok: true, status: 200, url: "x", headers: { get: () => null }, text: () => Promise.resolve("<html></html>") });

const fouten = [];
win.console.error = (...a) => fouten.push(a.join(" "));

const code = files.map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");

console.log("opstarten met " + files.length + " scripts: " + files.join(", "));
let crash = null;
try {
  win.eval(code);
} catch (e) {
  crash = e;
}

ok(!crash, "scripts laden zonder uitzondering", crash ? String(crash) : "");
ok(fouten.length === 0, "geen fouten tijdens opstarten", fouten.join(" | "));

/* Dezelfde pagina nog eens, maar nu faalt een onderdeel asynchroon: het
   opruimen van de cache leest als enige de hele opslag in, en die gooit hier.
   Dat hoort gemeld te worden als elke andere opstartfout, en de onderdelen
   erna — de dashboardknop — horen gewoon door te gaan. */
const win2 = new JSDOM(PAGINA, {
  url: "https://mijnknltb.toernooi.nl/player-profile/13e57c28-14f9-424e-83c4-c7e96c9546a7/Rating",
  pretendToBeVisual: true,
  runScripts: "outside-only",
}).window;
win2.chrome = {
  runtime: win.chrome.runtime,
  storage: {
    local: {
      get(keys, cb) {
        if (keys === null) throw new Error("opslag kapot");
        cb({});
      },
      set(obj, cb) {
        if (cb) cb();
      },
      remove(keys, cb) {
        if (cb) cb();
      },
    },
  },
};
win2.IntersectionObserver = win.IntersectionObserver;
win2.fetch = win.fetch;
const fouten2 = [];
win2.console.error = (...a) => fouten2.push(a.join(" "));
let crash2 = null;
try {
  win2.eval(code);
} catch (e) {
  crash2 = e;
}

ok(!crash2, "tweede venster laadt zonder uitzondering", crash2 ? String(crash2) : "");

// de instellingen komen uit chrome.storage, dus alles op de pagina verschijnt
// pas ná het laden; de chips bovendien na een debounce
setTimeout(() => {
  ok(!!win.document.getElementById("knltb-dash-btn"), "dashboardknop staat op de pagina");

  /* Dit is een ratingpagina. Daar toont de site zelf al de mutatie per
     wedstrijd, dus zet de extensie er geen chip per rij bij — het vinkje
     hieronder draagt ons eigen getal. De chips zelf worden getest op de
     wedstrijdenlijst, waar ze wél horen. */
  const chips = win.document.querySelectorAll(".knltb-delta");
  ok(chips.length === 0, "geen mutatiechip per rij op een ratingpagina",
     chips.length + " gevonden");

  const check = win.document.querySelector(".knltb-check");
  ok(!!check, "controlebadge naast de waarde van de KNLTB", check ? check.textContent : "geen");
  ok(check && check.classList.contains("ok"), "en die klopt", check ? check.className : "");
  ok(
    check && check.textContent.startsWith("+0,1221"),
    "met de juiste waarde",
    check ? check.textContent : ""
  );

  const alt = win.document.querySelector(".knltb-alt");
  ok(!!alt, "de andere uitkomst staat erbij", alt ? alt.textContent : "geen");
  ok(alt && alt.textContent.includes("−0,1529"), "met de juiste waarde", alt ? alt.textContent : "");

  /* Een walkover blijft buiten de berekening: geen vinkje, ook al zet de
     pagina er een waarde bij. */
  ok(win.document.querySelectorAll("#wo-match .knltb-check").length === 0,
     "walkover wordt niet nagerekend",
     win.document.querySelectorAll("#wo-match .knltb-check").length + " vinkjes");

  /* En de valstrik: "wo 26-8-2026" in de voettekst is woensdag. Die wedstrijd
     hoort gewoon meegeteld te worden — zichtbaar doordat hij is doorgerekend. */
  const gewoon = win.document.getElementById("gewoon-match");
  ok(gewoon && gewoon.dataset.knltbDelta === "1",
     "'wo 26-8-2026' in de voettekst is woensdag, geen walkover",
     gewoon ? String(gewoon.dataset.knltbDelta) : "geen blok");

  ok(fouten.length === 0, "nog steeds geen fouten", fouten.join(" | "));

  ok(fouten2.join(" | ") === "[KNLTB] cache opruimen mislukt: Error: opslag kapot",
     "een asynchroon falend onderdeel wordt gemeld", fouten2.join(" | ") || "niets gemeld");
  ok(!!win2.document.getElementById("knltb-dash-btn"), "en houdt de dashboardknop niet tegen");

  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
}, 900);
