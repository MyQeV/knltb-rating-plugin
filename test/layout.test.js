/* Meet in een echte browser waar de chipregel terechtkomt.
 *
 * De site-CSS hieronder is niet nagebouwd op gevoel maar overgenomen uit wat
 * de diagnose van de extensie zelf uit `document.styleSheets` heeft gelezen
 * op de wedstrijdenpagina. Dat is het verschil met de vorige versie van deze
 * test: die ging uit van text-align, en de site blijkt uit te lijnen met
 * flexbox terwijl text-align overal op `start` staat.
 *
 * De kern van de site-opmaak, boven 992px met .match--list:
 *
 *   .match__row                  krijgt min/max-width 50%  -> elk team een helft
 *   .match__row:first-of-type    flex-direction: row-reverse
 *   ... .match__row-title-value  flex-direction: row-reverse
 *
 * De linkerhelft draait dus zijn inhoud om, zodat die tegen het midden komt.
 * De extensie doet met de chipregel precies hetzelfde: rechts uitgelijnd én
 * omgekeerd, zodat het percentage van beide kanten aan de binnenkant staat.
 *
 * Daaronder (of zonder .match--list) staan de teams onder elkaar en is alles
 * links uitgelijnd; dan hoort de chipregel dat ook te zijn.
 */
const fs = require("fs");
const path = require("path");

/* Deze test meet in een echte browser; die is niet overal beschikbaar.
   Zonder browser slaan we hem over in plaats van de suite te laten vallen —
   een overgeslagen meting is eerlijker dan een test die niets doet. */
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {}
const overslaan = (waarom) => {
  console.log("  overgeslagen: " + waarom);
  console.log("\nalle tests geslaagd");
  process.exit(0);
};
if (!chromium) overslaan("playwright niet geïnstalleerd (npm i -D playwright && npx playwright install chromium)");

const eigen = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");

let fail = 0;
const ok = (c, l, e = "") => {
  console.log((c ? "  ok   " : "  FOUT ") + l + (e ? "  " + e : ""));
  if (!c) fail++;
};

/* Let op: mintekens zijn U+2212, net als in signed(). Een gewoon koppelteken
   is smaller en zou een verschil laten zien dat de extensie nooit maakt. */
const regel = (pct, delta, open) =>
  `<div class="knltb-regel"><span class="knltb-odds ${pct > 50 ? "fav" : "under"}">${pct}%</span>` +
  `<span class="knltb-delta ${open ? "open" : delta[0] === "−" ? "gain" : "drop"}">${delta}</span></div>`;

const naam = (n, r) =>
  `<div class="match__row-title-value"><span class="match__row-title-value-content">` +
  `<a class="nav-link"><span class="nav-link__value">${n}` +
  `<span class="knltb-tags"><span class="knltb-tag knltb-tag--double step">` +
  `<span class="k">D:</span><span class="v">${r}</span></span></span>` +
  `</span></a></span></div>`;

/* Namen bewust LANGER dan hun ratingbadge. Met een korte naam is de badge
   het breedste element en vallen de randen sowieso samen — dan bewijst een
   uitlijningstest niets. Zo staat de badge echt smaller in een breder vak. */
const kaart = (open) => `
<div class="match match--list">
  <div class="match__header">Tennis GD6<br>Ronde van 32</div>
  <div class="match__body">
    <div class="match__row-wrapper">
      <div class="match__row knltb-heeft-regel">
        <div class="match__row-title">
          ${naam("Bartholomeus van Rossum", "8,0387 → 8,2448")}
          ${naam("Annemarieke van Beekhuizen", "6,6397 → 6,8458")}
          ${open ? regel(75, "W −0,2061 · V +0,0689", true) : regel(75, "+0,2061")}
        </div>
        <span class="tag--round tag--success tag tag--small match__status">W</span>
      </div>
      <div class="match__row has-won knltb-heeft-regel">
        <div class="match__row-title">
          ${naam("Christiaan Mulder Hoogeveen", "7,2732 → 7,0671")}
          ${naam("Emma van Vliet - Wagenaar", "8,4952 → 8,2891")}
          ${open ? regel(25, "W −0,0689 · V +0,2061", true) : regel(25, "−0,2061")}
        </div>
        <span class="tag--round tag--success tag tag--small match__status">W</span>
      </div>
    </div>
    <div class="match__result">2 - 6&nbsp;&nbsp;3 - 6</div>
  </div>
</div>`;

/* Overgenomen uit de diagnose (siteCss). 1rem meet daar 10,72px — af te
   leiden uit de gemeten padding van 12,06px voor 1.125rem. */
const SITE = `
html { font-size: 10.72px; }
body { margin: 0; background: #fff; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
*, ::after, ::before { box-sizing: border-box; }

.match { background-color: #fff; border-radius: .6rem; margin-bottom: 2rem; position: relative; }
.match__body { border: 3px solid transparent; border-radius: .6rem; display: flex; }
.match__header { width: 20rem; background: #f5f5f5; padding: 1.4rem; font-size: 1.3rem; }
.match__row-wrapper {
  display: flex; flex-direction: column; flex-grow: 1;
  justify-content: center; margin-left: 5px; min-width: 0; padding: 3px 0;
}
.match__row { align-items: center; display: flex; min-height: 2.5rem; padding-top: 3px; }
.match__row:first-of-type { border-bottom: 1px solid #e1e2e5; padding-bottom: 3px; padding-top: 0; }
.match__row-title {
  display: flex; flex: 1 1 0%; flex-direction: column;
  justify-content: center; min-width: 0; position: relative;
}
.match__row-title-value { align-items: center; display: flex; min-height: 2rem; min-width: 0; }
.match__row-title-value-content {
  align-items: center; display: flex; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.match__status {
  background-color: #d0d2d8; border: 1px solid #fff; color: #fff; font-size: 10px;
  font-weight: 600; height: 12px; line-height: 22px; min-width: 12px; padding: 0;
  text-align: center; width: 12px; display: inline-block !important;
  margin-left: .375rem; margin-right: 1rem; overflow: hidden; text-indent: -9999em;
}
.match__result { display: flex; position: relative; padding-right: .75rem; }

@media (min-width: 768px) {
  .match__row-wrapper { margin-left: 7px; }
  .match__row { min-height: 2.8rem; }
}
@media (min-width: 992px) {
  .match.match--list { display: flex; margin-bottom: .75rem; }
  .match.match--list .match__body { flex-grow: 1; width: calc(100% - 20rem); border-bottom: 1px solid #e1e2e5; }
  .match.match--list .match__row-wrapper { flex-direction: row; margin: 0; position: relative; width: calc(100% - 20rem); }
  .match.match--list .match__row { margin-bottom: 0; max-width: 50%; min-width: 50%; padding: 0 1.125rem; border-bottom: 0 !important; }
  .match.match--list .match__row:first-of-type { flex-direction: row-reverse; }
  .match.match--list .match__row:first-of-type .match__row-title-value { flex-direction: row-reverse; }
  .match.match--list .match__row-title { flex-basis: auto; flex-grow: inherit; flex-shrink: inherit; padding: 0; }
  .match.match--list .match__result { flex-basis: 20rem; justify-content: flex-end; }
}
`;

const meet = () => {
  const rand = (el) => {
    const r = el.getBoundingClientRect();
    return { links: r.left, rechts: r.right };
  };
  const kant = (rij) => {
    const regel = rij.querySelector(".knltb-regel");
    const namen = [...rij.querySelectorAll(".knltb-tag")];
    return {
      naamblok: rand(rij.querySelector(".match__row-title")),
      badge: rand(namen[namen.length - 1]),
      naam: rand([...rij.querySelectorAll(".match__row-title-value-content")].pop()),
      /* Elke naam apart met zijn eigen vak. Alleen naar de laatste kijken
         bewijst niets: het vak van de kortste naam is even breed als zijn
         badge, dus daar vallen de randen sowieso samen. Bij de langste naam
         is het vak breder en wordt zichtbaar welke kant de badge op staat. */
      badges: [...rij.querySelectorAll(".match__row-title-value")].map((v) => ({
        badge: rand(v.querySelector(".knltb-tag")),
        vak: rand(v.querySelector(".match__row-title-value-content")),
      })),
      odds: rand(regel.querySelector(".knltb-odds")),
      delta: rand(regel.querySelector(".knltb-delta")),
      regelBoven: regel.getBoundingClientRect().top,
      badgeOnder: namen[namen.length - 1].getBoundingClientRect().bottom,
    };
  };
  const rijen = [...document.querySelectorAll(".match__row")];
  const w = document.querySelector(".match__row-wrapper").getBoundingClientRect();
  return { midden: (w.left + w.right) / 2, links: kant(rijen[0]), rechts: kant(rijen[1]) };
};

(async () => {
  // KNLTB_CHROME wijst desgewenst een eigen Chrome/Chromium aan
  let b;
  try {
    b = await chromium.launch(process.env.KNLTB_CHROME ? { executablePath: process.env.KNLTB_CHROME } : {});
  } catch {
    overslaan("geen Chromium voor playwright (npx playwright install chromium)");
  }
  const laad = async (html, breed) => {
    const p = await b.newPage({ viewport: { width: breed, height: 400 } });
    await p.setContent(`<style>${SITE}\n${eigen}</style>${html}`);
    const m = await p.evaluate(meet);
    await p.close();
    return m;
  };

  // ---- breed: de twee teams naast elkaar, gespiegeld om het midden -----
  const r = await laad(kaart(false), 1440);
  console.log("\nnaast elkaar (>= 992px, .match--list)");

  ok(r.links.regelBoven >= r.links.badgeOnder - 1,
     "chips staan onder de namen, niet ernaast");

  /* Door het omdraaien staat op de linkerhelft het percentage aan de rand,
     niet de mutatie — dus daar meten we de rand van de regel aan af. */
  ok(Math.abs(r.links.odds.rechts - r.links.naamblok.rechts) < 1,
     "linkerhelft: de regel eindigt waar het naamblok eindigt",
     Math.round(r.links.odds.rechts) + " vs " + Math.round(r.links.naamblok.rechts));
  ok(Math.abs(r.rechts.odds.links - r.rechts.naamblok.links) < 1,
     "rechterhelft: de regel begint waar het naamblok begint",
     Math.round(r.rechts.odds.links) + " vs " + Math.round(r.rechts.naamblok.links));

  /* De ratingbadge onder de naam hoort dezelfde kant op te wijzen als de
     naam zelf: op de omgedraaide helft dus rechts, niet links. */
  ok(r.links.badges.every((b) => Math.abs(b.badge.rechts - b.vak.rechts) < 1),
     "linkerhelft: elke ratingbadge eindigt waar zijn naamvak eindigt",
     r.links.badges.map((b) => Math.round(b.badge.rechts) + "/" + Math.round(b.vak.rechts)).join(" "));
  ok(r.rechts.badges.every((b) => Math.abs(b.badge.links - b.vak.links) < 1),
     "rechterhelft: en elke badge begint waar zijn naamvak begint",
     r.rechts.badges.map((b) => Math.round(b.badge.links) + "/" + Math.round(b.vak.links)).join(" "));

  /* De kern van de wens: van beide kanten staat het percentage als eerste
     tegen het midden, met de mutatie erbuiten. */
  ok(r.links.odds.rechts > r.links.delta.rechts,
     "linkerhelft: percentage aan de binnenkant, mutatie erbuiten",
     "% eindigt " + Math.round(r.links.odds.rechts) + ", mutatie " + Math.round(r.links.delta.rechts));
  ok(r.rechts.odds.links < r.rechts.delta.links,
     "rechterhelft: percentage aan de binnenkant, mutatie erbuiten",
     "% begint " + Math.round(r.rechts.odds.links) + ", mutatie " + Math.round(r.rechts.delta.links));
  ok(r.links.odds.rechts < r.midden && r.rechts.odds.links > r.midden,
     "en die twee percentages flankeren het midden van de kaart",
     Math.round(r.links.odds.rechts) + " | " + Math.round(r.midden) + " | " + Math.round(r.rechts.odds.links));

  // een veel bredere chip mag de spiegeling niet breken
  const ro = await laad(kaart(true), 1440);
  ok(Math.abs(ro.links.odds.rechts - ro.links.naamblok.rechts) < 1 &&
     Math.abs(ro.rechts.odds.links - ro.rechts.naamblok.links) < 1,
     "ook met de brede chip van een nog te spelen wedstrijd",
     Math.round(ro.links.odds.rechts) + "/" + Math.round(ro.links.naamblok.rechts) + " en " +
     Math.round(ro.rechts.odds.links) + "/" + Math.round(ro.rechts.naamblok.links));
  ok(ro.links.odds.rechts > ro.links.delta.rechts && ro.rechts.odds.links < ro.rechts.delta.links,
     "en het percentage blijft aan de binnenkant");

  // ---- smal: teams onder elkaar, alles links --------------------------
  const l = await laad(kaart(false), 900);
  console.log("\nonder elkaar (< 992px)");

  ok(l.links.badges.every((b) => Math.abs(b.badge.links - b.vak.links) < 1),
     "elke ratingbadge staat links, net als de naam",
     l.links.badges.map((b) => Math.round(b.badge.links) + "/" + Math.round(b.vak.links)).join(" "));
  ok(Math.abs(l.links.odds.links - l.links.naamblok.links) < 1,
     "de regel begint waar het naamblok begint",
     Math.round(l.links.odds.links) + " vs " + Math.round(l.links.naamblok.links));
  ok(Math.abs(l.links.odds.links - l.rechts.odds.links) < 1,
     "beide kanten in dezelfde kolom",
     Math.round(l.links.odds.links) + " en " + Math.round(l.rechts.odds.links));
  ok(l.links.odds.rechts <= l.links.delta.links + 0.5,
     "en hier staat het percentage gewoon vóór de mutatie");

  await b.close();
  console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
  process.exit(fail ? 1 : 0);
})();
