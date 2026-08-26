/* Alleen nodig om een nieuw tabblad te openen.
 *
 * Een content script mag zelf geen tabbladen maken, dus vraagt het dat hier
 * aan. Zo hoeft de dashboardpagina ook niet web_accessible te zijn.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "openDashboard") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard.html" + (msg.query || "")),
    });
    sendResponse({ ok: true });
    return true;
  }
});
