/**
 * PinIT Hub popup — classic script (no module) so it always paints UI.
 */

function showError(msg) {
  const box = document.getElementById('error-box');
  if (!box) return;
  if (!msg) {
    box.classList.add('hidden');
    box.textContent = '';
    return;
  }
  box.textContent = msg;
  box.classList.remove('hidden');
}

function send(type, payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, ...(payload || {}) }, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(res || { ok: false, error: 'No response from extension' });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });
}

async function refresh() {
  const signedOut = document.getElementById('signed-out');
  const signedIn = document.getElementById('signed-in');
  const pill = document.getElementById('status-pill');

  const status = await send('GET_STATUS');
  const apiHint = document.getElementById('api-hint');
  if (apiHint) {
    const api = (status && status.config && status.config.apiBaseUrl) || '';
    apiHint.textContent = api
      ? 'API: ' + api
      : 'API not loaded — Reload extension, then open Options and Save.';
  }
  if (!status || status.ok === false && !status.signedIn) {
    // Keep sign-in visible; show hint if background failed
    signedOut.classList.remove('hidden');
    signedIn.classList.add('hidden');
    pill.textContent = 'Signed out';
    pill.className = 'pill muted';
    if (status && status.error) {
      showError('Background not ready — click Reload on edge://extensions, then try again. (' + status.error + ')');
    } else {
      showError('');
    }
    return;
  }

  showError('');

  if (status.signedIn) {
    signedOut.classList.add('hidden');
    signedIn.classList.remove('hidden');
    const degraded = !!(status.lastProtect && status.lastProtect.degraded);
    const hasQueue = status.queue && (status.queue.pending || status.queue.failed);
    if (hasQueue) {
      pill.textContent = 'Queue';
      pill.className = 'pill warn';
    } else if (degraded) {
      pill.textContent = 'Degraded';
      pill.className = 'pill warn';
    } else {
      pill.textContent = 'Connected';
      pill.className = 'pill ok';
    }
    document.getElementById('user-id').textContent = (status.user && status.user.shortId) || 'PinIT user';

    const health = document.getElementById('health-card');
    if (health) {
      health.classList.remove('hidden');
      const h = status.health || {};
      const online = h.online === false ? 'Offline' : 'Online';
      health.innerHTML =
        '<strong>Extension health</strong><br/>v' +
        (status.version || h.version || '?') +
        ' · ' + online +
        ' · Queue P' + (status.queue && status.queue.pending != null ? status.queue.pending : 0) +
        '/F' + (status.queue && status.queue.failed != null ? status.queue.failed : 0);
    }

    const lp = document.getElementById('last-protect');
    if (status.lastProtect) {
      lp.classList.remove('hidden');
      const lpData = status.lastProtect;
      const parts = [
        lpData.platform || 'web',
        lpData.pageUrl ? 'page linked' : null,
        lpData.postUrl ? 'public URL' : 'URL pending',
        lpData.certificateId || lpData.vaultId || (lpData.error ? 'error' : 'OK'),
      ].filter(Boolean);
      lp.innerHTML =
        '<strong>Last protect</strong><br/>' +
        parts.join(' · ') +
        (lpData.degraded
          ? '<br/><span class="warn-text">Degraded: ' +
            ((lpData.degradedReasons && lpData.degradedReasons.join(', ')) || lpData.message || 'partial') +
            '</span>'
          : '') +
        (lpData.error && lpData.message ? '<br/>' + lpData.message : '');
    } else {
      lp.classList.add('hidden');
    }

    const tel = document.getElementById('capture-telemetry');
    if (tel) {
      const t = status.captureTelemetry;
      if (t && t.stages && t.stages.length) {
        tel.classList.remove('hidden');
        const want = [
          'adapter.file_input_hooked',
          'main.file_input_hooked',
          'capture.file_input_change',
          'capture.file_object',
          'capture.sendMessage_call',
          'PUBLISH_CAPTURE.received',
        ];
        const seen = {};
        t.stages.forEach(function (s) {
          seen[s.stage] = true;
        });
        const checklist = want
          .map(function (s) {
            return (seen[s] ? '✓' : '✗') + ' ' + s;
          })
          .join('<br/>');
        const probe = t.probe
          ? '<br/>Probe: inputs=' +
            (t.probe.fileInputCount != null ? t.probe.fileInputCount : '?') +
            ' dialogs=' +
            (t.probe.dialogHostCount != null ? t.probe.dialogHostCount : '?') +
            ' iframes=' +
            (t.probe.iframeCount != null ? t.probe.iframeCount : '?')
          : '';
        const last = t.stages[t.stages.length - 1];
        const attempt = status.lastCaptureAttempt;
        const attemptLine = attempt
          ? '<br/>Attempt: ' +
            (attempt.stage || '?') +
            (attempt.fileName ? ' · ' + attempt.fileName : '') +
            (attempt.assetId ? ' · asset ' + attempt.assetId : '') +
            (attempt.error ? ' · ERR ' + attempt.error : '')
          : '';
        tel.innerHTML =
          '<strong>Capture stages</strong><br/>' +
          checklist +
          probe +
          attemptLine +
          '<br/>Last: ' +
          (t.lastStage || last.stage) +
          (t.pageUrl ? '<br/><span class="hint">' + t.pageUrl + '</span>' : '');
      } else {
        tel.classList.add('hidden');
      }
    }

    const lv = document.getElementById('last-verify');
    if (status.lastVerify) {
      lv.classList.remove('hidden');
      lv.innerHTML = '<strong>Last verify</strong><br/>' + (status.lastVerify.message || '—');
    } else {
      lv.classList.add('hidden');
    }

    const qs = document.getElementById('queue-status');
    if (qs) {
      qs.classList.remove('hidden');
      let html =
        '<strong>Protect queue</strong><br/>Pending ' +
        ((status.queue && status.queue.pending) || 0) +
        ' · Failed ' +
        ((status.queue && status.queue.failed) || 0) +
        ' · Done ' +
        ((status.queue && status.queue.done) || 0);
      const fail = status.lastQueueFailure;
      if (fail && fail.error) {
        html +=
          '<br/><span class="warn-text">Last failure [' +
          (fail.id || '?') +
          ']: ' +
          fail.error +
          '</span>';
      } else if (status.queue && status.queue.failedItems && status.queue.failedItems[0]) {
        const f = status.queue.failedItems[0];
        html +=
          '<br/><span class="warn-text">Failed [' +
          f.id +
          ']: ' +
          (f.error || 'unknown') +
          '</span>';
      }
      qs.innerHTML = html;
    }
  } else {
    signedIn.classList.add('hidden');
    signedOut.classList.remove('hidden');
    pill.textContent = 'Signed out';
    pill.className = 'pill muted';
  }
}

document.getElementById('btn-signin').addEventListener('click', function () {
  send('OPEN_AUTH').then(function (res) {
    if (res && res.error) showError(res.error);
  });
});

document.getElementById('btn-signout').addEventListener('click', async function () {
  await send('SIGN_OUT');
  await refresh();
});

document.getElementById('btn-exchange').addEventListener('click', async function () {
  const code = document.getElementById('auth-code').value.trim();
  if (!code) return;
  if (code.length < 20) {
    alert('That does not look like a full auth code. Click Authorize again and copy the whole code.');
    return;
  }
  const res = await send('EXCHANGE_AUTH_CODE', { code: code });
  if (!res || !res.ok) {
    alert((res && res.error) || 'Connect failed');
    return;
  }
  document.getElementById('auth-code').value = '';
  await refresh();
});

document.getElementById('btn-hub').addEventListener('click', async function () {
  const status = await send('GET_STATUS');
  const hub = (status && status.config && status.config.hubBaseUrl) || 'https://www.pinithub.com';
  chrome.tabs.create({ url: hub.replace(/\/$/, '') + '/protected-posts' });
});

document.getElementById('btn-assets').addEventListener('click', async function () {
  const status = await send('GET_STATUS');
  const hub = (status && status.config && status.config.hubBaseUrl) || 'https://www.pinithub.com';
  chrome.tabs.create({ url: hub.replace(/\/$/, '') + '/assets' });
});

document.getElementById('btn-investigate').addEventListener('click', async function () {
  const status = await send('GET_STATUS');
  const hub = (status && status.config && status.config.hubBaseUrl) || 'https://www.pinithub.com';
  chrome.tabs.create({ url: hub.replace(/\/$/, '') + '/pinit-hub/investigation' });
});

document.getElementById('btn-flush').addEventListener('click', async function () {
  await send('FLUSH_QUEUE');
  await refresh();
});

document.getElementById('btn-selftest').addEventListener('click', async function () {
  const btn = document.getElementById('btn-selftest');
  btn.disabled = true;
  btn.textContent = 'Testing…';
  try {
    const res = await send('SELF_TEST_PROTECT');
    if (res && res.ok) {
      const asset = (res.result && res.result.assetId) || 'ok';
      alert('Pipeline self-test OK. Asset: ' + asset);
    } else {
      alert('Pipeline self-test failed: ' + ((res && res.error) || 'unknown'));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run pipeline self-test';
    await refresh();
  }
});

document.getElementById('btn-sync').addEventListener('click', async function () {
  await send('SYNC_NOW');
  await refresh();
});

refresh();
