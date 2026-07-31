/**
 * YouTube Studio MAIN-world hook (document_start).
 *
 * Content scripts run in an isolated world and cannot see closed Shadow DOM
 * or patch the page's HTMLInputElement.prototype. This script runs in the
 * page's JS world so Studio's own file inputs (often inside Polymer/Lit
 * shadow trees) are still intercepted when clicked / changed / shown.
 *
 * Captured Files are postMessage'd to the isolated adapter (youtube.js).
 */
(function () {
  if (window.__PINIT_YT_MAIN_HOOK__) return;
  window.__PINIT_YT_MAIN_HOOK__ = true;

  const SOURCE = 'pinit-yt-main';

  function emit(stage, detail) {
    try {
      window.postMessage(
        {
          source: SOURCE,
          stage,
          detail: detail || null,
          at: Date.now(),
          href: location.href,
        },
        '*',
      );
    } catch {
      /* ignore */
    }
  }

  function emitFiles(files, via, inputMeta) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    try {
      window.postMessage(
        {
          source: SOURCE,
          stage: 'main.file_selected',
          via,
          inputMeta: inputMeta || null,
          files: list,
          at: Date.now(),
          href: location.href,
        },
        '*',
      );
    } catch (err) {
      emit('main.file_post_failed', {
        via,
        error: String(err && err.message ? err.message : err),
      });
    }
  }

  function describeInput(input) {
    let inShadow = false;
    try {
      inShadow = !!(input.getRootNode && input.getRootNode() instanceof ShadowRoot);
    } catch {
      /* ignore */
    }
    return {
      accept: input.accept || '',
      multiple: !!input.multiple,
      id: input.id || '',
      name: input.name || '',
      inShadow,
    };
  }

  function attachInput(input, reason) {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type && input.type !== 'file') return;
    if (input.__pinitMainHooked) return;
    input.__pinitMainHooked = true;
    input.addEventListener(
      'change',
      function () {
        emit('main.input_change', { ...describeInput(input), reason });
        emitFiles(input.files, 'main_change_' + reason, describeInput(input));
      },
      true,
    );
    emit('main.file_input_hooked', { ...describeInput(input), reason });
  }

  // Patch click — Studio buttons often call input.click()
  const origClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function (...args) {
    try {
      if (!this.type || this.type === 'file') attachInput(this, 'click');
    } catch {
      /* ignore */
    }
    return origClick.apply(this, args);
  };

  // Patch showPicker (Chromium)
  if (typeof HTMLInputElement.prototype.showPicker === 'function') {
    const origPicker = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function (...args) {
      try {
        if (!this.type || this.type === 'file') attachInput(this, 'showPicker');
      } catch {
        /* ignore */
      }
      return origPicker.apply(this, args);
    };
  }

  // When Studio attaches its own change listener, hook the same input
  const origAEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    try {
      if (
        type === 'change' &&
        this instanceof HTMLInputElement &&
        (!this.type || this.type === 'file')
      ) {
        attachInput(this, 'page_addEventListener');
      }
    } catch {
      /* ignore */
    }
    return origAEL.call(this, type, listener, options);
  };

  // Drop zones often set files programmatically then dispatch change
  document.addEventListener(
    'drop',
    function (e) {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) {
        emit('main.drop_detected', { count: files.length });
        emitFiles(files, 'main_drop', null);
      }
    },
    true,
  );

  // Deep scan open shadow from MAIN world (same visibility as page scripts)
  function collectFileInputs(root, out, depth) {
    if (!root || depth > 40) return;
    try {
      root.querySelectorAll?.('input[type="file"]').forEach((el) => out.push(el));
      root.querySelectorAll?.('*').forEach((el) => {
        if (el.shadowRoot) collectFileInputs(el.shadowRoot, out, depth + 1);
      });
    } catch {
      /* ignore */
    }
  }

  function scan(reason) {
    const inputs = [];
    collectFileInputs(document, inputs, 0);
    let hooked = 0;
    for (const input of inputs) {
      if (!input.__pinitMainHooked) {
        attachInput(input, reason);
        hooked += 1;
      }
    }
    const dialogs = document.querySelectorAll(
      'ytcp-uploads-dialog, ytcp-upload-dialog, ytcp-upload-file-picker, tp-yt-paper-dialog',
    );
    emit('main.dom_probe', {
      reason,
      fileInputCount: inputs.length,
      newlyHooked: hooked,
      dialogHostCount: dialogs.length,
      iframeCount: document.querySelectorAll('iframe').length,
      href: location.href,
    });
  }

  emit('main.hook_installed', { href: location.href });
  if (document.documentElement) {
    scan('main_init');
    setTimeout(() => scan('main_t+500ms'), 500);
    setTimeout(() => scan('main_t+2s'), 2000);
    setTimeout(() => scan('main_t+5s'), 5000);
    setInterval(() => scan('main_interval_10s'), 10000);
    try {
      const mo = new MutationObserver(() => {
        if (scan._t) return;
        scan._t = setTimeout(() => {
          scan._t = null;
          scan('main_mutation');
        }, 300);
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }
  }
})();
