import { describe, expect, test } from '@jest/globals';
import {
  capturedViaForProtect,
  classifyProtectOrigin,
  protectOriginLabel,
} from '../../src/lib/protect-origin';

describe('protect origin', () => {
  test('upload vs PINIT camera are distinct recorded paths', () => {
    expect(classifyProtectOrigin('Upload')).toBe('upload');
    expect(protectOriginLabel('Upload')).toBe('Uploaded to PINIT Protect');
    expect(capturedViaForProtect('Upload')).toBe('hub_protect_upload');

    expect(classifyProtectOrigin('PinIT Camera')).toBe('camera');
    expect(protectOriginLabel('PinIT Camera')).toBe('Captured with the PINIT camera');
    expect(capturedViaForProtect('PinIT Camera')).toBe('hub_protect_camera');

    expect(classifyProtectOrigin(null)).toBe('unknown');
    expect(protectOriginLabel(null)).toBeNull();
  });
});
