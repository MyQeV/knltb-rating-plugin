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
 *   4. Een 429 van de server: de wachtrij valt stil en de geweigerde speler
 *      blijft wachten op zijn herkansing — hij wordt niet als "geen rating"
 *      afgeboekt.
 *   5. Tien spelers, twee tegelijk: nooit meer dan twee verzoeken open, en
 *      ze vertrekken in de volgorde van de pagina. Met vijf per minuut gaan
 *      er precies vijf de deur uit.
 *   6. hoverOnly: niets ophalen tot de muis over een naam gaat, en dan
 *      alleen die ene.
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
  8: { uuid: "eeeeeeee-0000-0000-0000-000000000008", naam: "Speler H", rating: "6,1000" },
  9: { uuid: "eeeeeeee-0000-0000-0000-000000000009", naam: "Speler I", rating: "6,3000" },
  10: { uuid: "eeeeeeee-0000-0000-0000-000000000010", naam: "Speler J", rating: "6,4000" },
  11: { uuid: "eeeeeeee-0000-0000-0000-000000000011", naam: "Speler K", rating: "6,8000" },
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

/* De server duwt terug: 429 (of 503), zonder bruikbare pagina. */
const afgewezen = (url, status) =>
  Promise.resolve({
    ok: false, status, url: String(url),
    headers: { get: () => null }, text: () => Promise.resolve(""),
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

  /* ---- 4. de server duwt terug: stilvallen, niet afboeken ----------------
     Eén tegelijk, drie spelers, en het eerste verzoek krijgt een 429. Dan
     hoort de hele wachtrij stil te vallen en de geweigerde speler te wachten
     op zijn herkansing — niet als "geen rating" afgedaan te worden. De pauze
     is 30 s en kent geen instelling (backoffMs staat vast in content.js),
     dus de herkansing zelf valt buiten de test. Zonder de pauze zou de
     herkansing na één seconde komen en zouden de andere twee meteen gaan;
     na anderhalve seconde is het verschil dus te zien. */

  let geweigerd = 0;
  const d = venster([1, 2, 3], { concurrency: 1 }, (url) =>
    geweigerd++ === 0 ? afgewezen(url, 429) : antwoord(url, profiel(spelerVan(url)))
  );
  await wacht(1500);

  ok(d.fouten.length === 0, "geen fouten", d.fouten.join(" | "));
  ok(d.opgehaald.length === 1,
     "na een 429 gaat er anderhalve seconde lang niets meer de deur uit",
     d.opgehaald.length + " verzoeken");
  ok(d.tel(".knltb-tags.error") === 0 && d.tel(".knltb-tag") === 0,
     "niemand is als 'geen rating' afgeboekt",
     d.tel(".knltb-tags.error") + " fout, " + d.tel(".knltb-tag") + " badges");
  const wachtend = [...d.win.document.querySelectorAll(".knltb-tags.loading")].map((el) => el.textContent);
  ok(wachtend.join(",") === "⏳,…,…",
     "de geweigerde speler wacht op zijn herkansing, de andere twee staan nog in de rij",
     wachtend.join(","));

  /* ---- 5. tien spelers, twee tegelijk ------------------------------------
     De antwoorden houden we vast en laten we één voor één los. Zo is te zien
     hoeveel er tegelijk openstaan en in welke volgorde ze vertrekken: nooit
     meer dan twee, en in de volgorde van de pagina — die staat hier expres
     niet op nummer. */

  const TIEN = [4, 1, 6, 2, 9, 3, 11, 5, 10, 8];
  const open = [];
  let tegelijk = 0;
  let hoogste = 0;
  const e = venster(TIEN, { concurrency: 2 }, (url) =>
    new Promise((los) => {
      tegelijk++;
      hoogste = Math.max(hoogste, tegelijk);
      open.push(() => {
        tegelijk--;
        los(antwoord(url, profiel(spelerVan(url))));
      });
    })
  );
  await wacht(300);

  ok(e.opgehaald.length === 2,
     "twee verzoeken staan open, de andere acht wachten", e.opgehaald.length + " open");

  // één voor één loslaten; na elk antwoord mag er precies één bij
  for (let ronde = 0; ronde < 40 && (open.length || e.opgehaald.length < TIEN.length); ronde++) {
    if (open.length) open.shift()();
    await wacht(30);
  }
  await wacht(300);

  const volgorde = e.opgehaald.map((u) => TIEN.find((nr) => u.includes(SPELERS[nr].uuid)));
  ok(volgorde.join(",") === TIEN.join(","),
     "de verzoeken vertrekken in de volgorde van de pagina", volgorde.join(","));
  ok(hoogste === 2, "en er staan er nooit meer dan twee tegelijk open", "hoogstens " + hoogste);
  ok(e.tel(".knltb-tag--single") === TIEN.length, "alle tien krijgen een badge",
     e.tel(".knltb-tag--single") + " van " + TIEN.length);
  ok(e.fouten.length === 0, "geen fouten", e.fouten.join(" | "));

  /* Dezelfde tien met vijf per minuut: precies vijf gaan de deur uit. Het
     zesde verzoek wacht op de bucket — twaalf seconden per token, dus dat
     zien we hier niet aflopen. */
  const f = venster(TIEN, { concurrency: 2, maxPerMinute: 5 }, (url) => antwoord(url, profiel(spelerVan(url))));
  await wacht(1000);

  ok(f.opgehaald.length === 5,
     "vijf per minuut: het zesde verzoek wacht op de bucket", f.opgehaald.length + " verzoeken");
  ok(f.tel(".knltb-tag--single") === 5 && f.tel(".knltb-tags.loading") === 5,
     "vijf badges, vijf nog op laden",
     f.tel(".knltb-tag--single") + " badges, " + f.tel(".knltb-tags.loading") + " op laden");

  /* ---- 6. hoverOnly: pas ophalen als de muis over de naam gaat ----------- */

  const g = venster([1, 2, 3], { hoverOnly: true }, (url) => antwoord(url, profiel(spelerVan(url))));
  await wacht(500);

  ok(g.opgehaald.length === 0,
     "muis-over-modus: bij het laden wordt niets opgehaald", g.opgehaald.length + " verzoeken");
  ok(g.tel(".knltb-tags.idle") === 3, "alle drie de badges wachten op de muis",
     g.tel(".knltb-tags.idle") + " van 3");

  const tweede = g.win.document.querySelectorAll("a.nav-link")[1];
  tweede.dispatchEvent(new g.win.Event("mouseenter"));
  await wacht(500);

  ok(g.opgehaald.length === 1 && g.opgehaald[0].includes(SPELERS[2].uuid),
     "muis over de tweede naam: één verzoek, voor die speler",
     g.opgehaald.map((u) => u.replace(/^.*\/player-profile\//, "")).join(" , "));
  const gehoverd = tweede.querySelector(".knltb-tag--single .v");
  ok(gehoverd && gehoverd.textContent === SPELERS[2].rating,
     "en zijn rating staat achter zijn naam", gehoverd ? gehoverd.textContent : "geen");
  ok(g.tel(".knltb-tags.idle") === 2, "de andere twee wachten nog op de muis",
     g.tel(".knltb-tags.idle") + " over");
  ok(g.fouten.length === 0, "geen fouten", g.fouten.join(" | "));

  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})();
