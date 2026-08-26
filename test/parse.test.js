const { JSDOM } = require("jsdom");
const Parse = require("../parse.js");
const DSS = require("../dss.js");
const dom = (html) => new JSDOM(html).window.document;
let fail = 0;
const ok = (cond, label, extra = "") => {
  console.log((cond ? "  ok   " : "  FOUT ") + label + (extra ? "  " + extra : ""));
  if (!cond) fail++;
};

// ---- 1. profielkop met enkel- en dubbelrating -------------------------
const profile = dom(`<div class="page-head"><div class="media__content">
  <h2 class="media__title"><span class="nav-link media__link"><span class="nav-link__value">Mike Verhaar</span></span>
  <span class="media__title-aside">(30340969)</span></h2>
  <div class="media__content-subinfo" id="mediaContentSubinfo">
  <ul class="list--inline list">
    <li class="list__item"><span title="Enkel" class="tag--mono tag-duo tag">
      <span class="tag-duo__title"> 8</span><span class="tag-duo__value">7,8265</span></span></li>
    <li class="list__item"><span title="" data-original-title="Dubbel" class="tag--mono tag-duo tag">
      <span class="tag-duo__title"> 6</span><span class="tag-duo__value">5,7033</span></span></li>
  </ul></div></div></div>
  <span class="tag tag--soft tag-duo"><span class="tag-duo__title">Open toernooi</span></span>`);

const p = Parse.playerDoc(profile);
console.log("profielpagina");
ok(p && p.single === 7.8265, "enkelrating 7,8265", p && String(p.single));
ok(p && p.double === 5.7033, "dubbelrating 5,7033", p && String(p.double));
ok(p && p.singleRaw === "7,8265", "onafgeronde weergave bewaard", p && p.singleRaw);
ok(p && p.singleLevel === "8" && p.doubleLevel === "6", "speelsterktes 8 en 6");
ok(p && p.name === "Mike Verhaar", "naam uit de mediakop, niet het logo", p && p.name);

// ---- 2. inschrijvingen enkelspel -------------------------------------
const single = dom(`<h3>Tennis HE6 17+</h3>
<table class="ruler"><thead><tr><td>Schema</td><td>Grootte</td></tr></thead>
<tbody><tr><td><a href="draw.aspx?id=X&draw=20">Tennis HE6 17+</a></td><td>8</td></tr></tbody></table>
<table class="ruler"><caption>Inschrijvingen (5)</caption>
<thead><tr><td>&nbsp;</td><td>Speler</td><td>Club</td><td>Rating</td><td>Plaatsing</td></tr></thead>
<tbody>
<tr><td>Hoofdschema</td><td><a href="player.aspx?id=X&player=201">Niels Hendriks</a></td><td>T.V. De Baan</td><td>6,9138</td><td>1</td></tr>
<tr><td>Hoofdschema</td><td><a href="player.aspx?id=X&player=202">Bas van der Berg</a></td><td>T.V. Het Net</td><td>7,2429</td><td>2</td></tr>
<tr><td>Hoofdschema</td><td><a href="player.aspx?id=X&player=203">Koen van der Laan</a></td><td>T.P.V. De Lob</td><td>7,2896</td><td>&nbsp;</td></tr>
<tr><td>Hoofdschema</td><td><a href="player.aspx?id=X&player=204">Tim Brouwer</a></td><td>T.V. De Baan</td><td>7,6355</td><td>&nbsp;</td></tr>
<tr><td>Hoofdschema</td><td><a href="player.aspx?id=X&player=205">Joris van den Broek</a></td><td>T.V. De Baan</td><td>9,1546</td><td>&nbsp;</td></tr>
</tbody></table>`);

const e1 = Parse.entryTable(single);
console.log("\ninschrijvingen enkelspel");
ok(e1 && e1.rows.length === 5, "5 rijen, schematabel niet meegepakt", e1 && String(e1.rows.length));
ok(e1 && e1.caption === "Inschrijvingen (5)", "caption als kop", e1 && e1.caption);
ok(e1 && e1.rows[0].ratings.length === 1 && e1.rows[0].ratings[0] === 6.9138, "eerste rating 6,9138");
ok(e1 && e1.rows[0].club === "T.V. De Baan", "club", e1 && e1.rows[0].club);
ok(e1 && e1.rows[0].seed === "1", "plaatsing 1", e1 && JSON.stringify(e1.rows[0].seed));
ok(Parse.discipline(Parse.eventTitle(single)) === "S", "HE6 17+ herkend als enkel",
   Parse.eventTitle(single));

// ---- 3. inschrijvingen dubbel ---------------------------------------
const dbl = dom(`<h3>Tennis HD6</h3>
<table class="ruler"><caption>Inschrijvingen (10)</caption>
<thead><tr><td>&nbsp;</td><td>Speler</td><td>Club</td><td>Rating</td><td>Plaatsing</td></tr></thead>
<tbody>
<tr><td>Hoofdschema</td>
 <td><p><a href="player.aspx?id=X&player=206">Milan Willems</a></p><p><a href="player.aspx?id=X&player=207">Sem Kuipers</a></p></td>
 <td><p>L.T.C. Smash</p><p>L.T.C. Smash</p></td>
 <td><p>5,8576</p><p>6,8564</p></td><td>1</td></tr>
<tr><td>Hoofdschema</td>
 <td><p><a href="player.aspx?id=X&player=700">Finn Vos</a></p><p><a href="player.aspx?id=X&player=701">Luuk Hoekstra</a></p></td>
 <td><p>Lawn Tennis Ver. De Service</p><p>KNLTB Spelerspas</p></td>
 <td><p>6,5697</p><p>5,9126</p></td><td>2</td></tr>
</tbody></table>`);

const e2 = Parse.entryTable(dbl);
console.log("\ninschrijvingen dubbel");
ok(e2 && e2.rows.length === 2, "2 koppels");
ok(e2 && e2.rows[0].ratings.length === 2, "twee ratings per rij", e2 && JSON.stringify(e2.rows[0].ratings));
ok(e2 && e2.rows[0].name === "Milan Willems / Sem Kuipers", "beide namen", e2 && e2.rows[0].name);
ok(e2 && e2.rows[0].club === "L.T.C. Smash", "gelijke clubs samengevoegd", e2 && e2.rows[0].club);
ok(e2 && e2.rows[1].club === "Lawn Tennis Ver. De Service / KNLTB Spelerspas", "twee clubs", e2 && e2.rows[1].club);
ok(Parse.discipline(Parse.eventTitle(dbl)) === "D", "HD6 herkend als dubbel (cijfer achter de code)");

/* Eén speler met profiellink, de ander als kale tekst — een gastspeler.
   Namen alleen uit de links halen gooit de tweede weg, en `ratings.slice`
   haalt dan ook zijn rating weg: het koppel belandt met de rating van één
   speler in het veld in plaats van met het gemiddelde. */
const half = dom(`<h3>Tennis HD6</h3>
<table class="ruler"><caption>Inschrijvingen (2)</caption>
<thead><tr><td>&nbsp;</td><td>Speler</td><td>Rating</td></tr></thead>
<tbody>
<tr><td>Hoofdschema</td>
 <td><p><a href="player.aspx?id=X&player=1">Anna Aalders</a></p><p>Bea Bakker</p></td>
 <td><p>5,8576</p><p>6,8564</p></td></tr>
<tr><td>Hoofdschema</td>
 <td><p><a href="player.aspx?id=X&player=2">Cor Cools</a></p><p><a href="player.aspx?id=X&player=3">Dirk Das</a></p></td>
 <td><p>6,0000</p><p>7,0000</p></td></tr>
</tbody></table>`);

const e3 = Parse.entryTable(half);
console.log("\ndubbel met een partner zonder profiellink");
ok(e3 && e3.rows[0].names.length === 2, "beide namen blijven staan",
   e3 && JSON.stringify(e3.rows[0].names));
ok(e3 && e3.rows[0].name === "Anna Aalders / Bea Bakker", "ook in de samengestelde naam",
   e3 && e3.rows[0].name);
ok(e3 && e3.rows[0].ratings.length === 2, "en beide ratings",
   e3 && JSON.stringify(e3.rows[0].ratings));
ok(e3 && Math.abs(DSS.teamRating(e3.rows[0].ratings.slice(0, 2)) - 6.357) < 1e-9,
   "teamrating is het gemiddelde 6,3570, niet 5,8576",
   e3 && String(DSS.teamRating(e3.rows[0].ratings.slice(0, 2))));
ok(e3 && e3.rows[0].hrefs.length === 1, "en de ene link blijft gewoon meegaan",
   e3 && JSON.stringify(e3.rows[0].hrefs));

// ---- 4. randgevallen -------------------------------------------------
console.log("\nrandgevallen");
ok(Parse.entryTable(dom("<table><thead><tr><td>Naam</td></tr></thead><tbody><tr><td>x</td></tr></tbody></table>")) === null,
   "tabel zonder ratingkolom wordt genegeerd");
ok(Parse.playerDoc(dom("<div>niets</div>")) === null, "pagina zonder rating geeft null");
ok(Parse.discipline("Tennis GD 20+ C (6.2630 - 6.8466)") === "D", "GD met plusnotatie");
ok(Parse.discipline("Onbekend onderdeel") === null, "onherkenbaar geeft null");

// ---- 5. titel van het onderdeel --------------------------------------
console.log("\ntitel van het onderdeel");
const tabTitel = dom(`<head><title>Schema - Open Dubbeltoernooi Voorbeeldstad | MijnKNLTB</title></head>
  <body><div class="page-head"><h2 class="media__title">Tennis HE6 17+</h2></div></body>`);
ok(Parse.eventTitle(tabTitel) === "Tennis HE6 17+", "tabbladtitel wordt niet gebruikt", Parse.eventTitle(tabTitel));
ok(Parse.discipline(Parse.eventTitle(tabTitel)) === "S", "en blijft dus enkel");

const navKop = dom(`<nav><h3>Mixed dubbel</h3></nav>
  <div class="page-subhead"><h4 class="media__title">Tennis HE6</h4></div>`);
ok(Parse.eventTitle(navKop) === "Tennis HE6", "kop uit de navigatie telt niet mee", Parse.eventTitle(navKop));

const leeg = dom(`<head><title>Iets met dubbel erin</title></head><body><p>niets</p></body>`);
ok(Parse.eventTitle(leeg) === "", "geen kop -> lege titel", JSON.stringify(Parse.eventTitle(leeg)));
ok(Parse.discipline(Parse.eventTitle(leeg)) === null, "en dus geen discipline geraden");

// ---- 6. link naar het juiste profiel ---------------------------------
console.log("\ndoorloop naar het profiel");
const spelerPagina = dom(`
  <div class="masthead"><div class="dropdown-menu"><ul class="dropdown-list">
    <li><a href="/player-profile/13e57c28-14f9-424e-83c4-c7e96c9546a7" title="Mijn profiel">Mijn profiel</a></li>
  </ul></div></div>
  <div class="page-head"><div class="media__content">
    <h2 class="media__title"><a class="media__link" href="/player-profile/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">
      <span class="nav-link__value">Petra Vermeulen</span></a></h2>
  </div></div>
  <div class="page-foot"><a href="/player-profile/ffffffff-1111-2222-3333-444444444444">iets in de voet</a></div>`);

const gevonden = Parse.profileLinks(spelerPagina);
ok(gevonden.length === 1, "alleen de speler van de pagina", JSON.stringify(gevonden));
ok(
  gevonden[0] === "/player-profile/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "'Mijn profiel' uit de menubalk wordt overgeslagen",
  gevonden[0]
);

const alleenMenu = dom(`<div class="masthead"><div class="dropdown-menu">
  <a href="/player-profile/13e57c28-14f9-424e-83c4-c7e96c9546a7">Mijn profiel</a></div></div>`);
ok(Parse.profileLinks(alleenMenu).length === 0, "geen profiel op de pagina -> niets teruggeven");

console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
process.exit(fail ? 1 : 0);
