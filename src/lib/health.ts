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
    memory:     ComponentHealth;
  };
}

export async function getHealthReport(): Promise<HealthReport> {
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkVaultDirectory(),
    checkStorageDirectory(),
    checkEncryptionConfig(),
    checkMemory(),
  ]);

  const [database, vault, storage, encryption, memory] = checks.map(r =>
    r.status === 'fulfilled' ? r.value : { status: 'unhealthy' as const, message: String((r as PromiseRejectedResult).reason) }
  );

  const allHealthy = [database, vault, storage, encryption, memory]
    .every(c => c.status === 'healthy');
  const anyUnhealthy = [database, vault, storage, encryption, memory]
    .some(c => c.status === 'unhealthy');

  return {
    status:    allHealthy ? 'healthy' : anyUnhealthy ? 'unhealthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime:    Math.round(process.uptime()),
    version:   config.dna.engineVersion,
    components: { database, vault, storage, encryption, memory },
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

function checkMemory(): ComponentHealth {
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const usedPct  = Math.round((1 - freeMem / totalMem) * 100);
  const freeMb   = Math.round(freeMem / 1024 / 1024);

  if (usedPct > 95) return { status: 'unhealthy', message: `Memory critical: ${usedPct}% used, ${freeMb}MB free` };
  if (usedPct > 85) return { status: 'degraded',  message: `Memory high: ${usedPct}% used, ${freeMb}MB free` };
  return { status: 'healthy', message: `Memory OK: ${usedPct}% used, ${freeMb}MB free` };
}
