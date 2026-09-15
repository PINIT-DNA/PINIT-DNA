import { notificationInboxWhere } from '../../src/services/platform-events/notification-inbox';

describe('notificationInboxWhere', () => {
  test('does not filter when the inbox has never been cleared', () => {
    expect(notificationInboxWhere(null)).toEqual({});
    expect(notificationInboxWhere(undefined)).toEqual({});
  });

  test('hides rows at or before the clear watermark without deleting them', () => {
    const clearedAt = new Date('2026-09-01T10:00:00.000Z');
    expect(notificationInboxWhere(clearedAt)).toEqual({
      createdAt: { gt: clearedAt },
    });
  });
});
