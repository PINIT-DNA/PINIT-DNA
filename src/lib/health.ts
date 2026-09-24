/**
 * PINIT-DNA — Health Check Service (Phase 6)
 *
 * Provides detailed health status for:
 *   - Database connectivity
 *   - Vault storage directory
 *   - Encryption configuration
 *   - System memory
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { prisma } from './prisma';
import { config } from '../config';
import { isCloudStorageConfigured, activeStorageBackend } from './vault-storage-backend';

export interface ComponentHealth {
  status:  'healthy' | 'degraded' | 'unhealthy';
  message: string;
  latencyMs?: number;
}

export interface HealthReport {
  status:    'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime:    number;
  version:   string;
  components: {
    database:   ComponentHealth;
    vault:      ComponentHealth;
    storage:    ComponentHealth;
    encryption: ComponentHealth;
    supabase:   ComponentHealth;
    memory:     ComponentHealth;
    mediaTools: ComponentHealth;
  };
}

export async function getHealthReport(): Promise<HealthReport> {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkVaultDirectory(),
    checkStorageDirectory(),
    checkEncryptionConfig(),
    checkSupabaseStorage(),
    checkMediaTools(),
    checkMemory(),
  ]);

  const [database, vault, storage, encryption, supabase, mediaTools, memory] = checks.map(r =>
    r.status === 'fulfilled' ? r.value : { status: 'unhealthy' as const, message: String((r as PromiseRejectedResult).reason) }
  );

  // mediaTools is reported but deliberately excluded from the overall verdict.
  // ffmpeg is an optional capability — without it images, vaulting, sharing and
  // certificates all work — and letting it turn the whole service "degraded"
  // would answer 207 to the platform health gate over a video feature.
  const core = [database, vault, storage, encryption, supabase, memory];
  const allHealthy = core.every(c => c.status === 'healthy');
  const anyUnhealthy = core.some(c => c.status === 'unhealthy');

  return {
    status:    allHealthy ? 'healthy' : anyUnhealthy ? 'unhealthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime:    Math.round(process.uptime()),
    version:   config.dna.engineVersion,
    components: { database, vault, storage, encryption, supabase, memory, mediaTools },
  };
}

async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'healthy', message: 'Database responding', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'unhealthy', message: `Database unreachable: ${String(err).slice(0, 80)}` };
  }
}

function checkVaultDirectory(): ComponentHealth {
  const vaultDir = config.vault.storageDir;
  if (!fs.existsSync(vaultDir)) {
    return { status: 'unhealthy', message: `Vault directory missing: ${vaultDir}` };
  }
  try {
    const testFile = path.join(vaultDir, `.health_${Date.now()}`);
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return { status: 'healthy', message: `Vault directory writable: ${vaultDir}` };
  } catch {
    return { status: 'degraded', message: `Vault directory not writable: ${vaultDir}` };
  }
}

function checkStorageDirectory(): ComponentHealth {
  const tempDir = config.upload.tempDir;
  if (!fs.existsSync(tempDir)) {
    try { fs.mkdirSync(tempDir, { recursive: true }); }
    catch { return { status: 'unhealthy', message: `Upload temp directory cannot be created: ${tempDir}` }; }
  }
  return { status: 'healthy', message: `Upload temp directory ready: ${tempDir}` };
}

function checkEncryptionConfig(): ComponentHealth {
  const secret = config.vault.masterSecret;
  if (!secret || secret.includes('dev_vault') || secret.length < 24) {
    return { status: 'degraded', message: 'Vault master secret appears to be default/weak — set VAULT_MASTER_SECRET env var' };
  }
  return { status: 'healthy', message: 'Encryption configuration valid' };
}

// Key stays 'supabase' below for backward compatibility with any dashboard
// reading this specific field, even though it now reports whichever object
// storage backend (Supabase or S3) is actually active — see config.storage.backend.
function checkSupabaseStorage(): ComponentHealth {
  const backend = activeStorageBackend();
  const requiredVarsMessage = backend === 's3'
    ? 'S3_BUCKET (and AWS credentials) are required in production for share links and vault retrieval'
    : 'SUPABASE_URL and SUPABASE_SERVICE_KEY are required in production for share links and vault retrieval';

  if (process.env['NODE_ENV'] !== 'production') {
    return isCloudStorageConfigured()
      ? { status: 'healthy', message: `${backend === 's3' ? 'S3' : 'Supabase'} Storage configured (dev)` }
      : { status: 'healthy', message: 'No cloud storage set — using local vault disk (dev)' };
  }
  if (!isCloudStorageConfigured()) {
    return { status: 'unhealthy', message: requiredVarsMessage };
  }
  return { status: 'healthy', message: `${backend === 's3' ? 'S3' : 'Supabase'} Storage configured` };
}

// Absolute-MB thresholds only make sense relative to how much memory this
// process is actually allocated — a fixed 512MB "degraded" floor is fine on a
// multi-GB host but would permanently degrade a small ECS task sized to,
// say, 512MB total. Override via env once the real ECS task memory is known;
// defaults below match this app's original Render-tuned values (no behavior
// change until the overrides are set).
const MEMORY_CRITICAL_FREE_MB = parseInt(process.env['HEALTH_MEMORY_CRITICAL_FREE_MB'] ?? '', 10) || 96;
const MEMORY_DEGRADED_FREE_MB = parseInt(process.env['HEALTH_MEMORY_DEGRADED_FREE_MB'] ?? '', 10) || 512;
const MEMORY_DEGRADED_USED_PCT = parseInt(process.env['HEALTH_MEMORY_DEGRADED_USED_PCT'] ?? '', 10) || 90;

function checkMemory(): ComponentHealth {
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const usedPct  = Math.round((1 - freeMem / totalMem) * 100);
  const freeMb   = Math.round(freeMem / 1024 / 1024);

  // Windows reports a high used-% while the working set still has hundreds of
  // MB free. Treating that as unhealthy made GET /health 503, and the Hub UI
  // showed "Backend starting" even though ping and dashboard APIs were 200.
  if (freeMb < MEMORY_CRITICAL_FREE_MB) {
    return { status: 'unhealthy', message: `Memory critical: ${usedPct}% used, ${freeMb}MB free` };
  }
  if (usedPct > MEMORY_DEGRADED_USED_PCT || freeMb < MEMORY_DEGRADED_FREE_MB) {
    return { status: 'degraded',  message: `Memory high: ${usedPct}% used, ${freeMb}MB free` };
  }
  return { status: 'healthy', message: `Memory OK: ${usedPct}% used, ${freeMb}MB free` };
}


/**
 * ffmpeg / ffprobe availability.
 *
 * Reported because their absence is otherwise invisible: video keyframe DNA and
 * the video duplicate check both degrade to "no frames" rather than failing, so a
 * re-encoded video would be accepted with nothing in the logs to say why.
 * Degraded, not unhealthy — the rest of the platform works fine without them.
 */
async function checkMediaTools(): Promise<ComponentHealth> {
  try {
    const { getMediaToolStatus } = await import('../services/forensics/media-tools.service');
    const t = await getMediaToolStatus();
    if (t.ffmpeg && t.ffprobe) {
      return { status: 'healthy', message: 'ffmpeg and ffprobe available — video DNA active' };
    }
    const missing = [!t.ffmpeg && 'ffmpeg', !t.ffprobe && 'ffprobe'].filter(Boolean).join(', ');
    return {
      status: 'degraded',
      message: `${missing} unavailable — video keyframe DNA and video duplicate detection are off`,
    };
  } catch (err) {
    return { status: 'degraded', message: `Media tool check failed: ${String(err).slice(0, 80)}` };
  }
}
