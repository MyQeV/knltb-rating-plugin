/* De cachelaag: wat er in de opslag komt, en wat dat kost.
 *
 *   1. De vlag "lezing afgebroken" vergeleek de tekstlengte met content-length,
 *      en die kop ontbreekt bij chunked encoding — dus stond de vlag altijd
 *      aan, en werd elk profiel zonder rating voor de zekerheid nog eens
 *      volledig opgehaald. De lezer weet zelf of hij het einde heeft gehaald.
 *   2. Eén speler staat onder alle namen waaronder hij te vinden is: de link,
 *      het bondsnummer, het profiel. Dat waren evenzoveel schrijfacties;
 *      één hoort te volstaan.
 *   3. Mislukt een schrijfactie (opslag vol), dan wordt er opgeruimd, en dat
 *      leest de hele opslag in. Mislukken er twee tegelijk, dan hoort er één
 *      opruimbeurt te lopen — niet twee.
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

const SITE = "https://mijnknltb.toernooi.nl";
const TOERNOOI = "eeeeeeee-1111-2222-3333-444444444444";
const ORG = "eeeeeeee-5555-6666-7777-888888888888";

const SPELERS = {
  1: { uuid: "eeeeeeee-0000-0000-0000-000000000001", naam: "Speler A", rating: "6,0000", lid: "10000001" },
  2: { uuid: "eeeeeeee-0000-0000-0000-000000000002", naam: "Speler B", rating: "7,0000" },
  // geen rating op zijn profiel, en ook geen tabblad ernaartoe
  3: { uuid: "eeeeeeee-0000-0000-0000-000000000003", naam: "Speler C" },
};

const profielUrl = (s) => SITE + "/player-profile/" + s.uuid;

const link = (s) =>
  `<li class="list__item"><a href="/player-profile/${s.uuid}" class="nav-link">
     <span class="nav-link__value">${s.naam}</span></a></li>`;

/* Een toernooilink mét H2H-knop ernaast: het bondsnummer daaruit is de
   snelste route naar het profiel, en de speler krijgt zo drie namen. */
const ASPX = "/sport/player.aspx?id=" + TOERNOOI + "&player=3868";
const matchLink = (s) =>
  `<li class="match"><a href="${ASPX.replace("&", "&amp;")}" class="nav-link">
     <span class="nav-link__value">${s.naam}</span></a>
   <a href="/head-2-head?OrganizationCode=${ORG}&amp;T1P1MemberID=${s.lid}">H2H</a></li>`;

const pagina = (items) =>
  `<!doctype html><html><body><ul class="list">${items.join("")}</ul></body></html>`;

const kop = (s) => `<div class="page-head"><div class="media__content">
  <h2 class="media__title"><span class="nav-link__value">${s.naam}</span></h2>`;

const profiel = (s) => `${kop(s)}
  <div id="mediaContentSubinfo">
    <span title="Enkel" class="tag-duo"><span class="tag-duo__title">6</span><span class="tag-duo__value">${s.rating}</span></span>
  </div></div></div>`;

// profiel zónder rating: de kop, en verder niets waar de lezer op stopt
const profielLeeg = (s) => `${kop(s)}</div></div><p>Nog geen wedstrijden gespeeld.</p>`;

const antwoord = (url, html, eind = url) =>
  Promise.resolve({
    ok: true, status: 200, url: String(eind),
    headers: { get: () => null }, text: () => Promise.resolve(html),
  });

/* Hetzelfde, maar als stroom in stukken — zo leest readBody hem echt, en
   ziet hij of de lezing het einde heeft gehaald. */
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

/** Eén pagina, met het Chrome-decor dat jsdom niet heeft. De opslag houdt
    bij wat erheen gaat, en kan de eerste `faal` ratingrecords weigeren. */
function venster(html, opslag, opHaal, faal = 0) {
  const win = new JSDOM(html, {
    url: SITE + "/tournament/" + TOERNOOI,
    pretendToBeVisual: true,
    runScripts: "outside-only",
  }).window;

  const schrijfacties = [];
  let gelezen = 0; // hoe vaak de hele opslag is ingelezen
  win.chrome = {
    runtime: { id: "t", onMessage: { addListener(f) { win.__onMsg = f; } }, sendMessage() {}, lastError: null },
    storage: {
      local: {
        get(keys, cb) {
          if (keys === null) {
            // alles inlezen duurt even; precies dáár lopen twee opruimbeurten elkaar in de weg
            gelezen++;
            setTimeout(() => cb({ ...opslag }), 20);
            return;
          }
          const out = {};
          for (const k of [].concat(keys)) if (k in opslag) out[k] = opslag[k];
          cb(out);
        },
        set(o, cb) {
          schrijfacties.push(o);
          if (faal > 0 && Object.keys(o).some((k) => k.startsWith("r:"))) {
            faal--;
            win.chrome.runtime.lastError = { message: "QUOTA_BYTES quota exceeded" };
            cb();
            win.chrome.runtime.lastError = null;
            return;
          }
          Object.assign(opslag, o);
          if (cb) cb();
        },
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
  return {
    win, opslag, opgehaald, fouten,
    records: () => schrijfacties.filter((o) => Object.keys(o).some((k) => k.startsWith("r:"))),
    gelezen: () => gelezen,
    teWeigeren: () => faal,
    tel: (sel) => win.document.querySelectorAll(sel).length,
  };
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

const spelerVan = (url) => {
  const m = url.match(/player-profile\/([0-9a-f-]{36})/i);
  return m ? Object.values(SPELERS).find((s) => s.uuid === m[1].toLowerCase()) : null;
};

(async () => {
  /* ---- 1. lezing tot het einde gehaald: geen tweede, volledige ophaalbeurt */

  const c = SPELERS[3];
  const a = venster(pagina([link(c)]), { settings: {} }, (url) => stroom(url, [profielLeeg(c)]));
  await wacht(500);

  ok(a.fouten.length === 0, "geen fouten", a.fouten.join(" | "));
  ok(a.opgehaald.length === 1,
     "profiel zonder rating, in één keer tot het einde gelezen: één verzoek",
     a.opgehaald.length + " verzoeken");
  const geen = a.opslag["r:" + profielUrl(c)];
  ok(geen && geen.none === true, "en onthouden dat er geen rating is", JSON.stringify(geen));
  ok(a.tel(".knltb-tags") === 0, "badge weggehaald", a.tel(".knltb-tags") + " over");

  /* ---- 2. drie namen, één schrijfactie ------------------------------------ */

  const s = SPELERS[1];
  const lidUrl = SITE + "/player/" + ORG + "/" + Buffer.from("base64:" + s.lid).toString("base64");
  const b = venster(pagina([matchLink(s)]), { settings: {} }, (url) =>
    // het bondsnummer-adres stuurt door naar het landelijke profiel
    antwoord(url, profiel(s), url === lidUrl ? profielUrl(s) : url)
  );
  await wacht(500);

  ok(b.fouten.length === 0, "geen fouten", b.fouten.join(" | "));
  ok(b.opgehaald.length === 1 && b.opgehaald[0] === lidUrl,
     "via het bondsnummer uit de H2H-knop opgehaald", b.opgehaald.join(" , "));
  const tag = b.win.document.querySelector(".knltb-tag--single .v");
  ok(tag && tag.textContent === s.rating, "rating achter de naam", tag ? tag.textContent : "geen");

  const rec = b.records();
  const verwacht = ["r:" + lidUrl, "r:" + SITE + ASPX, "r:" + profielUrl(s)].sort();
  const sleutels = rec.length === 1 ? Object.keys(rec[0]).sort() : rec.flatMap(Object.keys);
  ok(rec.length === 1, "één schrijfactie voor deze speler", rec.length + " schrijfacties");
  ok(JSON.stringify(sleutels) === JSON.stringify(verwacht),
     "met alle drie de namen erin", sleutels.join(" , "));
  ok(rec.length === 1 && Object.values(rec[0]).every((v) => v.via === profielUrl(s) && typeof v.ts === "number"),
     "elk met het profiel als bron en een tijdstempel");

  /* ---- 3. opslag vol: één opruimbeurt, ook als er twee schrijfacties mislukken */

  const nu = Date.now();
  const r = (n) => "r:" + SITE + "/player-profile/eeeeeeee-0000-0000-0000-0000000000" + n;
  const opslag = {
    settings: {},
    prunedAt: nu, // net opgeruimd, dus de opstartbeurt slaat over
    selfProfile: SITE + "/player-profile/eeeeeeee-0000-0000-0000-0000000000a0",
    [r("a1")]: { name: "Speler X", single: 6, ts: nu - 9 * 36e5 }, // verlopen
    [r("a2")]: { name: "Speler Y", single: 6 }, // beschadigd: geen tijdstempel
    [r("a3")]: { name: "Speler Z", single: 6, ts: nu }, // vers
  };
  const d = venster(
    pagina([link(SPELERS[1]), link(SPELERS[2])]), opslag,
    (url) => antwoord(url, profiel(spelerVan(url))), 2
  );
  await wacht(500);

  ok(d.fouten.length === 0, "geen fouten", d.fouten.join(" | "));
  ok(d.teWeigeren() === 0, "beide schrijfacties zijn geweigerd", d.teWeigeren() + " weigeringen over");
  ok(d.tel(".knltb-tag--single") === 2, "de ratings staan er desondanks", d.tel(".knltb-tag--single") + " badges");
  ok(d.gelezen() === 1, "de opslag is één keer helemaal ingelezen", d.gelezen() + " keer");
  const over = Object.keys(opslag).filter((k) => k.startsWith("r:"));
  ok(!(r("a1") in opslag) && !(r("a2") in opslag), "verlopen en beschadigd zijn weg", over.join(" , "));
  ok(r("a3") in opslag && "selfProfile" in opslag, "vers en niet-cache blijven staan", Object.keys(opslag).join(" , "));

  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})();
