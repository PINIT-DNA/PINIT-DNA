const { chromium } = require('playwright');
const axios = require('axios');

(async () => {
  // Reuse the known-working auth flow to get a real JWT
  const authRes = await axios.post('http://localhost:4000/api/v1/auth/create', {});
  const { accessToken, refreshToken, user } = authRes.data.data;
  console.log('Created user:', user.shortId);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Prime localStorage BEFORE any app script runs
  await page.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('pinit_access_token', accessToken);
    localStorage.setItem('pinit_refresh_token', refreshToken);
  }, { accessToken, refreshToken });

  await page.goto('http://localhost:3002/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('URL after nav:', page.url());
  await page.screenshot({ path: 'shot-02-dashboard.png', fullPage: true });

  const bodyText = await page.textContent('body');
  console.log('Body text (first 1000 chars):', bodyText.slice(0, 1000));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
