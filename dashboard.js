/* Dashboard — draait als eigen extensiepagina.
 *
 * Omdat een extensiepagina op zijn eigen origin draait én de extensie
 * host_permissions voor mijnknltb heeft, mag deze pagina zelf ophalen mét
 * jouw sessiecookie. Er hoeft dus geen tabblad open te staan.
 *
 * De cache wordt gedeeld met het content script: dezelfde "r:"-sleutels in
 * chrome.storage.local. Wat de plugin op de site al ophaalde, is hier gratis.
 */

(() => {
  "use strict";

  const { ORIGIN: SITE, UUID, cacheKey, store, f4, signed, isProfileUrl, sameName, median } = Site;

  const $ = (id) => document.getElementById(id);
  const norm = Parse.norm;

  let settings = {};

  const status = (msg) => {
    $("status").textContent = msg || "";
  };

  /* ------------------------------------------------------------- ophalen */

  let inFlight = 0;
  const MAX_PARALLEL = 6;
  const waiters = [];

  async function slot() {
    if (inFlight < MAX_PARALLEL) {
      inFlight++;
      return;
    }
    // wachten tot iemand zijn plek doorgeeft; die plek is dan al van ons,
    // dus hier niet nogmaals ophogen — anders lopen er meer dan MAX_PARALLEL
    await new Promise((r) => waiters.push(r));
  }

  function release() {
    const next = waiters.shift();
    if (next) next(); // plek doorgeven, teller blijft gelijk
    else inFlight--;
  }

  async function fetchDoc(url) {
    await slot();
    try {
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 429 || res.status === 503) throw new Error("Server is druk (" + res.status + ")");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const html = await res.text();
      if (Site.looksLoggedOut(html)) {
        throw new Error("Je lijkt niet ingelogd op mijnknltb.toernooi.nl");
      }
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.__url = res.url || url;
      return doc;
    } finally {
      release();
    }
  }

  /** Rating van een speler, via dezelfde cache als het content script. */
  async function ratingFor(url) {
    const ttl = (settings.cacheTtlHours || 8) * 36e5;
    const key = cacheKey(url);

    const hit = (await store.get(key))[key];
    if (hit && !hit.none && typeof hit.ts === "number" && Date.now() - hit.ts <= ttl) {
      return { ...hit, fromCache: true };
    }

    let doc = await fetchDoc(url);
    let data = isProfileUrl(url) || isProfileUrl(doc.__url) ? Parse.playerDoc(doc) : null;

    // toernooipagina: doorlopen naar het landelijke profiel
    if (!data) {
      // let op: de menubalk bevat "Mijn profiel" van de ingelogde gebruiker,
      // dus niet zomaar de eerste /player-profile/-link pakken
      const link = Parse.profileLinks(doc)
        .map((h) => {
          try {
            return new URL(h, url).href;
          } catch {
            return null;
          }
        })
        .find((h) => h && isProfileUrl(h));
      if (!link) throw new Error("Geen profiel gevonden achter " + url);
      doc = await fetchDoc(link);
      data = Parse.playerDoc(doc);
    }

    if (!data) throw new Error("Geen rating gevonden");

    const via = doc.__url || url;
    const rec = { ...data, via };
    const saved = { ...rec, ts: Date.now() };
    await store.set({ [key]: saved, [cacheKey(via)]: saved });
    return rec;
  }

  // de foutcodes van Site.parsePlayerInput, in woorden
  const INVOER_FOUT = {
    BUITEN_BEREIK: "Een rating ligt tussen 1 en 10",
    GEEN_ORG: "Geen organisatiecode bekend — plak een profiellink",
    ANDERE_SITE: "Alleen links van mijnknltb.toernooi.nl",
    ONBEGREPEN: "Niet herkend als rating, link of bondsnummer",
  };

  /** Invoer begrijpen: rating, uuid, bondsnummer of link. */
  async function resolveInput(text) {
    let p;
    try {
      p = Site.parsePlayerInput(text, ORG);
    } catch (err) {
      throw new Error(INVOER_FOUT[err.message] || err.message);
    }
    if (!p) return null;
    if (p.rating != null) return { rating: p.rating, name: null };

    const d = await ratingFor(p.url);
    return { rating: null, data: d, name: d.name, url: p.url };
  }

  // KNLTB als organisatie; komt uit de links die de site zelf gebruikt
  const ORG = "630BAE5F-36FE-42EA-A2E5-999630ABFEB8";

  /* ------------------------------------------------- toernooi-verkenner */

  let field = null; // {disc, title, rows:[…]}

  async function loadEvent(raw) {
    const t = norm(raw);
    if (!t) return;

    let url;
    try {
      url = new URL(t, SITE).href;
    } catch {
      status("Dat is geen geldige URL");
      return;
    }

    status("bezig met ophalen…");
    $("eventTable").hidden = true;
    $("eventNote").hidden = true;
    $("eventHead").hidden = true;
    $("eventPartnerBar").hidden = true;

    try {
      const doc = await fetchDoc(url);
      const title = Parse.eventTitle(doc);
      const disc = Parse.discipline(title) || "S";

      const table = Parse.entryTable(doc);
      let rows;

      if (table) {
        rows = table.rows.map((r) => ({
          name: r.name,
          names: r.names,
          ratings: r.ratings,
          start: DSS.teamRating(r.ratings.slice(0, 2)),
          club: r.club,
          seed: r.seed,
        }));
        field = { disc, title, rows, caption: table.caption, url };
      } else {
        // geen inschrijvingstabel: spelerslinks van de pagina afhalen
        status("geen inschrijvingstabel — spelers worden los opgehaald…");
        rows = await fieldFromLinks(doc, url, disc);
        field = { disc, title, rows, caption: null, url };
      }

      if (!rows.length) {
        status("Geen spelers met een rating gevonden op die pagina");
        return;
      }

      await addSelf();
      renderEvent();
      status("");
    } catch (err) {
      status(err.message);
    }
  }

  /** Spelers van een schema-/poulepagina, ieder apart opgehaald. */
  async function fieldFromLinks(doc, base, disc) {
    const links = [
      ...new Set(
        [...doc.querySelectorAll("a[href]")]
          .map((a) => a.getAttribute("href") || "")
          .filter((h) => /player\.aspx|\/player-profile\/|\/player\//i.test(h))
      ),
    ].slice(0, 64);

    const out = [];
    await Promise.all(
      links.map(async (h) => {
        try {
          const abs = new URL(h, base).href;
          const d = await ratingFor(abs);
          const start = disc === "D" ? d.double : d.single;
          if (start == null || !isFinite(start)) return;
          out.push({ name: d.name || abs, names: [d.name || abs], ratings: [start], start, club: "", seed: "" });
        } catch {
          /* speler overslaan */
        }
      })
    );

    // dubbelen eruit
    const seen = new Set();
    return out.filter((r) => (seen.has(r.name) ? false : seen.add(r.name)));
  }

  /** Jezelf toevoegen als je nog niet in het veld staat. */
  async function addSelf() {
    if (!field) return;
    const me = await myRating();
    if (!me) return;

    const already = field.rows.find((r) => r.names.some((n) => sameName(n, me.name)));
    if (already) {
      already.isSelf = true;
      return;
    }

    const mine = field.disc === "D" ? me.double : me.single;
    if (mine == null || !isFinite(mine)) return;

    const partner = partnerRating() ?? mine;
    const ratings = field.disc === "D" ? [mine, partner] : [mine];

    field.rows.push({
      name: (me.name || "jij") + (field.disc === "D" ? partnerName() : "") + " — niet ingeschreven",
      names: [me.name || "jij"],
      ratings,
      start: DSS.teamRating(ratings),
      club: "",
      seed: "",
      isSelf: true,
      virtual: true,
    });
  }

  const partnerRating = () => {
    const v = settings.partnerRating;
    return v != null && isFinite(v) && v >= 1 && v <= 10 ? v : null;
  };
  const partnerName = () =>
    partnerRating() == null
      ? " + partner van gelijke sterkte"
      : " + " + (settings.partnerName || "partner") + " " + f4(partnerRating());

  const asTeam = (r, disc) =>
    disc === "D" && r.ratings.length === 1 ? [r.ratings[0], r.ratings[0]] : r.ratings;

  function renderEvent() {
    const rows = [...field.rows].sort((a, b) => a.start - b.start);
    rows.forEach((r, i) => (r.rank = i + 1));

    const me = rows.find((r) => r.isSelf);
    const vals = rows.map((r) => r.start).sort((a, b) => a - b);

    const head = $("eventHead");
    head.hidden = false;
    head.textContent = "";

    const h = document.createElement("h2");
    h.textContent = field.title || field.caption || "Onderdeel";
    head.appendChild(h);

    const sub = document.createElement("p");
    sub.className = "muted";
    sub.textContent =
      (field.disc === "D" ? "Dubbel" : "Enkel") +
      " · " + rows.length + " deelnemers" +
      " · sterkste " + f4(vals[0]) +
      " · mediaan " + f4(median(vals)) +
      " · zwakste " + f4(vals[vals.length - 1]) +
      (me ? "  ·  jij " + me.rank + "e" + (me.virtual ? " (niet ingeschreven)" : "") : "");
    head.appendChild(sub);

    $("eventPartnerBar").hidden = field.disc !== "D";
    $("partner").value = partnerRating() != null ? f4(partnerRating()) : "";
    $("partnerInfo").textContent = me
      ? "jouw teamrating " + f4(me.start)
      : "vul je partner in om jouw kant te bepalen";

    const table = $("eventTable");
    table.hidden = false;
    table.textContent = "";

    const thead = table.insertRow();
    for (const label of ["#", "Speler", "Rating", "Club", "Winstkans", "Bij winst", "Bij verlies"]) {
      const th = document.createElement("th");
      th.textContent = label;
      thead.appendChild(th);
    }

    for (const r of rows) {
      const tr = table.insertRow();
      tr.className = r.isSelf ? "is-self" : "";

      const add = (text, cls, title) => {
        const td = tr.insertCell();
        td.textContent = text;
        if (cls) td.className = cls;
        if (title) td.title = title;
        return td;
      };

      add(String(r.rank), "num");
      add(r.name + (r.seed ? "  [" + r.seed + "]" : ""));
      add(f4(r.start), "num", r.ratings.length > 1 ? r.ratings.map(f4).join(" en ") : "");
      add(r.club || "", "club");

      if (!me || r === me) {
        add("", "num");
        add("—", "num muted");
        add("—", "num muted");
      } else {
        const m = DSS.match(asTeam(me, field.disc), asTeam(r, field.disc)).a;
        add(Math.round(m.prob * 100) + "%", "num");
        add(signed(m.onWin), "num gain");
        add(signed(m.onLoss), "num drop");
      }
    }

    const note = $("eventNote");
    note.hidden = false;
    note.textContent =
      "Lagere rating is sterker, dus winst geeft een min. De twee laatste kolommen " +
      "zijn wat een partij tégen die speler met jouw rating doet." +
      (field.disc === "D" && me && me.virtual
        ? " Voor jouw kant is gerekend met " +
          (partnerRating() == null ? "een partner van gelijke sterkte." : "de opgegeven partner.")
        : "");
  }

  /* ------------------------------------------------------ mijn overzicht */

  let mine = null;

  async function myRating() {
    if (mine) return mine;
    const { selfProfile } = await store.get("selfProfile");
    if (!selfProfile) return null;
    try {
      mine = await ratingFor(selfProfile);
      return mine;
    } catch {
      return null;
    }
  }

  async function loadMe() {
    status("bezig…");
    const cards = $("meCards");
    cards.textContent = "";

    const { selfProfile } = await store.get("selfProfile");
    if (!selfProfile) {
      status("Open eerst een pagina op mijnknltb, dan onthoudt de plugin welk profiel van jou is.");
      return;
    }

    try {
      const me = await ratingFor(selfProfile);
      mine = me;

      card(cards, "Enkel", f4(me.single), me.singleLevel ? "speelsterkte " + me.singleLevel : "");
      card(cards, "Dubbel", f4(me.double), me.doubleLevel ? "speelsterkte " + me.doubleLevel : "");
      card(cards, "Naam", me.name || "—", "");

      const m = selfProfile.match(new RegExp("/player-profile/" + UUID, "i"));
      if (m) {
        const doc = await fetchDoc(SITE + "/player-profile/" + m[1] + "/Rating");
        const seas = History.season(doc);
        const hist = History.parse(doc);
        const box = $("meChart");
        box.hidden = false;
        box.textContent = "";

        if (seas) {
          const h2 = document.createElement("h2");
          h2.textContent = "Dit seizoen";
          box.appendChild(h2);

          const t = document.createElement("table");
          t.className = "grid";
          const hr = t.insertRow();
          for (const h of ["", "Startrating", "Nu", "Verschil", "Wedstrijden"]) {
            const th = document.createElement("th");
            th.textContent = h;
            hr.appendChild(th);
          }
          for (const [k, label] of [["single", "Enkel"], ["double", "Dubbel"]]) {
            const v = seas[k];
            if (!v) continue;
            const tr = t.insertRow();
            const beter = v.now < v.start;
            [label + " (sterkte " + v.level + ")", f4(v.start), f4(v.now),
             signed(v.now - v.start), String(v.played)].forEach((c, i) => {
              const td = tr.insertCell();
              td.textContent = c;
              if (i >= 1) td.className = "num" + (i === 3 ? (beter ? " gain" : " drop") : "");
            });
          }
          box.appendChild(t);
        }

        if (!hist) {
          if (!seas) box.textContent = "Geen verloop gevonden op het tabblad Rating.";
        } else {
          const h2 = document.createElement("h2");
          h2.textContent = "Verloop";
          box.appendChild(h2);

          const spark = History.sparkline(hist.values, { width: 640, height: 140 });
          spark.classList.add(
            hist.values[hist.values.length - 1] < hist.values[0] ? "gain" : "drop"
          );
          box.appendChild(spark);

          const p = document.createElement("p");
          p.className = "muted";
          p.textContent =
            hist.values.length + " metingen · " +
            f4(hist.values[0]) + " → " + f4(hist.values[hist.values.length - 1]) + "  " +
            signed(hist.values[hist.values.length - 1] - hist.values[0]) +
            " · een lijn omhoog is vooruitgang, want lager is sterker";
          box.appendChild(p);
        }
      }
      status("");
    } catch (err) {
      status(err.message);
    }
  }

  function card(host, label, value, sub) {
    const el = document.createElement("div");
    el.className = "card";
    const l = document.createElement("span");
    l.className = "card__label";
    l.textContent = label;
    const v = document.createElement("strong");
    v.className = "card__value";
    v.textContent = value;
    el.appendChild(l);
    el.appendChild(v);
    if (sub) {
      const s = document.createElement("span");
      s.className = "card__sub";
      s.textContent = sub;
      el.appendChild(s);
    }
    host.appendChild(el);
  }

  /* --------------------------------------------------------- vergelijker */

  async function compare() {
    const out = $("compareOut");
    out.hidden = false;
    out.textContent = "bezig…";

    try {
      const vals = {};
      for (const id of ["c-a1", "c-a2", "c-b1", "c-b2"]) {
        const r = await resolveInput($(id).value);
        vals[id] = r ? (r.rating != null ? { r: r.rating, n: null } : { r: null, d: r.data, n: r.name }) : null;
      }

      const missing = [];
      const side = (a, b, disc) =>
        [a, b]
          .filter(Boolean)
          .map((x) => {
            if (x.r != null) return x.r;
            const v = disc === "D" ? x.d.double : x.d.single;
            if (v == null || !isFinite(v)) {
              // wél gevonden, maar geen rating voor déze discipline — dat is
              // iets anders dan "niets ingevuld", en hoort ook zo te klinken
              missing.push((x.n || "die speler") + " heeft geen " + (disc === "D" ? "dubbel" : "enkel") + "rating");
              return null;
            }
            return v;
          })
          .filter((v) => v != null);

      const isD = !!(vals["c-a2"] || vals["c-b2"]);
      const A = side(vals["c-a1"], vals["c-a2"], isD ? "D" : "S");
      const B = side(vals["c-b1"], vals["c-b2"], isD ? "D" : "S");

      if (missing.length) {
        out.textContent = missing.join("\n");
        return;
      }
      if (!A.length || !B.length) {
        out.textContent = "Vul minstens één speler per kant in.";
        return;
      }
      if (A.length !== B.length) {
        out.textContent = "Beide kanten evenveel spelers (1 of 2).";
        return;
      }

      const m = DSS.match(A, B);
      out.textContent = "";

      const title = document.createElement("h2");
      title.textContent = (m.isDouble ? "Dubbel" : "Enkel") + " — q = " + m.q;
      out.appendChild(title);

      const t = document.createElement("table");
      t.className = "grid";
      const head = t.insertRow();
      for (const h of ["", "Teamrating", "Winstkans", "Bij winst", "Bij verlies"]) {
        const th = document.createElement("th");
        th.textContent = h;
        head.appendChild(th);
      }

      [["Team 1", A, m.a, m.ratingA], ["Team 2", B, m.b, m.ratingB]].forEach(
        ([label, ratings, s, team]) => {
          const tr = t.insertRow();
          const cells = [
            label + " (" + ratings.map(f4).join(" + ") + ")",
            f4(team),
            Math.round(s.prob * 100) + "%",
            signed(s.onWin),
            signed(s.onLoss),
          ];
          cells.forEach((c, i) => {
            const td = tr.insertCell();
            td.textContent = c;
            if (i >= 1) td.className = "num" + (i === 3 ? " gain" : i === 4 ? " drop" : "");
          });
        }
      );
      out.appendChild(t);

      const p = document.createElement("p");
      p.className = "note";
      p.textContent =
        "Elke speler in een team krijgt dezelfde mutatie. De verwachte mutatie is " +
        "altijd precies nul: K·(P−1)·P + K·P·(1−P) = 0.";
      out.appendChild(p);
    } catch (err) {
      out.textContent = err.message;
    }
  }

  /* ---------------------------------------------------- opgeslagen spelers */

  let cacheRows = null;

  async function loadCache(reload = true) {
    if (!reload && cacheRows) return drawCache();
    const all = await store.get(null);
    const seen = new Map();
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith("r:") || !v || v.none || typeof v.ts !== "number") continue;
      const id = v.via || k.slice(2);
      const prev = seen.get(id);
      if (!prev || prev.ts < v.ts) seen.set(id, { ...v, url: (v.via || k.slice(2)) });
    }

    cacheRows = [...seen.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    $("cacheInfo").textContent =
      cacheRows.length + " spelers bewaard · " +
      Object.keys(all).filter((k) => k.startsWith("r:")).length + " sleutels · " +
      "verloopt na " + (settings.cacheTtlHours || 8) + " uur";

    drawCache();
  }

  function drawCache() {
    const rows = cacheRows || [];
    const now = Date.now();
    const ttl = (settings.cacheTtlHours || 8) * 36e5;

    const find = norm($("cacheFind").value).toLowerCase();
    const table = $("cacheTable");
    table.textContent = "";

    const head = table.insertRow();
    for (const h of ["Speler", "Enkel", "Dubbel", "Opgehaald", "Bron"]) {
      const th = document.createElement("th");
      th.textContent = h;
      head.appendChild(th);
    }

    for (const r of rows) {
      if (find && !(r.name || "").toLowerCase().includes(find)) continue;
      const tr = table.insertRow();
      const age = Math.round((now - r.ts) / 36e5);

      const cells = [
        r.name || "(naam onbekend)",
        f4(r.single),
        f4(r.double),
        age < 1 ? "< 1 uur" : age + " uur",
        r.url,
      ];
      cells.forEach((c, i) => {
        const td = tr.insertCell();
        if (i === 4) {
          const a = document.createElement("a");
          a.href = c;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = "profiel";
          td.appendChild(a);
        } else {
          td.textContent = c;
          if (i === 1 || i === 2) td.className = "num";
          if (i === 3) td.className = "num muted" + (now - r.ts > ttl ? " drop" : "");
        }
      });
    }
  }

  /* ---------------------------------------------------------------- opzet */

  function initTabs() {
    $("tabs").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      for (const b of $("tabs").children) b.classList.toggle("is-active", b === btn);
      for (const s of document.querySelectorAll(".tab")) {
        s.classList.toggle("is-active", s.id === "tab-" + btn.dataset.tab);
      }
      if (btn.dataset.tab === "cache") loadCache(!cacheRows);
      if (btn.dataset.tab === "me" && !$("meCards").children.length) loadMe();
    });
  }

  async function init() {
    const { settings: st } = await store.get("settings");
    settings = st || {};

    initTabs();

    $("eventGo").addEventListener("click", () => loadEvent($("eventUrl").value));
    $("eventUrl").addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadEvent($("eventUrl").value);
    });

    $("partner").addEventListener("change", async () => {
      try {
        const r = await resolveInput($("partner").value);
        let waarde = null;
        if (r) {
          waarde = r.rating != null ? r.rating : r.data && r.data.double;
          if (waarde == null || !isFinite(waarde)) {
            throw new Error("Op dat profiel staat geen dubbelrating");
          }
        }
        settings.partnerRating = waarde;
        settings.partnerName = r ? r.name : null;
        await store.merge("settings", { partnerRating: settings.partnerRating, partnerName: settings.partnerName });

        if (field) {
          field.rows = field.rows.filter((r2) => !r2.virtual);
          await addSelf();
          renderEvent();
        }
        status("");
      } catch (err) {
        status(err.message);
      }
    });

    $("meLoad").addEventListener("click", loadMe);
    $("compareGo").addEventListener("click", compare);
    $("compareMe").addEventListener("click", async () => {
      const me = await myRating();
      if (!me) return status("Je eigen profiel is nog niet bekend — open eerst een pagina op mijnknltb.");
      if (me.single == null || !isFinite(me.single)) {
        return status("Er staat geen enkelrating op je profiel");
      }
      $("c-a1").value = f4(me.single);
      status("");
    });

    $("cacheReload").addEventListener("click", () => loadCache(true));
    $("cacheFind").addEventListener("input", () => drawCache());
    $("cacheClear").addEventListener("click", async () => {
      const all = await store.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith("r:"));
      await store.remove(keys);
      loadCache();
    });

    // met een URL geopend vanaf de site? dan meteen aan de slag
    const q = new URLSearchParams(location.search);
    const url = q.get("url");
    if (url) {
      $("eventUrl").value = url;
      loadEvent(url);
    }
  }

  init();
})();
