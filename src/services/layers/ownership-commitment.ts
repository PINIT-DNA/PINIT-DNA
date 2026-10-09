import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

function ownerKey(ownerUserId: string): Buffer {
  return crypto.createHash('sha256').update(ownerUserId).digest();
}

export function ownershipCommitmentHash(secret: string, fileHash: string, ownerUserId: string): string {
  return crypto.createHash('sha256').update(`${secret}${fileHash}${ownerUserId}`).digest('hex');
}

export function openOwnershipSecret(proofData: string, ownerUserId: string): string | null {
  const [ivHex, cipherHex, tagHex] = proofData.split(':');
  if (!ivHex || !cipherHex || !tagHex) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', ownerKey(ownerUserId), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Opens the stored commitment and checks it against the registered file hash.
 * A match means the stored secret still opens. It is not a court ruling.
 */
export async function openStoredOwnershipCommitment(
  dnaRecordId: string,
  ownerUserId: string,
): Promise<boolean> {
  try {
    const [proof, cryptoLayer] = await Promise.all([
      prisma.zkProofLayer.findUnique({
        where: { dnaRecordId },
        select: { commitmentHash: true, proofData: true },
      }),
      prisma.cryptoLayer.findUnique({
        where: { dnaRecordId },
        select: { sha256Hash: true },
      }),
    ]);
    if (!proof || !cryptoLayer?.sha256Hash) return false;
    const secret = openOwnershipSecret(proof.proofData, ownerUserId);
    if (!secret) return false;
    const opened = ownershipCommitmentHash(secret, cryptoLayer.sha256Hash, ownerUserId);
    return opened === proof.commitmentHash;
  } catch (err) {
    logger.warn('Ownership commitment open skipped', { dnaRecordId, error: String(err) });
    return false;
  }
}
