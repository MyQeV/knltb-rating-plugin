/* Controle van de DSS-formule tegen twee onafhankelijke bronnen:
 *   1. het rekenvoorbeeld uit de KNLTB-PDF
 *   2. een echte wedstrijd van de Rating-pagina, waar de KNLTB zijn eigen
 *      mutatie toont naast de ratings zoals ze op dat moment waren
 */
const DSS = require("../dss.js");
let fail = 0;
const ok = (c, l, e = "") => {
  console.log((c ? "  ok   " : "  FOUT ") + l + (e ? "  " + e : ""));
  if (!c) fail++;
};
const f4 = (n) => n.toFixed(4).replace(".", ",");

console.log("rekenvoorbeeld uit de PDF (enkel)");
const pdf = DSS.match([6.0], [6.5]);
ok(Math.abs(pdf.a.prob - 0.71) < 0.005, "winstkans 71%", (pdf.a.prob * 100).toFixed(2) + "%");
ok(f4(6.0 + pdf.a.onWin) === "5,9212", "Victor na winst 5,9212", f4(6.0 + pdf.a.onWin));
ok(f4(6.5 + pdf.b.onLoss) === "6,5788", "Pieter na verlies 6,5788", f4(6.5 + pdf.b.onLoss));
ok(Math.abs(pdf.a.onWin + pdf.b.onLoss) < 1e-12, "nulsom");

console.log("\necht duel van een Rating-pagina (dubbel)");
console.log("  kwartfinale dubbel — KNLTB toonde 0,1221");
const m = DSS.match([5.5812, 7.2280], [6.7593, 5.8261]); // Mike+Lotte tegen Fleur+Bram
ok(m.q === 2.012, "dubbel-q gebruikt", String(m.q));
ok(f4(DSS.teamRating([5.5812, 7.228])) === "6,4046", "teamrating Mike/Lotte");
ok(f4(m.a.onLoss) === "0,1221", "mutatie bij verlies = 0,1221", f4(m.a.onLoss));

console.log("\nverwachtingswaarde is nul");
for (const [a, b] of [[6, 6.5], [5.5, 8], [7, 7], [6.2, 6.25]]) {
  const x = DSS.match([a], [b]);
  const E = x.a.prob * x.a.onWin + (1 - x.a.prob) * x.a.onLoss;
  ok(Math.abs(E) < 1e-15, a + " tegen " + b, "E = " + E.toExponential(1));
}

console.log(fail ? "\n" + fail + " test(s) mislukt" : "\nalle tests geslaagd");
process.exit(fail ? 1 : 0);
