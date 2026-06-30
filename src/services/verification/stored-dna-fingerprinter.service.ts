/**
 * Load vault-stored DNA fingerprints for comparison (original file side).
 * Avoids re-fingerprinting the vault original — uses registry layers L1–L15.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { DNA_LAYER_REGISTRY } from '../../constants/dna-layer-registry';
import type { EphemeralFingerprint, EphemeralLayer } from './ephemeral-fingerprinter';

function placeholderLayer(n: number): EphemeralLayer {
  const reg = DNA_LAYER_REGISTRY[n]!;
  return {
    layer: n,
    name: reg.name.toLowerCase().replace(/\s+/g, '_'),
    implementation: reg.implementation,
    fingerprint: '',
    data: {},
    success: false,
  };
}

export class StoredDnaFingerprinter {
  async fromDnaRecord(dnaRecordId: string): Promise<EphemeralFingerprint> {
    const record = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      include: {
        cryptoLayer: true,
        structuralLayer: true,
        perceptualLayer: true,
        semanticLayer: true,
        metadataLayer: true,
        stegoLayer: true,
        behavioralLayer: true,
        relationshipLayer: true,
        originLayer: true,
        evolutionLayer: true,
        deepfakeLayer: true,
        dctWatermarkLayer: true,
        custodyLayer: true,
        zkProofLayer: true,
        biometricBindLayer: true,
      },
    });

    if (!record) {
      throw new Error(`DNA record not found: ${dnaRecordId}`);
    }

    const layerMap = new Map<number, EphemeralLayer>();

    if (record.cryptoLayer) {
      layerMap.set(1, {
        layer: 1, name: 'cryptographic', implementation: 'sha256_serialized',
        fingerprint: record.cryptoLayer.sha256Hash,
        data: { sha256Hash: record.cryptoLayer.sha256Hash },
        success: true,
      });
    }

    if (record.structuralLayer) {
      layerMap.set(2, {
        layer: 2, name: 'structural', implementation: 'sobel_edge_detection',
        fingerprint: record.structuralLayer.edgeSignature64,
        data: { edgeSignature64: record.structuralLayer.edgeSignature64 },
        success: true,
      });
    }

    if (record.perceptualLayer) {
      layerMap.set(3, {
        layer: 3, name: 'perceptual', implementation: 'dct_phash',
        fingerprint: record.perceptualLayer.pHash64,
        data: {
          pHash64: record.perceptualLayer.pHash64,
          aHash64: record.perceptualLayer.aHash64,
          dHash64: record.perceptualLayer.dHash64,
        },
        success: true,
      });
    }

    if (record.semanticLayer) {
      layerMap.set(4, {
        layer: 4, name: 'semantic', implementation: 'rgb_hsv_histogram',
        fingerprint: record.semanticLayer.colorFingerprint,
        data: { colorFingerprint: record.semanticLayer.colorFingerprint },
        success: true,
      });
    }

    if (record.metadataLayer) {
      const stableL5 = crypto.createHash('sha256').update(JSON.stringify({
        deviceMake: record.metadataLayer.deviceMake,
        deviceModel: record.metadataLayer.deviceModel,
        capturedAt: record.metadataLayer.capturedAt?.toISOString() ?? null,
        gpsLat: record.metadataLayer.gpsLatitude,
        gpsLon: record.metadataLayer.gpsLongitude,
      })).digest('hex');

      layerMap.set(5, {
        layer: 5, name: 'metadata', implementation: 'exif_metadata_stable',
        fingerprint: stableL5,
        data: { stableFingerprint: stableL5 },
        success: true,
      });
    }

    if (record.stegoLayer) {
      layerMap.set(6, {
        layer: 6, name: 'signature', implementation: 'lsb_steganography_hmac',
        fingerprint: record.stegoLayer.payloadHmac,
        data: { payloadHmac: record.stegoLayer.payloadHmac },
        success: true,
      });
    }

    if (record.behavioralLayer) {
      layerMap.set(7, {
        layer: 7, name: 'behavioral', implementation: 'sha256_behavior_bundle',
        fingerprint: record.behavioralLayer.behaviorHash,
        data: { behaviorHash: record.behavioralLayer.behaviorHash },
        success: true,
      });
    }

    if (record.relationshipLayer) {
      layerMap.set(8, {
        layer: 8, name: 'relationship', implementation: 'sha256_graph_hash',
        fingerprint: record.relationshipLayer.graphHash ?? '',
        data: { graphHash: record.relationshipLayer.graphHash },
        success: true,
      });
    }

    if (record.originLayer) {
      layerMap.set(9, {
        layer: 9, name: 'origin', implementation: 'sha256_origin_bundle',
        fingerprint: record.originLayer.bundleHash,
        data: { bundleHash: record.originLayer.bundleHash },
        success: true,
      });
    }

    if (record.evolutionLayer) {
      layerMap.set(10, {
        layer: 10, name: 'evolution', implementation: 'markov_mutation_log',
        fingerprint: record.evolutionLayer.merkleRoot ?? '',
        data: { merkleRoot: record.evolutionLayer.merkleRoot },
        success: true,
      });
    }

    if (record.deepfakeLayer) {
      layerMap.set(11, {
        layer: 11, name: 'deepfake', implementation: 'ai_deepfake_analysis',
        fingerprint: String(Math.round(record.deepfakeLayer.deepfakeScore)),
        data: { deepfakeScore: record.deepfakeLayer.deepfakeScore },
        success: true,
      });
    }

    if (record.dctWatermarkLayer) {
      layerMap.set(12, {
        layer: 12, name: 'watermark', implementation: 'dct_frequency_watermark',
        fingerprint: record.dctWatermarkLayer.watermarkHash,
        data: { watermarkHash: record.dctWatermarkLayer.watermarkHash, embedded: record.dctWatermarkLayer.embedded },
        success: record.dctWatermarkLayer.embedded,
      });
    }

    if (record.custodyLayer) {
      layerMap.set(13, {
        layer: 13, name: 'custody', implementation: 'legal_custody_chain',
        fingerprint: record.custodyLayer.evidenceHash ?? crypto.createHash('sha256').update(JSON.stringify(record.custodyLayer.custodyChain)).digest('hex'),
        data: { dmcaReady: record.custodyLayer.dmcaReady },
        success: true,
      });
    }

    if (record.zkProofLayer) {
      layerMap.set(14, {
        layer: 14, name: 'zk_proof', implementation: 'hash_commitment_proof',
        fingerprint: record.zkProofLayer.commitmentHash,
        data: { verified: record.zkProofLayer.verified },
        success: record.zkProofLayer.verified,
      });
    }

    if (record.biometricBindLayer) {
      layerMap.set(15, {
        layer: 15, name: 'biometric', implementation: 'biometric_hmac_bind',
        fingerprint: record.biometricBindLayer.biometricHash,
        data: { biometricType: record.biometricBindLayer.biometricType },
        success: record.biometricBindLayer.embeddedInFile,
      });
    }

    const layers: EphemeralLayer[] = [];
    for (let n = 1; n <= 15; n++) {
      layers.push(layerMap.get(n) ?? placeholderLayer(n));
    }

    return {
      fileType: record.fileType ?? 'IMAGE',
      mimeType: record.imageMimeType ?? 'application/octet-stream',
      filename: record.imageFilename,
      sizeBytes: record.imageSizeBytes ?? 0,
      detectedBy: 'vault-registry',
      layers,
    };
  }
}

export const storedDnaFingerprinter = new StoredDnaFingerprinter();
