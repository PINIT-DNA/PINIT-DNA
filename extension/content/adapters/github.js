/** GitHub — Creator Mode when attaching/uploading files (not repo browsing alone). */
(function () {
  if (window.__PINIT_GH_ADAPTER__) return;
  window.__PINIT_GH_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before github.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('github', {
    supportsRealtime: false,
    acceptAll: true,
    platformType: 'business',
    detectPublishContext() {
      // Upload/release/issue comment attach surfaces
      return (
        PinITAdapter.pathMatches([
          /\/(upload|releases\/new|releases\/edit)/i,
          /\/(issues\/new|pull\/new|compare)/i,
          /\/(wiki|_edit)/i,
          /\/settings\/(pages|secrets)/i,
        ]) ||
        PinITAdapter.hasComposerDialog([
          'attach files',
          'upload files',
          'drop files',
          'choose your files',
          'commit changes',
        ]) ||
        // Comment compose box with file input present on issue/PR pages
        (/\/(issues|pull)\//i.test(location.pathname) &&
          !!document.querySelector('file-attachment, input[type="file"]'))
      );
    },
  });
  console.info('[PinIT] GitHub adapter active (creator-gated)');
})();
