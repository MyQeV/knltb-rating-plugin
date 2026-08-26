const DEFAULTS = {
  enabled: true,
  showSingle: true,
  showDouble: true,
  hideWhenNoRating: true,
  allowGuess: false,
  showDelta: true,
  showHistory: true,
  showCheck: true,
  showSteps: true,
  showSummary: true,
  showOdds: true,
  showMeInField: true,
  partnerRating: null,
  partnerName: null,
  chainTournament: true,
  debug: false,
  hoverOnly: false,
  maxLinksPerPage: 200,
  concurrency: 6,
  requestDelayMs: 0,
  maxPerMinute: 60,
  cacheTtlHours: 8,
};

const FIELDS = [
  "enabled", "showSingle", "showDouble", "showDelta", "showHistory", "showCheck", "showSteps", "showSummary", "showOdds", "showMeInField", "chainTournament", "hoverOnly",
  "hideWhenNoRating", "allowGuess", "debug", "maxLinksPerPage",
  "maxPerMinute", "concurrency", "cacheTtlHours",
];
const TEXT_FIELDS = new Set();
const out = document.getElementById("out");

function activeTab() {
  return new Promise((r) =>
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => r(tabs[0]))
  );
}

async function send(msg) {
  const tab = await activeTab();
  if (!tab) return null;
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, msg, (resp) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(resp);
    });
  });
}

/* Wat doet de extensie op de pagina die je nu open hebt? Zonder dit is het
   gissen of hij hier iets doet — er staat immers alleen iets in beeld als er
   ook ratings te tonen zijn. */
async function toonStatus() {
  const el = document.getElementById("status");
  const r = await send({ type: "status" });

  if (!r || r.error || !r.ok) {
    el.className = "status stil";
    el.innerHTML =
      "<b>Hier doet de extensie niets.</b><br>" +
      '<span class="wat">Deze pagina hoort niet bij mijnknltb.toernooi.nl, of hij ' +
      "is geopend voordat de extensie geladen werd \u2014 herlaad de pagina.</span>";
    return;
  }

  if (!r.aan) {
    el.className = "status uit";
    el.innerHTML =
      "<b>Uitgeschakeld.</b><br>" +
      '<span class="wat">Zet het vinkje \u201cIngeschakeld\u201d aan om weer iets te zien.</span>';
    return;
  }

  const n = r.nu;
  const doet = [];
  if (n.badges) doet.push(n.badges + " rating" + (n.badges === 1 ? "" : "s"));
  if (n.mutaties) doet.push(n.mutaties + " mutatie" + (n.mutaties === 1 ? "" : "s"));
  if (n.winstkansen) doet.push(n.winstkansen + " winstkans" + (n.winstkansen === 1 ? "" : "en"));
  if (n.paneel) doet.push("het paneel");
  if (n.verloop) doet.push("het ratingverloop");

  const g = r.gezien;
  const herkomst = g
    ? g.uitCache + " uit cache, " + g.ophalen + " opgehaald" +
      (g.overgeslagen ? ", " + g.overgeslagen + " overgeslagen" : "")
    : null;

  el.className = "status " + (doet.length ? "doet" : "stil");
  el.innerHTML =
    "<b>" + r.naam + "</b><br>" +
    (doet.length ? "Toont hier " + doet.join(", ") + "." : "Hier valt nu niets te tonen.") +
    (herkomst ? '<br><span class="wat">' + herkomst + "</span>" : "") +
    (r.ophalen
      ? ""
      : '<br><span class="wat">Haalt op deze pagina geen ratings op. ' + (r.waarom || "") + "</span>");
}

toonStatus();

chrome.storage.local.get("settings", (obj) => {
  const s = { ...DEFAULTS, ...(obj.settings || {}) };
  for (const f of FIELDS) {
    const el = document.getElementById(f);
    if (el.type === "checkbox") el.checked = !!s[f];
    else el.value = s[f];
  }
});

function save() {
  chrome.storage.local.get("settings", (obj) => {
    const s = { ...DEFAULTS, ...(obj.settings || {}) };
    for (const f of FIELDS) {
      const el = document.getElementById(f);
      if (el.type === "checkbox") {
        s[f] = el.checked;
      } else if (TEXT_FIELDS.has(f)) {
        s[f] = el.value;
      } else {
        // een leeggemaakt getalveld gaf Number("") === 0, en concurrency 0
        // liet de wachtrij voorgoed stilstaan
        const lo = el.min !== "" ? Number(el.min) : 1;
        const hi = el.max !== "" ? Number(el.max) : Infinity;
        const v = Number(el.value);
        s[f] = !isFinite(v) || v === 0 ? DEFAULTS[f] : Math.min(hi, Math.max(lo, v));
        el.value = s[f];
      }
    }
    chrome.storage.local.set({ settings: s }, () => send({ type: "settings", settings: s }));
  });
}

for (const f of FIELDS) document.getElementById(f).addEventListener("change", save);

document.getElementById("dash").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

document.getElementById("rescan").addEventListener("click", async () => {
  const knop = document.getElementById("rescan");
  const oud = knop.textContent;
  knop.textContent = "bezig…";
  knop.disabled = true;

  const r = await send({ type: "rescan" });

  knop.textContent = oud;
  knop.disabled = false;

  if (!r || r.error) {
    // meestal: het tabblad stond al open toen de extensie herladen werd
    out.value =
      "Kan niet met deze pagina praten.\n\n" +
      (r && r.error ? r.error + "\n\n" : "") +
      "Ververs het tabblad (F5) en probeer opnieuw. Dit gebeurt als de " +
      "extensie herladen is nadat de pagina al open stond, of als je op een " +
      "pagina bent waar de extensie niet actief is.";
    return;
  }

  out.value =
    "Opnieuw gescand.\n" +
    r.spelers + " spelers gevonden" +
    (r.ophalen ? " (" + r.uitCache + " uit cache, " + r.ophalen + " worden opgehaald)" : " (alles uit cache)") +
    "\n" + r.tags + " badges, " + r.chips + " mutaties op de pagina";
});

document.getElementById("clear").addEventListener("click", () => {
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all).filter((k) => k.startsWith("r:"));
    chrome.storage.local.remove(keys, async () => {
      out.value = keys.length + " gecachte spelers gewist — pagina wordt opnieuw gescand.";
      await send({ type: "rescan" });
    });
  });
});

/* ------------------------------------------------------------ calculator */

const CALC_IDS = ["a1", "a2", "b1", "b2"];
const calcOut = document.getElementById("calcOut");

const num = (id) => {
  const v = document.getElementById(id).value.trim().replace(",", ".");
  if (!v) return null;
  const n = parseFloat(v);
  return isFinite(n) && n > 0 && n <= 10 ? n : null;
};

const f4 = (n) => n.toFixed(4).replace(".", ",");
const sgn = (n) => (n > 0 ? "+" : "−") + Math.abs(n).toFixed(4).replace(".", ",");

function calc() {
  const a = [num("a1"), num("a2")].filter((x) => x != null);
  const b = [num("b1"), num("b2")].filter((x) => x != null);

  if (!a.length || !b.length) {
    calcOut.textContent = "—";
    return;
  }
  if (a.length !== b.length) {
    calcOut.textContent = "Beide teams even veel spelers invullen (1 of 2).";
    return;
  }

  const m = DSS.match(a, b);
  const rows = [];

  rows.push(
    `<b>${m.isDouble ? "Dubbel" : "Enkel"}</b> — team 1 ${f4(m.ratingA)} tegen team 2 ${f4(m.ratingB)}`
  );
  rows.push(
    `winstkans: ${Math.round(m.a.prob * 100)}% – ${Math.round(m.b.prob * 100)}%`
  );
  rows.push("");

  [["Team 1", a, m.a], ["Team 2", b, m.b]].forEach(([label, ratings, side]) => {
    rows.push(`<b>${label}</b>`);
    ratings.forEach((r, i) => {
      const who = ratings.length > 1 ? `speler ${i + 1} ` : "";
      rows.push(
        `  ${who}${f4(r)} → bij winst <span class="up">${f4(r + side.onWin)}</span> ` +
          `(${sgn(side.onWin)}), bij verlies <span class="down">${f4(r + side.onLoss)}</span> ` +
          `(${sgn(side.onLoss)})`
      );
    });
  });

  calcOut.innerHTML = rows.join("\n");
}

for (const id of CALC_IDS) {
  document.getElementById(id).addEventListener("input", calc);
}

document.getElementById("diagnose").addEventListener("click", async () => {
  out.value = "bezig…";
  const url = document.getElementById("diagUrl").value.trim();
  const r = await send({ type: "diagnose", url: url || undefined });
  out.value = JSON.stringify(r, null, 2);
  out.select();
});
