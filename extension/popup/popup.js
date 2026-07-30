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
    pill.textContent = 'Connected';
    pill.className = 'pill ok';
    document.getElementById('user-id').textContent = (status.user && status.user.shortId) || 'PinIT user';

    const lp = document.getElementById('last-protect');
    if (status.lastProtect) {
      lp.classList.remove('hidden');
      lp.innerHTML = '<strong>Last protect</strong><br/>' +
        (status.lastProtect.platform || 'web') + ' · ' +
        (status.lastProtect.certificateId || status.lastProtect.vaultId || 'OK');
    } else {
      lp.classList.add('hidden');
    }

    const lv = document.getElementById('last-verify');
    if (status.lastVerify) {
      lv.classList.remove('hidden');
      lv.innerHTML = '<strong>Last verify</strong><br/>' + (status.lastVerify.message || '—');
    } else {
      lv.classList.add('hidden');
    }

    const qs = document.getElementById('queue-status');
    if (status.queue && (status.queue.pending || status.queue.failed)) {
      qs.classList.remove('hidden');
      qs.innerHTML = '<strong>Protect queue</strong><br/>Pending ' +
        (status.queue.pending || 0) + ' · Failed ' + (status.queue.failed || 0) +
        ' · Done ' + (status.queue.done || 0);
    } else if (qs) {
      qs.classList.add('hidden');
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
  const res = await send('EXCHANGE_AUTH_CODE', { code: code });
  if (!res || !res.ok) {
    alert((res && res.error) || 'Connect failed');
    return;
  }
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

document.getElementById('btn-sync').addEventListener('click', async function () {
  await send('SYNC_NOW');
  await refresh();
});

refresh();
