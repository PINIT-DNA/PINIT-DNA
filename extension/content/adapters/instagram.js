/**
 * Instagram Web — Publish Guardian adapter (PlatformAdapter contract).
 * Creator Mode only: create/compose surfaces. Feed / Reels browsing = Viewer Mode.
 * Captures original bytes from file inputs (does NOT block Instagram upload).
 */
(function () {
  if (window.__PINIT_IG_ADAPTER__) return;
  window.__PINIT_IG_ADAPTER__ = true;

  const PLATFORM = 'instagram';

  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before instagram.js');
    return;
  }

  function isInstagramCreateSurface() {
    const path = location.pathname || '';
    // Explicit create routes
    if (PinITAdapter.pathMatches([/\/create(\/|$)/i, /\/stories\/create/i])) return true;
    // Compose dialog opened from any page (Create → New post / Reel / Story)
    if (
      PinITAdapter.hasComposerDialog([
        'new post',
        'new reel',
        'new story',
        'create new',
        'crop',
        'edit',
        'share',
      ])
    ) {
      return true;
    }
    // Never treat feed / explore / profile browsing as creator intent
    if (/^\/(explore|reels|stories|direct|accounts)\b/i.test(path)) return false;
    return false;
  }

  PinITAdapter.createFileInputAdapter(PLATFORM, {
    supportsRealtime: false,
    platformType: 'social',
    detectPublishContext: isInstagramCreateSurface,
    ownerAccount() {
      return location.pathname.split('/').filter(Boolean)[0] || null;
    },
    profileUrl() {
      const owner = location.pathname.split('/').filter(Boolean)[0];
      return owner ? `https://www.instagram.com/${owner}/` : null;
    },
    getPostUrl() {
      const link = document.querySelector('a[href*="/p/"], a[href*="/reel/"]');
      return link?.href || null;
    },
  });

  // Late post URL registration when permalink becomes available
  const obs = new MutationObserver(() => {
    const link = document.querySelector('a[href*="/p/"], a[href*="/reel/"]');
    if (!link) return;
    const href = link.href;
    chrome.storage.local.get(['lastProtect'], (data) => {
      const last = data.lastProtect;
      if (!last?.vaultId || last.postUrl) return;
      if (Date.now() - (last.at || 0) > 10 * 60 * 1000) return;
      chrome.runtime.sendMessage({
        type: 'REGISTER_POST',
        payload: {
          vaultId: last.vaultId,
          protectedPostId: last.protectedPostId,
          platform: PLATFORM,
          postUrl: href,
        },
      });
    });
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  console.info('[PinIT] Instagram Publish Guardian adapter active (creator-gated)');
})();
