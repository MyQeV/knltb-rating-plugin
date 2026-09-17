/* Site: de helpers die content script, dashboard en popup delen. */
const Site = require("../site.js");
let fail = 0;
const ok = (cond, label, extra = "") => {
  console.log((cond ? "  ok   " : "  FOUT ") + label + (extra ? "  " + extra : ""));
  if (!cond) fail++;
};
const fout = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e.message;
  }
};

const ORG = "AAAAAAAA-1111-2222-3333-444444444444";
const UUID = "bbbbbbbb-1111-2222-3333-444444444444";
const SITE = "https://mijnknltb.toernooi.nl";

// ---- 1. parsePlayerInput: vier vormen en een weigering -----------------
console.log("parsePlayerInput");
let p = Site.parsePlayerInput(" 6,4314 ", ORG);
ok(p && p.rating === 6.4314 && p.url === undefined, "rating met komma en spaties eromheen", JSON.stringify(p));
p = Site.parsePlayerInput("10", ORG);
ok(p && p.rating === 10, "rating 10 valt binnen het bereik", JSON.stringify(p));

p = Site.parsePlayerInput(UUID.toUpperCase(), ORG);
ok(p && p.url === SITE + "/player-profile/" + UUID && p.rating === undefined, "uuid wordt een profiellink in kleine letters", JSON.stringify(p));

p = Site.parsePlayerInput("12345678", ORG);
ok(
  p && p.url === SITE + "/player/" + ORG + "/YmFzZTY0OjEyMzQ1Njc4", // btoa("base64:12345678")
  "bondsnummer wordt /player/<org>/<base64 van base64:nummer>",
  JSON.stringify(p)
);
ok(fout(() => Site.parsePlayerInput("12345678", null)) === "GEEN_ORG", "bondsnummer zonder organisatiecode: GEEN_ORG");

p = Site.parsePlayerInput("/sport/player.aspx?id=123&player=4", ORG);
ok(p && p.url === SITE + "/sport/player.aspx?id=123&player=4", "relatieve link wordt absoluut", JSON.stringify(p));
p = Site.parsePlayerInput(SITE + "/player-profile/" + UUID, ORG);
ok(p && p.url === SITE + "/player-profile/" + UUID, "absolute link blijft zichzelf", JSON.stringify(p));

ok(fout(() => Site.parsePlayerInput("Fleur Jansen", ORG)) === "ONBEGREPEN", "losse tekst: ONBEGREPEN");
ok(fout(() => Site.parsePlayerInput("12", ORG)) === "BUITEN_BEREIK", "rating 12: BUITEN_BEREIK");
ok(fout(() => Site.parsePlayerInput("https://example.org/player-profile/" + UUID, ORG)) === "ANDERE_SITE", "link van een andere site: ANDERE_SITE");
ok(Site.parsePlayerInput("   ", ORG) === null, "lege invoer: null");

// ---- 2. sameName: plaatsingscijfers, spaties, diakrieten ---------------
console.log("\nsameName");
ok(Site.sameName("Fleur Jansen [2]", "Fleur Jansen"), "plaatsingscijfer achteraan telt niet mee");
ok(Site.sameName("Fleur [2] Jansen", "Fleur Jansen"), "plaatsingscijfer middenin laat geen dubbele spatie over");
ok(Site.sameName("Fleur\tJansen", "fleur  jansen"), "tabs, dubbele spaties en hoofdletters tellen niet");
ok(Site.sameName("Renée Müller-Bosch", "renée müllerbosch"), "diakrieten blijven staan, leestekens vallen weg");
ok(!Site.sameName("Björn de Vries", "Bjorn de Vries"), "diakrieten worden niet weggevouwen");
ok(Site.sameName("Jansen", "Fleur Jansen"), "een deel van de naam is genoeg");
ok(!Site.sameName("Fleur Jansen", "Pieter Bakker"), "andere naam is anders");
ok(Site.sameName("", "Fleur Jansen") && Site.sameName(null, "Fleur Jansen"), "niets te vergelijken: geen bezwaar");

// ---- 3. de kleine helpers ---------------------------------------------
console.log("\nisProfileUrl, median, f4, signed, looksLoggedOut");
ok(Site.isProfileUrl(SITE + "/player-profile/" + UUID + "/tournaments"), "profielpagina (ook een tabblad) is betrouwbaar");
ok(Site.isProfileUrl("/player/" + UUID + "/YmFzZTY0OjEyMzQ1Njc4"), "bondsnummerpagina is betrouwbaar");
ok(!Site.isProfileUrl("/tournament/" + UUID + "/player/12"), "toernooispeler is geen profiel");
ok(Site.median([5, 6, 8]) === 6 && Site.median([5, 6, 7, 8]) === 6.5, "mediaan oneven en even");
ok(Site.f4(6.43142) === "6,4314" && Site.f4(null) === "—", "f4 rondt op vier decimalen, niets is een streepje");
ok(Site.signed(0.0123) === "+0,0123" && Site.signed(-0.0123) === "−0,0123" && Site.signed(0) === "±0,0000", "signed met teken");
ok(
  Site.looksLoggedOut('<form action="/Login"><input name="password"></form>') &&
    !Site.looksLoggedOut('<a href="/login">Inloggen</a><div class="page-head"></div>'),
  "looksLoggedOut: het wachtwoordveld telt, een /login-link in het menu niet"
);

// ---- 4. store.merge: lezen-wijzigen-schrijven achter elkaar -----------
console.log("\nstore.merge");
(async () => {
  const opslag = { settings: { enabled: true } };
  let vol = false;
  global.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        // net als de echte opslag komt `get` pas een tik later terug — zo
        // lezen twee merges die tegelijk starten allebei de oude stand
        get(keys, cb) {
          const out = {};
          for (const k of [].concat(keys)) if (k in opslag) out[k] = { ...opslag[k] };
          setTimeout(() => cb(out), 0);
        },
        set(o, cb) {
          if (vol) {
            vol = false;
            chrome.runtime.lastError = { message: "QUOTA_BYTES quota exceeded" };
            cb();
            chrome.runtime.lastError = null;
            return;
          }
          // een kopie, zoals de echte opslag: wat merge teruggeeft mag niet
          // hetzelfde object zijn als wat hier staat
          for (const k in o) opslag[k] = { ...o[k] };
          cb();
        },
      },
    },
  };

  await Promise.all([Site.store.merge("settings", { showOdds: false }), Site.store.merge("settings", { partnerRating: 6.5 })]);
  ok(
    opslag.settings.enabled === true && opslag.settings.showOdds === false && opslag.settings.partnerRating === 6.5,
    "twee merges tegelijk: beide wijzigingen blijven staan",
    JSON.stringify(opslag.settings)
  );

  const terug = await Site.store.merge("settings", { debug: true });
  ok(terug.debug === true && JSON.stringify(terug) === JSON.stringify(opslag.settings), "merge geeft het opgeslagen object terug", JSON.stringify(terug));

  const nieuw = await Site.store.merge("nogNiet", { a: 1 });
  ok(JSON.stringify(nieuw) === '{"a":1}' && JSON.stringify(opslag.nogNiet) === '{"a":1}', "merge op een lege sleutel begint bij {}", JSON.stringify(opslag.nogNiet));

  vol = true;
  const melding = await Site.store.merge("settings", { showDelta: false }).then(() => null, (e) => e.message);
  ok(melding === "QUOTA_BYTES quota exceeded", "een volle opslag laat die ene merge falen", String(melding));
  await Site.store.merge("settings", { showDelta: false });
  ok(opslag.settings.showDelta === false, "…maar de merge daarna komt gewoon aan de beurt", JSON.stringify(opslag.settings));

  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
