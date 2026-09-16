/* Alle tests achter elkaar. */
const { execFileSync } = require("child_process");
const suites = ["dss.test.js", "parse.test.js", "boot.test.js", "draw.test.js", "chain.test.js", "advance.test.js", "matchlist.test.js", "poule.test.js", "settings.test.js", "rating.test.js", "fetch.test.js", "layout.test.js"];
let fail = 0;
for (const s of suites) {
  console.log("\n=== " + s + " ===");
  try {
    console.log(execFileSync("node", [__dirname + "/" + s], { encoding: "utf8" }).trim());
  } catch (e) {
    console.log((e.stdout || "").trim());
    fail++;
  }
}
console.log(fail ? "\n" + fail + " suite(s) mislukt" : "\n== alles groen ==");
process.exit(fail ? 1 : 0);
