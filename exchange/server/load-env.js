/**
 * Must be imported before any module that reads process.env at load time.
 * Loads exchange/.env, then inherits Hub root .env RAZORPAY_* for shared local billing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function applyEnvFile(envPath, { forcePrefixes = [], onlyKeys = null } = {}) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (onlyKeys && !onlyKeys.has(key)) continue;
    const force = forcePrefixes.some((p) => key.startsWith(p));
    const empty = !String(process.env[key] || '').trim();
    if (force || !(key in process.env) || empty) {
      process.env[key] = val;
    }
  }
}

const exchangeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const exchangeEnv = path.join(exchangeDir, '.env');
const hubEnv = path.join(exchangeDir, '..', '.env');

// Exchange-local first (bridge + overrides)
applyEnvFile(exchangeEnv, { forcePrefixes: ['EXCHANGE_', 'HUB_'] });

// Dev: reuse Hub Razorpay keys when Exchange .env has none
applyEnvFile(hubEnv, {
  onlyKeys: new Set([
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'PAYMENT_MOCK',
  ]),
});
