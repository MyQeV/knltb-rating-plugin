/* Rekent hij op een schemapagina de volgende ronde door met de bijgestelde
 * ratings van de vorige?
 *
 * De opzet is zo gekozen dat de twee mogelijkheden verschillende getallen
 * geven — anders bewijst de test niets:
 *
 *   ronde 1   A 6,0000 wint van B 7,0000   ->  A wordt 5,9618
 *             C 6,5000 wint van D 6,6000   ->  C wordt 6,3750
 *   ronde 2   A tegen C
 *             mét stapelen : W −0,0880 · V +0,1870
 *             zonder       : W −0,0788 · V +0,1962
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

// speler -> profiel-uuid en rating
const SPELERS = {
  11: { uuid: "aaaaaaaa-0000-0000-0000-000000000001", naam: "Speler A", rating: "6,0000" },
  12: { uuid: "aaaaaaaa-0000-0000-0000-000000000002", naam: "Speler B", rating: "7,0000" },
  13: { uuid: "aaaaaaaa-0000-0000-0000-000000000003", naam: "Speler C", rating: "6,5000" },
  14: { uuid: "aaaaaaaa-0000-0000-0000-000000000004", naam: "Speler D", rating: "6,6000" },
};

const link = (nr) =>
  `<a href="/sport/player.aspx?id=T1&amp;player=${nr}" class="nav-link"><span class="nav-link__value">${SPELERS[nr].naam}</span></a>`;
const rij = (nr, gewonnen) =>
  `<div class="match__row${gewonnen ? " has-won" : ""}"><div class="match__row-title">
     <div class="match__row-title-value"><span class="match__row-title-value-content">${link(nr)}</span></div>
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
          ${rij(13, true)}${rij(14, false)}
        </div></div><div class="match__result"><ul class="points"><li>6</li></ul></div></div>
      </div>
    </swiper-slide>
    <swiper-slide class="bracket-round__item" aria-label="2 / 2">
      <div class="bracket-round__match-group">
        <div class="match" id="m3"><div class="match__body"><div class="match__row-wrapper">
          <div class="match__row"><div class="match__row-title">
            <div class="match__row-title-value"></div>
            <div class="match__row-title-value"><span class="match__row-title-value-content">nog te bepalen</span></div>
          </div></div>
          <div class="match__row"><div class="match__row-title"></div></div>
        </div></div></div>
      </div>
    </swiper-slide>
  </swiper-container>
</div>
</body></html>`;

const dom = new JSDOM(PAGINA, {
  url: "https://mijnknltb.toernooi.nl/tournament/aaaaaaaa-1111-2222-3333-444444444444/draw/1",
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

// laat alles meteen "in beeld" komen, anders wordt er niets opgehaald
let observerCalls = 0;
const EchteMO = win.MutationObserver;
win.MutationObserver = class extends EchteMO {
  constructor(cb) {
    super((...a) => {
      observerCalls++;
      return cb(...a);
    });
  }
};

win.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) { this.cb([{ target: el, isIntersecting: true }]); }
  unobserve() {}
  disconnect() {}
};

// toernooipagina verwijst naar het profiel; profiel bevat de rating
let fetches = 0;
win.fetch = (url) => {
  fetches++;
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

  const r1 = win.document.querySelectorAll("#m1 .knltb-delta");
  ok(r1.length === 2, "ronde 1 doorgerekend", r1.length + " chips");

  const r2 = [...win.document.querySelectorAll("#m3 .knltb-delta")];
  ok(r2.length === 2, "ronde 2 doorgerekend", r2.length + " chips");

  const tekst = r2.map((c) => c.textContent).join(" | ");
  ok(tekst.includes("\u22120,0880") && tekst.includes("+0,1870"),
     "ronde 2 rekent met de bijgestelde ratings uit ronde 1", tekst);
  ok(!(tekst.includes("\u22120,0788") && tekst.includes("+0,1962")),
     "en dus niet met de beginratings", tekst);

  const stap1 = win.document.querySelector("#m1 .knltb-tag.step .v");
  ok(stap1 && stap1.textContent === "6,0000 \u2192 5,9618",
     "ronde 1: 6,0000 \u2192 5,9618", stap1 ? stap1.textContent : "geen");
  ok(stap1 && stap1.dataset.live === "6,0000", "huidige rating blijft bewaard",
     stap1 ? stap1.dataset.live : "");
  ok(!!win.document.querySelector("#m1 .knltb-tag.step.up"), "winnaar groen gemarkeerd");

  const meegenomen = [...win.document.querySelectorAll("#m3 .knltb-tag.carried .v")]
    .map((v) => v.textContent);
  ok(meegenomen.includes("5,9618") && meegenomen.includes("6,3750"),
     "nog niet gespeelde ronde toont de meegenomen stand", meegenomen.join(" | "));
  ok(!meegenomen.includes("6,0000") && !meegenomen.includes("6,5000"),
     "en dus niet de live rating", meegenomen.join(" | "));

  const cellen = [...win.document.querySelectorAll("#m3 .knltb-proj-cel")];
  ok(cellen.length === 2, "elke doorgeschoven speler krijgt een eigen cel",
     cellen.length + " cellen");

  /* Twee soorten rijen in de testpagina, met opzet:
       rij 1 heeft al twee cellen van de site  -> die moeten hergebruikt worden
       rij 2 heeft er geen                     -> die maken we zelf aan       */
  const rijen = [...win.document.querySelectorAll("#m3 .match__row")];

  const rij1 = [...rijen[0].querySelectorAll(".match__row-title-value")];
  ok(rij1.length === 2, "rij met bestaande cellen krijgt er niet meer bij",
     rij1.length + " cellen");
  ok(rijen[0].querySelectorAll("[data-knltb-own]").length === 0,
     "die cellen worden hergebruikt, niet gedupliceerd");
  // enkelspel: één speler per rij, dus de tweede cel van de site hoort
  // verborgen te worden in plaats van als witruimte te blijven staan
  ok(rij1.filter((c) => c.classList.contains("knltb-leeg")).length === 1,
     "de overtollige cel van de site wordt verborgen");
  ok(rij1.filter((c) => c.classList.contains("knltb-proj-cel")).length === 1,
     "en precies één cel wordt gevuld");

  ok(rijen[1].querySelectorAll("[data-knltb-own]").length === 1,
     "rij zonder cellen krijgt er zelf een",
     rijen[1].querySelectorAll("[data-knltb-own]").length + " gemaakt");

  // wat de site in die cel had staan moet bewaard zijn, anders kan het
  // na het terugnemen van een keuze nooit meer terug
  const hergebruikt = rij1.find((c) => c.classList.contains("knltb-proj-cel"));
  ok(
    hergebruikt && hergebruikt.dataset.knltbOrig != null,
    "de oorspronkelijke inhoud van de site is bewaard",
    hergebruikt ? JSON.stringify(hergebruikt.dataset.knltbOrig) : "geen"
  );
  ok(cellen.every((c) => c.querySelector(".match__row-title-value-content")),
     "met dezelfde opbouw als de site");

  const projWaarden = [...win.document.querySelectorAll("#m3 .knltb-proj")].map((x) => {
    const v = x.querySelector(".knltb-tag .v");
    return (x.childNodes[0] ? x.childNodes[0].textContent : "") + "=" + (v ? v.textContent : "-");
  });
  ok(projWaarden.some((t) => t.startsWith("Speler A") && t.endsWith("5,9618")),
     "doorgeschoven speler toont zijn bijgestelde rating", projWaarden.join(" | "));
  ok(projWaarden.some((t) => t.startsWith("Speler C") && t.endsWith("6,3750")),
     "ook de andere kant", projWaarden.join(" | "));

  ok(typeof win.__onMsg === "function", "berichtluisteraar geregistreerd");

  const voorTags = win.document.querySelectorAll(".knltb-tags").length;
  const voorChips = win.document.querySelectorAll(".knltb-delta").length;

  let antwoord = null;
  win.__onMsg({ type: "rescan" }, {}, (r) => (antwoord = r));
  await wacht(1500);

  ok(antwoord && antwoord.ok, "rescan meldt terug", JSON.stringify(antwoord));
  ok(antwoord && antwoord.spelers > 0, "en zegt hoeveel spelers hij vond",
     antwoord ? String(antwoord.spelers) : "-");
  ok(win.document.querySelectorAll(".knltb-tags").length === voorTags,
     "badges opnieuw opgebouwd");
  ok(win.document.querySelectorAll(".knltb-delta").length === voorChips,
     "chips opnieuw opgebouwd");

  const cellenVoor = win.document.querySelectorAll(".knltb-proj-cel").length;
  win.__onMsg({ type: "rescan" }, {}, () => {});
  await wacht(1200);
  win.__onMsg({ type: "rescan" }, {}, () => {});
  await wacht(1200);

  const cellenNa = win.document.querySelectorAll(".knltb-proj-cel").length;
  ok(cellenNa === cellenVoor, "geen cellen erbij na tweemaal hertekenen",
     cellenVoor + " -> " + cellenNa);

  const leeg = [...win.document.querySelectorAll(".knltb-proj-cel")].filter(
    (c) => !c.querySelector(".knltb-proj")
  );
  ok(leeg.length === 0, "en geen lege cellen blijven staan", leeg.length + " leeg");

  for (const k of Object.keys(opslag)) if (k.startsWith("r:")) delete opslag[k];
  const voorFetches = fetches;
  win.__onMsg({ type: "rescan" }, {}, () => {});
  await wacht(1500);

  ok(fetches > voorFetches, "na cache legen wordt er opnieuw opgehaald",
     voorFetches + " -> " + fetches + " verzoeken");
  ok(win.document.querySelectorAll(".knltb-tags").length > 0, "badges staan er weer");

  const chip = win.document.querySelector("#m3 .knltb-delta.pickable");
  ok(!!chip, "finale is klikbaar", chip ? chip.textContent : "geen");

  if (chip) {
    chip.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await wacht(900);

    ok(win.document.querySelectorAll("#m3 .knltb-delta.picked").length > 0,
       "keuze wordt als gekozen gemarkeerd");
    ok(win.document.querySelectorAll("#m3 .knltb-hypothetisch").length === 2,
       "beide rijen krijgen de plugin-rand");

    const naKeuze = [...win.document.querySelectorAll("#m3 .knltb-proj .knltb-tag .v")]
      .map((v) => v.textContent);
    ok(naKeuze.some((t) => /\u2192/.test(t)),
       "doorgeschoven duo toont de pijl naar de nieuwe waarde", naKeuze.join(" | "));
  }

  // ---- winstkans ---------------------------------------------------
  const kansen = [...win.document.querySelectorAll("#m1 .knltb-odds")].map((x) => x.textContent);
  ok(kansen.length === 2, "winstkans bij beide kanten", kansen.join(" | "));
  ok(kansen.includes("86%") && kansen.includes("14%"), "met de juiste percentages",
     kansen.join(" | "));
  ok(
    !!win.document.querySelector("#m1 .knltb-odds.fav") &&
      !!win.document.querySelector("#m1 .knltb-odds.under"),
    "favoriet en underdog verschillend gemarkeerd"
  );

  // ---- paneel aan/uit ---------------------------------------------
  win.__onMsg({ type: "settings", settings: { showSummary: false } }, {}, () => {});
  await wacht(300);
  ok(!win.document.getElementById("knltb-summary"), "paneel verdwijnt bij uitzetten");

  win.__onMsg({ type: "settings", settings: { showSummary: true } }, {}, () => {});
  await wacht(1500);
  ok(!!win.document.getElementById("knltb-summary"), "en komt terug bij aanzetten");

  // ---- geen hertekenlus --------------------------------------------
  // De observer mag niet blijven vuren: als de extensie haar eigen
  // invoegingen niet herkent, tekent ze zichzelf eindeloos opnieuw.
  await wacht(1500);
  const rustVoor = observerCalls;
  await wacht(2000);
  const erbij = observerCalls - rustVoor;
  ok(erbij <= 2, "geen hertekenlus: observer komt tot rust",
     erbij + " oproepen in 2 seconden");

  // ---- instelling uitzetten werkt meteen ---------------------------
  ok(win.document.querySelectorAll(".knltb-odds").length > 0, "winstkansen staan er");
  win.__onMsg({ type: "settings", settings: { showOdds: false } }, {}, () => {});
  await wacht(1200);
  ok(win.document.querySelectorAll(".knltb-odds").length === 0,
     "winstkans verdwijnt zodra je hem uitzet",
     win.document.querySelectorAll(".knltb-odds").length + " over");

  win.__onMsg({ type: "settings", settings: { showOdds: true } }, {}, () => {});
  await wacht(1200);
  ok(win.document.querySelectorAll(".knltb-odds").length > 0, "en komt terug");

  ok(fouten.length === 0, "geen fouten aan het eind", fouten.join(" | "));
  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})();
