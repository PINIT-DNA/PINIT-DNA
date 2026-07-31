/** Shopify Admin product media — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_SH_ADAPTER__) return;
  window.__PINIT_SH_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before shopify.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('shopify', {
    supportsRealtime: false,
    acceptAll: false,
  });
  console.info('[PinIT] shopify Publish Guardian adapter active');
})();
