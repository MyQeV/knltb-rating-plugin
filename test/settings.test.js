/* Instellingen moeten meteen effect hebben, langs het pad dat het betreffende
 * onderdeel ook écht opnieuw tekent.
 *
 *   showSingle/showDouble/hideWhenNoRating/allowGuess  -> de badges achter de
 *     namen. Die worden alleen in processLinks/renderTags gemaakt; rerunDeltas
 *     raakt ze niet aan, dus die vlaggen leken niets te doen tot je opnieuw
 *     scande.
 *   enabled -> alles. Werd alleen in processLinks gelezen, waardoor het
 *     ratingverloop, de dashboardknop en alles wat er al stond bleven staan.
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
  11: { uuid: "eeeeeeee-0000-0000-0000-000000000001", naam: "Speler A", rating: "6,0000" },
  12: { uuid: "eeeeeeee-0000-0000-0000-000000000002", naam: "Speler B", rating: "7,0000" },
  13: { uuid: "eeeeeeee-0000-0000-0000-000000000003", naam: "Speler C", rating: "6,5000" },
  14: { uuid: "eeeeeeee-0000-0000-0000-000000000004", naam: "Speler D", rating: "6,6000" },
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
  url: "https://mijnknltb.toernooi.nl/tournament/eeeeeeee-1111-2222-3333-444444444444/draw/1",
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

  const tel = (sel) => win.document.querySelectorAll(sel).length;
  const stuur = async (o, ms = 1500) => {
    win.__onMsg({ type: "settings", settings: o }, {}, () => {});
    await wacht(ms);
  };

  ok(tel(".knltb-tag--single") > 0, "enkelbadges staan er", tel(".knltb-tag--single") + "");
  ok(!!win.document.getElementById("knltb-dash-btn"), "dashboardknop staat er");

  // ---- badge-instelling werkt zonder opnieuw scannen ----------------
  await stuur({ showSingle: false });
  ok(tel(".knltb-tag--single") === 0,
     "enkelrating uitzetten haalt de badges meteen weg",
     tel(".knltb-tag--single") + " over");

  await stuur({ showSingle: true });
  ok(tel(".knltb-tag--single") > 0, "en aanzetten brengt ze terug",
     tel(".knltb-tag--single") + "");

  // ---- uit is ook echt uit ------------------------------------------
  await stuur({ enabled: false });
  ok(tel(".knltb-tags") === 0, "uitzetten haalt de badges weg", tel(".knltb-tags") + " over");
  ok(tel(".knltb-delta") === 0, "en de mutaties", tel(".knltb-delta") + " over");
  ok(!win.document.getElementById("knltb-summary"), "en het paneel");
  ok(!win.document.getElementById("knltb-dash-btn"), "en de dashboardknop");

  // een instelling wisselen terwijl de extensie uit staat mag niets terugtoveren
  await stuur({ showOdds: false });
  await stuur({ showOdds: true });
  ok(tel(".knltb-delta") + tel(".knltb-odds") === 0,
     "een andere instelling wisselen tekent niets terug terwijl hij uit staat",
     tel(".knltb-delta") + tel(".knltb-odds") + " elementen");

  await stuur({ enabled: true }, 2500);
  ok(tel(".knltb-tags") > 0, "weer aanzetten bouwt alles opnieuw op", tel(".knltb-tags") + "");
  ok(tel(".knltb-delta") > 0, "inclusief de mutaties", tel(".knltb-delta") + "");
  ok(!!win.document.getElementById("knltb-dash-btn"), "en de dashboardknop");

  ok(fouten.length === 0, "geen fouten aan het eind", fouten.join(" | "));

  /* ---- opstarten terwijl hij al uit staat --------------------------
     Het omschakelen hierboven ruimt alles op via resetPage(); dat verhult
     of de onderdelen zichzelf ook tegenhouden. Een verse pagina met
     enabled:false in de opslag is de echte proef: `processLinks` keek er
     wél naar, maar het ratingverloop en de dashboardknop draaiden in de
     bootreeks daarvóór en trokken zich er niets van aan. */
  const dom2 = new JSDOM(PAGINA, {
    url: "https://mijnknltb.toernooi.nl/player-profile/eeeeeeee-0000-0000-0000-000000000001",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const w2 = dom2.window;
  const opslag2 = { settings: { enabled: false } };
  w2.chrome = {
    runtime: { id: "t", onMessage: { addListener() {} }, sendMessage() {}, lastError: null },
    storage: {
      local: {
        get(keys, cb) {
          if (keys === null) return cb({ ...opslag2 });
          const out = {};
          for (const k of [].concat(keys)) if (k in opslag2) out[k] = opslag2[k];
          cb(out);
        },
        set(o, cb) { Object.assign(opslag2, o); if (cb) cb(); },
        remove(keys, cb) { for (const k of [].concat(keys)) delete opslag2[k]; if (cb) cb(); },
      },
    },
  };
  w2.IntersectionObserver = win.IntersectionObserver;
  let fetches2 = 0;
  w2.fetch = (u) => { fetches2++; return win.fetch(u); };
  const fouten2 = [];
  w2.console.error = (...a) => fouten2.push(a.join(" "));
  w2.eval(code);
  await wacht(2000);

  ok(fouten2.length === 0, "geen fouten bij opstarten met uit", fouten2.join(" | "));
  ok(w2.document.querySelectorAll(".knltb-tags").length === 0,
     "uitgeschakeld opstarten tekent geen badges",
     w2.document.querySelectorAll(".knltb-tags").length + "");
  ok(!w2.document.getElementById("knltb-dash-btn"),
     "en zet geen dashboardknop neer");
  ok(!w2.document.getElementById("knltb-history"),
     "en haalt geen ratingverloop op");
  ok(fetches2 === 0, "en doet helemaal geen verzoeken", fetches2 + " verzoeken");

  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})();
