/** WordPress media library upload — Creator Mode inside wp-admin upload surfaces. */
(function () {
  if (window.__PINIT_WP_ADAPTER__) return;
  window.__PINIT_WP_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before wordpress.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('wordpress', {
    supportsRealtime: false,
    acceptAll: false,
    platformType: 'business',
    detectPublishContext() {
      // Manifest already scopes to wp-admin; further narrow to media/post editors
      return (
        PinITAdapter.pathMatches([
          /wp-admin\/(upload\.php|media-new\.php|post(-new)?\.php|post\.php|edit\.php)/i,
          /wp-admin\/admin\.php\?page=.*media/i,
        ]) ||
        PinITAdapter.hasComposerDialog(['upload files', 'media library', 'select files', 'insert media'])
      );
    },
  });
  console.info('[PinIT] wordpress Publish Guardian adapter active (creator-gated)');
})();
