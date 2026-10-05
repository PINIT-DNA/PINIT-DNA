import { describe, expect, test } from 'vitest';
import { READER_MESSAGES } from '../../src/core/validation';

describe('reader messages', () => {
  test('uses the public wording for file and hub failures', () => {
    expect(READER_MESSAGES.invalid_file).toBe('Invalid PINIT file.');
    expect(READER_MESSAGES.unsupported_version).toBe('This PINIT file version is not supported.');
    expect(READER_MESSAGES.missing_token).toBe('This PINIT file does not contain a valid share token.');
    expect(READER_MESSAGES.corrupted).toBe('This PINIT file is corrupted or invalid.');
    expect(READER_MESSAGES.expired).toBe('This share has expired.');
    expect(READER_MESSAGES.revoked).toBe('This share was turned off by the owner.');
    expect(READER_MESSAGES.network).toBe('Could not reach PINIT. Check your connection and try again.');
    expect(READER_MESSAGES.hub_unavailable).toBe('PINIT Hub is unavailable right now. Try again in a moment.');
  });
});
