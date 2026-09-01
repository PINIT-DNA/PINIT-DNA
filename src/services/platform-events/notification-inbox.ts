import type { Prisma } from '@prisma/client';

/**
 * Inbox (bell + badge) vs history:
 * clearing the panel stores a watermark on the user. Rows created at or before
 * that time stay in the database and history; they are hidden from the inbox
 * and unread badge until a newer notification arrives.
 */
export function notificationInboxWhere(
  clearedAt: Date | null | undefined,
): Prisma.NotificationWhereInput {
  if (!clearedAt) return {};
  return { createdAt: { gt: clearedAt } };
}
