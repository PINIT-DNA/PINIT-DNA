/** adobe_portfolio — PlatformAdapter (photographer / design pack). */
(function () {
  if (window.__PINIT_AP_ADAPTER__) return;
  window.__PINIT_AP_ADAPTER__ = true;
  window.__PINIT_EXPORT_PLATFORM__ = 'adobe_portfolio';
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before adobe_portfolio.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('adobe_portfolio', { supportsRealtime: false, acceptAll: true });
  console.info('[PinIT] adobe_portfolio Publish Guardian adapter active');
})();
