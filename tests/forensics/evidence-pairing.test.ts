/**
 * Phase 4.5 — Evidence pairing: L6 aligned, L7–L15 registry SKIPPED.
 */
import { ComparisonEngine } from '../../src/services/verification/comparison-engine';
import type { EphemeralFingerprint, EphemeralLayer } from '../../src/services/verification/ephemeral-fingerprinter';
import { computeHmac } from '../../src/services/engines/base/text-utils';
import { config } from '../../src/config';

function layer(
  n: number,
  name: string,
  fingerprint: string,
  success = true,
): EphemeralLayer {
  return {
    layer: n,
    name,
    implementation: 'test',
    fingerprint,
    data: {},
    success,
  };
}

function fp(layers: EphemeralLayer[], detectedBy: string): EphemeralFingerprint {
  return {
    fileType: 'IMAGE',
    mimeType: 'image/jpeg',
    filename: 'test.jpg',
    sizeBytes: 1000,
    detectedBy,
    layers,
  };
}

describe('Phase 4.5 evidence pairing', () => {
  const engine = new ComparisonEngine();

  it('pairs L6 when both sides use COMPARE: stabilisation', () => {
    const l1to5 = 'aaa|bbb|ccc|ddd|eee';
    const compareHmac = computeHmac(`COMPARE:IMAGE:${l1to5}`, config.stego.signatureSecret);
    const content = [
      layer(1, 'cryptographic', 'aaa'),
      layer(2, 'structural', 'bbb'),
      layer(3, 'perceptual', 'ccc'),
      layer(4, 'semantic', 'ddd'),
      layer(5, 'metadata', 'eee'),
      layer(6, 'signature', compareHmac),
    ];
    // Pad registry placeholders on vault
    for (let n = 7; n <= 15; n++) {
      content.push(layer(n, `layer${n}`, `vault-${n}`, n <= 10));
    }

    const result = engine.compare(
      fp(content, 'vault-registry'),
      fp(content.map((l) => (l.layer >= 7 ? { ...l, success: false, fingerprint: '' } : l)), 'ephemeral'),
      10,
      { vaultCompare: true },
    );

    const l6 = result.layerComparisons.find((l) => l.layer === 6)!;
    expect(l6.skipped).toBeFalsy();
    expect(l6.similarityPercent).toBe(100);
    expect(l6.matched).toBe(true);
  });

  it('marks L7–L15 as SKIPPED when content is not fully verified', () => {
    const vaultL3 = '0000000000000000';
    const probeL3 = 'ffffffffffffffff'; // hamming similarity 0 — not contentVerified
    const l1to5 = `aaa|bbb|${vaultL3}|ddd|eee`;
    const compareHmac = computeHmac(`COMPARE:IMAGE:${l1to5}`, config.stego.signatureSecret);
    const vaultLayers: EphemeralLayer[] = [
      layer(1, 'cryptographic', 'aaa'),
      layer(2, 'structural', 'bbb'),
      layer(3, 'perceptual', vaultL3),
      layer(4, 'semantic', 'ddd'),
      layer(5, 'metadata', 'eee'),
      layer(6, 'signature', compareHmac),
    ];
    for (let n = 7; n <= 15; n++) {
      vaultLayers.push(layer(n, `layer${n}`, `vault-${n}`, true));
    }

    const probeLayers: EphemeralLayer[] = [
      layer(1, 'cryptographic', 'different'),
      layer(2, 'structural', 'bbbbbbbbbbbbbbbb'),
      layer(3, 'perceptual', probeL3),
      layer(4, 'semantic', 'dddddddddddddddd'),
      layer(5, 'metadata', 'eeeeeeeeeeeeeeee'),
      layer(6, 'signature', 'other'),
    ];
    for (let n = 7; n <= 15; n++) {
      probeLayers.push(layer(n, `layer${n}`, '', false));
    }

    const result = engine.compare(
      fp(vaultLayers, 'vault-registry'),
      fp(probeLayers, 'ephemeral'),
      10,
      { vaultCompare: true },
    );

    for (let n = 7; n <= 15; n++) {
      const row = result.layerComparisons.find((l) => l.layer === n)!;
      expect(row.skipped).toBe(true);
      expect(row.matched).toBe(false);
      expect(row.changeDescription).toMatch(/Registry evidence/i);
    }
  });

  it('never marks missing probe layers as content FAIL (L1–L6 one-sided)', () => {
    const vaultOnly = [
      layer(1, 'cryptographic', 'aaa'),
      layer(2, 'structural', 'bbb'),
    ];
    const probeEmpty = [
      layer(1, 'cryptographic', '', false),
      layer(2, 'structural', '', false),
    ];

    const result = engine.compare(
      fp(vaultOnly, 'vault-registry'),
      fp(probeEmpty, 'ephemeral'),
      10,
      { vaultCompare: false },
    );

    const l1 = result.layerComparisons.find((l) => l.layer === 1)!;
    expect(l1.skipped).toBe(true);
  });
});
