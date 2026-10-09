import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export interface WatermarkCopyRecord {
  lookupId: string;
  vaultId: string;
  dnaRecordId: string;
  ownerUserId: string;
  ownerName: string | null;
  filename: string | null;
  recipientLabel: string | null;
}

export async function recordWatermarkLookup(params: {
  lookupId: string;
  vaultId: string;
  dnaRecordId: string;
  ownerUserId: string;
  recipientKey?: string;
  recipientLabel?: string;
}): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO watermark_lookups (
        "lookupId", "vaultId", "dnaRecordId", "ownerUserId", "recipientKey", "recipientLabel"
      ) VALUES (
        ${params.lookupId},
        ${params.vaultId},
        ${params.dnaRecordId},
        ${params.ownerUserId},
        ${params.recipientKey ?? null},
        ${params.recipientLabel ?? null}
      )
      ON CONFLICT ("lookupId") DO NOTHING
    `;
  } catch (err) {
    logger.warn('Watermark lookup index write skipped', { error: String(err) });
  }
}

export async function findWatermarkCopy(lookupId: string): Promise<WatermarkCopyRecord | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{
      lookupId: string;
      vaultId: string;
      dnaRecordId: string;
      ownerUserId: string;
      ownerName: string | null;
      filename: string | null;
      recipientLabel: string | null;
    }>>`
      SELECT
        w."lookupId" AS "lookupId",
        w."vaultId" AS "vaultId",
        w."dnaRecordId" AS "dnaRecordId",
        w."ownerUserId" AS "ownerUserId",
        u."fullName" AS "ownerName",
        d."imageFilename" AS "filename",
        w."recipientLabel" AS "recipientLabel"
      FROM watermark_lookups w
      JOIN users u ON u.id = w."ownerUserId"
      LEFT JOIN dna_records d ON d.id = w."dnaRecordId"
      WHERE w."lookupId" = ${lookupId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch (err) {
    logger.warn('Watermark lookup index read skipped', { error: String(err) });
    return null;
  }
}
