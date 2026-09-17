/* KNLTB Rating Inline - content script
 *
 * Werking:
 *  1. zoekt op de pagina alle links die naar een spelerprofiel wijzen
 *  2. haalt die profielpagina op met fetch() -> gebeurt in jouw eigen browser,
 *     dus mét je ingelogde sessiecookie. Geen login/wachtwoord nodig.
 *  3. parst de enkel- en dubbelrating uit de HTML
 *  4. plakt een badge achter de naam en cachet het resultaat
 *
 * Belangrijk principe: liever een badge te weinig dan een badge op een rare plek.
 * Een badge blijft alleen staan als er daadwerkelijk een rating gevonden is.
 */

(() => {
  "use strict";

  const DEFAULTS = Site.DEFAULTS;

  let settings = { ...DEFAULTS };

  // logboek van alles wat we aangeraakt hebben -> zichtbaar via Diagnose
  const registry = [];

  // ---------------------------------------------------------------- helpers

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

  const toNumber = (s) => parseFloat(String(s).replace(",", "."));
  const f4 = Site.f4;
  const signed = Site.signed;
  const fmt = (n) => (n == null ? null : n.toFixed(2).replace(".", ","));

  function log(...args) {
    if (settings.debug) {
      console.debug("%c[KNLTB]", "color:#174ea6;font-weight:bold", ...args);
    }
  }

  // ------------------------------------------------------- link-herkenning

  /**
   * Een spelerlink moet een pad hebben als /player/<id> waarbij <id> op een
   * echte identifier lijkt (bevat een cijfer). Dat sluit /profile/settings,
   * /member/home en dat soort navigatielinks uit.
   */
  // De echte vorm op mijnknltb:
  //   <a href="/player-profile/13e57c28-14f9-424e-83c4-c7e96c9546a7" class="nav-link media__link">
  //     <span class="nav-link__value">Mike Verhaar</span>
  //   </a>
  const UUID = Site.UUID;
  // Let op het $: /player-profile/<uuid>/tournaments is een tabblad, geen speler.
  const PLAYER_PATH_RES = [
    new RegExp("^/player-profile/" + UUID + "/?$", "i"),
    new RegExp("^/player/" + UUID + "/?$", "i"),
    new RegExp("^/tournament/" + UUID + "/player/\\d+/?$", "i"),
    /\/sport\/player\.aspx\?.*\bid=/i,
  ];

  // tekst die zeker geen spelersnaam is
  const TEXT_BLACKLIST = new Set([
    "profiel", "mijn profiel", "profile", "my profile", "home", "inloggen",
    "uitloggen", "log in", "log uit", "instellingen", "accountinstellingen",
    "settings", "account", "meer", "more", "alle", "all", "bekijk", "details",
    "leden", "lidmaatschappen", "berichten", "members", "spelers", "players",
    "vereniging", "club", "team", "teams", "toernooi", "toernooien",
    "competities", "leagues", "wedstrijden", "matches", "uitslagen", "results",
    "info", "help", "overzicht", "ranking", "rating", "totaal", "enkel",
    "dubbel", "mixed", "favorieten", "favoriet", "inschrijvingen",
    "head to head", "h2h", "statistieken",
  ]);

  // containers waar we sowieso niets in prikken
  const SKIP_CONTAINERS =
    'nav, header, footer, aside, [role="navigation"], [role="banner"], ' +
    '[role="tablist"], [role="menu"], ' +
    ".navbar, .nav, .navigation, .breadcrumb, .breadcrumbs, .site-header, " +
    ".site-footer, .dropdown-menu, .dropdown-list, .menu, .pagination, " +
    ".tabs, .tab-nav, .page-nav, .primary-nav, .masthead, .page-foot, " +
    ".hgroup, .page-head, .module__aside";

  function playerIdFromHref(u) {
    const s = u.pathname + u.search;
    for (const re of PLAYER_PATH_RES) {
      const m = s.match(re);
      if (m) return m[1] || "aspx";
    }
    return null;
  }

  const UUID_ONLY = Site.UUID_ONLY;
  const profileUrl = (id) => location.origin + "/player-profile/" + id;
  const isProfileUrl = Site.isProfileUrl;

  /* De H2H-knop bij elke wedstrijd bevat de bondsnummers van alle spelers:
       /head-2-head?OrganizationCode=<org>&T1P1MemberID=30340969&T1P2…
     En een bondsnummer is rechtstreeks om te zetten naar een spelerspagina:
       /player/<org>/<base64 van "base64:<bondsnummer>">
     Daarmee hoeven we de toernooipagina helemaal niet meer op te halen. */
  function memberUrl(org, memberId) {
    try {
      return location.origin + "/player/" + org + "/" + btoa("base64:" + memberId);
    } catch {
      return null;
    }
  }

  const PLAYER_ANCHOR_SEL =
    'a[href*="player.aspx" i], a[href*="player-profile" i], a[href*="/player/" i]';

  /**
   * Koppelt spelerslinks aan bondsnummers via de H2H-knop in hetzelfde
   * wedstrijdblok. Volgorde is vast: T1P1, T1P2, T2P1, T2P2 = de spelers
   * van boven naar beneden. Alleen toepassen als de aantallen exact
   * kloppen — bij twijfel liever geen koppeling dan een verkeerde.
   */
  function harvestMemberIds() {
    const map = new WeakMap();

    for (const h2h of document.querySelectorAll('a[href*="head-2-head"]')) {
      let u;
      try {
        u = new URL(h2h.href, location.href);
      } catch {
        continue;
      }

      const org = u.searchParams.get("OrganizationCode");
      if (!org) continue;

      const ids = ["T1P1", "T1P2", "T2P1", "T2P2"]
        .map((k) => u.searchParams.get(k + "MemberID"))
        .filter(Boolean);
      if (!ids.length) continue;

      const block = h2h.closest(".match, .match-group__item, tr, li");
      if (!block) continue;

      const anchors = [...block.querySelectorAll(PLAYER_ANCHOR_SEL)];
      if (anchors.length !== ids.length) continue; // aantallen kloppen niet

      anchors.forEach((a, i) => map.set(a, { org, memberId: ids[i] }));
    }

    return map;
  }

  let memberIds = new WeakMap();

  /**
   * Bouwt de te proberen profiel-URL's op uit alles wat op een speler-id lijkt:
   *   href /player-profile/<uuid>        -> direct
   *   href /sport/player.aspx?id=<uuid>  -> /player-profile/<uuid>
   *   attributen data-player-id / data-id als het een uuid is
   * Eerste treffer met een rating wint.
   */
  function candidateUrls(a, u) {
    const urls = [];

    // Snelste route: bondsnummer uit de H2H-knop -> direct de spelerspagina.
    const member = memberIds.get(a);
    if (member) {
      const url = memberUrl(member.org, member.memberId);
      if (url) urls.push(url);
    }

    // Alleen een uuid uít het pad is de speler zelf.
    // LET OP: bij /sport/player.aspx?id=<uuid>&player=3868 is die uuid het
    // TOERNOOI, niet de speler — die pagina moeten we openen en dan de link
    // naar /player-profile/<uuid> eruit halen (dat doet de hop-logica).
    const inPath = u.pathname.match(new RegExp("/(?:player-profile|player)/" + UUID, "i"));
    if (inPath) urls.push(profileUrl(inPath[1].toLowerCase()));

    const dataId = a.getAttribute("data-player-id") || a.getAttribute("data-id");
    if (dataId && UUID_ONLY.test(dataId)) {
      const url = profileUrl(dataId.toLowerCase());
      if (!urls.includes(url)) urls.push(url);
    }

    if (!urls.includes(u.href)) urls.push(u.href);
    return urls;
  }

  function looksLikeName(txt) {
    const t = txt.toLowerCase();
    if (TEXT_BLACKLIST.has(t)) return false;
    if (t.length < 3 || t.length > 60) return false;
    if (!/[a-zà-ÿ]/i.test(t)) return false; // moet letters bevatten
    if (/^\d+$/.test(t)) return false;
    if (txt.split(/\s+/).length > 7) return false;
    return true;
  }

  function isPlayerLink(a) {
    if (!a.href || a.dataset.knltbDone) return false;

    // eerst de goedkope toets op de href zelf; de closest()-tochten
    // hieronder zijn per anker het duurste stuk van een scan
    let u;
    try {
      u = new URL(a.href, location.href);
    } catch {
      return false;
    }
    if (u.origin !== location.origin) return false;
    if (u.pathname === location.pathname) return false; // link naar zichzelf

    if (!playerIdFromHref(u)) return false;

    if (a.closest(".knltb-tags, .knltb-delta, .knltb-proj")) return false;
    if (entryAnchors.has(a)) return false; // rating staat al in de tabel
    if (a.closest(SKIP_CONTAINERS)) return false;

    const txt = norm(a.textContent);
    if (!looksLikeName(txt)) return false;

    // een link met alleen een plaatje erin is meestal een avatar/icoon
    if (!a.textContent.trim() && a.querySelector("img,svg")) return false;

    return true;
  }

  // ---------------------------------------------------------------- parsing

  const parsePlayerDoc = (doc) => Parse.playerDoc(doc);

  // ---------------------------------------------------------------- cache

  const cacheKey = Site.cacheKey;

  async function getCached(url) {
    const k = cacheKey(url);
    const hit = (await Site.store.get(k))[k];
    if (!hit) return null;
    if ((Date.now() - hit.ts) / 36e5 > settings.cacheTtlHours) return null;
    return hit;
  }

  /** Hetzelfde record onder elk van de namen, in één schrijfactie. */
  function setCached(urls, data) {
    const rec = { ...data, ts: Date.now() };
    const obj = {};
    for (const url of urls) if (url) obj[cacheKey(url)] = rec;
    Site.store.set(obj).catch((e) => {
      // vol of anderszins geweigerd: niet stilzwijgend voorbijgaan
      log("opslaan mislukt:", e.message);
      pruneCache(true).catch(() => {});
    });
  }

  /* Opruimen. Verlopen vermeldingen worden bij het lezen wel genegeerd maar
     nooit weggegooid, dus blijven ze liggen. Eén speler kan bovendien onder
     meerdere URL's staan — de toernooigebonden variant (player.aspx?…&player=N)
     komt er per toernooi één keer bij.

     Draait hooguit eens per 6 uur, want het leest de hele opslag in. */
  const PRUNE_EVERY_MS = 6 * 36e5;
  const MAX_ENTRIES = 5000;

  /* Een volle opslag weigert alle schrijfacties tegelijk; die mogen samen
     één opruimbeurt aanzwengelen, niet elk hun eigen. */
  let pruning = false;

  async function pruneCache(force = false) {
    if (pruning) return;
    pruning = true;
    try {
      const now = Date.now();
      const { prunedAt } = await Site.store.get("prunedAt");
      if (!force && prunedAt && now - prunedAt < PRUNE_EVERY_MS) return;

      Site.store.set({ prunedAt: now }).catch(() => {});

      const all = await Site.store.get(null);
      const ttl = Math.max(1, settings.cacheTtlHours) * 36e5;
      const entries = Object.keys(all).filter((k) => k.startsWith("r:"));

      // verlopen of beschadigd
      const dead = entries.filter((k) => {
        const v = all[k];
        return !v || typeof v.ts !== "number" || now - v.ts > ttl;
      });

      // en als het er dan nog te veel zijn: de oudste eruit
      const deadSet = new Set(dead);
      const alive = entries.filter((k) => !deadSet.has(k));
      if (alive.length > MAX_ENTRIES) {
        alive
          .sort((a, b) => all[a].ts - all[b].ts)
          .slice(0, alive.length - MAX_ENTRIES)
          .forEach((k) => dead.push(k));
      }

      if (!dead.length) return;
      await Site.store.remove(dead);
      log("cache opgeruimd:", dead.length, "van", entries.length);
    } finally {
      pruning = false;
    }
  }

  // ---------------------------------------------------------------- fetching

  const inFlight = new Map();

  /* Eén inlogpagina gezien? Dan levert elk volgend verzoek dezelfde pagina
     op. Onthouden, en de rest zonder verzoek als "login" afdoen. Gaat weer
     leeg bij "opnieuw scannen", zodat het na inloggen gewoon werkt. */
  let loggedOut = false;

  /**
   * Leest niet meer van de pagina dan nodig. De rating staat in de kop van
   * het document; zodra we die binnen hebben verbreken we de verbinding.
   * Scheelt het grootste deel van het verkeer (de rest van een profielpagina
   * is toernooihistorie, statistieken en advertentie-markup).
   */
  const MAX_BYTES = 600000;

  function seenEnough(buf) {
    // dit id staat direct ná het kopblok met de ratings
    if (buf.includes('id="page_content_profile"')) return true;
    const hits = buf.match(/tag-duo__value/g);
    if (!hits || hits.length < 2) return false;
    return buf.indexOf("</ul>", buf.lastIndexOf("tag-duo__value")) !== -1;
  }

  async function readBody(res, early) {
    if (!early || !res.body || !res.body.getReader) {
      return { html: await res.text(), truncated: false };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let done = false;

    try {
      for (;;) {
        const chunk = await reader.read();
        done = chunk.done;
        if (done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        if (buf.length > MAX_BYTES || seenEnough(buf)) break;
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* verbinding was al klaar */
      }
    }
    // niet tot het einde gelezen? dan kan er nog iets ongelezen zijn gebleven
    return { html: buf, truncated: !done };
  }

  async function fetchDoc(url, early = true) {
    // al uitgelogd gebleken: geen token afboeken en wachten voor niets
    if (loggedOut) throw new Error("NOT_LOGGED_IN");

    /* De rem telt hier, per verzoek — niet per taak in de wachtrij. Eén taak
       doet er tot zes: drie kandidaten, een volledige herhaling, twee stappen
       doorlopen. Na het wachten opnieuw vragen: de bucket is dan met precies
       één token bijgevuld, en die moet wél afgeboekt worden — anders gaan
       alle wachtenden tegelijk door zodra er één mag. */
    for (let w = takeToken(); w > 0; w = takeToken()) {
      await new Promise((r) => setTimeout(r, w));
    }

    /* Wie hier gewacht heeft, weet niet wat er intussen gebeurd is: een
       ander verzoek kan de inlogpagina hebben gezien, of de server heeft
       teruggeduwd. Dan niet alsnog gaan — de pauze uitzitten, zoals de
       wachtrij dat met een nog niet gestarte taak doet. */
    for (;;) {
      if (loggedOut) throw new Error("NOT_LOGGED_IN");
      const p = pausedUntil - Date.now();
      if (p <= 0) break;
      await new Promise((r) => setTimeout(r, p + 50));
    }

    const res = await fetch(url, { credentials: "include", redirect: "follow" });

    // Server geeft aan dat het te veel wordt -> stoppen en flink wachten.
    if (res.status === 429 || res.status === 503) {
      backOff();
      throw new Error("RATE_LIMITED");
    }
    if (res.status >= 500) {
      backOff();
      throw new Error("HTTP " + res.status);
    }
    resetBackOff();

    if (!res.ok) return null;

    const { html, truncated } = await readBody(res, early);

    if (Site.looksLoggedOut(html)) {
      loggedOut = true;
      throw new Error("NOT_LOGGED_IN");
    }

    const doc = new DOMParser().parseFromString(html, "text/html");
    // res.url is de URL ná de redirect; /player/<org>/<token> landt op
    // /player-profile/<uuid>. Die willen we als cachesleutel gebruiken.
    doc.__url = res.url || url;
    doc.__truncated = truncated;
    return doc;
  }

  /**
   * @param key        cachesleutel (de originele link)
   * @param candidates lijst met profiel-URL's om te proberen
   */
  async function fetchRating(key, candidates) {
    if (inFlight.has(key)) return inFlight.get(key);

    const p = (async () => {
      const cached = await getCached(key);
      if (cached) {
        if (cached.none) throw new Error("NO_RATING_FOUND");
        return { ...cached, fromCache: true };
      }

      const seen = new Set();
      let sawPage = false; // hebben we überhaupt een pagina te zien gekregen?
      let doc = null;
      let current = null;
      let data = null;

      /* 1. Kandidaten langs. LET OP: een rating tellen we alleen als de
            pagina een landelijk profiel is (/player-profile/<uuid>). Een
            toernooipagina heeft óók een kopblok met een rating, maar dat
            is niet per se die van de speler waar de link over gaat —
            daar mogen we ons dus niet op baseren. */
      for (const url of candidates) {
        if (seen.has(url)) continue;
        seen.add(url);

        // dezelfde speler op een andere pagina? dan staat hij al in de cache
        const hit = await getCached(url);
        if (hit && !hit.none) {
          data = { ...hit, fromCache: true, via: hit.via || url };
          break;
        }

        /* Uitgelogd: niets ophalen, maar de overige namen wél nog nakijken —
           wat al bekend is mag getoond worden, onder welke naam ook. */
        if (loggedOut) continue;

        const trusted = isProfileUrl(url);
        let d = await fetchDoc(url, trusted);
        if (!d) continue;
        sawPage = true;

        doc = d;
        current = url;

        if (trusted || isProfileUrl(d.__url)) {
          data = parsePlayerDoc(d);

          /* Vroegtijdig afgebroken lezing zonder resultaat? Dan hebben we
             misschien net te weinig binnengehaald. Één keer volledig
             ophalen voordat we concluderen dat er geen rating is. */
          if (!data && d.__truncated) {
            log("afgebroken lezing zonder rating, opnieuw volledig:", url);
            const full = await fetchDoc(url, false);
            if (full) {
              d = full;
              doc = full;
              data = parsePlayerDoc(full);
            }
          }

          if (data) {
            data.via = d.__url || url;
            break;
          }
        }
      }

      // 2. Vanaf een toernooipagina doorlopen naar het echte profiel.
      for (let hop = 0; hop < 2 && !data && doc; hop++) {
        const next = findProfileLink(doc, current, seen) || findRatingTab(doc, current, seen);
        if (!next) break;
        seen.add(next);
        log("doorlopen naar profiel:", next);

        const cachedHop = await getCached(next);
        if (cachedHop && !cachedHop.none) {
          data = { ...cachedHop, fromCache: true, via: cachedHop.via || next };
          break;
        }

        const d = await fetchDoc(next, isProfileUrl(next));
        if (!d) break;
        doc = d;
        current = next;
        data = parsePlayerDoc(d);
        if (data) data.via = next;
      }

      if (!data) {
        // uitgelogd en nergens bekend: dan is dát het antwoord, en niets onthouden
        if (loggedOut) throw new Error("NOT_LOGGED_IN");
        /* Alleen onthouden dat er geen rating is als we de pagina ook
           daadwerkelijk hebben gezien. Een 403 of 404 door een tijdelijke
           storing mag geen 8 uur lang als "deze speler heeft geen rating"
           in de cache blijven staan. */
        if (sawPage) setCached([key], { none: true });
        throw new Error("NO_RATING_FOUND");
      }
      /* Onder alle namen bewaren waaronder deze speler te vinden is:
         de aangeklikte link, de bondsnummer-URL en de uiteindelijke
         profiel-URL. Waar je hem hierna ook tegenkomt, hij is bekend. */
      // fromCache/ts horen niet in de opslag thuis
      const { fromCache, ts, ...store } = data;
      setCached([key, ...candidates, data.via], store);
      return data;
    })();

    inFlight.set(key, p);
    p.catch(() => {}).finally(() => inFlight.delete(key));
    return p;
  }

  /**
   * Zoekt de link naar het landelijke profiel van de speler waar deze pagina
   * over gaat. Het uitlezen zit in parse.js, dat de menubalk overslaat en de
   * paginakop vóór laat gaan — anders belandt iedereen op "Mijn profiel".
   */
  function findProfileLink(doc, baseUrl, seen) {
    for (const href of Parse.profileLinks(doc)) {
      try {
        const u = new URL(href, baseUrl);
        if (u.origin !== location.origin) continue;
        if (seen.has(u.href)) continue;
        return u.href;
      } catch {
        /* negeren */
      }
    }
    return null;
  }

  /** Zoekt op de profielpagina een tabblad/link die over rating gaat. */
  function findRatingTab(doc, baseUrl, seen) {
    for (const a of doc.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href") || "";
      const txt = norm(a.textContent).toLowerCase();
      if (!/rating|speelsterkte/i.test(href + " " + txt)) continue;
      try {
        const u = new URL(href, baseUrl);
        if (u.origin !== location.origin) continue;
        if (seen.has(u.href)) continue;
        return u.href;
      } catch {
        /* negeren */
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------
     Wachtrij met rem. Drie lagen:
       1. token bucket  -> nooit meer dan X requests per minuut
                           (afgeboekt in fetchDoc, per verzoek)
       2. concurrency   -> nooit meer dan Y tegelijk
       3. backoff       -> bij 429/503/5xx even helemaal stil vallen
     --------------------------------------------------------------- */

  const queue = [];
  let running = 0;

  let bucket = null;
  let pausedUntil = 0;
  let backoffMs = 30000;

  function backOff() {
    pausedUntil = Date.now() + backoffMs;
    log("server duwt terug — " + Math.round(backoffMs / 1000) + "s pauze");
    backoffMs = Math.min(backoffMs * 2, 600000);
  }

  function resetBackOff() {
    backoffMs = 30000;
  }

  /** @returns 0 als er nu een request mag, anders het aantal ms wachten. */
  function takeToken() {
    const now = Date.now();
    const cap = Math.max(1, settings.maxPerMinute);
    if (!bucket) bucket = { count: cap, last: now };

    bucket.count = Math.min(cap, bucket.count + ((now - bucket.last) / 60000) * cap);
    bucket.last = now;

    if (bucket.count >= 1) {
      bucket.count -= 1;
      return 0;
    }
    return Math.ceil(((1 - bucket.count) / cap) * 60000);
  }

  function enqueue(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      pump();
    });
  }

  let pumpTimer = null;
  function later(ms) {
    clearTimeout(pumpTimer);
    pumpTimer = setTimeout(pump, ms);
  }

  function pump() {
    if (!queue.length) return;

    const now = Date.now();
    if (pausedUntil > now) return later(pausedUntil - now + 50);

    while (running < settings.concurrency && queue.length) {
      const { task, resolve, reject } = queue.shift();
      running++;
      task()
        .then(resolve, reject)
        .finally(() => {
          running--;
          const d = settings.requestDelayMs;
          if (d > 0) later(d + Math.random() * d);
          else pump();
        });
    }
  }

  // ---------------------------------------------------------------- badges

  /** Container waar de losse tags in komen. */
  function makeHolder() {
    const el = document.createElement("span");
    el.className = "knltb-tags loading";
    el.textContent = "…";
    el.title = "rating ophalen…";
    return el;
  }

  function makeTag(kind, label, value, title) {
    const el = document.createElement("span");
    el.className = "knltb-tag knltb-tag--" + kind;
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = label + ":";
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = value;
    el.appendChild(k);
    el.appendChild(v);
    el.title = title;
    return el;
  }

  const sameName = Site.sameName;

  /** Rendert twee losse tags: S:7,8265 en D:5,7033 */
  function renderTags(holder, data, expectedName) {
    // op sommige pagina's voegt een badge achter de naam niets toe
    if (paginaSoort().badges === false) {
      holder.remove();
      return false;
    }

    // vangnet: hoort deze rating wel bij deze naam?
    const mismatch = !sameName(data.name, expectedName);
    if (mismatch) {
      log("naam wijkt af — verwacht:", expectedName, "gevonden:", data.name, data.via);
    }

    const isGuess = data.how === "guess" || mismatch;
    const hasSingle = settings.showSingle && data.single != null;
    const hasDouble = settings.showDouble && data.double != null;

    if ((!hasSingle && !hasDouble) || (isGuess && !settings.allowGuess)) {
      holder.remove();
      return false;
    }

    holder.className = "knltb-tags" + (isGuess ? " guess" : "");
    holder.textContent = "";
    holder.removeAttribute("title");

    const who = data.name ? data.name + " — " : "";
    const src = data.via ? "\n" + data.via : "";
    const extra =
      (mismatch ? " ⚠ naam komt niet overeen met het profiel — controleer" : "") +
      (data.how === "guess" ? " (geschat — controleer even)" : "") +
      (data.fromCache ? " • cache" : "");

    const lvl = (l) => (l ? " (speelsterkte " + l + ")" : "");
    // exact de waarde van de site; alleen terugvallen op afronden als
    // de rating uit een van de fallback-parsers komt
    const show = (raw, num) => raw || fmt(num);

    if (hasSingle) {
      holder.appendChild(
        makeTag("single", "S", show(data.singleRaw, data.single),
          who + "enkel " + show(data.singleRaw, data.single) + lvl(data.singleLevel) + extra + src)
      );
    }
    if (hasDouble) {
      holder.appendChild(
        makeTag("double", "D", show(data.doubleRaw, data.double),
          who + "dubbel " + show(data.doubleRaw, data.double) + lvl(data.doubleLevel) + extra + src)
      );
    }
    return true;
  }

  // ---------------------------------------------------------------- DOM work

  /** Toont het "geen rating"-resultaat volgens de instelling. */
  function applyMiss(item, msg) {
    item.entry.outcome = "error:" + msg;

    if (msg === "NOT_LOGGED_IN") {
      item.holder.className = "knltb-tags error";
      item.holder.textContent = "login";
      item.holder.title = "Je lijkt niet ingelogd op mijnknltb.toernooi.nl";
      return;
    }
    if (settings.hideWhenNoRating) {
      item.holder.remove();
      return;
    }
    item.holder.className = "knltb-tags error";
    item.holder.textContent = msg === "NO_RATING_FOUND" ? "–" : "!";
    item.holder.title = msg + "\n" + item.urls.join("\n");
  }

  /* Dezelfde speler staat vaak 5-10x op één pagina (elke ronde opnieuw).
     Alle plekken met dezelfde URL delen daarom één aanvraag: de eerste doet
     het werk, de rest hangt zich eraan vast en wordt tegelijk ingevuld. */
  const shared = new Map(); // url -> [item, item, ...]

  function queueItem(item, attempt = 0) {
    // sleutel op de canonieke spelers-URL als we die hebben: dan delen
    // ook verschillende toernooilinks van dezelfde persoon één aanvraag
    const key = item.urls[0] || item.u.href;

    // loopt er al een aanvraag voor deze speler? dan meeliften
    const waiting = shared.get(key);
    if (waiting) {
      waiting.push(item);
      return;
    }

    const group = [item];
    shared.set(key, group);

    enqueue(() => fetchRating(key, item.urls))
      .then((data) => {
        shared.delete(key);
        for (const it of group) {
          const kept = renderTags(it.holder, data, it.entry.text);
          it.entry.outcome = (kept ? "ok:" : "hidden:") + data.how;
          it.entry.via = data.via;
          ratingOf.set(it.a, { ...data, key });
          ratedAnchors.add(it.a);
        }
        scheduleDeltas();
        log(item.entry.text, "→", item.entry.outcome, "×" + group.length, data);
      })
      .catch((err) => {
        shared.delete(key);
        const msg = String(err.message);
        log(item.entry.text, "→", msg, item.urls);

        // afgeremd door de server: netjes wachten en het één keer opnieuw doen
        if (msg === "RATE_LIMITED" && attempt < 2) {
          for (const it of group) {
            it.holder.className = "knltb-tags loading";
            it.holder.textContent = "⏳";
            it.holder.title = "server is druk — probeert het zo nog eens";
          }
          const delay = Math.max(1000, pausedUntil - Date.now());
          setTimeout(() => {
            const [first, ...rest] = group;
            queueItem(first, attempt + 1);
            for (const it of rest) queueItem(it, attempt + 1);
          }, delay);
          return;
        }
        for (const it of group) applyMiss(it, msg);
      });
  }

  /* Ophalen uitstellen tot het echt nodig is.
     Op een groot schema staan 60 namen, maar zie je er hooguit 10.
     Dat scheelt het leeuwendeel van de requests. */

  let observer = null;
  const waiting = new WeakMap();
  const observed = new Set();

  function observeItem(item) {
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            observer.unobserve(e.target);
            observed.delete(e.target);
            const it = waiting.get(e.target);
            if (it) {
              waiting.delete(e.target);
              queueItem(it);
            }
          }
        },
        { rootMargin: "300px" } // net iets voordat je er bent
      );
    }

    waiting.set(item.a, item);
    observed.add(item.a);
    observer.observe(item.a);
  }

  function hoverItem(item) {
    item.holder.className = "knltb-tags idle";

    // na een rescan hangt er mogelijk nog een oude luisteraar aan dit anker,
    // die naar een inmiddels losgekoppelde badge wijst
    if (item.a.__knltbHover) item.a.removeEventListener("mouseenter", item.a.__knltbHover);

    const once = () => {
      item.a.removeEventListener("mouseenter", once);
      item.a.__knltbHover = null;
      item.holder.className = "knltb-tags loading";
      item.holder.textContent = "…";
      queueItem(item);
    };
    item.a.__knltbHover = once;
    item.a.addEventListener("mouseenter", once);
  }

  function scheduleItem(item) {
    return settings.hoverOnly ? hoverItem(item) : observeItem(item);
  }

  let laatsteScan = null;

  /** Eén spelerslink markeren, registreren en van een placeholder voorzien. */
  function placeHolder(a) {
    a.dataset.knltbDone = "1";
    const u = new URL(a.href, location.href);
    const urls = candidateUrls(a, u);
    const entry = {
      text: norm(a.textContent),
      href: a.getAttribute("href"),
      tried: urls,
      outcome: "pending",
    };
    registry.push(entry);
    if (registry.length > 400) registry.splice(0, registry.length - 400);

    // De badge komt IN de anchor te staan, dus a.textContent raakt daarna
    // vervuild ("Mike VerhaarS:7,8265"). Nu vastleggen, niet later lezen.
    if (!a.dataset.knltbName) {
      a.dataset.knltbName = entry.text.replace(/\[[^\]]*\]/g, "").trim();
    }

    const holder = makeHolder();
    // liefst binnen de naam-span, dan blijft de lay-out netjes
    const nameSpan = a.querySelector(".nav-link__value") || a.querySelector("span");
    if (nameSpan) nameSpan.appendChild(holder);
    else a.insertAdjacentElement("afterend", holder);

    return { a, u, urls, holder, entry, keys: [cacheKey(u.href), ...urls.map(cacheKey)] };
  }

  /** Een verse cachetreffer meteen tekenen — of als "geen rating" afhandelen. */
  function applyCached(item, hit) {
    if (hit.none) {
      applyMiss(item, "NO_RATING_FOUND");
      return;
    }
    const kept = renderTags(item.holder, { ...hit, fromCache: true }, item.entry.text);
    item.entry.outcome = (kept ? "cache:" : "hidden:") + hit.how;
    ratingOf.set(item.a, { ...hit, key: item.urls[0] || item.u.href });
    ratedAnchors.add(item.a);
  }

  function processLinks() {
    if (!settings.enabled) return;

    // extensie herladen terwijl de pagina open staat? dan stil stoppen
    if (!chrome.runtime || !chrome.runtime.id) {
      if (observerRoot) observerRoot.disconnect();
      return;
    }

    // staat de rating al in een kolom? dan hoeft er niets opgehaald te worden
    if (entryTable === null) {
      entryTable = parseEntryTable() || false;
      if (entryTable) {
        entryTable.anchors.forEach((a) => entryAnchors.add(a));
        log("inschrijvingstabel gevonden:", entryTable.rows.length, "spelers — niets ophalen");
      }
    }

    /* De limiet is bedoeld om de site niet te bestoken, en gold tot nu toe
       voor het aantal spelers op de pagina. Dat is te grof: wie al in de
       cache staat kost geen enkel verzoek, en op een wedstrijdenlijst met
       ruim honderd namen vielen de laatste tientallen daardoor stil weg —
       zonder badge, zonder mutatie, zonder melding. De limiet verhuist
       hieronder naar het ophalen zelf; hier nemen we iedereen mee. */
    // elke spelerslink heeft "player" in het pad (zie PLAYER_PATH_RES), dus
    // de rest van de ankers hoeft isPlayerLink niet eens te zien
    const slice = [...document.querySelectorAll('a[href*="player" i]')].filter(isPlayerLink);

    /* Niets op te halen betekent niet: niets te doen. Op een inschrijvings-
       pagina staan de ratings al in de tabel, dus worden al die ankers
       overgeslagen — maar het veldpaneel moet er wél komen. Maar niet bij
       élke vreemde mutatie: een tooltip van de site of een lazy geladen
       slide zonder nieuwe wedstrijden mag niet alle chips, badges en het
       paneel opnieuw laten opbouwen. Alleen als er een wedstrijdblok staat
       dat rerunDeltas nog niet gezien heeft (data-knltb-delta is daar niet
       genoeg voor: een bye, een lege plek of een speler zonder rating
       krijgt die nooit), of als het paneel er hoort te zijn maar mist. */
    if (!slice.length) {
      const nieuw = document.querySelector(".match:not([data-knltb-gezien])");
      const paneelMist =
        entryTable && settings.showMeInField && settings.showSummary &&
        !summaryClosed && !document.getElementById("knltb-summary");
      if (nieuw || paneelMist) scheduleDeltas();
      return 0;
    }


    // eerst de bondsnummers oogsten, die bepalen welke URL we straks kiezen
    memberIds = harvestMemberIds();

    // 1. eerst alle plekken markeren en een placeholder plaatsen
    const items = slice.map(placeHolder);

    // 2. ÉÉN storage-lookup voor de hele pagina, en meteen alles tekenen
    //    wat al bekend is. Geen wachtrij, geen netwerk, geen wachttijd.
    const allKeys = [...new Set(items.flatMap((i) => i.keys))];

    Site.store.get(allKeys).then((store) => {
      const now = Date.now();
      const fresh = (h) => h && (now - h.ts) / 36e5 <= settings.cacheTtlHours;
      const misses = [];

      for (const item of items) {
        const hit = item.keys.map((k) => store[k]).find(fresh);
        if (hit) applyCached(item, hit);
        else misses.push(item);
      }

      scheduleDeltas();

      log(
        "spelers:", items.length,
        "• uit cache:", items.length - misses.length,
        "• ophalen:", misses.length,
        "• modus:", settings.hoverOnly ? "muis-over" : "in beeld"
      );

      /* 3. alleen de onbekende spelers ophalen, en niet meer dan de limiet
            toestaat. Die limiet geldt per scan, niet over de hele levensduur
            van het tabblad: op de wedstrijdenlijst vervangt het wisselen van
            dag de hele lijst, en met een oplopende teller was het budget na
            de eerste dag op — daarna leverde elke volgende dag niets meer op,
            terwijl er wel degelijk opnieuw gescand werd. Elke scan ziet
            alleen nieuwe namen (verwerkte ankers krijgen data-knltb-done),
            dus per scan afrekenen kan geen dubbel werk opleveren. De
            werkelijke rem op het verkeer is maxPerMinute. */
      const soort = paginaSoort();
      const ruimte = soort.ophalen ? Math.max(0, settings.maxLinksPerPage || 0) : 0;
      const halen = misses.slice(0, ruimte);
      const rest = misses.slice(ruimte);

      // ankers die van de pagina verdwenen voordat ze in beeld kwamen
      // blijven anders door de observer vastgehouden; één keer per scan
      // opruimen, niet per anker
      for (const el of observed) {
        if (!document.contains(el)) {
          observer.unobserve(el);
          observed.delete(el);
        }
      }

      for (const item of halen) scheduleItem(item);

      const reden = soort.ophalen
        ? "Niet opgehaald: de limiet van " + settings.maxLinksPerPage +
          " verzoeken per scan is bereikt.\nVerhoog hem in de instellingen " +
          "van de extensie als je alles wilt zien."
        : "Op deze pagina worden geen ratings opgehaald.\n" + soort.waarom;

      for (const item of rest) {
        item.holder.className = "knltb-tags idle";
        item.holder.textContent = "";
        item.holder.title = reden;
        item.entry.outcome = soort.ophalen ? "limiet" : "niet op deze pagina";
      }
      if (rest.length) {
        log(soort.ophalen ? "limiet bereikt:" : soort.sleutel + ": niet ophalen —",
            rest.length, "spelers niet opgehaald");
      }

      scheduleDeltas();
      laatsteScan = {
        spelers: items.length,
        uitCache: items.length - misses.length,
        ophalen: halen.length,
        overgeslagen: rest.length,
      };
    });
  }

  /* ---------------------------------------------------------------
     Rating-mutaties bij elke wedstrijd (DSS)
     --------------------------------------------------------------- */

  const ratingOf = new WeakMap(); // anchor -> ratingdata
  const ratedAnchors = new Set(); // dezelfde ankers, wél doorloopbaar
  let summaryClosed = false;

  /** Naam van de speler zonder onze eigen badge-tekst erin. */
  function cleanName(a) {
    if (a.dataset && a.dataset.knltbName) return a.dataset.knltbName;
    const copy = a.cloneNode(true);
    copy.querySelectorAll(".knltb-tags, .knltb-delta, .knltb-proj").forEach((x) => x.remove());
    return norm(copy.textContent).replace(/\[[^\]]*\]/g, "").trim();
  }

  /**
   * Winstkans van deze kant als badge. Stond alleen in de tooltip, maar
   * juist dit getal verklaart waarom de mutaties zo scheef liggen: bij 28%
   * levert winnen veel op en kost verliezen weinig.
   */
  /**
   * Waar de chips heen gaan. In een schema staat een rij naast de namen en
   * past er nog van alles achter; in de wedstrijdenlijst is de rij al zo
   * breed als de pagina, en dan duwen de chips de namen scheef. Daar krijgen
   * ze een eigen regel eronder, zodat alle wedstrijden gelijk uitlijnen.
   */
  function chipHost(row) {
    if (!isMatchListPage()) return row;

    /* De regel gaat ín het naamblok, niet in de rij. De rij bevat namelijk
       ook de W-markering, en die schuift de namen opzij; een regel op
       rijniveau zou dan net iets anders uitlijnen dan de namen erboven.
       In het naamblok erft hij precies dezelfde linker- en rechterrand. */
    const blok = row.querySelector(".match__row-title") || row;

    let regel = blok.querySelector(":scope > .knltb-regel");
    if (!regel) {
      regel = document.createElement("div");
      regel.className = "knltb-regel";
      blok.appendChild(regel);
      // een klasse op de rij zelf in plaats van :has() in de stylesheet —
      // die selector is de enige regel die op oudere Chromium stilletjes
      // wegvalt
      row.classList.add("knltb-heeft-regel");
    }
    return regel;
  }

  function oddsBadge(kans, isFavoriet, extra) {
    const el = document.createElement("span");
    el.className = "knltb-odds " + (isFavoriet ? "fav" : "under");
    el.textContent = Math.round(kans * 100) + "%";
    el.title =
      "Winstkans " + (kans * 100).toFixed(1) + "% volgens de ratings" +
      (isFavoriet ? " — favoriet" : " — underdog") +
      (extra ? "\n" + extra : "");
    return el;
  }

  function deltaChip(cls, text, title) {
    const el = document.createElement("span");
    el.className = "knltb-delta " + cls;
    el.textContent = text;
    el.title = title;
    return el;
  }

  /**
   * Spelers van één kant van de wedstrijd, in DOM-volgorde.
   *
   * Een speler telt mee zodra we een rating van hem hebben — opgehaald, óf
   * al op de pagina bij de wedstrijd zelf. Dat laatste is het geval op het
   * Rating-tabblad, en daar hoeft dus niets opgehaald te worden voordat de
   * mutaties berekend kunnen worden.
   *
   * Maar alleen als de link naar een speler wijst. De H2H-knop en een
   * clublink staan in hetzelfde naamblok, en ratingAtMatch leest daar voor
   * hen dezelfde rating af — dan telt zo'n knop als derde speler mee.
   */
  function sidePlayers(row) {
    return [...row.querySelectorAll("a[href]")].filter(
      (a) =>
        /player/i.test(a.getAttribute("href") || "") &&
        (ratingOf.has(a) || ratingAtMatch(a) != null)
    );
  }

  /** Identiteit van een speler, om zijn rating door het toernooi te volgen. */
  function playerKey(a) {
    const d = ratingOf.get(a);
    const m = memberIds.get(a);
    // op de canonieke profiel-URL sleutelen, zodat dezelfde persoon via
    // verschillende linkvormen tóch één speler blijft
    if (d && (d.via || d.key)) return cacheKey(d.via || d.key);
    if (m) return m.org + "/" + m.memberId;
    return cleanName(a);
  }

  const MONTHS_NL = {
    januari: 0, februari: 1, maart: 2, april: 3, mei: 4, juni: 5,
    juli: 6, augustus: 7, september: 8, oktober: 9, november: 10, december: 11,
  };

  /** "ma 24-8-2026 20:00" of "24-8-2026" -> tijdstip. */
  function parseDutchDate(text) {
    const t = norm(text);

    let m = t.match(/(\d{1,2})-(\d{1,2})-(\d{4})(?:\D{1,4}(\d{1,2}):(\d{2}))?/);
    if (m) {
      return {
        at: new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime(),
        exact: m[4] != null,
      };
    }

    // "maandag 24 augustus 2026"
    m = t.match(/(\d{1,2})\s+([a-zé]+)\s+(\d{4})/i);
    if (m && MONTHS_NL[m[2].toLowerCase()] != null) {
      return { at: new Date(+m[3], MONTHS_NL[m[2].toLowerCase()], +m[1]).getTime(), exact: false };
    }

    return null;
  }

  /** De datumkop boven een groep wedstrijden ("maandag 24 augustus 2026"). */
  function groupDate(block) {
    let el = block.closest("ul.match-group, .match-group__item") || block;
    for (let i = 0; i < 4 && el; i++, el = el.previousElementSibling) {
      if (el.matches && el.matches(".module-divider")) return parseDutchDate(el.textContent);
    }
    const holder = block.closest("ul.match-group");
    let prev = holder ? holder.previousElementSibling : null;
    while (prev) {
      if (prev.matches(".module-divider")) return parseDutchDate(prev.textContent);
      prev = prev.previousElementSibling;
    }
    return null;
  }

  /**
   * Wanneer wordt/werd er gespeeld? null = nog niet ingepland.
   * Drie bronnen, in deze volgorde:
   *   1. <time datetime="…">            (profielpagina)
   *   2. de tekst in de wedstrijdvoet    "ma 24-8-2026 20:00"  (poule/schema)
   *   3. de datumkop boven de groep      "maandag 24 augustus 2026"
   */
  function matchWhen(block) {
    const t = block.querySelector("time[datetime]");
    const raw = t ? (t.getAttribute("datetime") || "").trim() : "";
    if (raw) {
      const v = Date.parse(raw.replace(" ", "T"));
      if (isFinite(v)) {
        return { at: v, exact: /\d{1,2}:\d{2}/.test(raw) && !/[T ]00:00(:00)?$/.test(raw) };
      }
    }

    const foot = block.querySelector(".match__footer");
    const fromFoot = foot ? parseDutchDate(foot.textContent) : null;
    if (fromFoot) return fromFoot;

    return groupDate(block);
  }

  /** Rangnummer uit een rondenaam. Hoger = later in het toernooi. */
  function rankFromName(text) {
    const t = norm(text).toLowerCase();
    if (!t) return null;

    // let op de volgorde: "ronde van 16" mag niet als "ronde 16" gelezen worden
    let m = t.match(/ronde\s+van\s+(\d+)/);
    if (m) return 300 - Number(m[1]); // 16 -> 284, 8 -> 292, 4 -> 296

    if (/kwalificatie|voorronde/.test(t)) return 50;

    m = t.match(/ronde\s+(\d+)/); // poulewedstrijden
    if (m) return 100 + Number(m[1]);

    if (/poule|groep|round\s*robin/.test(t)) return 100;
    if (/achtste/.test(t)) return 284;
    if (/kwart/.test(t)) return 292;
    if (/halve/.test(t)) return 296; // vóór "finale" testen
    if (/finale/.test(t)) return 298;
    if (/winnaar/.test(t)) return 299;

    return null;
  }

  /**
   * Op een schemapagina staat de rondenaam niet bij de wedstrijd maar boven
   * de kolom waarin hij staat:
   *
   *   .bracket
   *     .swiper-subheadings-container
   *       .subheading  "Ronde van 16" | "Kwartfinale" | "Halve finale" | "Finale"
   *     swiper-container
   *       swiper-slide.bracket-round__item   <- kolom 0, 1, 2, 3
   *         .match ...
   *
   * De positie van de kolom ís dus de ronde. Dat is betrouwbaarder dan de
   * speeltijd, want binnen één ronde wordt vaak op dezelfde dag gespeeld.
   */
  function bracketRound(block) {
    const slide = block.closest("swiper-slide, .bracket-round__item");
    if (!slide || !slide.parentElement) return null;

    /* De site nummert de kolommen zelf: aria-label="2 / 4" betekent
       ronde 2 van 4. Dat is harder dan de DOM-volgorde, want een swiper
       kan slides herschikken (of dupliceren bij loop-modus). */
    let index = -1;
    let total = null;

    const label = (slide.getAttribute("aria-label") || "").match(/(\d+)\s*\/\s*(\d+)/);
    if (label) {
      index = Number(label[1]) - 1;
      total = Number(label[2]);
    }

    if (index < 0) {
      const siblings = [...slide.parentElement.children].filter((el) =>
        el.matches("swiper-slide, .bracket-round__item")
      );
      index = siblings.indexOf(slide);
      total = siblings.length;
    }
    if (index < 0) return null;

    const bracket = block.closest(".bracket") || document;
    const heads = [
      ...bracket.querySelectorAll(".js-subheading, .swiper-subheadings-container .subheading"),
    ];
    const name = heads[index] ? norm(heads[index].textContent) : null;

    return { index, total, name };
  }

  /** Rondevolgorde: eerst het schema, dan de kop bij de wedstrijd. */
  function roundRank(block, br) {
    /* In een schema is de kolompositie de waarheid: kolom 0 komt vóór
       kolom 1, ongeacht hoe de ronde heet. Namen alleen als schaal
       gebruiken zou scheef gaan zodra één kop niet herkend wordt. */
    if (br) return 200 + br.index * 4;

    const head = block.querySelector(".match__header");
    return head ? rankFromName(head.textContent) : null;
  }

  /* Wedstrijden van verschillende toernooien/onderdelen niet door elkaar
     husselen: een finale van toernooi A hoort niet vóór ronde 1 van B.
     Elk blok krijgt daarom een eigen groep, en groepen worden onderling
     op hun vroegste speeldatum gezet. */
  const GROUP_SEL = '[id^="TournamentMatchList_"], .bracket, ol.match-group, .module--card';

  function groupOf(block) {
    return block.closest(GROUP_SEL) || document.body;
  }

  /* ---------------------------------------------------------------
     Schema vooruitspelen
     --------------------------------------------------------------- */

  const picks = new Map(); // matchEl -> gekozen winnaar (0 of 1)

  /**
   * Sommige pagina's zetten de rating van de speler op het moment van de
   * wedstrijd erachter:
   *   <a …>Fleur Jansen</a><span class="match__row-title-aside"> (6,7593)</span>
   * Die is voor déze wedstrijd juister dan de rating van vandaag, want die
   * is sindsdien meebewogen. Staat hij er, dan gaat hij voor.
   */
  function ratingAtMatch(a) {
    const holder = a.closest(".match__row-title-value") || a.parentElement;
    const aside = holder && holder.querySelector(".match__row-title-aside");
    if (!aside) return null;
    const m = norm(aside.textContent).match(/\(?\s*((?:10|[1-9])[.,]\d{1,4})\s*\)?/);
    if (!m) return null;
    const v = toNumber(m[1]);
    return isFinite(v) && v >= 1 && v <= 10 ? v : null;
  }

  function teamFrom(anchors, isDouble) {
    return anchors.map((a) => {
      const d = ratingOf.get(a);
      const then = ratingAtMatch(a);
      return {
        anchor: a,
        key: playerKey(a),
        name: cleanName(a),
        start: then != null ? then : d ? (isDouble ? d.double : d.single) : null,
        atTime: then != null,
      };
    });
  }

  /**
   * Is dit een walkover of verstek?
   *
   * Alleen in de uitslag en de statustag kijken, nadrukkelijk NIET in de
   * voettekst: daar staat de speeldag, en "wo 26-8-2026" is woensdag, geen
   * walkover. Precies het soort valse treffer waar een ruwe zoekopdracht
   * over de hele wedstrijd in trapt.
   */
/* Wat telt níét mee voor de rating: er is niet gespeeld. Een opgave hoort
   daar uitdrukkelijk NIET bij — dan is er wel degelijk gespeeld en heeft de
   tegenstander gewoon gewonnen; de KNLTB rekent die partij mee. Hetzelfde
   geldt voor een gestaakte partij die alsnog een uitslag krijgt. Alleen een
   walkover, verstek of niet komen opdagen blijft buiten de berekening. */
  const WO_RE = /\bw\.?o\.?\b|walkover|verstek|afgemeld|niet opgekomen/;

  function isWalkover(block) {
    /* .match__message is het label dat de wedstrijdenlijst gebruikt
       ("Walkover"); in een schema staat het in .match__status of bij de
       uitslag. De voettekst blijft er bewust buiten: daar staat "wo 26-8-2026"
       voor woensdag, en dat is geen walkover. */
    const delen = [
      block.querySelector(".match__result"),
      ...block.querySelectorAll(".match__status"),
      ...block.querySelectorAll(".match__message"),
    ].filter(Boolean);
    const t = norm(delen.map((e) => e.textContent).join(" ")).toLowerCase();
    return WO_RE.test(t);
  }

  /**
   * Van wie is deze profielpagina? De mutatie in de wedstrijdkop hoort bij
   * die persoon, niet bij zijn tegenstander.
   */
  function subjectOfPage() {
    const m = location.pathname.match(new RegExp("/player-profile/" + UUID, "i"));

    /* Ook het bondsnummer, uit de kop van de pagina ("Mike Verhaar
       (30340969)"). De sleutel hierboven komt van de profiel-URL, terwijl de
       spelers in de wedstrijden een sleutel op bondsnummer hebben — die twee
       matchen dus nooit, en dan hangt de controle volledig op de naam. Bij
       een naam die net anders geschreven staat viel het vinkje daardoor
       zomaar weg. Met het nummer erbij is het hard te vergelijken. */
    let bond = null;
    const kop = document.querySelector(".page-head") || document.body;
    const aside = kop.querySelector(".media__title-aside");
    const tekst = norm((aside || kop).textContent).match(/\((\d{6,10})\)/);
    if (tekst) bond = tekst[1];

    return {
      key: m ? cacheKey(profileUrl(m[1].toLowerCase())) : null,
      name: Parse.playerName(document),
      bond,
    };
  }

  /**
   * De KNLTB zet zijn eigen mutatie in de kop van de wedstrijd:
   *   <div class="match__header-aside"><span class="tag tag--danger">0,1221</span>
   * Rood betekent dat de rating omhoog ging (dus verlies), groen omlaag.
   * Daarmee kunnen we onze eigen som naast de hunne leggen.
   */
  /**
   * De mutatie die de KNLTB zelf bij de wedstrijd toont.
   *
   * Twee vormen, allebei binnen .match__header-aside. Meestal een tag, waar
   * de kleur het teken draagt (tag--danger = omhoog = zwakker). Op de
   * ratingpagina staat hij bij een deel van de wedstrijden als kale tekst,
   * mét een eigen minteken. Alleen naar de tag kijken liet die tweede vorm
   * onopgemerkt — en zonder officiële waarde is er niets te controleren,
   * dus bleef daar het vinkje weg.
   *
   * Bewust alleen de aside en niet de hele kop: daar staan de ratinggrenzen
   * van het onderdeel ("8.0546 - 9.2975"), en die zien er net zo uit.
   */
  function officialDelta(block) {
    const aside = block.querySelector(".match__header-aside");
    if (!aside) return null;

    /* Niet de eerste tag pakken: daar staat de speelduur in ("47m"), als
       .tag--placeholder met een <time> erin. Alleen de tag die zelf een
       ratinggetal bevat telt. Dit ging eerder mis bij precies de verloren
       partijen: die tonen tag--danger zonder teken in de tekst, dus de
       terugval op de kale tekst kon de richting niet bepalen en liet het
       vinkje weg. */
    for (const tag of aside.querySelectorAll(".tag")) {
      if (tag.querySelector("time") || tag.classList.contains("tag--placeholder")) continue;
      const m = norm(tag.textContent).match(/((?:\d)[.,]\d{1,4})/);
      if (!m) continue;
      const v = toNumber(m[1]);
      if (!isFinite(v)) continue;
      // het teken zit in de kleur: danger = omhoog = zwakker, anders omlaag
      return tag.classList.contains("tag--danger") ? v : -v;
    }

    /* Kale tekst: het teken moet uit de tekst zelf komen. Staat er geen
       teken vóór het getal, dan weten we de richting niet en laten we het
       liever leeg dan dat we de helft van de tijd het omgekeerde beweren. */
    const m = norm(aside.textContent).match(/([+\u2212-])\s?((?:\d)[.,]\d{1,4})/);
    if (!m) return null;
    const v = toNumber(m[2]);
    if (!isFinite(v)) return null;
    return m[1] === "+" ? v : -v;
  }

  /**
   * Loopt het schema van voor naar achter door en schuift winnaars door naar
   * de lege plekken in de volgende ronde. Een bye is geen wedstrijd: die kant
   * gaat door zonder ratingmutatie. Zelfgekozen winnaars tellen hier net zo
   * hard mee als echte uitslagen, zodat je een scenario kunt uitspelen.
   */
  function projectBrackets() {
    const filled = new Map(); // matchEl -> [teamA|"BYE"|null, ...]
    const winners = new Map(); // matchEl -> index

    for (const b of Bracket.build()) {
      for (let r = 0; r < b.rounds.length; r++) {
        b.rounds[r].forEach((el, j) => {
          const s = Bracket.slots(el);
          if (s.length !== 2) return;

          const isDouble = s.some((x) => x.kind === "team" && x.anchors.length > 1);
          const cur = filled.get(el) || [null, null];

          s.forEach((slot, i) => {
            if (slot.kind === "team") cur[i] = teamFrom(slot.anchors, isDouble);
            else if (slot.kind === "bye") cur[i] = "BYE";
          });
          filled.set(el, cur);

          // winnaar: echte uitslag, anders eigen keuze, anders een bye
          let w = Bracket.decided(el);
          if (w < 0 && picks.has(el)) w = picks.get(el);
          if (w < 0) {
            const bye = cur.findIndex((t) => t === "BYE");
            if (bye >= 0 && cur[1 - bye] && cur[1 - bye] !== "BYE") w = 1 - bye;
          }
          if (w >= 0) winners.set(el, w);

          const next = Bracket.successor(b, r, j);
          if (next && w >= 0 && cur[w] && cur[w] !== "BYE") {
            const arr = filled.get(next.matchEl) || [null, null];
            // kopie per plek: elke doorgeschoven speler krijgt zijn eigen
            // badge-element, en dat mag niet gedeeld worden met de ronde
            // waar hij vandaan komt
            if (!arr[next.slot]) arr[next.slot] = cur[w].map((x) => ({ ...x }));
            filled.set(next.matchEl, arr);
          }
        });
      }
    }

    return { filled, winners };
  }

  /**
   * Zet de doorgeschoven spelers in de lege plekken van het schema.
   *
   * Bouwt daarbij dezelfde opbouw na als de site zelf gebruikt — per speler
   * een eigen .match__row-title-value, dus namen onder elkaar bij een duo —
   * met een badge in dezelfde vorm als bij een echte speler. Alleen de
   * blauwe rand verraadt dat het van de extensie komt.
   */
  /** Alles weghalen wat wij in lege plekken hebben gezet. */
  function clearProjected(scope) {
    const root = scope || document;
    root.querySelectorAll(".knltb-proj").forEach((el) => el.remove());
    // cellen die wij zelf hebben aangemaakt mogen weg; die van de site niet
    root.querySelectorAll("[data-knltb-own]").forEach((el) => el.remove());
    root.querySelectorAll(".knltb-proj-cel").forEach((el) => {
      el.classList.remove("knltb-proj-cel");
      if (el.dataset.knltbOrig != null) {
        const c = el.querySelector(".match__row-title-value-content");
        if (c) c.innerHTML = el.dataset.knltbOrig;
        delete el.dataset.knltbOrig;
      }
    });
    root.querySelectorAll(".knltb-proj-inhoud").forEach((el) => el.remove());
    root.querySelectorAll(".knltb-leeg").forEach((el) => el.classList.remove("knltb-leeg"));
    // de teruggezette innerHTML kan elementen van de site bevatten; die mag
    // de observer niet als vreemde wijziging zien, anders trapt de extensie
    // zichzelf opnieuw af
    if (observerRoot) observerRoot.takeRecords();
  }

  function showProjected(filled) {
    for (const [el, teams] of filled) {
      const rows = [...el.querySelectorAll(".match__row")];

      rows.forEach((row, i) => {
        const t = teams[i];
        if (!t || t === "BYE" || !Array.isArray(t)) return;
        // zelfde toets als bracket.js gebruikt; een attribuutselector is
        // hoofdlettergevoelig en zou /Player-Profile/ missen
        const heeftEchteNamen = [...row.querySelectorAll("a[href]")].some((a) =>
          /player/i.test(a.getAttribute("href") || "")
        );
        if (heeftEchteNamen) return;
        if (row.dataset.knltbProj) return;

        const titel = row.querySelector(".match__row-title") || row;
        clearProjected(titel);

        const disc = t.length > 1 ? "D" : "S";

        /* De site zet in een lege plek al net zoveel .match__row-title-value
           cellen neer als er spelers horen te komen. Die hergebruiken we —
           er zelf nieuwe achter plakken gaf een rij met dubbel zoveel cellen,
           waarvan de helft leeg. Dat leverde een blok witruimte boven de
           namen op en duwde de mutatie uit het midden. */
        const bestaand = [...titel.children].filter((c) =>
          c.classList && c.classList.contains("match__row-title-value")
        );

        t.forEach((speler, idx) => {
          let cel = bestaand[idx];
          if (!cel) {
            cel = document.createElement("div");
            /* De klasse moet er staan vóór het invoegen. De observer kijkt
               naar klassenamen om onze eigen invoegingen te herkennen; zonder
               die klasse ziet hij dit als een paginawijziging, start een nieuwe
               scan, die tekent opnieuw, en zo door — een eindeloze lus. */
            cel.className = "match__row-title-value knltb-proj-cel";
            cel.dataset.knltbOwn = "1";
            titel.appendChild(cel);
          }
          cel.classList.add("knltb-proj-cel");

          let inhoud = cel.querySelector(".match__row-title-value-content");
          if (!inhoud) {
            inhoud = document.createElement("span");
            inhoud.className = "match__row-title-value-content knltb-proj-inhoud";
            cel.appendChild(inhoud);
          }
          // wat de site hier had bewaren; anders is het na het terugnemen
          // van een keuze voorgoed weg
          if (!cel.dataset.knltbOwn && cel.dataset.knltbOrig == null) {
            cel.dataset.knltbOrig = inhoud.innerHTML;
          }
          inhoud.textContent = "";

          const naam = document.createElement("span");
          naam.className = "knltb-proj";
          naam.textContent = speler.name;

          /* Deze badge maken we zelf, buiten renderTags om, dus de
             zichtbaarheidsvlaggen moeten hier apart nagekeken worden —
             anders blijft een doorgeschoven speler zijn rating tonen
             terwijl je die discipline hebt uitgezet. */
          if (disc === "D" ? settings.showDouble : settings.showSingle) {
            const tags = document.createElement("span");
            tags.className = "knltb-tags";
            tags.appendChild(
              makeTag(
                disc === "D" ? "double" : "single",
                disc === "D" ? "D" : "S",
                f4(speler.start),
                speler.name + " — doorgeschoven op basis van jouw keuze"
              )
            );
            naam.appendChild(tags);
          }
          inhoud.appendChild(naam);

          speler.tagHost = naam;
        });

        // cellen die de site over heeft: niet laten meetellen in de hoogte
        for (let k = t.length; k < bestaand.length; k++) {
          bestaand[k].classList.add("knltb-leeg");
        }

        row.classList.add("knltb-hypothetisch");
        row.dataset.knltbProj = "1";
      });
    }
  }

  /** Alle bruikbare wedstrijden op de pagina, chronologisch. */
  function collectMatches(projection) {
    const out = [];
    const filled = projection ? projection.filled : null;
    const winners = projection ? projection.winners : null;

    document.querySelectorAll(".match").forEach((block, order) => {
      const rows = [...block.querySelectorAll(".match__row")];
      if (rows.length !== 2) return;

      const proj = filled ? filled.get(block) : null;
      if (proj && proj.some((t) => t === "BYE")) return; // bye = geen wedstrijd

      const sides = rows.map(sidePlayers);
      const isDouble =
        sides.some((s) => s.length > 1) ||
        (proj ? proj.some((t) => Array.isArray(t) && t.length > 1) : false);

      const teams = sides.map((anchors, i) => {
        if (anchors.length) return teamFrom(anchors, isDouble);
        // geen namen op de pagina, maar wel doorgeschoven vanuit een eerdere ronde
        return proj && Array.isArray(proj[i]) ? proj[i] : [];
      });

      if (teams.some((t) => t.length === 0 || t.length > 2)) return;

      /* Dubbel waarbij aan één kant maar één speler bekend is — de partner
         heeft geen profiellink, of staat er als kale tekst. `teamRating`
         neemt dan die ene rating in plaats van het gemiddelde, terwijl er
         wél met de dubbel-q (2,012) gerekend wordt. Dat levert een
         winstkans en een mutatie op die er plausibel uitzien en het niet
         zijn, zonder dat er iets in beeld verraadt dat er iemand ontbreekt.
         Liever niets tonen dan een verkeerd getal. */
      if (isDouble && teams.some((t) => t.length !== 2)) return;

      if (teams.flat().some((p) => p.start == null || !isFinite(p.start))) return;

      const when = matchWhen(block);
      const br = bracketRound(block);

      out.push({
        block, rows, teams, isDouble, order,
        group: groupOf(block),
        when: when ? when.at : null,
        exact: when ? when.exact : false,
        round: roundRank(block, br),
        wo: isWalkover(block),
        // in een schema loopt de ronde mee met de tijd, in een poule niet
        isBracket: !!br,
        wonBy: winners && winners.has(block)
          ? winners.get(block)
          : rows.some((r) => r.classList.contains("has-won"))
          ? rows.findIndex((r) => r.classList.contains("has-won"))
          : picks.has(block)
          ? picks.get(block)
          : -1,
        real: rows.some((r) => r.classList.contains("has-won")),
      });
    });

    // groepen onderling ordenen op hun vroegste speeldatum, anders paginavolgorde
    const groups = new Map();
    for (const m of out) {
      const g = groups.get(m.group) || { first: Infinity, order: m.order };
      if (m.when != null) g.first = Math.min(g.first, m.when);
      g.order = Math.min(g.order, m.order);
      groups.set(m.group, g);
    }
    const groupRank = new Map(
      [...groups.entries()]
        .sort((a, b) => {
          if (a[1].first !== b[1].first) return a[1].first - b[1].first;
          return a[1].order - b[1].order;
        })
        .map(([el], i) => [el, i])
    );

    /* Binnen een groep hangt de juiste maatstaf af van het speeltype.

       Schema (afvalschema): de kolom ís de voortgang. Je kunt de kwartfinale
       niet spelen voordat de achtste is gespeeld, ongeacht wat de kalender
       zegt. Ronde gaat daar dus vóór tijd.

       Poule: "Ronde 1/2/3" is een indelingsnummer, geen volgorde. In dit
       voorbeeld werd ronde 3 op 24 augustus gespeeld en ronde 1 pas op de
       25e. Daar is de speeldatum leidend en dient de ronde alleen als
       tiebreak binnen dezelfde dag. */
    const byRound = (x, y) =>
      x.round != null && y.round != null && x.round !== y.round ? x.round - y.round : 0;

    const byTime = (x, y) => {
      const xd = x.when != null;
      const yd = y.when != null;
      if (xd !== yd) return xd ? -1 : 1; // ingepland vóór niet-ingepland
      if (xd && yd && x.when !== y.when) return x.when - y.when;
      return 0;
    };

    return out.sort((x, y) => {
      const gx = groupRank.get(x.group);
      const gy = groupRank.get(y.group);
      if (gx !== gy) return gx - gy;

      const first = x.isBracket && y.isBracket ? byRound(x, y) : byTime(x, y);
      if (first) return first;

      const second = x.isBracket && y.isBracket ? byTime(x, y) : byRound(x, y);
      if (second) return second;

      return x.order - y.order;
    });
  }

  /** Alles opnieuw tekenen na een gekozen uitslag. */
  function rerunDeltas() {
    /* Badges terug naar de huidige rating; showStep() vult ze zo nodig
       opnieuw. Anders borduurt de volgende ronde voort op een al aangepaste
       weergave en klopt de "vóór"-waarde niet meer. */
    document.querySelectorAll(".knltb-hypothetisch").forEach((el) =>
      el.classList.remove("knltb-hypothetisch")
    );
    document.querySelectorAll(".knltb-heeft-regel").forEach((el) =>
      el.classList.remove("knltb-heeft-regel")
    );
    document.querySelectorAll(".knltb-tag.step .v").forEach((v) => {
      if (v.dataset.live) v.textContent = v.dataset.live;
      v.parentElement.classList.remove("step", "up", "down", "carried");
    });

    // een SPA-navigatie vervangt de wedstrijdblokken; keuzes die naar
    // losgekoppelde elementen wijzen doen niets meer en houden ze vast
    for (const el of picks.keys()) if (!document.contains(el)) picks.delete(el);

    document
      .querySelectorAll(".knltb-delta, .knltb-odds, .knltb-check, .knltb-alt, .knltb-regel")
      .forEach((el) => el.remove());
    clearProjected();
    document.querySelectorAll("[data-knltb-delta]").forEach((el) => delete el.dataset.knltbDelta);
    document.querySelectorAll("[data-knltb-gezien]").forEach((el) => delete el.dataset.knltbGezien);
    document.querySelectorAll("[data-knltb-proj]").forEach((el) => delete el.dataset.knltbProj);
    document.getElementById("knltb-summary")?.remove();
    annotateMatches();
    // elk blok is nu bekeken, ook wat collectMatches oversloeg; een vreemde
    // mutatie hoeft daar niet voor terug te komen. Alles wat een overgeslagen
    // blok alsnog bruikbaar kan maken (nieuwe namen, een binnengekomen
    // rating, een keuze, een instelling) loopt via deze functie en wist de
    // stempel hierboven weer.
    document.querySelectorAll(".match").forEach((el) => (el.dataset.knltbGezien = "1"));
    // alles hierboven is eigen werk; de observer hoeft het niet te zien
    if (observerRoot) observerRoot.takeRecords();
  }

  /* Walkover: er is niet gespeeld, dus er valt niets te berekenen.
     Altijd overslaan — ook in de doorrekening en het paneel. Staat er
     op de pagina tóch een waarde bij, dan noemen we die in de tooltip;
     verzwijgen wat de site zegt is geen optie, narekenen ook niet. */
  function markWalkover(m, official) {
    m.block.dataset.knltbDelta = "1";
    if (paginaSoort().mutaties === false) return;
    m.rows.forEach((row) => {
      chipHost(row).appendChild(
        deltaChip(
          "open wo",
          "w.o.",
          "Walkover of verstek: er is niet gespeeld, dus hier wordt niets " +
            "berekend en telt niets mee in de doorrekening." +
            (official != null
              ? "\n\nDe pagina zelf noemt hier " + signed(official) + "."
              : "")
        )
      );
    });
  }

  /* Doorgeschoven spelers zonder tegenstander.
     Zo'n wedstrijd valt buiten de doorrekening — er is niets te rekenen
     zolang de andere kant leeg is — en daardoor bleef de badge op de live
     rating staan, terwijl die speler zijn vorige ronde wél gewonnen had.
     Dus hier alsnog iedereen langs die nog niet is bijgewerkt. */
  function refreshProjectedBadges(projection, matches, current) {
    if (projection) {
      for (const teams of projection.filled.values()) {
        for (const team of teams) {
          if (!Array.isArray(team)) continue;
          const disc = team.length > 1 ? "D" : "S";

          for (const p of team) {
            if (!p.tagHost) continue;
            const tag = p.tagHost.querySelector(".knltb-tag");
            if (!tag || tag.classList.contains("step")) continue; // al gedaan
            showCarried(p, disc, current(p, disc));
          }
        }
      }
    }

    /* Doorgeschoven spelers in een wedstrijd die nog niet beslist is:
       daar valt geen mutatie te tonen, maar wel de stand waarmee ze die
       ronde ingaan. Bij een beslist duel heeft showStep het al gedaan. */
    for (const m of matches) {
      if (m.wonBy !== -1) continue;
      const disc = m.isDouble ? "D" : "S";
      for (const p of m.teams.flat()) {
        if (!p.tagHost) continue;
        const veld = p.tagHost.querySelector(".knltb-tag .v");
        if (!veld) continue;
        const nu = current(p, disc);
        veld.textContent = f4(nu);
        p.tagHost.querySelector(".knltb-tag").title =
          p.name + " — doorgeschoven op basis van jouw keuze" +
          "\nlive rating " + f4(p.start) +
          (Math.abs(nu - p.start) > 1e-9 ? "\nna eerdere rondes " + f4(nu) : "");
      }
    }
  }

  /** Het overzichtspaneel na de doorrekening, met je eigen rij erbij zodra die er is. */
  function showSummaryPanel(matches, totals, current, chain, stand) {
    // het paneel heeft een eigen schakelaar; stapelen zegt alleen iets over
    // hoe er gerekend wordt, niet of er een overzicht komt
    if (!settings.showSummary) return;

    // eigen rating op de achtergrond ophalen; zodra hij binnen is
    // tekenen we het paneel opnieuw zodat je eigen rij erbij komt
    if (settings.showMeInField && !ownData) ensureOwnData(scheduleDeltas);

    /* Het paneel toont `start + som` als huidige stand, maar de beste- en
       slechtste-geval-scenario's rekenen met `current()`. Zonder stapelen
       is `stand` leeg en geeft die de live rating terug: jouw beste geval
       zou dan gerekend worden tegen een tegenstander die twee regels lager
       in hetzelfde paneel op een andere waarde staat. Hier zetten we de
       meelopende stand alsnog gelijk. De wedstrijden zijn op dit punt al
       getekend, dus de badges veranderen er niet meer van. */
    if (!chain) for (const [k, t] of totals) stand.set(k, t.start + t.sum);

    const pending = isDrawPage() ? matches.filter((m) => m.wonBy === -1) : [];
    const rows = buildSummaryRows(matches, pending, totals, current);
    if (rows.length) {
      redrawField = rerunDeltas;
      renderSummary(rows, pending.length);
    }
  }

  function annotateMatches() {
    if (!settings.enabled) return;

    // Het veldpaneel en de mutatie-chips zijn twee losse instellingen;
    // showDelta uitzetten mocht niet ook het veld laten verdwijnen.
    if (!settings.showDelta) {
      if (!showEntryField()) showFieldOnly();
      return;
    }

    // op een schemapagina eerst de winnaars doorschuiven naar lege plekken
    const projection = isDrawPage() ? projectBrackets() : null;
    if (projection) showProjected(projection.filled);

    const matches = collectMatches(projection).filter((m) => !m.block.dataset.knltbDelta);
    if (!matches.length) {
      // ratings uit de inschrijvingstabel gaan voor: die zijn er al
      if (showEntryField()) return;
      // anders: spelers zonder wedstrijden, veld uit de opgehaalde ratings
      showFieldOnly();
      return;
    }

    /* De KNLTB rekent per toernooi chronologisch door: je rating in ronde 2
       is al bijgesteld door ronde 1. Dat volgen we hier ook, per discipline
       apart. `stand` houdt de meelopende rating per speler bij. */
    const chain = settings.chainTournament && isKnockoutPage();
    const stand = new Map();
    const totals = new Map();

    // van wie de pagina is: één keer opzoeken, en pas als een wedstrijd een
    // officiële mutatie heeft om onze som naast te leggen
    let subj;
    const pageSubject = () => (subj ??= subjectOfPage());

    const current = (p, disc) => {
      // staat de rating van dat moment al op de pagina? dan is doorrekenen
      // niet alleen overbodig maar fout — je zou de mutatie dubbel tellen
      if (p.atTime) return p.start;
      const k = p.key + "|" + disc;
      if (!stand.has(k)) stand.set(k, p.start);
      return stand.get(k);
    };

    for (const m of matches) {
      const disc = m.isDouble ? "D" : "S";
      const official = officialDelta(m.block);
      const subject = official != null ? pageSubject() : null;

      if (m.wo) {
        markWalkover(m, official);
        continue;
      }
      const A = m.teams[0].map((p) => (chain ? current(p, disc) : p.start));
      const B = m.teams[1].map((p) => (chain ? current(p, disc) : p.start));

      const res = DSS.match(A, B);
      m.block.dataset.knltbDelta = "1";

      m.rows.forEach((row, i) => {
        const side = i === 0 ? res.a : res.b;
        const team = m.teams[i];
        const teamR = i === 0 ? res.ratingA : res.ratingB;
        const oppR = i === 0 ? res.ratingB : res.ratingA;
        const decided = m.wonBy !== -1;
        const won = m.wonBy === i;

        const uitleg =
          (m.isDouble ? "Dubbel" : "Enkel") +
          " · " + Math.round(side.prob * 100) + "% winstkans" +
          "\nteam " + f4(teamR) + " tegen " + f4(oppR) +
          (team.some((p) => p.atTime)
            ? "\n(ratings zoals ze bij deze wedstrijd waren, van de pagina zelf)"
            : chain && team.some((p) => current(p, disc) !== p.start)
            ? "\n(stand na eerdere rondes van dit toernooi)"
            : "") +
          "\nlagere rating = sterker, dus winst geeft een min" +
          (m.isDouble ? "\nbeide partners krijgen dezelfde mutatie" : "");

        let chip;
        if (decided) {
          const d = won ? side.onWin : side.onLoss;

          /* De site geeft zijn eigen mutatie voor de kant van de speler
             wiens pagina dit is. Klopt die met de onze, dan weten we dat de
             formule en de gebruikte ratings allebei goed zijn. */
          let check = "";
          if (official != null) {
            const zelfdeKant = Math.abs(Math.abs(d) - Math.abs(official)) < 5e-5;
            const zelfdeRichting = d * official > 0;
            if (zelfdeKant && zelfdeRichting) check = "\n✓ gelijk aan de KNLTB (" + signed(official) + ")";
            else if (zelfdeKant) check = "\n(de KNLTB toont " + signed(official) + " voor de andere kant)";
            else check = "\n⚠ de KNLTB toont " + signed(official) + " — controleer";
          }
          const perPlayer = team
            .map((p) => p.name + ": " + f4(current(p, disc)) + " → " + f4(current(p, disc) + d))
            .join("\n");

          // de stand vóór en ná in de badge achter de naam zetten
          for (const p of team) {
            const voor = current(p, disc);
            /* "over dit toernooi tot nu toe" is de som van alle eerdere
               wedstrijden plus deze. Bij stapelen is dat gelijk aan
               voor + d − start, maar zónder stapelen begint elke wedstrijd
               weer bij de startrating en zou die formule simpelweg `d`
               herhalen — precies de regel die erboven al staat. */
            const eerder = totals.get(p.key + "|" + disc);
            showStep(p, disc, voor, voor + d,
              p.atTime ? null : (eerder ? eerder.sum : 0) + d);
          }

          /* Een zelfgekozen uitslag is geen uitslag. De hele rij krijgt een
             rand mee zodat je in één oogopslag ziet wat van de site komt en
             wat van jou — anders lezen de getallen als feiten. */
          if (!m.real) row.classList.add("knltb-hypothetisch");

          const geverifieerd =
            official != null &&
            Math.abs(Math.abs(d) - Math.abs(official)) < 5e-5 &&
            d * official > 0;

          // hoort deze kant bij de speler wiens profiel dit is? dan onze
          // uitkomst naast die van de KNLTB zetten
          if (
            official != null &&
            subject &&
            team.some(
              (p) =>
                (subject.key && p.key === subject.key) ||
                (subject.bond && String(p.key || "").endsWith("/" + subject.bond)) ||
                (subject.name && sameName(p.name, subject.name))
            )
          ) {
            addCheckBadge(m.block, d, official, won ? side.onLoss : side.onWin, won);
          }

          chip = deltaChip(
            (won ? "gain" : "drop") + (m.real ? "" : " picked") + (geverifieerd ? " verified" : ""),
            signed(d),
            (m.real
              ? won
                ? "Gewonnen"
                : "Verloren"
              : won
              ? "Gekozen winnaar"
              : "Gekozen verliezer") +
              ": " + signed(d) + check +
              "\n" + perPlayer +
              "\nAndersom gelopen: " + signed(won ? side.onLoss : side.onWin) +
              "\n\n" + uitleg
          );
        } else {
          // geen uitslag, maar de stand waarmee ze deze ronde ingaan wél
          if (chain) for (const p of team) showCarried(p, disc, current(p, disc));

          chip = deltaChip(
            "open",
            "W " + signed(side.onWin) + " · V " + signed(side.onLoss),
            "Bij winst " + signed(side.onWin) + ", bij verlies " + signed(side.onLoss) +
              "\n\n" + uitleg
          );
        }

        // nog niet gespeeld? dan mag je zelf de winnaar aanwijzen
        if (!m.real) {
          chip.classList.add("pickable");
          chip.setAttribute("role", "button");
          chip.tabIndex = 0;
          chip.title =
            (won ? "Klik om deze keuze terug te nemen" : "Klik om deze kant te laten winnen") +
            "\n\n" + chip.title;

          const toggle = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (picks.get(m.block) === i) picks.delete(m.block);
            else picks.set(m.block, i);
            rerunDeltas();
          };
          chip.addEventListener("click", toggle);
          chip.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") toggle(e);
          });
        }

        const host = chipHost(row);
        const toonMutatie = paginaSoort().mutaties !== false;

        if (settings.showOdds) {
          host.appendChild(
            oddsBadge(
              side.prob,
              side.prob >= 0.5,
              "Bij winst " + signed(side.onWin) + ", bij verlies " + signed(side.onLoss)
            )
          );
        }

        if (toonMutatie) host.appendChild(chip);
      });

      /* Stand en totalen bijwerken. Het paneel telt de mutaties altijd op —
         ook zonder stapelen, want "wat heeft dit toernooi tot nu toe gedaan"
         is dan nog steeds de som van de losse wedstrijden. Alleen `stand`,
         de rating waarmee een speler de vólgende wedstrijd ingaat, hoort bij
         het stapelen en blijft daarbuiten onaangeroerd. */
      if (m.wonBy !== -1) {
        m.teams.forEach((team, i) => {
          const side = i === 0 ? res.a : res.b;
          const d = m.wonBy === i ? side.onWin : side.onLoss;
          for (const p of team) {
            if (p.atTime) continue; // stand komt van de pagina zelf
            const k = p.key + "|" + disc;
            if (chain) stand.set(k, current(p, disc) + d);
            const t = totals.get(k) || { name: p.name, disc, start: p.start, n: 0, sum: 0 };
            t.n++;
            t.sum += d;
            totals.set(k, t);
          }
        });
      }
    }

    refreshProjectedBadges(projection, matches, current);
    showSummaryPanel(matches, totals, current, chain, stand);
  }

  /**
   * De oude inschrijvingspagina (/sport/event.aspx?id=…&event=N) heeft de
   * ratings al in een kolom staan:
   *
   *   <table class="ruler">
   *     <caption>Inschrijvingen (5)</caption>
   *     <thead><tr><td></td><td>Speler</td><td>Club</td><td>Rating</td><td>Plaatsing</td></tr>
   *     <tbody><tr>…<a href="player.aspx?…">Niels Hendriks</a>…<td>6,9138</td><td>1</td>
   *
   * Daar hoeft dus niets voor opgehaald te worden. Nul verzoeken voor een
   * compleet veld — en meteen de reden om op zo'n pagina ook geen profielen
   * meer op te vragen voor de tags.
   *
   * Het uitlezen zelf gebeurt in parse.js; hier maken we de links absoluut en
   * houden we de ankerelementen bij, zodat we ze kunnen overslaan bij het ophalen.
   */
  function parseEntryTable() {
    const found = Parse.entryTable(document);
    if (!found) return null;

    const anchors = [...found.table.querySelectorAll("a[href]")].filter((a) =>
      /player/i.test(a.getAttribute("href") || "")
    );

    const rows = found.rows.map((r, i) => ({
      ...r,
      start: DSS.teamRating(r.ratings.slice(0, 2)),
      key: "entry:" + (r.hrefs[0] || r.name) + "#" + i,
      hrefs: r.hrefs
        .map((h) => {
          try {
            return new URL(h, location.href).href;
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    }));

    return { rows, anchors, caption: found.caption, table: found.table };
  }

  let entryTable = null;
  const entryAnchors = new Set();

  /** Veld uit de inschrijvingstabel, zonder ook maar iets op te halen. */
  function showEntryField() {
    if (!settings.showMeInField || !entryTable) return false;

    const disc = eventDiscipline() || "S";
    const rows = entryTable.rows.map((r) => ({
      ...r,
      disc,
      now: r.start,
      best: r.start,
      worst: r.start,
      played: 0,
      todo: 0,
    }));

    // sta jij ertussen? vergelijken op de profiel-URL achter de naam
    const ownKey = ownProfileKey();

    for (const r of rows) {
      if (ownKey && (r.hrefs || []).some((h) => cacheKey(h) === ownKey)) r.isSelf = true;
      if (ownData && ownData.name && (r.names || [r.name]).some((n) => sameName(ownData.name, n))) {
        r.isSelf = true;
      }
    }

    if (!rows.some((r) => r.isSelf)) {
      if (!ownData) {
        ensureOwnData(() => {
          document.getElementById("knltb-summary")?.remove();
          showEntryField();
        });
      } else {
        const row = selfRow(disc);
        if (row) rows.push(row);
      }
    }

    rankRows(rows);

    redrawField = showEntryField;
    document.getElementById("knltb-summary")?.remove();
    renderSummary(rows, 0, entryTable.caption);
    return true;
  }

  /**
   * Een onderdeel waar nog geen wedstrijden van bekend zijn: toon het veld,
   * zodat je vóór het inschrijven ziet waar je zou staan. Enkel of dubbel
   * halen we dan uit de naam van het onderdeel (HE/DE tegenover HD/DD/GD).
   */
  function showFieldOnly() {
    if (!settings.showMeInField) return;

    const disc = eventDiscipline();
    if (!disc) return;

    const seen = new Map();
    for (const a of ratedAnchors) {
      if (!document.contains(a)) continue;
      const d = ratingOf.get(a);
      if (!d) continue;
      const waarde = disc === "D" ? d.double : d.single;
      if (waarde == null || !isFinite(waarde)) continue;

      const key = playerKey(a) + "|" + disc;
      if (seen.has(key)) continue;
      seen.set(key, {
        key, disc, start: waarde,
        name: cleanName(a),
        now: waarde, best: waarde, worst: waarde,
        played: 0, todo: 0,
      });
    }

    if (seen.size < 3) return;

    const self = ownProfileKey();
    const rows = [...seen.values()];
    if (self) for (const r of rows) r.isSelf = r.key.startsWith(self + "|");

    if (!rows.some((r) => r.isSelf) && ownData) {
      const mine = disc === "D" ? ownData.double : ownData.single;
      if (mine != null && isFinite(mine)) {
        rows.push({
          key: "self|" + disc, disc,
          name: (ownData.name || "jij") + " — niet ingeschreven",
          start: mine, now: mine, best: mine, worst: mine,
          played: 0, todo: 0, isSelf: true, virtual: true,
        });
      }
    } else if (!ownData) {
      ensureOwnData(() => {
        document.getElementById("knltb-summary")?.remove();
        showFieldOnly();
      });
    }

    // op sterkte sorteren; hier is er nog geen uitslag om op te ordenen
    rankRows(rows);

    redrawField = showFieldOnly;
    document.getElementById("knltb-summary")?.remove();
    renderSummary(rows, 0);
  }

  /**
   * Een afvalschema: de enige plek waar de volgorde van de wedstrijden
   * hard uit de opmaak volgt — ronde 2 komt aantoonbaar na ronde 1, en de
   * winnaar van een partij is te herleiden naar zijn plek in de volgende.
   * Alleen daar mag de doorrekening stapelen.
   *
   * In een poule ligt die volgorde niet vast: de tabel is een raster, geen
   * tijdlijn. In de wedstrijdenlijst staan onderdelen door elkaar. Op zulke
   * pagina's rekent elke wedstrijd op zichzelf, vanaf de huidige rating.
   */
  /**
   * Wat voor pagina is dit, en hoort de extensie hier ratings op te halen?
   * Eén plek voor allebei, zodat wat de popup laat zien altijd klopt met wat
   * er werkelijk gebeurt.
   */
  let soortMemo = null;
  let soortVoor = null;

  /** Zelfde antwoord zolang je op dezelfde pagina blijft. */
  function paginaSoort() {
    if (soortVoor === location.href && soortMemo) return soortMemo;
    soortVoor = location.href;
    soortMemo = bepaalSoort();
    return soortMemo;
  }

  function bepaalSoort() {
    const p = location.pathname;
    const T = "^/tournament/" + UUID;

    if (new RegExp(T + "/players/?$", "i").test(p) || /^\/sport\/players\.aspx/i.test(p)) {
      return {
        sleutel: "deelnemerslijst",
        naam: "Deelnemerslijst van het toernooi",
        ophalen: false,
        waarom:
          "Hier staat het hele deelnemersveld; dat zijn er al gauw honderden. " +
          "Elke naam opzoeken zou de site onnodig belasten voor een lijst waar " +
          "je toch niet per wedstrijd rekent. Wat al in de cache staat wordt " +
          "wel getoond.",
      };
    }
    if (new RegExp(T + "/draw/\\d+", "i").test(p) || /^\/sport\/draw\.aspx/i.test(p)) {
      return {
        sleutel: isKnockoutPage() ? "afvalschema" : "poule",
        naam: isKnockoutPage() ? "Afvalschema" : "Poule of ander schema",
        ophalen: true,
      };
    }
    if (isMatchListPage()) {
      return { sleutel: "wedstrijden", naam: "Wedstrijdenlijst", ophalen: true };
    }
    if (new RegExp("^/player-profile/" + UUID + "/rating/?$", "i").test(p)) {
      return {
        sleutel: "ratingpagina",
        naam: "Ratingpagina van een speler",
        ophalen: true,
        /* De site zet hier zelf al bij elke wedstrijd de rating van dat
           moment en de officiële mutatie. Onze eigen badge achter de naam en
           de stap voor → na zouden dat alleen maar verdubbelen; de controle
           bovenaan laat al zien dat onze som klopt. De winstkans voegt wél
           iets toe, want die staat er nergens. */
        badges: false,
        stappen: false,
        /* De eigen mutatie staat hier al in de controle bovenaan, en per rij
           zou hij precies datzelfde getal nog eens herhalen. De winstkans
           blijft wel: die staat nergens anders. */
        mutaties: false,
      };
    }
    if (new RegExp("^/player-profile/" + UUID, "i").test(p)) {
      return { sleutel: "profiel", naam: "Spelersprofiel", ophalen: true };
    }
    if (/^\/sport\/event\.aspx/i.test(p)) {
      return { sleutel: "inschrijvingen", naam: "Inschrijvingen", ophalen: true };
    }
    if (/^\/head-2-head/i.test(p)) {
      return { sleutel: "h2h", naam: "Head-to-head", ophalen: true };
    }
    return { sleutel: "overig", naam: "Overige pagina", ophalen: true };
  }

  function isKnockoutPage() {
    return !!document.querySelector(".bracket");
  }

  /**
   * De wedstrijdenlijst van een toernooi (/Matches en /matches/<datum>).
   * Daar staan wedstrijden uit alle onderdelen door elkaar en niet op
   * toernooivolgorde, dus rondes op elkaar stapelen zou getallen opleveren
   * die nergens op slaan. Elke wedstrijd op zichzelf is hier het juiste
   * antwoord: steeds vanaf de huidige rating van de speler.
   */
  function isMatchListPage() {
    return /^\/tournament\/[0-9a-f-]{36}\/matches(\/|$)/i.test(location.pathname);
  }

  /** Alleen op een schema-/poulepagina staat één compleet onderdeel. */
  function isDrawPage() {
    return /^\/tournament\/[0-9a-f-]{36}\/draw\/\d+/i.test(location.pathname);
  }

  let ownData = null;

  /**
   * Per speler: de stand na de gespeelde rondes, plus wat er nog te winnen
   * of te verliezen valt in de resterende wedstrijden.
   *
   * "Beste geval" = deze speler wint al zijn resterende wedstrijden, waarbij
   * elke volgende met zijn dan bijgestelde rating gerekend wordt. De overige
   * wedstrijden laten we onaangeroerd — en dat is precies de verwachtings-
   * waarde, want E[mutatie] = K·(P−1)·P + K·P·(1−P) = 0. Het DSS is zuiver:
   * spelen levert je op de lange duur niets op of kost je niets, tenzij je
   * beter of slechter presteert dan je rating voorspelt.
   */
  /** Eén speler doorgerekend over zijn resterende wedstrijden: nu, beste en slechtste geval. */
  function scenario(row, pending, current) {
    const disc = row.disc;
    // som van de mutaties; bij stapelen is dat exact wat `stand` bijhoudt,
    // zonder stapelen is het de enige bron
    const now = row.start + (row.sum || 0);

    // resterende wedstrijden van deze speler, op volgorde
    const mine = pending.filter(
      (m) =>
        (m.isDouble ? "D" : "S") === disc &&
        m.teams.some((t) => t.some((p) => p.key + "|" + disc === row.key))
    );

    let best = now;
    let worst = now;

    for (const m of mine) {
      const sideIx = m.teams.findIndex((t) =>
        t.some((p) => p.key + "|" + disc === row.key)
      );
      const own = m.teams[sideIx];
      const opp = m.teams[1 - sideIx];
      const oppR = opp.map((q) => current(q, disc));

      for (const mode of ["best", "worst"]) {
        const r = mode === "best" ? best : worst;
        const ownR = own.map((q) => (q.key + "|" + disc === row.key ? r : current(q, disc)));

        const res =
          sideIx === 0 ? DSS.match(ownR, oppR) : DSS.match(oppR, ownR);
        const side = sideIx === 0 ? res.a : res.b;

        if (mode === "best") best = r + side.onWin;
        else worst = r + side.onLoss;
      }
    }

    return { now, best, worst, todo: mine.length };
  }

  function buildSummaryRows(matches, pending, totals, current) {
    const seen = new Map();

    // iedereen die speelde
    for (const [k, t] of totals) {
      seen.set(k, {
        key: k, name: t.name, disc: t.disc, start: t.start,
        played: t.n, sum: t.sum || 0,
      });
    }

    // plus iedereen met nog een wedstrijd te gaan
    for (const m of pending) {
      const disc = m.isDouble ? "D" : "S";
      for (const p of m.teams.flat()) {
        const k = p.key + "|" + disc;
        if (!seen.has(k)) {
          seen.set(k, { key: k, name: p.name, disc, start: p.start, played: 0 });
        }
      }
    }

    const rows = [];

    for (const row of seen.values()) {
      const { now, best, worst, todo } = scenario(row, pending, current);
      rows.push({
        key: row.key,
        name: row.name,
        disc: row.disc,
        start: row.start,
        now,
        best,
        worst,
        played: row.played,
        todo,
      });
    }

    const self = ownProfileKey();
    if (self) {
      for (const r of rows) r.isSelf = r.key.startsWith(self + "|");
    }

    const out = rows.filter((r) => r.played > 0 || r.todo > 0);

    /* Sta je zelf niet in dit veld, maar is je rating bekend? Dan als
       hypothetische deelnemer meetellen — zo zie je vóór het inschrijven
       waar je zou staan. Zo'n rij speelt geen wedstrijden en verandert
       dus ook niets aan de doorrekening. */
    if (settings.showMeInField && out.length && !out.some((r) => r.isSelf) && ownData) {
      const row = selfRow(out[0].disc);
      if (row) out.push(row);
    }

    /* Positie in het deelnemersveld. Niet uit de onderdeeltitel — die heeft
       lang niet altijd ratinggrenzen, en bij een enkelschema vaak helemaal
       geen titel. We hebben de ratings van alle deelnemers toch al opgehaald,
       dus het veld rekenen we gewoon zelf uit. Dat is bovendien de échte
       samenstelling in plaats van de inschrijfgrenzen. */
    // per discipline apart: een enkelrating van 6,2 en een dubbelrating van
    // 6,2 zijn niet dezelfde maat, dus die horen niet in één ranglijst
    const byDisc = new Map();
    for (const r of out) {
      if (!byDisc.has(r.disc)) byDisc.set(r.disc, []);
      byDisc.get(r.disc).push(r);
    }
    for (const group of byDisc.values()) rankRows(group);

    // wie het meest is opgeschoven bovenaan; daarna wie nog het meest kan.
    // De hypothetische eigen rij hoort onderaan, hij hoort niet bij de uitslag.
    return out.sort(
      (a, b) =>
        (a.virtual ? 1 : 0) - (b.virtual ? 1 : 0) ||
        a.now - a.start - (b.now - b.start) ||
        a.now - b.now
    );
  }

  /* ---------------------------------------------------------------
     Jezelf in een veld zetten waar je (nog) niet in staat
     --------------------------------------------------------------- */

  let ownRatingPromise = null;
  let redrawField = null; // hoe het huidige veldpaneel opnieuw te tekenen is

  /** Met welke partner rekenen we in het dubbel? */
  /** Organisatiecode van deze site, uit een H2H-link of een favorietknop. */
  function pageOrgCode() {
    const h2h = document.querySelector('a[href*="head-2-head"]');
    if (h2h) {
      try {
        const v = new URL(h2h.href, location.href).searchParams.get("OrganizationCode");
        if (v) return v;
      } catch {
        /* negeren */
      }
    }
    const btn = document.querySelector("[data-uldata1]");
    const v = btn && btn.getAttribute("data-uldata1");
    return v && UUID_ONLY.test(v) ? v : null;
  }

  /**
   * Partnerinvoer begrijpen (zie Site.parsePlayerInput): een rating is
   * meteen klaar, een verwijzing naar een speler wordt opgezocht.
   */
  async function resolvePartner(text) {
    const p = Site.parsePlayerInput(text, pageOrgCode());
    if (!p) return { rating: null, name: null };
    if (p.rating != null) return { rating: p.rating, name: null };

    const data = await enqueue(() => fetchRating(p.url, [p.url]));
    if (!data || data.double == null || !isFinite(data.double)) throw new Error("GEEN_DUBBEL");
    return { rating: data.double, name: data.name || null };
  }

  function partnerFor(mine) {
    const p = settings.partnerRating;
    return p != null && isFinite(p) && p >= 1 && p <= 10 ? p : mine;
  }

  function partnerLabel() {
    const p = settings.partnerRating;
    if (p == null || !isFinite(p) || p < 1 || p > 10) return " + partner van gelijke sterkte";
    return " + " + (settings.partnerName ? settings.partnerName + " " : "partner ") + f4(p);
  }

  /** Jouw eigen rij als hypothetische deelnemer — null zonder bruikbare rating. */
  function selfRow(disc) {
    const mine = disc === "D" ? ownData.double : ownData.single;
    if (mine == null || !isFinite(mine)) return null;
    const ratings = disc === "D" ? [mine, partnerFor(mine)] : [mine];
    const team = DSS.teamRating(ratings);
    return {
      key: "self|" + disc, disc,
      name:
        (ownData.name || "jij") +
        (disc === "D" ? partnerLabel() : "") +
        " — niet ingeschreven",
      names: [ownData.name || "jij"],
      ratings,
      start: team, now: team, best: team, worst: team,
      played: 0, todo: 0, isSelf: true, virtual: true,
    };
  }

  /** URL van het eigen profiel, uit het menu rechtsboven. */
  function ownProfileUrl() {
    const a =
      document.querySelector('.dropdown-list a[href*="/player-profile/"]') ||
      document.querySelector('a[title="Mijn profiel"][href*="/player-profile/"]');
    if (!a) return null;
    try {
      return new URL(a.getAttribute("href"), location.href).href;
    } catch {
      return null;
    }
  }

  /** Eigen profiel vastleggen, zodat het dashboard weet wie jij bent. */
  function rememberSelf() {
    const url = ownProfileUrl();
    if (!url) return;
    Site.store.get("selfProfile").then((o) => {
      if (o.selfProfile !== url) {
        Site.store.set({ selfProfile: url }).catch((e) => log("eigen profiel bewaren mislukt:", e.message));
      }
    });
  }

  /** Eigen rating ophalen — één keer per pagina, daarna uit de cache. */
  function ownRating() {
    if (ownRatingPromise) return ownRatingPromise;
    const url = ownProfileUrl();
    if (!url) return Promise.resolve(null);
    ownRatingPromise = enqueue(() => fetchRating(url, [url])).catch(() => {
      // niet permanent onthouden: een tijdelijke fout mag geen blijvende
      // "geen eigen rating" opleveren
      ownRatingPromise = null;
      return null;
    });
    return ownRatingPromise;
  }

  /** Eigen rating op de achtergrond ophalen; zodra hij binnen is, opnieuw tekenen. */
  function ensureOwnData(redraw) {
    ownRating().then((d) => {
      if (d && !ownData) {
        ownData = d;
        redraw();
      }
    });
  }

  /**
   * Enkel of dubbel? Bij een onderdeel zonder wedstrijden (een deelnemers-
   * lijst) valt dat niet uit de opstelling af te leiden, maar wel uit de
   * naam: HE/DE is enkelspel, HD/DD/GD is dubbel.
   */
  /** Enkel of dubbel, afgeleid uit de naam van het onderdeel. */
  function eventDiscipline() {
    return Parse.discipline(Parse.eventTitle(document));
  }

  /** Het profiel van de ingelogde gebruiker staat in het menu rechtsboven. */
  function ownProfileKey() {
    const u = ownProfileUrl();
    return u && cacheKey(u);
  }

  /** Kengetallen van het deelnemersveld. */
  function fieldStats(rows) {
    const vals = rows.map((r) => r.start).filter((v) => isFinite(v)).sort((a, b) => a - b);
    if (vals.length < 2) return null;
    return {
      n: vals.length,
      best: vals[0],
      worst: vals[vals.length - 1],
      median: Site.median(vals),
    };
  }

  /** Op sterkte sorteren (laag = sterk) en ieders plek in het veld erbij zetten. */
  function rankRows(rows) {
    rows.sort((a, b) => a.start - b.start);
    rows.forEach((r, i) => {
      r.rank = i + 1;
      r.fieldSize = rows.length;
    });
  }

  /** Het invoerveld voor je dubbelpartner, onder de veldregel van het paneel. */
  function partnerInput(me) {
    const row = document.createElement("div");
    row.className = "knltb-summary__partner";

    const lbl = document.createElement("label");
    lbl.textContent = "partner ";

    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.placeholder = "rating of link naar speler";
    input.value =
      settings.partnerRating != null && isFinite(settings.partnerRating)
        ? f4(settings.partnerRating)
        : "";
    input.title =
      "Je beoogde dubbelpartner. Mag een rating zijn (6,4314) of een\n" +
      "verwijzing naar de speler:\n" +
      "  · een profiellink /player-profile/<uuid>\n" +
      "  · een toernooilink /sport/player.aspx?…\n" +
      "  · een bondsnummer, bv. 30340969\n\n" +
      "Teamrating = het gemiddelde van jullie twee.\n" +
      "Leeg laten = rekenen met een partner van jouw eigen sterkte.";

    const save = (rating, name) => {
      settings.partnerRating = rating;
      settings.partnerName = name;
      Site.store
        .merge("settings", { partnerRating: rating, partnerName: name })
        .catch((e) => log("partner bewaren mislukt:", e.message));
      redrawField();
    };

    const apply = async () => {
      const raw = input.value;
      input.classList.remove("bad");

      if (!norm(raw)) return save(null, null);

      input.classList.add("busy");
      try {
        const { rating, name } = await resolvePartner(raw);
        input.classList.remove("busy");
        save(rating, name);
      } catch (err) {
        input.classList.remove("busy");
        input.classList.add("bad");
        input.title =
          {
            BUITEN_BEREIK: "Een rating ligt tussen 1 en 10.",
            GEEN_ORG: "Kan op deze pagina geen organisatiecode vinden — plak een profiellink.",
            ANDERE_SITE: "Alleen links van mijnknltb.toernooi.nl.",
            ONBEGREPEN: "Niet herkend als rating, link of bondsnummer.",
            GEEN_DUBBEL: "Op dat profiel staat geen dubbelrating.",
          }[err.message] || ("Opzoeken mislukt: " + err.message);
      }
    };

    input.addEventListener("change", apply);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") apply();
    });

    lbl.appendChild(input);
    row.appendChild(lbl);

    const hint = document.createElement("span");
    hint.className = "knltb-summary__hint";
    hint.textContent =
      (settings.partnerName ? settings.partnerName + " · " : "") +
      "teamrating " + f4(me.start);
    row.appendChild(hint);

    return row;
  }

  /** De tabel van het paneel; welke kolommen erin staan hangt af van `mode`. */
  function summaryTable(rows, mode, versus) {
    const table = document.createElement("table");
    table.className = "knltb-summary__table";

    const thead = document.createElement("tr");
    for (const h of mode === "scenarios"
      ? ["", "nu", "beste", "slechtste"]
      : mode === "field"
      ? ["", "rating", "winst", "verlies"]
      : ["", "start", "nu", ""]) {
      const th = document.createElement("th");
      th.textContent = h;
      thead.appendChild(th);
    }
    table.appendChild(thead);

    for (const r of rows) {
      const tr = document.createElement("tr");

      const name = document.createElement("td");
      name.className = "knltb-summary__name" + (r.isSelf ? " is-self" : "");
      name.textContent = (r.rank ? r.rank + ". " : "") + r.name;
      name.title =
        r.name +
        (r.club ? " · " + r.club : "") +
        (r.seed ? " · geplaatst " + r.seed : "") +
        " — " + (r.disc === "D" ? "dubbel" : "enkel") +
        "\nstart " + f4(r.start) +
        (r.rank ? "\n" + r.rank + "e van " + r.fieldSize + " op sterkte" : "") +
        "\n" + r.played + " gespeeld, " + r.todo + " te gaan";
      tr.appendChild(name);

      const cell = (text, cls, title) => {
        const td = document.createElement("td");
        td.className = "knltb-summary__val " + (cls || "");
        td.textContent = text;
        if (title) td.title = title;
        return td;
      };

      const moved = r.now - r.start;

      if (mode === "scenarios") {
        tr.appendChild(
          cell(f4(r.now), moved < -1e-9 ? "gain" : moved > 1e-9 ? "drop" : "",
            "stand na " + r.played + " gespeelde wedstrijd(en): " + signed(moved))
        );
        tr.appendChild(
          cell(r.todo ? f4(r.best) : "–", "gain",
            r.todo ? "alle " + r.todo + " resterende gewonnen: " + signed(r.best - r.now) : "niets meer te spelen")
        );
        tr.appendChild(
          cell(r.todo ? f4(r.worst) : "–", "drop",
            r.todo ? "alle " + r.todo + " resterende verloren: " + signed(r.worst - r.now) : "niets meer te spelen")
        );
      } else if (mode === "field") {
        tr.appendChild(
          cell(
            f4(r.start),
            "",
            r.ratings && r.ratings.length > 1
              ? "teamrating " + f4(r.start) + " = gemiddelde van " +
                r.ratings.map(f4).join(" en ")
              : ""
          )
        );

        const v = versus(r);
        if (v) {
          const kans = Math.round(v.prob * 100) + "% winstkans tegen " + r.name;
          tr.appendChild(cell(signed(v.onWin), "gain", kans));
          tr.appendChild(cell(signed(v.onLoss), "drop", kans));
        } else {
          tr.appendChild(cell(r.isSelf ? "—" : "", "muted"));
          tr.appendChild(cell("", "muted"));
        }
      } else {
        tr.appendChild(cell(f4(r.start)));
        tr.appendChild(
          cell(f4(r.now), moved < -1e-9 ? "gain" : moved > 1e-9 ? "drop" : "")
        );
        tr.appendChild(cell(signed(moved), moved < 0 ? "gain" : "drop"));
      }

      table.appendChild(tr);
    }
    return table;
  }

  /** De toelichting onder de tabel: hoe er gerekend is en wat de kolommen zeggen. */
  function summaryNote(rows, mode) {
    const note = document.createElement("div");
    note.className = "knltb-summary__note";
    note.textContent = mode === "field"
      ? "Veld op sterkte; lagere rating = sterker. De twee kolommen zijn wat een " +
        "partij tégen die speler met jouw rating doet — winst levert een min op, " +
        "want je zakt richting de 1. Tegen een sterkere tegenstander valt er veel " +
        "te halen en weinig te verliezen." +
        (rows.some((r) => r.disc === "D")
          ? " Bij dubbel gerekend alsof beide kanten een partner van gelijke sterkte hebben."
          : "")
      : mode === "scenarios"
      ? "Beste en slechtste geval = alle resterende wedstrijden gewonnen of verloren, " +
        "elke volgende gerekend met de dan bijgestelde rating. Een “verwachte” " +
        "kolom ontbreekt met opzet: die is exact gelijk aan “nu”, want " +
        "K·(P−1)·P + K·P·(1−P) = 0. Het DSS is zuiver — meer spelen levert " +
        "vanzelf niets op."
      : !isKnockoutPage()
      ? "Elke wedstrijd apart gerekend vanaf de nu getoonde rating en daarna " +
        "opgeteld. Alleen in een afvalschema ligt de volgorde van de wedstrijden " +
        "vast; hier niet, en dan zou doorstapelen getallen opleveren die nergens " +
        "op slaan. Is dit toernooi al verwerkt door de KNLTB, dan zit het " +
        "resultaat al in die startwaarde en telt deze berekening het dubbel."
      : "Chronologisch doorgerekend vanaf de nu getoonde rating. Is dit toernooi al " +
        "verwerkt door de KNLTB, dan zit het resultaat al in die startwaarde en telt " +
        "deze berekening het dubbel.";
    return note;
  }

  /* Overzichtspaneel: stand na de gespeelde rondes + wat er nog op het spel staat. */
  function renderSummary(rows, pendingCount, heading) {
    if (!settings.showSummary || summaryClosed) return;
    document.getElementById("knltb-summary")?.remove();

    const box = document.createElement("div");
    box.id = "knltb-summary";
    box.className = "knltb-summary";

    const head = document.createElement("div");
    head.className = "knltb-summary__head";
    head.append(heading || "Doorgerekend");

    if (picks.size) {
      const reset = document.createElement("button");
      reset.className = "knltb-summary__reset";
      reset.textContent = picks.size + " gekozen · herstel";
      reset.title = "alle zelfgekozen uitslagen terugnemen";
      reset.addEventListener("click", () => {
        picks.clear();
        rerunDeltas();
      });
      head.appendChild(reset);
    }

    const close = document.createElement("button");
    close.className = "knltb-summary__close";
    close.textContent = "×";
    close.title = "sluiten";
    close.addEventListener("click", () => {
      summaryClosed = true; // anders staat hij er bij de eerstvolgende scan weer
      box.remove();
    });
    head.appendChild(close);
    box.appendChild(head);

    /* Sterkste, mediaan en zwakste horen binnen één discipline te blijven:
       een enkelrating van 6,2 en een dubbelrating van 6,2 zijn niet dezelfde
       maat, dus een mediaan over allebei is een getal zonder betekenis. Staan
       er meer disciplines op de pagina, dan pakken we die waar jij in zit —
       en anders de grootste. `rank` en `fieldSize` werden al per discipline
       bepaald, dus die sloten hier niet op aan. */
    const perDisc = new Map();
    for (const r of rows) {
      if (!perDisc.has(r.disc)) perDisc.set(r.disc, []);
      perDisc.get(r.disc).push(r);
    }
    const veld =
      [...perDisc.values()].sort(
        (a, b) =>
          (b.some((r) => r.isSelf) ? 1 : 0) - (a.some((r) => r.isSelf) ? 1 : 0) ||
          b.length - a.length
      )[0] || rows;

    const me = veld.find((r) => r.isSelf);

    /* Wat doet een partij tegen elke afzonderlijke tegenstander met jouw
       rating? Bij een dubbelonderdeel bestaat "jij tegen hem" strikt genomen
       niet, dus rekenen we alsof beide kanten een partner van gelijke sterkte
       hebben — dat is precies wat teamrating = ½r + ½r oplevert. */
    /* Bij dubbel moet er aan béíde kanten een koppel staan, anders kiest
       DSS.match de enkel-q (1,824 in plaats van 2,012) en klopt zowel de
       winstkans als de mutatie niet. Eén bekende rating vullen we dan aan
       met zichzelf — precies het "partner van gelijke sterkte"-model dat
       onderaan het paneel beloofd wordt. */
    const asTeam = (r) => {
      const v = r.ratings && r.ratings.length ? r.ratings : [r.start];
      return r.disc === "D" && v.length === 1 ? [v[0], v[0]] : v;
    };

    const versus = (opponent) => {
      if (!me || !opponent || opponent === me) return null;
      const mine = asTeam(me);
      const theirs = asTeam(opponent);
      if (mine.length !== theirs.length) return null;
      return DSS.match(mine, theirs).a;
    };

    const stats = fieldStats(veld);
    if (stats) {
      const field = document.createElement("div");
      field.className = "knltb-summary__field";
      field.textContent =
        stats.n + " spelers" +
        (perDisc.size > 1 ? " (" + (veld[0].disc === "D" ? "dubbel" : "enkel") + ")" : "") +
        " · sterkste " + f4(stats.best) +
        " · mediaan " + f4(stats.median) + " · zwakste " + f4(stats.worst);
      if (me) {
        field.textContent += "  ·  jij " + me.rank + "e" + (me.virtual ? " (niet ingeschreven)" : "");

        // tegen de mediaan van dit veld: wat win of verlies je
        const vs = DSS.match(asTeam(me), asTeam({ disc: me.disc, start: stats.median }));
        field.textContent +=
          "  ·  tegen mediaan " + signed(vs.a.onWin) + " / " + signed(vs.a.onLoss);
        field.title =
          "Je staat " + me.rank + "e van " + me.fieldSize + " op sterkte.\n" +
          (me.rank <= me.fieldSize / 3
            ? "Onderin het veld: je bent in de meeste partijen favoriet, dus je wint weinig en riskeert veel."
            : me.rank >= (me.fieldSize * 2) / 3
            ? "Bovenin het veld: je bent vaak underdog, dus winst levert veel op en verlies kost weinig."
            : "Middenin het veld.");
      }
      box.appendChild(field);

      // in het dubbel bepaalt je partner de helft van de teamrating, dus
      // laat hem invullen in plaats van een aanname op te leggen
      if (me && me.virtual && me.disc === "D" && me.ratings && redrawField) box.appendChild(partnerInput(me));
    }

    // wat er in de kolommen komt: de scenario's zolang er nog gespeeld
    // wordt, anders het kale veld, anders start en stand
    const mode =
      pendingCount > 0
        ? "scenarios"
        : rows.every((r) => r.played === 0 && r.todo === 0)
        ? "field"
        : "played";

    box.appendChild(summaryTable(rows, mode, versus));
    box.appendChild(summaryNote(rows, mode));

    document.body.appendChild(box);
  }

  /**
   * Zet onze eigen uitkomst naast die van de KNLTB, in dezelfde kopregel.
   * Bedoeld om te kúnnen zien dat het klopt — niet om iets toe te voegen
   * wat de site al zegt.
   */
  function addCheckBadge(block, ours, official, andersom, won) {
    if (!settings.showCheck) return;

    const host = block.querySelector(".match__header-aside");
    if (!host || host.querySelector(".knltb-check")) return;

    const gelijk =
      Math.abs(Math.abs(ours) - Math.abs(official)) < 5e-5 && ours * official > 0;

    const el = document.createElement("span");
    el.className = "knltb-check " + (gelijk ? "ok" : "bad");
    el.textContent = signed(ours) + (gelijk ? " \u2713" : " \u2717");
    el.title = gelijk
      ? "Zelf berekend: " + signed(ours) +
        "\nKNLTB toont: " + signed(official) +
        "\nGelijk tot op vier decimalen."
      : "Zelf berekend: " + signed(ours) +
        "\nKNLTB toont: " + signed(official) +
        "\nVerschil: " + signed(ours - official) +
        "\n\nWijst op andere invoer (ratings van een ander moment) of op een" +
        " geval dat het DSS anders behandelt, zoals een walkover.";

    host.appendChild(el);

    /* Wat het geworden was bij de andere uitslag. Stond al in de tooltip,
       maar dit is nou juist het getal dat je wilt zien: het laat zien hoe
       scheef winst en verlies verdeeld zijn in deze wedstrijd. */
    if (andersom != null && isFinite(andersom)) {
      const alt = document.createElement("span");
      alt.className = "knltb-alt";
      alt.textContent = (won ? "verlies " : "winst ") + signed(andersom);
      alt.title =
        "Was het andersom gelopen, dan was de mutatie " + signed(andersom) + " geweest.\n" +
        "Werkelijk: " + signed(ours) + " (" + (won ? "gewonnen" : "verloren") + ").\n\n" +
        "Winst en verlies wegen zelden even zwaar: als favoriet win je weinig " +
        "en verlies je veel, als underdog precies andersom.";
      host.appendChild(alt);
    }
  }

  /**
   * Toont bij een gespeelde wedstrijd de stand vóór en ná, in de badge die
   * al achter de naam staat: 8,7838 → 8,5861.
   *
   * De huidige rating verdwijnt daarmee niet — die blijft in de tooltip en
   * in het paneel rechtsonder, en wordt hier bewaard zodat een hertekening
   * niet voortborduurt op een al aangepaste weergave.
   */
  function showStep(speler, disc, voor, na, vanafStart) {
    const host = speler.tagHost || speler.anchor;
    if (!settings.showSteps || !host) return;
    if (paginaSoort().stappen === false) return;

    const tags = host.querySelector(".knltb-tags");
    if (!tags) return;

    const tag = tags.querySelector(
      disc === "D" ? ".knltb-tag--double" : ".knltb-tag--single"
    );
    const veld = tag && tag.querySelector(".v");
    if (!veld) return;

    if (!veld.dataset.live) veld.dataset.live = veld.textContent;
    const live = veld.dataset.live;

    veld.textContent = f4(voor) + " → " + f4(na);
    tag.classList.add("step");
    tag.classList.toggle("up", na < voor - 1e-9);
    tag.classList.toggle("down", na > voor + 1e-9);

    tag.title =
      speler.name + " — " + (disc === "D" ? "dubbel" : "enkel") +
      "\nin deze wedstrijd: " + f4(voor) + " → " + f4(na) + " (" + signed(na - voor) + ")" +
      (vanafStart != null && Math.abs(vanafStart) > 1e-9
        ? "\nover dit toernooi tot nu toe: " + signed(vanafStart)
        : "") +
      "\nhuidige rating volgens het profiel: " + live;
  }

  /**
   * Nog niet gespeelde wedstrijd: er is geen mutatie te tonen, maar wél de
   * rating waarmee de speler deze ronde ingaat. Dat is na een gewonnen
   * eerdere ronde niet zijn live rating meer — en juist dat maakt zichtbaar
   * dat de rondes doortellen.
   */
  function showCarried(speler, disc, nu) {
    const host = speler.tagHost || speler.anchor;
    if (!settings.showSteps || !host) return;
    if (paginaSoort().stappen === false) return;

    const tags = host.querySelector(".knltb-tags");
    const tag = tags && tags.querySelector(
      disc === "D" ? ".knltb-tag--double" : ".knltb-tag--single"
    );
    const veld = tag && tag.querySelector(".v");
    if (!veld) return;

    if (!veld.dataset.live) veld.dataset.live = veld.textContent;
    const live = veld.dataset.live;

    const verschoven = Math.abs(nu - speler.start) > 1e-9;
    veld.textContent = f4(nu);
    tag.classList.add("step", "carried");
    tag.classList.remove("up", "down");

    tag.title =
      speler.name + " — " + (disc === "D" ? "dubbel" : "enkel") +
      "\ngaat deze ronde in met " + f4(nu) +
      (verschoven
        ? "\nbijgesteld na eerdere rondes van dit toernooi (" + signed(nu - speler.start) + ")"
        : "\nnog ongewijzigd dit toernooi") +
      "\nhuidige rating volgens het profiel: " + live;
  }

  let deltaTimer = null;
  function scheduleDeltas() {
    clearTimeout(deltaTimer);
    // volledig opnieuw, niet incrementeel: de doorrekening moet altijd
    // over álle wedstrijden lopen, anders start een later binnengekomen
    // ronde vanaf de beginrating in plaats van de meelopende stand
    deltaTimer = setTimeout(rerunDeltas, 150);
  }

  // ---------------------------------------------------------------- observer

  let debounceTimer = null;
  let debounceSince = 0;

  function scheduleScan() {
    const now = Date.now();
    if (!debounceSince) debounceSince = now;

    // op een pagina die blijft bewegen (swiper-animaties) niet eindeloos
    // uitstellen: na 2 seconden gewoon een keer draaien
    if (now - debounceSince > 2000) {
      clearTimeout(debounceTimer);
      debounceSince = 0;
      processLinks();
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceSince = 0;
      processLinks();
    }, 400);
  }

  /** Is dit iets wat wij zelf hebben ingevoegd? */
  function isOwnNode(n) {
    if (n.nodeType !== 1) return true; // tekst in onze eigen badges
    if (n.id === "knltb-summary") return true;
    return n.classList && [...n.classList].some((c) => c.startsWith("knltb-"));
  }

  let observerRoot = null;

  function start() {
    processLinks();

    observerRoot = new MutationObserver((muts) => {
      for (const m of muts) {
        if (!m.addedNodes || !m.addedNodes.length) continue;
        // eigen invoegingen niet als paginawijziging tellen, anders
        // trapt de extensie zichzelf onophoudelijk opnieuw af
        if ([...m.addedNodes].every(isOwnNode)) continue;
        scheduleScan();
        return;
      }
    });

    observerRoot.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  /* ---------------------------------------------------------------
     Ratingverloop op een profielpagina
     --------------------------------------------------------------- */

  const PROFILE_PATH = new RegExp("^/player-profile/" + UUID + "/?$", "i");

  async function showHistory() {
    if (!settings.enabled || !settings.showHistory) return;
    if (document.getElementById("knltb-history")) return;

    const m = location.pathname.match(PROFILE_PATH);
    if (!m) return;

    const url = location.origin + "/player-profile/" + m[1] + "/Rating";

    let doc;
    try {
      doc = await enqueue(() => fetchDoc(url, false));
    } catch (e) {
      log("verloop ophalen mislukt:", e.message);
      return;
    }
    if (!doc) return;

    const seas = History.season(doc);
    const hist = History.parse(doc);
    if (!seas && !hist) {
      log("geen verloop gevonden op", url);
      return;
    }

    renderHistory(seas, hist, url);
  }

  function renderHistory(seas, hist, url) {
    const host =
      document.querySelector("#mediaContentSubinfo") ||
      document.querySelector(".page-head .media__content");
    if (!host) return;

    const box = document.createElement("div");
    box.id = "knltb-history";
    box.className = "knltb-history";

    // echte reeks? dan een lijntje. Anders het seizoensoverzicht, dat
    // inhoudelijk meer zegt dan een grafiek van twee punten.
    if (hist && hist.values.length > 2) {
      const first = hist.values[0];
      const last = hist.values[hist.values.length - 1];
      const spark = History.sparkline(hist.values, { width: 150, height: 30 });
      spark.classList.add(last < first ? "gain" : last > first ? "drop" : "flat");
      box.appendChild(spark);
    }

    for (const [key, label] of [["single", "E"], ["double", "D"]]) {
      const s = seas && seas[key];
      if (!s) continue;

      const el = document.createElement("span");
      el.className = "knltb-history__label";
      el.textContent =
        label + " " + f4(s.start) + " → " + f4(s.now) + " " + signed(s.now - s.start);
      el.title =
        (key === "single" ? "Enkel" : "Dubbel") +
        " dit seizoen\nstartrating " + f4(s.start) +
        "\nnu " + f4(s.now) + " (speelsterkte " + s.level + ")" +
        "\n" + s.played + " wedstrijden meegeteld" +
        "\n\nbron: " + url;
      box.appendChild(el);
    }

    if (!box.childNodes.length) return;
    host.appendChild(box);
  }

  /* Knop naar het volledige dashboard. Het content script mag zelf geen
     tabblad openen, dus dat vraagt hij aan de service worker. */
  function addDashboardButton() {
    if (!settings.enabled) return;
    if (document.getElementById("knltb-dash-btn")) return;
    if (!document.body) return;

    const btn = document.createElement("button");
    btn.id = "knltb-dash-btn";
    btn.className = "knltb-dash-btn";
    btn.type = "button";
    btn.textContent = "Dashboard";
    btn.title = "Deze pagina openen in het volledige dashboard";

    btn.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: "openDashboard",
        query: "?url=" + encodeURIComponent(location.href),
      });
    });

    document.body.appendChild(btn);
  }

  // ---------------------------------------------------------------- messages

  /**
   * Alles wat de extensie op de pagina heeft gezet weer weghalen en de
   * boekhouding leegmaken, zodat een volgende `processLinks()` van voren af
   * aan begint. Wordt gebruikt door "opnieuw scannen", door het uitzetten
   * van de extensie en door instellingen die de badges zelf veranderen.
   */
  function resetPage() {
    document.querySelectorAll("[data-knltb-done]").forEach((el) => delete el.dataset.knltbDone);
    document
      .querySelectorAll(
        ".knltb-tags, .knltb-delta, .knltb-odds, .knltb-check, .knltb-alt, .knltb-regel"
      )
      .forEach((el) => el.remove());
    clearProjected();
    document.getElementById("knltb-summary")?.remove();
    document.querySelectorAll("[data-knltb-delta]").forEach((el) => delete el.dataset.knltbDelta);
    document.querySelectorAll("[data-knltb-gezien]").forEach((el) => delete el.dataset.knltbGezien);
    document.querySelectorAll("[data-knltb-proj]").forEach((el) => delete el.dataset.knltbProj);
    document.querySelectorAll(".knltb-hypothetisch").forEach((el) =>
      el.classList.remove("knltb-hypothetisch")
    );
    document.querySelectorAll(".knltb-heeft-regel").forEach((el) =>
      el.classList.remove("knltb-heeft-regel")
    );
    document.querySelectorAll("[data-knltb-name]").forEach((el) => delete el.dataset.knltbName);
    picks.clear();
    entryTable = null;
    entryAnchors.clear();
    ratedAnchors.clear();
    summaryClosed = false;
    registry.length = 0;
    laatsteScan = null;
    loggedOut = false;
  }

  /** Het ratingverloop en de dashboardknop staan buiten de wedstrijden om. */
  function removeExtras() {
    document.getElementById("knltb-history")?.remove();
    document.getElementById("knltb-dash-btn")?.remove();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "rescan") {
      resetPage();
      const gevonden = processLinks();

      /* Terugmelden wat er gebeurd is. Zonder dit lijkt de knop niets te
         doen: de badges worden opnieuw opgebouwd met dezelfde waarden, dus
         de pagina ziet er achteraf identiek uit. */
      setTimeout(() => {
        sendResponse({
          ok: true,
          spelers: laatsteScan ? laatsteScan.spelers : gevonden || 0,
          uitCache: laatsteScan ? laatsteScan.uitCache : 0,
          ophalen: laatsteScan ? laatsteScan.ophalen : 0,
          tags: document.querySelectorAll(".knltb-tags").length,
          chips: document.querySelectorAll(".knltb-delta").length,
        });
      }, 250);
      return true; // antwoord komt zo
    }

    if (msg.type === "settings") {
      const vorige = settings;
      settings = { ...settings, ...msg.settings };

      /* Een vinkje uitzetten moet meteen zichtbaar zijn. Welke weg dat
         neemt hangt af van wát er verandert:

           TEKENVLAGGEN  raken alleen de wedstrijden — chips, winstkansen,
                         stappen, paneel. `rerunDeltas` tekent die opnieuw.
           TAGVLAGGEN    raken de badges achter de namen zelf, en die worden
                         uitsluitend in `processLinks`/`renderTags` gemaakt.
                         `rerunDeltas` komt daar niet, dus die vlaggen leken
                         niets te doen; ze moeten via een volledige opbouw.

         De ratings komen daarbij uit de cache, dus er gaat geen extra
         verkeer naar de site. */
      const TEKENVLAGGEN = [
        "showDelta", "showOdds", "showSteps", "showCheck", "showSummary",
        "showMeInField", "chainTournament",
      ];
      const TAGVLAGGEN = ["showSingle", "showDouble", "hideWhenNoRating", "allowGuess"];
      const gewijzigd = (lijst) => lijst.some((k) => vorige[k] !== settings[k]);

      if (settings.showSummary && !vorige.showSummary) summaryClosed = false;
      if (!settings.showSummary) document.getElementById("knltb-summary")?.remove();

      if (vorige.showHistory !== settings.showHistory) {
        document.getElementById("knltb-history")?.remove();
        if (settings.showHistory) showHistory();
      }

      if (vorige.enabled !== settings.enabled) {
        /* Uit betekende tot nu toe alleen "geen nieuwe ratings ophalen":
           het ratingverloop, de dashboardknop en alles wat er al stond
           bleven gewoon staan. Uit is nu ook echt uit. */
        resetPage();
        if (settings.enabled) {
          showHistory();
          addDashboardButton();
          processLinks();
        } else {
          removeExtras();
        }
      } else if (!settings.enabled) {
        // niets te tekenen zolang de extensie uit staat
      } else if (gewijzigd(TAGVLAGGEN)) {
        resetPage();
        processLinks();
      } else if (gewijzigd(TEKENVLAGGEN)) {
        rerunDeltas();
      }

      sendResponse({ ok: true });
      return;
    }

    /* Wat doet de extensie op déze pagina? De popup laat dit meteen zien,
       zodat je niet hoeft te raden of hij hier iets doet en waarom wel of
       niet. Alles komt uit dezelfde bron als het gedrag zelf. */
    if (msg.type === "status") {
      const soort = paginaSoort();
      sendResponse({
        ok: true,
        aan: !!settings.enabled,
        soort: soort.sleutel,
        naam: soort.naam,
        ophalen: soort.ophalen,
        waarom: soort.waarom || null,
        gezien: laatsteScan || null,
        nu: {
          badges: document.querySelectorAll(".knltb-tag").length,
          mutaties: document.querySelectorAll(".knltb-delta").length,
          winstkansen: document.querySelectorAll(".knltb-odds").length,
          paneel: !!document.getElementById("knltb-summary"),
          verloop: !!document.getElementById("knltb-history"),
        },
      });
      return;
    }

    if (msg.type === "diagnose") {
      Diagnose.run(
        {
          registry, ratedAnchors, ratingOf, playerIdFromHref,
          parsePlayerDoc, subjectOfPage, officialDelta, isWalkover,
          collectMatches, isDrawPage, projectBrackets,
        },
        msg.url
      ).then(sendResponse);
      return true; // async
    }
  });

  // ---------------------------------------------------------------- boot

  Site.store.get("settings").then((obj) => {
    settings = { ...DEFAULTS, ...(obj.settings || {}) };

    /* Elk onderdeel apart afschermen. Eerder stond hier een rechte reeks
       aanroepen, en toen één daarvan door een refactor verdween liep het
       opstarten stuk vóór start() — waardoor de hele extensie zweeg zonder
       dat er iets op de pagina te zien was. Eén kapot onderdeel mag de rest
       niet meeslepen — ook niet als het asynchroon is en pas later omvalt. */
    const veilig = (naam, fn) =>
      Promise.resolve()
        .then(fn)
        .catch((e) => console.error("[KNLTB] " + naam + " mislukt:", e));

    veilig("cache opruimen", pruneCache);
    veilig("eigen profiel vastleggen", rememberSelf);
    veilig("ratingverloop", showHistory);
    veilig("dashboardknop", addDashboardButton);
    veilig("scannen", start);
  });
})();
