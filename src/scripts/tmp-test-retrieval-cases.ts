import 'dotenv/config';
import sharp from 'sharp';
import { prisma } from '../lib/prisma';
import { VaultService } from '../services/vault/vault.service';
import { pinitOriginalIdentityRecoveryService } from '../services/forensics/pinit-original-identity-recovery.service';

const TARGET_VAULT = '5511775b-1fed-48fa-b435-bafb09a231dc';

async function runCase(
  label: string,
  buffer: Buffer,
  mimeType: string,
  ownerUserId: string,
) {
  const result = await pinitOriginalIdentityRecoveryService.recover(
    buffer,
    mimeType,
    `${label}.jpg`,
    buffer.length,
    ownerUserId,
    { retrievalMode: true, skipProbeDna: true, orbTopK: 5, deepCompareTopN: 3 },
  );
  const vaultId = result.match?.vaultId ?? result.probableMatch?.vaultId ?? null;
  const ok = vaultId === TARGET_VAULT && (result.identified || result.fusion.ownershipConfidence >= 55);
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${label.padEnd(22)} | identified=${result.identified} conf=${result.fusion.ownershipConfidence}% vault=${vaultId?.slice(0, 8) ?? 'none'}`,
  );
  return ok;
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { shortId: 'PINIT-324BMMSL' },
    select: { id: true },
  });
  if (!user) throw new Error('user not found');

  const vault = new VaultService();
  const file = await vault.retrieve(TARGET_VAULT, user.id);
  const original = file.originalBuffer;
  const meta = await sharp(original).metadata();

  const cases: Array<{ label: string; buffer: Buffer; mime: string }> = [
    { label: 'original', buffer: original, mime: file.originalMimeType },
  ];

  const jpegQ60 = await sharp(original).jpeg({ quality: 60 }).toBuffer();
  cases.push({ label: 'jpeg_q60', buffer: jpegQ60, mime: 'image/jpeg' });

  const jpegQ40 = await sharp(original).jpeg({ quality: 40 }).toBuffer();
  cases.push({ label: 'whatsapp_sim', buffer: jpegQ40, mime: 'image/jpeg' });

  const resized = await sharp(original).resize(Math.round((meta.width ?? 800) * 0.6)).jpeg({ quality: 75 }).toBuffer();
  cases.push({ label: 'resize_60pct', buffer: resized, mime: 'image/jpeg' });

  const bright = await sharp(original).modulate({ brightness: 1.35, saturation: 0.9 }).jpeg({ quality: 85 }).toBuffer();
  cases.push({ label: 'brightness_up', buffer: bright, mime: 'image/jpeg' });

  const contrast = await sharp(original).linear(1.4, -30).jpeg({ quality: 85 }).toBuffer();
  cases.push({ label: 'contrast_up', buffer: contrast, mime: 'image/jpeg' });

  const w = meta.width ?? 1000;
  const h = meta.height ?? 1000;
  const crop85 = await sharp(original)
    .extract({ left: Math.round(w * 0.075), top: Math.round(h * 0.075), width: Math.round(w * 0.85), height: Math.round(h * 0.85) })
    .jpeg({ quality: 85 })
    .toBuffer();
  cases.push({ label: 'crop_15pct', buffer: crop85, mime: 'image/jpeg' });

  const crop80 = await sharp(original)
    .extract({ left: Math.round(w * 0.1), top: Math.round(h * 0.1), width: Math.round(w * 0.8), height: Math.round(h * 0.8) })
    .jpeg({ quality: 85 })
    .toBuffer();
  cases.push({ label: 'crop_20pct', buffer: crop80, mime: 'image/jpeg' });

  const rotated = await sharp(original).rotate(8).jpeg({ quality: 85 }).toBuffer();
  cases.push({ label: 'rotate_8deg', buffer: rotated, mime: 'image/jpeg' });

  let passed = 0;
  for (const c of cases) {
    const ok = await runCase(c.label, c.buffer, c.mime, user.id);
    if (ok) passed++;
  }
  console.log(`\nSummary: ${passed}/${cases.length} passed`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
