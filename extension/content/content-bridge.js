/**
 * Shared content-bridge — right-click helpers and page metadata.
 * Platform-specific adapters handle Publish Guardian capture.
 */

(function () {
  if (window.__PINIT_CONTENT_BRIDGE__) return;
  window.__PINIT_CONTENT_BRIDGE__ = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'GET_PAGE_META') {
      sendResponse({
        ok: true,
        pageUrl: location.href,
        pageTitle: document.title,
      });
      return;
    }
    return false;
  });
})();
