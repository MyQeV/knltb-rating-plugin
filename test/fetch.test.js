/* De ophaallaag: wat er gebeurt als je niet ingelogd bent, en de rem.
 *
 *   1. Niet ingelogd. Elke profielpagina is dan de inlogpagina, en de
 *      extensie haalde er tóch één op per speler: zes namen, zes keer
 *      dezelfde inlogpagina. Na de eerste hoort hij te weten dat het geen
 *      zin heeft en de rest meteen als "login" te tonen.
 *   2. Na "opnieuw scannen" moet dat geheugen weer leeg zijn — anders blijft
 *      de badge "login" zeggen nadat je wél bent ingelogd.
 *   3. De rem (maxPerMinute) werd per taak afgerekend, terwijl één taak tot
 *      zes verzoeken kan doen: drie kandidaten, een volledige herhaling,
 *      twee stappen doorlopen. De rem hoort per verzoek te tellen.
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
const code = files.map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");

const TOERNOOI = "eeeeeeee-1111-2222-3333-444444444444";

const SPELERS = {
  1: { uuid: "eeeeeeee-0000-0000-0000-000000000001", naam: "Speler A", rating: "6,0000" },
  2: { uuid: "eeeeeeee-0000-0000-0000-000000000002", naam: "Speler B", rating: "7,0000" },
  3: { uuid: "eeeeeeee-0000-0000-0000-000000000003", naam: "Speler C", rating: "6,5000" },
  4: { uuid: "eeeeeeee-0000-0000-0000-000000000004", naam: "Speler D", rating: "6,6000" },
  5: { uuid: "eeeeeeee-0000-0000-0000-000000000005", naam: "Speler E", rating: "7,2000" },
  6: { uuid: "eeeeeeee-0000-0000-0000-000000000006", naam: "Speler F", rating: "6,2000" },
  // zijn profielpagina toont geen rating; die staat pas op het Rating-tabblad
  7: { uuid: "eeeeeeee-0000-0000-0000-000000000007", naam: "Speler G", rating: "6,7000" },
};

const link = (nr) =>
  `<li class="list__item"><a href="/player-profile/${SPELERS[nr].uuid}" class="nav-link">
     <span class="nav-link__value">${SPELERS[nr].naam}</span></a></li>`;

const pagina = (nrs) =>
  `<!doctype html><html><body><ul class="list">${nrs.map(link).join("")}</ul></body></html>`;

const INLOG = `<html><body><form action="/Login" method="post">
  <input name="username"><input name="password"></form></body></html>`;

const kop = (s) => `<div class="page-head"><div class="media__content">
  <h2 class="media__title"><span class="nav-link__value">${s.naam}</span></h2>`;

const profiel = (s) => `${kop(s)}
  <div id="mediaContentSubinfo">
    <span title="Enkel" class="tag-duo"><span class="tag-duo__title">6</span><span class="tag-duo__value">${s.rating}</span></span>
  </div></div></div>`;

// profiel zónder rating, in twee stukken: de kop tot de markering waarop de
// lezer stopt, en daarachter alleen een tabblad naar de rating
const profielZonder = (s) => [
  `${kop(s)}</div></div><div id="page_content_profile">`,
  `<ul class="tabs"><li><a href="/player-profile/${s.uuid}/Rating">Rating</a></li></ul></div>`,
];

const antwoord = (url, html) =>
  Promise.resolve({
    ok: true, status: 200, url: String(url),
    headers: { get: () => null }, text: () => Promise.resolve(html),
  });

/* Hetzelfde, maar als stroom in stukken — zo leest readBody hem echt, en
   breekt hij af zodra hij genoeg heeft. */
const stroom = (url, stukken) => {
  let i = 0;
  return Promise.resolve({
    ok: true, status: 200, url: String(url),
    headers: { get: () => null },
    text: () => Promise.resolve(stukken.join("")),
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(i < stukken.length ? { done: false, value: Buffer.from(stukken[i++]) } : { done: true }),
        cancel: () => Promise.resolve(),
      }),
    },
  });
};

/** Eén pagina, met het Chrome-decor dat jsdom niet heeft. */
function venster(nrs, instellingen, opHaal) {
  const win = new JSDOM(pagina(nrs), {
    url: "https://mijnknltb.toernooi.nl/tournament/" + TOERNOOI,
    pretendToBeVisual: true,
    runScripts: "outside-only",
  }).window;

  const opslag = { settings: instellingen };
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
  win.TextDecoder = TextDecoder; // jsdom heeft hem niet, de stroomlezer wel nodig

  const opgehaald = [];
  win.fetch = (url) => {
    opgehaald.push(String(url));
    return opHaal(String(url));
  };

  const fouten = [];
  win.console.error = (...a) => fouten.push(a.join(" "));

  win.eval(code);
  return { win, opgehaald, fouten, tel: (sel) => win.document.querySelectorAll(sel).length };
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

const spelerVan = (url) => {
  const m = url.match(/player-profile\/([0-9a-f-]{36})/i);
  return m ? Object.values(SPELERS).find((s) => s.uuid === m[1].toLowerCase()) : null;
};

(async () => {
  /* ---- 1. niet ingelogd: na de eerste inlogpagina niets meer ophalen ---- */

  // één tegelijk, anders zijn alle zes verzoeken al de deur uit voordat het
  // eerste antwoord binnen is en valt er niets te onderscheiden
  let ingelogd = false;
  const a = venster([1, 2, 3, 4, 5, 6], { concurrency: 1 }, (url) => {
    const s = spelerVan(url);
    return antwoord(url, ingelogd && s ? profiel(s) : INLOG);
  });
  await wacht(1000);

  ok(a.fouten.length === 0, "geen fouten", a.fouten.join(" | "));
  ok(a.opgehaald.length === 1,
     "niet ingelogd: na de eerste inlogpagina wordt er niets meer opgehaald",
     a.opgehaald.length + " verzoeken");
  ok(a.tel(".knltb-tags.error") === 6, "alle zes badges melden het",
     a.tel(".knltb-tags.error") + " van 6");
  const teksten = [...a.win.document.querySelectorAll(".knltb-tags")].map((el) => el.textContent);
  ok(teksten.length === 6 && teksten.every((t) => t === "login"),
     "en wel als 'login'", teksten.join(","));

  /* ---- 2. opnieuw scannen nadat je bent ingelogd -------------------------- */

  ingelogd = true;
  let melding = null;
  a.win.__onMsg({ type: "rescan" }, {}, (r) => { melding = r; });
  await wacht(1000);

  ok(a.fouten.length === 0, "geen fouten na het opnieuw scannen", a.fouten.join(" | "));
  ok(a.opgehaald.length === 7,
     "na 'opnieuw scannen' wordt er weer opgehaald: zes profielen erbij",
     a.opgehaald.length + " verzoeken in totaal");
  ok(a.tel(".knltb-tags.error") === 0, "geen 'login' meer", a.tel(".knltb-tags.error") + " over");
  ok(a.tel(".knltb-tag--single") === 6, "zes ratingbadges", a.tel(".knltb-tag--single") + "");
  const eerste = a.win.document.querySelector(".knltb-tag--single .v");
  ok(eerste && eerste.textContent === SPELERS[1].rating,
     "met de rating van het profiel", eerste ? eerste.textContent : "geen");
  ok(melding && melding.ophalen === 6, "en de knop krijgt dat teruggemeld",
     JSON.stringify(melding));

  /* ---- 3. de rem telt per verzoek, niet per taak --------------------------
     Eén speler, drie verzoeken: het profiel wordt vroegtijdig afgebroken
     gelezen (1), levert geen rating op en wordt volledig opgehaald (2), en
     dan wordt het Rating-tabblad doorlopen (3). Met twee verzoeken per
     minuut moet het derde wachten — een halve minuut, dus dat zien we hier
     niet aflopen. Ter controle dezelfde pagina met ruimte voor drie: dan
     komt het er wél. */

  const ophaalG = (url) => {
    const s = SPELERS[7];
    if (/\/Rating$/i.test(url)) return antwoord(url, profiel(s));
    return stroom(url, profielZonder(s));
  };

  const b = venster([7], { maxPerMinute: 2 }, ophaalG);
  const c = venster([7], { maxPerMinute: 3 }, ophaalG);
  await wacht(1500);

  ok(b.fouten.length === 0 && c.fouten.length === 0, "geen fouten",
     b.fouten.concat(c.fouten).join(" | "));
  ok(b.opgehaald.length === 2,
     "twee per minuut: het derde verzoek van dezelfde taak wacht",
     b.opgehaald.map((u) => u.replace(/^.*\/player-profile\//, "")).join(" , "));
  ok(b.tel(".knltb-tags.loading") === 1 && b.tel(".knltb-tag") === 0,
     "en de badge staat nog op laden", b.win.document.body.querySelector(".knltb-tags")?.className);

  ok(c.opgehaald.length === 3,
     "drie per minuut: alle drie de verzoeken gaan meteen door",
     c.opgehaald.map((u) => u.replace(/^.*\/player-profile\//, "")).join(" , "));
  const viaTab = c.win.document.querySelector(".knltb-tag--single .v");
  ok(viaTab && viaTab.textContent === SPELERS[7].rating,
     "en de rating van het tabblad staat achter de naam", viaTab ? viaTab.textContent : "geen");

  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})();
