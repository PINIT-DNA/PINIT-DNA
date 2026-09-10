/**
 * A bundled binary that exists but cannot be executed is NOT available.
 *
 * `fs.access` defaults to F_OK, so checking only existence made
 * isFfmpegAvailable() answer true while every execFile failed with EACCES. npm
 * does not reliably preserve the execute bit on unpacked platform binaries, so on
 * Linux this is the normal case, not an edge case.
 *
 * Caught in production: a video protected on Render came back with
 * `ffmpegAvailable: true` and ZERO keyframes, so the duplicate check declined to
 * guess and a re-encoded copy was accepted.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const access = jest.fn<AnyAsync>();
const chmod = jest.fn<AnyAsync>();

jest.mock('fs', () => ({
  __esModule: true,
  default: {
    constants: { F_OK: 0, X_OK: 1 },
    promises: { access, chmod },
  },
  constants: { F_OK: 0, X_OK: 1 },
  promises: { access, chmod },
}));

jest.mock('child_process', () => ({ execFile: jest.fn() }));

const X_OK = 1;

beforeEach(() => {
  jest.resetModules();
  access.mockReset();
  chmod.mockReset();
});

/** Fresh import each time — availability is cached per process. */
async function loadStatus() {
  const mod = await import('../../src/services/forensics/media-tools.service');
  return mod.getMediaToolStatus;
}

describe('media tool availability', () => {
  test('an executable binary is available', async () => {
    access.mockResolvedValue(undefined);

    const status = await (await loadStatus())();

    expect(status.ffmpeg).toBe(true);
    expect(chmod).not.toHaveBeenCalled();
  });

  test('a present but non-executable binary has its execute bit restored', async () => {
    // X_OK fails, F_OK succeeds, chmod works, X_OK then succeeds.
    let chmodded = false;
    access.mockImplementation(async (_p: unknown, mode?: unknown) => {
      if (mode === X_OK && !chmodded) throw new Error('EACCES');
      return undefined;
    });
    chmod.mockImplementation(async () => { chmodded = true; });

    const status = await (await loadStatus())();

    expect(chmod).toHaveBeenCalled();
    expect(status.ffmpeg).toBe(true);
  });

  test('a binary that cannot be made executable is NOT reported available', async () => {
    // This is the case that used to report `true` and silently produce no frames.
    access.mockImplementation(async (_p: unknown, mode?: unknown) => {
      if (mode === X_OK) throw new Error('EACCES');
      return undefined; // F_OK passes — the file exists
    });
    chmod.mockRejectedValue(new Error('EPERM'));

    const status = await (await loadStatus())();

    expect(status.ffmpeg).toBe(false);
    expect(status.ffprobe).toBe(false);
  });

  test('a missing binary is not available', async () => {
    access.mockRejectedValue(new Error('ENOENT'));
    chmod.mockRejectedValue(new Error('ENOENT'));

    const status = await (await loadStatus())();

    expect(status.ffmpeg).toBe(false);
  });

  test('the status reports the paths it checked, for remote diagnosis', async () => {
    access.mockResolvedValue(undefined);

    const status = await (await loadStatus())();

    expect(typeof status.ffmpegPath).toBe('string');
    expect(status.ffmpegPath.length).toBeGreaterThan(0);
    expect(typeof status.ffprobePath).toBe('string');
  });
});
