/* Gedeeld door content script, dashboard en popup: waar de site staat, hoe
 * een profiel-URL eruitziet, de standaardinstellingen, de helpers die elk
 * script eerst zelf had, en de opslag als promises. Drie plekken lazen
 * dezelfde dingen op hun eigen manier; nu staat het hier één keer.
 */

const Site = (() => {
  "use strict";

  const ORIGIN = "https://mijnknltb.toernooi.nl";
  const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
  const UUID_ONLY = new RegExp("^" + UUID + "$", "i");
  const CACHE_KEY_RE = new RegExp("^(.*/player-profile/)" + UUID + "(.*)$", "i");

  const DEFAULTS = {
    enabled: true,
    showSingle: true,
    showDouble: true,
    hideWhenNoRating: true, // badge weghalen als het geen speler blijkt
    allowGuess: false, // "geraden" ratings tonen (label niet herkend)
    showDelta: true, // rating-mutatie bij winst/verlies tonen (DSS)
    showHistory: true, // ratingverloop op je profielpagina
    showCheck: true, // eigen som naast die van de KNLTB (Rating-tabblad)
    showSteps: true, // in een gespeelde wedstrijd de stand vóór en ná tonen
    showSummary: true, // het paneel rechtsonder met de doorrekening
    showOdds: true, // winstkans per kant als badge bij de wedstrijd
    showMeInField: true, // jezelf in een veld zetten waar je niet in staat
    partnerRating: null, // dubbelpartner om mee te rekenen (leeg = gelijke sterkte)
    partnerName: null, // naam erbij, als hij via een link is opgezocht
    chainTournament: true, // rondes van een toernooi op elkaar stapelen
    debug: false,

    // Alleen ophalen als je met de muis over een naam gaat.
    // Uit = ophalen zodra de naam in beeld scrolt.
    hoverOnly: false,

    maxLinksPerPage: 200,
    // 6 = precies wat een browser zelf per host openzet bij een paginaload.
    concurrency: 6,
    requestDelayMs: 0, // geen kunstmatige pauze
    maxPerMinute: 60, // vangnet, geen rem bij normaal gebruik
    // Ratings worden bijgewerkt zodra een toernooi is afgerond, en dat moment
    // is van buitenaf niet te zien. Daarom kort: binnen een sessie scheelt het
    // alle herhaling, en morgen kijkt hij gewoon opnieuw.
    cacheTtlHours: 8,
  };

  /* Zelfde als Parse.norm, maar Site laadt vóór Parse en de popup laadt
     Parse helemaal niet — dus hier zijn eigen regel. */
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

  const f4 = (n) => (n == null || !isFinite(n) ? "—" : n.toFixed(4).replace(".", ","));
  const signed = (n) =>
    (n > 1e-9 ? "+" : n < -1e-9 ? "−" : "±") + Math.abs(n).toFixed(4).replace(".", ",");

  /** Alleen deze pagina's zijn een betrouwbare bron voor een rating. */
  const PROFILE_URL_RE = /\/player-profile\/[0-9a-f-]{36}/i;
  const MEMBER_URL_RE = /\/player\/[0-9a-f-]{36}\/[A-Za-z0-9+/=]{8,}/i;
  const isProfileUrl = (url) => PROFILE_URL_RE.test(url) || MEMBER_URL_RE.test(url);

  /* De site is inconsistent met hoofdletters: een link geeft
     /player-profile/13e57c28-… maar een redirect /player-profile/13E57C28-….
     Zelfde speler, dus zelfde cachesleutel. Alleen de uuid normaliseren —
     het base64-token is wél hoofdlettergevoelig. */
  function cacheKey(url) {
    const m = String(url).match(CACHE_KEY_RE);
    return "r:" + (m ? m[1] + m[2].toLowerCase() + m[3] : url);
  }

  /* "Mike Verhaar [2]" en "Mike Verhaar" horen bij elkaar: plaatsingscijfers
     eruit, daarna de spaties opnieuw samentrekken (anders houdt
     "Mike [2] Verhaar" een dubbele spatie over), en niets te vergelijken
     betekent geen bezwaar. */
  function sameName(a, b) {
    const clean = (s) =>
      norm(s)
        .replace(/\[[^\]]*\]/g, "")
        .replace(/[^\p{L}\p{N} ]/gu, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const x = clean(a);
    const y = clean(b);
    if (!x || !y) return true; // niets te vergelijken -> niet zeuren
    return x === y || x.includes(y) || y.includes(x);
  }

  /**
   * Invoer die een speler aanwijst, zoals in het partnerveld en op het
   * dashboard. Een getal is een rating; al het andere is een verwijzing:
   *   https://mijnknltb.toernooi.nl/player-profile/<uuid>
   *   /player-profile/<uuid>   ·   <uuid>
   *   /sport/player.aspx?id=…&player=N
   *   30340969                 (bondsnummer; daar is de organisatiecode
   *                             `org` voor nodig)
   * Geeft { rating } of { url }; de aanroeper haalt de URL zelf op en
   * vertaalt de foutcodes BUITEN_BEREIK, GEEN_ORG, ANDERE_SITE en
   * ONBEGREPEN naar zijn eigen melding. Lege invoer geeft null.
   */
  function parsePlayerInput(text, org) {
    const t = norm(text);
    if (!t) return null;

    // een rating: hooguit twee cijfers voor de komma
    if (/^\d{1,2}([.,]\d{1,4})?$/.test(t)) {
      const v = parseFloat(t.replace(",", "."));
      if (isFinite(v) && v >= 1 && v <= 10) return { rating: v };
      throw new Error("BUITEN_BEREIK");
    }

    if (UUID_ONLY.test(t)) return { url: ORIGIN + "/player-profile/" + t.toLowerCase() };

    /* Een bondsnummer is rechtstreeks om te zetten naar een spelerspagina:
         /player/<org>/<base64 van "base64:<bondsnummer>"> */
    if (/^\d{5,10}$/.test(t)) {
      if (!org) throw new Error("GEEN_ORG");
      return { url: ORIGIN + "/player/" + org + "/" + btoa("base64:" + t) };
    }

    // alleen iets dat op een pad of adres lijkt; losse tekst is geen link
    if (/[/?]/.test(t)) {
      let u;
      try {
        u = new URL(t, ORIGIN);
      } catch {
        throw new Error("ONBEGREPEN");
      }
      if (u.origin !== ORIGIN) throw new Error("ANDERE_SITE");
      return { url: u.href };
    }

    throw new Error("ONBEGREPEN");
  }

  /** Mediaan van een oplopend gesorteerde reeks. */
  function median(vals) {
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  /* Uitgelogd geeft de site geen 401 maar gewoon de loginpagina, status 200.
     Alleen het wachtwoordveld telt: een /login-link in het menu staat ook op
     een vroeg afgebroken lezing zonder rating, en één misser stopt alles. */
  const looksLoggedOut = (html) =>
    /name=["']?password/i.test(html) && !/rating|speelsterkte/i.test(html);

  /* chrome.storage.local met promises. `set` faalt hoorbaar als de opslag vol
     zit; de callback-API meldt dat alleen via runtime.lastError. */
  const local = () => chrome.storage.local;
  let chain = Promise.resolve(); // zie merge
  const store = {
    get: (keys) => new Promise((resolve) => local().get(keys, resolve)),
    set: (obj) =>
      new Promise((resolve, reject) =>
        local().set(obj, () => {
          const err = chrome.runtime && chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        })
      ),
    remove: (keys) => new Promise((resolve) => local().remove(keys, resolve)),
    /* Eén sleutel lezen, aanvullen en terugschrijven — achter elkaar in
       plaats van door elkaar. Twee losse lees-wijzig-schrijf-rondes lazen
       anders allebei de oude stand, en de tweede schreef de eerste weer weg.
       De ketting is per pagina: popup, dashboard en content script hebben
       elk hun eigen, dus die kunnen elkaar nog steeds overschrijven.
       Geeft het opgeslagen object terug. */
    merge: (key, patch) => {
      const work = async () => {
        const cur = (await store.get(key))[key] || {};
        const next = { ...cur, ...patch };
        await store.set({ [key]: next });
        return next;
      };
      const p = chain.then(work);
      // een volle opslag is de zorg van déze aanroeper; de ketting slikt de
      // fout, anders kwam geen enkele merge daarna nog aan de beurt
      chain = p.catch(() => {});
      return p;
    },
  };

  return {
    ORIGIN, UUID, UUID_ONLY, cacheKey, looksLoggedOut, store,
    DEFAULTS, f4, signed, isProfileUrl, sameName, parsePlayerInput, median,
  };
})();

if (typeof module !== "undefined") module.exports = Site;
