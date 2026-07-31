/**
 * Revoke TEP packages — append-only custody event, never mutates DNA.
 */
import { prisma } from '../../lib/prisma';
import { forensicProvenanceService } from '../forensics/forensic-provenance.service';
import { provenanceEventBus } from './event-bus';

export interface RevokeTepInput {
  tepCode: string;
  ownerUserId: string;
  reason?: string;
}

export interface RevokeTepResult {
  success: boolean;
  tepCode: string;
  status: string;
  message: string;
}

export async function revokeTepPackage(input: RevokeTepInput): Promise<RevokeTepResult> {
  const pkg = await prisma.trackedExportPackage.findUnique({
    where: { tepCode: input.tepCode },
  });

  if (!pkg) {
    return {
      success: false,
      tepCode: input.tepCode,
      status: 'NOT_FOUND',
      message: 'TEP package not found',
    };
  }

  if (pkg.ownerUserId && pkg.ownerUserId !== input.ownerUserId) {
    return {
      success: false,
      tepCode: input.tepCode,
      status: 'FORBIDDEN',
      message: 'Not authorized to revoke this package',
    };
  }

  if (pkg.status === 'REVOKED') {
    return {
      success: true,
      tepCode: input.tepCode,
      status: 'REVOKED',
      message: 'Package already revoked',
    };
  }

  await prisma.trackedExportPackage.update({
    where: { tepCode: input.tepCode },
    data: { status: 'REVOKED' },
  });

  await forensicProvenanceService.append({
    eventType: 'REVOKED',
    summary: `TEP revoked — ${input.tepCode}`,
    dnaRecordId: pkg.dnaRecordId,
    vaultId: pkg.vaultId,
    tepCode: pkg.tepCode,
    actorUserId: input.ownerUserId,
    payload: {
      reason: input.reason ?? 'Owner revoked access',
      previousStatus: pkg.status,
    },
    dedupeKey: `tep_revoked:${input.tepCode}`,
  });

  await provenanceEventBus.emit('tep.revoked', {
    tepCode: input.tepCode,
    vaultId: pkg.vaultId,
    dnaRecordId: pkg.dnaRecordId,
    reason: input.reason ?? 'Owner revoked access',
  });

  import('../platform-events/module-events').then(({ emitTepRevoked }) => {
    emitTepRevoked({
      ownerUserId: input.ownerUserId,
      tepCode: input.tepCode,
      vaultId: pkg.vaultId,
      dnaRecordId: pkg.dnaRecordId,
      reason: input.reason,
    });
  }).catch(() => {});

  return {
    success: true,
    tepCode: input.tepCode,
    status: 'REVOKED',
    message: 'Package revoked — future PINIT recovery will show REVOKED status',
  };
}
