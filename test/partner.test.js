/* De dubbelpartner in het veldpaneel.
 *
 * Op de inschrijvingspagina van een dubbelonderdeel sta je zelf niet in het
 * veld, maar met een bekende eigen rating word je er als hypothetische
 * deelnemer bij gezet. De teamrating is dan het gemiddelde van jou en je
 * partner. Zonder ingestelde partner rekent het paneel met een partner van
 * jouw eigen sterkte; mét `partnerRating` hoort dát getal de andere helft
 * te zijn — in je rij, in het invoerveld en in de hint eronder.
 *
 *   jij 7,0000 + partner van gelijke sterkte  ->  7,0000
 *   jij 7,0000 + partner 6,0000               ->  6,5000
 *
 * Op een schemapagina zonder uitslagen komt het veld uit de opgehaalde
 * ratings van de spelers zelf, en dan is jouw rij je eigen dubbelrating —
 * geen teamrating. Een partnerveld hoort daar dan ook niet: invullen zou
 * niets veranderen.
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

const TOERNOOI = "ffffffff-1111-2222-3333-444444444444";

// jijzelf: staat in het menu rechtsboven, niet in het veld
const IK = { uuid: "ffffffff-0000-0000-0000-000000000099", naam: "Speler X", enkel: "7,4000", dubbel: "7,0000" };

const koppel = (nr, a, b, ra, rb) => `<tr><td>Hoofdschema</td>
  <td><p><a href="player.aspx?id=${TOERNOOI}&amp;player=${nr}">${a}</a></p><p><a href="player.aspx?id=${TOERNOOI}&amp;player=${nr + 1}">${b}</a></p></td>
  <td><p>Club</p><p>Club</p></td>
  <td><p>${ra}</p><p>${rb}</p></td><td></td></tr>`;

// twee koppels: 6,7000 en 5,9000 — geen van beide is 7,0000 of 6,5000
const PAGINA = `<!doctype html><html><body>
<div class="masthead"><div class="dropdown-menu"><ul class="dropdown-list">
  <li><a href="/player-profile/${IK.uuid}" title="Mijn profiel">Mijn profiel</a></li>
</ul></div></div>
<div class="page-subhead"><h4 class="media__title">Tennis HD6</h4></div>
<table class="ruler"><caption>Inschrijvingen (2)</caption>
<thead><tr><td>&nbsp;</td><td>Speler</td><td>Club</td><td>Rating</td><td>Plaatsing</td></tr></thead>
<tbody>
${koppel(11, "Speler A", "Speler B", "6,6000", "6,8000")}
${koppel(13, "Speler C", "Speler D", "5,8000", "6,0000")}
</tbody></table>
</body></html>`;

const profiel = (s) => `<div class="page-head"><div class="media__content">
  <h2 class="media__title"><span class="nav-link__value">${s.naam}</span></h2>
  <div id="mediaContentSubinfo">
    <span title="Enkel" class="tag-duo"><span class="tag-duo__title">6</span><span class="tag-duo__value">${s.enkel}</span></span>
    <span title="Dubbel" class="tag-duo"><span class="tag-duo__title">6</span><span class="tag-duo__value">${s.dubbel}</span></span>
  </div></div></div>`;

// een poule van hetzelfde dubbelonderdeel, nog zonder uitslagen: drie losse
// spelers, elk met een dubbelrating op zijn profiel — geen van drieën 7,0000
const VELD = [
  { uuid: "ffffffff-0000-0000-0000-000000000011", naam: "Speler A", enkel: "6,5000", dubbel: "6,6000" },
  { uuid: "ffffffff-0000-0000-0000-000000000012", naam: "Speler B", enkel: "6,9000", dubbel: "6,8000" },
  { uuid: "ffffffff-0000-0000-0000-000000000013", naam: "Speler C", enkel: "5,7000", dubbel: "5,8000" },
];
const schakel = (s) =>
  `<li class="list__item"><a href="/player-profile/${s.uuid}" class="nav-link"><span class="nav-link__value">${s.naam}</span></a></li>`;

const POULE = `<!doctype html><html><body>
<div class="masthead"><div class="dropdown-menu"><ul class="dropdown-list">
  <li><a href="/player-profile/${IK.uuid}" title="Mijn profiel">Mijn profiel</a></li>
</ul></div></div>
<div class="page-subhead"><h4 class="media__title">Tennis HD6 poule A</h4></div>
<ul class="list">
${VELD.map(schakel).join("\n")}
</ul>
</body></html>`;

const INSCHRIJVING_URL = "https://mijnknltb.toernooi.nl/sport/event.aspx?id=" + TOERNOOI + "&event=5";
const POULE_URL = "https://mijnknltb.toernooi.nl/tournament/" + TOERNOOI + "/draw/4";

/** Een pagina van het onderdeel, met het Chrome-decor dat jsdom niet heeft. */
function venster(instellingen, pagina = PAGINA, adres = INSCHRIJVING_URL) {
  const win = new JSDOM(pagina, {
    url: adres,
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

  const opgehaald = [];
  win.fetch = (url) => {
    opgehaald.push(String(url));
    const wie = [IK, ...VELD].find((s) => String(url).includes(s.uuid));
    const html = wie ? profiel(wie) : "<html><body></body></html>";
    return Promise.resolve({
      ok: true, status: 200, url: String(url),
      headers: { get: () => null }, text: () => Promise.resolve(html),
    });
  };

  const fouten = [];
  win.console.error = (...a) => fouten.push(a.join(" "));

  win.eval(code);
  return { win, opgehaald, fouten };
}

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

/** De onderdelen van het paneel waar de partner in doorklinkt. */
function lees(win) {
  const paneel = win.document.getElementById("knltb-summary");
  const zelf = paneel && paneel.querySelector(".knltb-summary__name.is-self");
  const team = zelf && zelf.parentElement.querySelector(".knltb-summary__val");
  const invoer = paneel && paneel.querySelector(".knltb-summary__partner input");
  const hint = paneel && paneel.querySelector(".knltb-summary__hint");
  return {
    paneel: !!paneel,
    rij: zelf ? zelf.textContent : null,
    team: team ? team.textContent : null,
    invoer: invoer ? invoer.value : null,
    hint: hint ? hint.textContent : null,
  };
}

(async () => {
  /* ---- 1. met een bewaarde partner --------------------------------------- */

  const a = venster({ partnerRating: 6, partnerName: "Speler P" });
  const b = venster({});
  const c = venster({ partnerRating: 6, partnerName: "Speler P" }, POULE, POULE_URL);
  await wacht(1500);

  ok(a.fouten.length === 0 && b.fouten.length === 0, "geen fouten", a.fouten.concat(b.fouten).join(" | "));
  ok(a.opgehaald.length === 1 && a.opgehaald[0].includes(IK.uuid),
     "alleen het eigen profiel wordt opgehaald; het veld staat al in de kolom",
     a.opgehaald.map((u) => u.replace(/^https?:\/\/[^/]+/, "")).join(" , "));

  const met = lees(a.win);
  ok(met.paneel, "het veldpaneel staat er");
  ok(met.rij != null, "met jezelf als hypothetische deelnemer", JSON.stringify(met));
  ok(met.rij != null && met.rij.includes("Speler P 6,0000"),
     "je rij noemt de partner met zijn rating", met.rij);
  ok(met.team === "6,5000",
     "teamrating is het gemiddelde van jou (7,0000) en je partner (6,0000)", met.team);
  ok(met.invoer === "6,0000", "het invoerveld toont de bewaarde partnerrating", met.invoer);
  ok(met.hint === "Speler P · teamrating 6,5000", "en de hint eronder rekent ermee", met.hint);

  /* ---- 2. zonder partner: gelijke sterkte ---------------------------------- */

  const zonder = lees(b.win);
  ok(zonder.rij != null && zonder.rij.includes("partner van gelijke sterkte"),
     "zonder partner zegt je rij dat ook", zonder.rij);
  ok(zonder.team === "7,0000", "en de teamrating is je eigen dubbelrating", zonder.team);
  ok(zonder.invoer === "", "het invoerveld is leeg", JSON.stringify(zonder.invoer));
  ok(zonder.hint === "teamrating 7,0000", "de hint rekent zonder partner", zonder.hint);

  /* ---- 3. een veld van losse ratings: geen partnerveld -------------------- */

  const veld = lees(c.win);
  ok(c.fouten.length === 0, "geen fouten op de poulepagina", c.fouten.join(" | "));
  ok(c.opgehaald.length === 4, "de drie spelers en het eigen profiel opgehaald",
     c.opgehaald.map((u) => u.replace(/^https?:\/\/[^/]+/, "")).join(" , "));
  ok(veld.paneel && veld.rij != null,
     "ook daar sta je als hypothetische deelnemer in het veld", JSON.stringify(veld));
  ok(veld.rij != null && !veld.rij.includes("partner"),
     "maar je rij is je eigen rating, zonder partner", veld.rij);
  ok(veld.team === "7,0000", "geen teamrating: 7,0000 staat er onbewerkt", veld.team);
  ok(veld.invoer === null,
     "en dus geen partnerveld — invullen zou hier niets veranderen", JSON.stringify(veld.invoer));

  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})();
