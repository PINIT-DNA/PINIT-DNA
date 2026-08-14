/**
 * PINIT-DNA — Central Configuration
 *
 * All environment variables are validated and typed here.
 * Import `config` throughout the app — never read process.env directly.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { ALL_ACCEPTED_MIME_TYPES, GLOBAL_MAX_FILE_SIZE_BYTES } from './supported-file-types';
import { DNA_GENERATOR_VERSION, DNA_SCHEMA_VERSION } from './dna-versions';

dotenv.config();
// Ensure Exchange bridge secret from .env wins even if a shell JWT_SECRET was already set
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, 'utf8');
    const match = text.match(/^EXCHANGE_BRIDGE_SECRET=(.*)$/m);
    if (match) {
      const val = match[1].trim().replace(/^["']|["']$/g, '');
      if (val) process.env.EXCHANGE_BRIDGE_SECRET = val;
    }
  }
} catch {
  /* ignore */
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalInt(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) throw new Error(`Env var ${key} must be an integer, got: ${value}`);
  return parsed;
}

export const config = {
  env: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',
  port: optionalInt('PORT', 4000),
  apiPrefix: optional('API_PREFIX', '/api/v1'),

  db: {
    url: required('DATABASE_URL'),
  },

  upload: {
    /**
     * Phase 0+: all supported MIME types are accepted at the upload boundary.
     * The UniversalFileRouter enforces which types have live engines.
     * Override via ALLOWED_FILE_TYPES env var (comma-separated) if needed.
     */
    allowedMimeTypes: process.env['ALLOWED_FILE_TYPES']
      ? process.env['ALLOWED_FILE_TYPES'].split(',')
      : ALL_ACCEPTED_MIME_TYPES,
    /**
     * Global ceiling — the largest single-type max (500 MB for ZIP/VIDEO).
     * Per-type ceilings are enforced by the router after detection.
     */
    maxFileSizeBytes: optionalInt('MAX_FILE_SIZE', GLOBAL_MAX_FILE_SIZE_BYTES),
    tempDir: path.resolve(optional('UPLOAD_TEMP_DIR', './tmp/uploads')),
  },

  dna: {
    // WHY defaults from dna-versions (Task A1): same strings as before; env override unchanged.
    schemaVersion: optional('DNA_SCHEMA_VERSION', DNA_SCHEMA_VERSION),
    /** Universal engine version — bumped each phase */
    engineVersion: optional('DNA_ENGINE_VERSION', DNA_GENERATOR_VERSION),
  },

  stego: {
    signatureSecret: optional('LSB_SIGNATURE_SECRET', 'dev_secret_change_in_prod'),
  },

  vault: {
    // Master secret for HKDF key derivation — never stored derived keys
    masterSecret: optional('VAULT_MASTER_SECRET', 'dev_vault_secret_change_in_prod'),
    // Directory where AES-256-GCM encrypted vault files are stored
    storageDir: path.resolve(optional('VAULT_STORAGE_DIR', './vault/encrypted')),
  },

  jwt: {
    secret: optional('JWT_SECRET', 'dev_jwt_secret_change_in_prod_min_32_chars_long!!'),
  },

  biometric: {
    encryptionKey: optional('BIOMETRIC_ENCRYPTION_KEY', optional('VAULT_MASTER_SECRET', 'dev_biometric_key_change_in_prod')),
    thresholds: {
      // face-api.js L2 on normalized 128-d: same person ~0.25–0.45; strangers often ≥0.55.
      // 0.62 was too loose and caused wrong-face logins with a small registry.
      faceLogin: parseFloat(optional('BIOMETRIC_FACE_LOGIN_THRESHOLD', '0.48')),
      // Same as login — 1:N enroll uniqueness. A hit rejects registration (sign in instead).
      faceDuplicate: parseFloat(optional('BIOMETRIC_FACE_DUPLICATE_THRESHOLD', '0.48')),
      // Best match must beat 2nd-best by this margin when ≥2 templates exist.
      faceLoginMargin: parseFloat(optional('BIOMETRIC_FACE_LOGIN_MARGIN', '0.08')),
      voiceLogin: parseFloat(optional('BIOMETRIC_VOICE_LOGIN_THRESHOLD', '0.45')),
      voiceDuplicate: parseFloat(optional('BIOMETRIC_VOICE_DUPLICATE_THRESHOLD', '0.35')),
      fingerprintLogin: parseFloat(optional('BIOMETRIC_FINGERPRINT_LOGIN_THRESHOLD', '0.40')),
      fingerprintDuplicate: parseFloat(optional('BIOMETRIC_FINGERPRINT_DUPLICATE_THRESHOLD', '0.30')),
      fusionMinConfidence: parseFloat(optional('BIOMETRIC_FUSION_MIN_CONFIDENCE', '72')),
      weights: {
        face: parseFloat(optional('BIOMETRIC_WEIGHT_FACE', '0.50')),
        voice: parseFloat(optional('BIOMETRIC_WEIGHT_VOICE', '0.30')),
        fingerprint: parseFloat(optional('BIOMETRIC_WEIGHT_FINGERPRINT', '0.20')),
      },
    },
  },

  rateLimit: {
    windowMs: optionalInt('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), // 15 min
    max: optionalInt('RATE_LIMIT_MAX', 2000),
  },

  /**
   * Freemium subscription enforcement.
   * When false, all features are allowed (emergency bypass). Default: true.
   * Quota limits below are configurable via env — not hardcoded in business logic.
   */
  subscription: {
    enforcementEnabled: optional('SUBSCRIPTION_ENFORCEMENT', 'true').toLowerCase() !== 'false',
    freeAssetLimit: optionalInt('SUBSCRIPTION_FREE_ASSET_LIMIT', 5),
    businessFreeTeamLimit: optionalInt('SUBSCRIPTION_BUSINESS_FREE_TEAM_LIMIT', 1),
    businessFreeWorkspaceLimit: optionalInt('SUBSCRIPTION_BUSINESS_FREE_WORKSPACE_LIMIT', 1),
  },

  razorpay: {
    keyId: optional('RAZORPAY_KEY_ID', ''),
    keySecret: optional('RAZORPAY_KEY_SECRET', ''),
    webhookSecret: optional('RAZORPAY_WEBHOOK_SECRET', ''),
  },

  /**
   * Pinit Exchange bridge — marketplace stays a separate app.
   * Hub owns identity / vault / DNA; Exchange only receives public-safe listing payloads.
   */
  exchange: {
    appUrl: optional('EXCHANGE_APP_URL', 'http://localhost:5174').replace(/\/$/, ''),
    apiUrl: optional('EXCHANGE_API_URL', 'http://localhost:5000').replace(/\/$/, ''),
    bridgeSecret: optional(
      'EXCHANGE_BRIDGE_SECRET',
      optional('JWT_SECRET', 'dev_jwt_secret_change_in_prod_min_32_chars_long!!'),
    ),
  },

  log: {
    level: optional('LOG_LEVEL', 'debug'),
  },
} as const;

export type Config = typeof config;
