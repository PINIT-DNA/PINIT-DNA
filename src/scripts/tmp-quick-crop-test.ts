import 'dotenv/config';
import sharp from 'sharp';
import { prisma } from '../lib/prisma';
import { VaultService } from '../services/vault/vault.service';
import { enterpriseRetrievalEngine } from '../services/forensics/enterprise-retrieval-engine.service';

const TARGET = '5511775b-1fed-48fa-b435-bafb09a231dc';

async function main() {
  const user = await prisma.user.findFirst({ where: { shortId: 'PINIT-324BMMSL' }, select: { id: true } });
  if (!user) throw new Error('no user');
  const file = await new VaultService().retrieve(TARGET, user.id);
  const meta = await sharp(file.originalBuffer).metadata();
  const w = meta.width ?? 1000;
  const h = meta.height ?? 1000;
  const crop = await sharp(file.originalBuffer)
    .extract({ left: Math.round(w * 0.1), top: Math.round(h * 0.1), width: Math.round(w * 0.8), height: Math.round(h * 0.8) })
    .jpeg({ quality: 85 })
    .toBuffer();

  const r = await enterpriseRetrievalEngine.retrieve(crop, 'image/jpeg', user.id, { fullVariants: false });
  const top = r.localDnaHits[0];
  console.log({
    topVault: top?.vaultId?.slice(0, 8),
    votes: top?.patchMatchCount,
    score: top?.compositeScore,
    retrievalConfidence: r.retrievalConfidence,
    ok: top?.vaultId === TARGET,
  });
}

main().finally(() => prisma.$disconnect());
