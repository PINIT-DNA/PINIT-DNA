async function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

async function refresh() {
  const status = await send('GET_STATUS');
  const signedOut = document.getElementById('signed-out');
  const signedIn = document.getElementById('signed-in');
  const pill = document.getElementById('status-pill');

  if (status?.signedIn) {
    signedOut.classList.add('hidden');
    signedIn.classList.remove('hidden');
    pill.textContent = 'Connected';
    pill.className = 'pill ok';
    document.getElementById('user-id').textContent = status.user?.shortId || 'PinIT user';

    const lp = document.getElementById('last-protect');
    if (status.lastProtect) {
      lp.classList.remove('hidden');
      lp.innerHTML = `<strong>Last protect</strong><br/>${status.lastProtect.platform || 'web'} · ${status.lastProtect.certificateId || status.lastProtect.vaultId || 'OK'}`;
    } else {
      lp.classList.add('hidden');
    }

    const lv = document.getElementById('last-verify');
    if (status.lastVerify) {
      lv.classList.remove('hidden');
      lv.innerHTML = `<strong>Last verify</strong><br/>${status.lastVerify.message || '—'}`;
    } else {
      lv.classList.add('hidden');
    }

    const qs = document.getElementById('queue-status');
    if (status.queue && (status.queue.pending || status.queue.failed)) {
      qs.classList.remove('hidden');
      qs.innerHTML = `<strong>Protect queue</strong><br/>Pending ${status.queue.pending || 0} · Failed ${status.queue.failed || 0} · Done ${status.queue.done || 0}`;
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

document.getElementById('btn-signin').addEventListener('click', () => send('OPEN_AUTH'));
document.getElementById('btn-signout').addEventListener('click', async () => {
  await send('SIGN_OUT');
  await refresh();
});
document.getElementById('btn-exchange').addEventListener('click', async () => {
  const code = document.getElementById('auth-code').value.trim();
  if (!code) return;
  const res = await send('EXCHANGE_AUTH_CODE', { code });
  if (!res?.ok) {
    alert(res?.error || 'Connect failed');
    return;
  }
  await refresh();
});
document.getElementById('btn-hub').addEventListener('click', async () => {
  const status = await send('GET_STATUS');
  const hub = status.config?.hubBaseUrl || 'http://localhost:3000';
  chrome.tabs.create({ url: `${hub.replace(/\/$/, '')}/protected-posts` });
});
document.getElementById('btn-investigate').addEventListener('click', async () => {
  const status = await send('GET_STATUS');
  const hub = status.config?.hubBaseUrl || 'http://localhost:3000';
  chrome.tabs.create({ url: `${hub.replace(/\/$/, '')}/pinit-hub/investigation` });
});
document.getElementById('btn-flush')?.addEventListener('click', async () => {
  await send('FLUSH_QUEUE');
  await refresh();
});
document.getElementById('btn-sync')?.addEventListener('click', async () => {
  await send('SYNC_NOW');
  await refresh();
});

refresh();
