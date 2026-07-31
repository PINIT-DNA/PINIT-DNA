/**
 * Extension queue pure-logic tests (Sprint 2).
 * Mirrors formulas in extension/shared/queue.js without Chrome APIs.
 */

const BASE_DELAY_MS = 5_000;
const MAX_DURABLE_DATAURL_CHARS = 4_000_000;

function backoffMs(attempts: number): number {
  const exp = Math.min(10, Math.max(0, attempts));
  return Math.min(30 * 60 * 1000, BASE_DELAY_MS * 2 ** exp);
}

function canDurableEnqueue(dataUrl: string | null | undefined): boolean {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  return dataUrl.length <= MAX_DURABLE_DATAURL_CHARS;
}

function buildDegradedFlags(result: {
  certificateId?: string | null;
  monitorId?: string | null;
  vaultId?: string | null;
  dnaRecordId?: string | null;
}) {
  const degraded: string[] = [];
  if (!result?.certificateId) degraded.push('certificate_missing');
  if (!result?.monitorId) degraded.push('monitoring_missing');
  if (!result?.vaultId) degraded.push('vault_missing');
  if (!result?.dnaRecordId) degraded.push('dna_missing');
  return { degraded: degraded.length > 0, degradedReasons: degraded };
}

describe('extension queue backoff', () => {
  it('grows exponentially and caps at 30 minutes', () => {
    expect(backoffMs(0)).toBe(5_000);
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(2)).toBe(20_000);
    expect(backoffMs(8)).toBe(5_000 * 2 ** 8);
    expect(backoffMs(10)).toBe(30 * 60 * 1000);
    expect(backoffMs(99)).toBe(30 * 60 * 1000);
  });
});

describe('durable enqueue gate', () => {
  it('rejects empty payloads', () => {
    expect(canDurableEnqueue(null)).toBe(false);
    expect(canDurableEnqueue('')).toBe(false);
  });

  it('accepts small dataUrls and rejects oversized ones', () => {
    expect(canDurableEnqueue('data:application/octet-stream;base64,AAAA')).toBe(true);
    expect(canDurableEnqueue('x'.repeat(MAX_DURABLE_DATAURL_CHARS))).toBe(true);
    expect(canDurableEnqueue('x'.repeat(MAX_DURABLE_DATAURL_CHARS + 1))).toBe(false);
  });
});

describe('protect degraded flags', () => {
  it('marks complete protection as not degraded', () => {
    expect(
      buildDegradedFlags({
        vaultId: 'v',
        dnaRecordId: 'd',
        certificateId: 'c',
        monitorId: 'm',
      }),
    ).toEqual({ degraded: false, degradedReasons: [] });
  });

  it('flags missing certificate and monitoring', () => {
    expect(
      buildDegradedFlags({
        vaultId: 'v',
        dnaRecordId: 'd',
        certificateId: null,
        monitorId: null,
      }),
    ).toEqual({
      degraded: true,
      degradedReasons: ['certificate_missing', 'monitoring_missing'],
    });
  });
});
