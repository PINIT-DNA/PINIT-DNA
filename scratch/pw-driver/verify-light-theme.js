const { chromium } = require('C:/PinIt/scratch/pw-driver/node_modules/playwright');
const fs = require('fs');

const token = fs.readFileSync('C:/PinIt/scratch/pw-driver/token.txt', 'utf-8').trim();
const BASE = 'http://localhost:3003';

const routes = [
  { path: '/audit', name: 'audit' },
  { path: '/vault', name: 'vault-explorer' },
  { path: '/files', name: 'file-explorer' },
  { path: '/analytics', name: 'analytics' },
  { path: '/investigations/history', name: 'investigations' },
  { path: '/security', name: 'security-center' },
  { path: '/timeline', name: 'timeline' },
  { path: '/tracking', name: 'tracking' },
  { path: '/monitoring', name: 'monitoring' },
  { path: '/certificates', name: 'certificates' },
  { path: '/dna', name: 'dna' },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Prime origin then set the token in localStorage before real navigation.
  await page.goto(`${BASE}/access-denied`);
  await page.evaluate((t) => {
    localStorage.setItem('master_admin_access_token', t);
  }, token);

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

  for (const r of routes) {
    errors.length = 0;
    await page.goto(`${BASE}${r.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `C:/PinIt/scratch/pw-driver/shot-${r.name}.png`, fullPage: true });
    console.log(`${r.path} -> shot-${r.name}.png ${errors.length ? '  ERRORS: ' + errors.join(' | ') : ''}`);
  }

  await browser.close();
})();
