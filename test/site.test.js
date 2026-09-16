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
const token = p && p.url.split("/").pop();
ok(
  p && p.url === SITE + "/player/" + ORG + "/" + token && Buffer.from(token, "base64").toString() === "base64:12345678",
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
console.log("\nisProfileUrl, median, f4, signed");
ok(Site.isProfileUrl(SITE + "/player-profile/" + UUID + "/tournaments"), "profielpagina (ook een tabblad) is betrouwbaar");
ok(Site.isProfileUrl("/player/" + UUID + "/YmFzZTY0OjEyMzQ1Njc4"), "bondsnummerpagina is betrouwbaar");
ok(!Site.isProfileUrl("/tournament/" + UUID + "/player/12"), "toernooispeler is geen profiel");
ok(Site.median([5, 6, 8]) === 6 && Site.median([5, 6, 7, 8]) === 6.5, "mediaan oneven en even");
ok(Site.f4(6.43142) === "6,4314" && Site.f4(null) === "—", "f4 rondt op vier decimalen, niets is een streepje");
ok(Site.signed(0.0123) === "+0,0123" && Site.signed(-0.0123) === "−0,0123" && Site.signed(0) === "±0,0000", "signed met teken");

console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
process.exit(fail ? 1 : 0);
