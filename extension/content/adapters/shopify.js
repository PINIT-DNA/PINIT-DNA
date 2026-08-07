/** Shopify Admin product media — Creator Mode on product/file upload surfaces. */
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
    platformType: 'business',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([
          /\/(products|content|files|themes|online-store)/i,
          /\/(collections|pages|blogs|articles)/i,
        ]) || PinITAdapter.hasComposerDialog(['upload', 'add media', 'add image', 'add files'])
      );
    },
  });
  console.info('[PinIT] shopify Publish Guardian adapter active (creator-gated)');
})();
