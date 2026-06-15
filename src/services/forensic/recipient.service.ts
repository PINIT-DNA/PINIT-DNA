import { prisma } from '../../lib/prisma';

function generateRecipientCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const part = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `RCP-${part(4)}-${part(4)}`;
}

export async function createRecipient(ownerUserId: string, label: string) {
  const recipientCode = generateRecipientCode();
  return prisma.shareRecipient.create({
    data: { ownerUserId, label, recipientCode },
  });
}

export async function listRecipients(ownerUserId: string) {
  return prisma.shareRecipient.findMany({
    where: { ownerUserId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { shareLinks: true } } },
  });
}

export async function getRecipient(ownerUserId: string, recipientId: string) {
  return prisma.shareRecipient.findFirst({
    where: { id: recipientId, ownerUserId },
    include: {
      shareLinks: {
        select: { id: true, token: true, createdAt: true, forwardStatus: true, forwardRiskScore: true, viewCount: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      trustEvents: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
}

export async function deleteRecipient(ownerUserId: string, recipientId: string) {
  return prisma.shareRecipient.deleteMany({ where: { id: recipientId, ownerUserId } });
}

export async function updateRecipientOnAccess(
  recipientId: string,
  ip: string,
  deviceFp: string | undefined,
  country: string | undefined
) {
  const recipient = await prisma.shareRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient) return;

  const knownIps = new Set(recipient.knownIps);
  const knownDevices = new Set(recipient.knownDevices);
  const knownCountries = new Set(recipient.knownCountries);

  if (ip) knownIps.add(ip);
  if (deviceFp) knownDevices.add(deviceFp);
  if (country) knownCountries.add(country);

  await prisma.shareRecipient.update({
    where: { id: recipientId },
    data: {
      knownIps: Array.from(knownIps),
      knownDevices: Array.from(knownDevices),
      knownCountries: Array.from(knownCountries),
      totalAccessCount: { increment: 1 },
      lastAccessAt: new Date(),
      firstAccessAt: recipient.firstAccessAt ?? new Date(),
    },
  });
}

export async function degradeTrustScore(
  recipientId: string,
  delta: number,
  eventType: string,
  reason: string,
  linkId?: string
) {
  const recipient = await prisma.shareRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient) return;

  const scoreBefore = recipient.trustScore;
  const scoreAfter = Math.max(0, scoreBefore - delta);

  await prisma.$transaction([
    prisma.shareRecipient.update({
      where: { id: recipientId },
      data: { trustScore: scoreAfter },
    }),
    prisma.recipientTrustEvent.create({
      data: { recipientId, eventType, scoreBefore, scoreAfter, delta: -delta, reason, linkId },
    }),
  ]);
}
