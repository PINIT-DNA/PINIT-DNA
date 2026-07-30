import { PLATFORM_REGISTRY, PLATFORM_IDS, defaultPlatformFlags } from '../shared/platforms.js';

const DEFAULTS = {
  apiBaseUrl: 'https://pinit-dna-backend.onrender.com/api/v1',
  hubBaseUrl: 'https://www.pinithub.com',
  publishGuardianEnabled: true,
  platforms: defaultPlatformFlags(true),
};

function renderPlatformToggles() {
  for (const group of ['social', 'creator', 'photo', 'business']) {
    const root = document.getElementById(`group-${group}`);
    if (!root) continue;
    root.innerHTML = '';
    for (const p of PLATFORM_REGISTRY.filter((x) => x.group === group)) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<input id="${p.id}" type="checkbox" checked /> <span>${p.label}</span>`;
      root.appendChild(row);
    }
  }
}

async function load() {
  renderPlatformToggles();
  const { config } = await chrome.storage.local.get('config');
  const c = {
    ...DEFAULTS,
    ...(config || {}),
    platforms: { ...DEFAULTS.platforms, ...(config?.platforms || {}) },
  };
  document.getElementById('apiBaseUrl').value = c.apiBaseUrl;
  document.getElementById('hubBaseUrl').value = c.hubBaseUrl;
  document.getElementById('publishGuardianEnabled').checked = !!c.publishGuardianEnabled;
  for (const key of PLATFORM_IDS) {
    const el = document.getElementById(key);
    if (el) el.checked = c.platforms[key] !== false;
  }
}

document.getElementById('save').addEventListener('click', async () => {
  const platforms = {};
  for (const key of PLATFORM_IDS) {
    const el = document.getElementById(key);
    platforms[key] = el ? el.checked : true;
  }
  const config = {
    apiBaseUrl: document.getElementById('apiBaseUrl').value.trim() || DEFAULTS.apiBaseUrl,
    hubBaseUrl: document.getElementById('hubBaseUrl').value.trim() || DEFAULTS.hubBaseUrl,
    publishGuardianEnabled: document.getElementById('publishGuardianEnabled').checked,
    platforms,
  };
  await chrome.storage.local.set({ config });
  document.getElementById('msg').textContent = 'Saved.';
});

load();
