/* Gedeeld door content script, dashboard en popup: waar de site staat, hoe
 * een profiel-URL eruitziet, en de opslag als promises. Drie plekken lazen
 * dezelfde dingen op hun eigen manier; nu staat het hier één keer.
 */

const Site = (() => {
  "use strict";

  const ORIGIN = "https://mijnknltb.toernooi.nl";
  const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
  const UUID_ONLY = new RegExp("^" + UUID + "$", "i");
  const CACHE_KEY_RE = new RegExp("^(.*/player-profile/)" + UUID + "(.*)$", "i");

  /* De site is inconsistent met hoofdletters: een link geeft
     /player-profile/13e57c28-… maar een redirect /player-profile/13E57C28-….
     Zelfde speler, dus zelfde cachesleutel. Alleen de uuid normaliseren —
     het base64-token is wél hoofdlettergevoelig. */
  function cacheKey(url) {
    const m = String(url).match(CACHE_KEY_RE);
    return "r:" + (m ? m[1] + m[2].toLowerCase() + m[3] : url);
  }

  /* Uitgelogd geeft de site geen 401 maar gewoon de loginpagina, status 200. */
  const looksLoggedOut = (html) =>
    /name=["']?password|\/login/i.test(html) && !/rating|speelsterkte/i.test(html);

  /* chrome.storage.local met promises. `set` faalt hoorbaar als de opslag vol
     zit; de callback-API meldt dat alleen via runtime.lastError. */
  const local = () => chrome.storage.local;
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
  };

  return { ORIGIN, UUID, UUID_ONLY, cacheKey, looksLoggedOut, store };
})();

if (typeof module !== "undefined") module.exports = Site;
