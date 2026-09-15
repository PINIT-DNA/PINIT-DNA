import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../src/lib/prisma';
import { dnaPhase2 } from '../src/config/dna-phase2';
import { VaultService } from '../src/services/vault/vault.service';
import { aggregateVideoComposition } from '../src/services/forensics/video-investigation-composition.service';

const execFileAsync = promisify(execFile);
async function ffmpeg(args: string[]): Promise<void> {
  await execFileAsync(dnaPhase2.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 60000 });
}

const REAL_VAULT_ID = '6d9c7bae-f6de-48ae-9468-038362d654d5';
const REAL_OWNER_USER_ID = '0712e895-aee0-4aac-b80b-abca89341f3d';

async function main() {
  const vaultSvc = new VaultService();
  const retrieved = await vaultSvc.retrieve(REAL_VAULT_ID, REAL_OWNER_USER_ID);
  console.log('Retrieved real video:', retrieved.originalFileName, retrieved.originalBuffer.length, 'bytes');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinit-real-crop-test-'));
  const originalPath = path.join(tmpDir, 'original' + path.extname(retrieved.originalFileName || '.mp4'));
  const croppedPath = path.join(tmpDir, 'video_left_half.mp4');
  fs.writeFileSync(originalPath, retrieved.originalBuffer);

  console.log('--- cropping to left half (matching user\'s real test) ---');
  await ffmpeg(['-i', originalPath, '-vf', 'crop=iw/2:ih:0:0', '-c:v', 'libx264', croppedPath]);
  const croppedBuffer = fs.readFileSync(croppedPath);
  console.log('cropped size:', croppedBuffer.length, 'bytes');

  console.log('--- running aggregateVideoComposition on the real cropped probe ---');
  const composition = await aggregateVideoComposition({
    probeBuffer: croppedBuffer,
    probeMimeType: 'video/mp4',
    probeFileName: 'video_left_half.mp4',
    ownerUserId: REAL_OWNER_USER_ID,
  });

  if (!composition) {
    console.log('RESULT: null (still no match)');
  } else {
    console.log('RESULT: composition found');
    console.log('  vaultDnaRecordId:', composition.vaultDnaRecordId);
    console.log('  framesSampled:', composition.framesSampled, 'framesMatched:', composition.framesMatched);
    console.log('  overall:', JSON.stringify(composition.overall));
    console.log('  timeline segments:', composition.timeline.length);
    for (const seg of composition.timeline) {
      console.log(`    [${seg.tStartMs}-${seg.tEndMs}ms] source=${seg.sourceVaultId ? 'MATCHED' : 'none'} protected=${seg.protectedFromAssetPercent}% other=${seg.otherPercent}%`);
    }
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); }).finally(() => prisma.$disconnect());
