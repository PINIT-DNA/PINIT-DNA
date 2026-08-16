/**
 * Spatial Auth Phase 1+2 — Mode A exact verification + block localization
 *
 * Phase 1 HMAC/Merkle algorithm UNCHANGED.
 * Phase 2 attaches derived tamper map only when crypto package is trusted.
 */

import crypto from 'crypto';
import { isSupportedSpatialAuthVersion } from '../../config/spatial-auth';
import { authenticateBlocksForScale } from './block-auth';
import { decodeBlockBlob } from './block-blob';
import { deriveSpatialBlockKey } from './key-derivation';
import { merkleRootHex, verifyRootMac } from './merkle';
import { buildSpatialBlockLocalization } from './tamper-localize';
import { verifyPixelAuthLayer } from './pixel-auth/verify';
import { buildSpatialInvestigation } from './investigation';
import { isSpatialQuad4AuthEnabled, isSpatialQuad2AuthEnabled, isSpatialPixel1AuthEnabled } from '../../config/spatial-hierarchy';
import { verifyQuad4UnderFailed8x8, quad4Unavailable } from './hierarchy/quad4-auth';
import { verifyQuad2UnderFailed4x4, quad2Unavailable } from './hierarchy/quad2-auth';
import { verifyPixel1UnderFailed2x2, pixel1Unavailable } from './hierarchy/pixel1-auth';
import { spatialAuthConfig } from '../../config/spatial-auth';
import type {
  ExactSpatialVerificationResult,
  SpatialAuthPackageData,
  TamperedBlockResult,
} from './types';
import type { PixelAuthPackageData } from './pixel-auth/types';

function tagsEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Phase 3C — attach visualization/investigation without altering crypto fields */
function withInvestigation(
  result: ExactSpatialVerificationResult,
): ExactSpatialVerificationResult {
  return {
    ...result,
    investigation: buildSpatialInvestigation(result),
  };
}

function emptyResult(
  base: Omit<ExactSpatialVerificationResult, 'status' | 'matched' | 'tampered' | 'blocksChecked' | 'blocksPassed' | 'blocksFailed' | 'merkleRootMatch' | 'rootMacValid' | 'packageIntegrityValid' | 'tamperedBlocks' | 'exactPassRate' | 'verificationMs'>,
  partial: Partial<ExactSpatialVerificationResult> & Pick<ExactSpatialVerificationResult, 'status' | 'rootMacValid' | 'packageIntegrityValid' | 'verificationMs'>,
): ExactSpatialVerificationResult {
  return withInvestigation({
    ...base,
    matched: false,
    tampered: false,
    blocksChecked: 0,
    blocksPassed: 0,
    blocksFailed: 0,
    blocksUnknown: 0,
    merkleRootMatch: false,
    tamperedBlocks: [],
    exactPassRate: 0,
    localization: null,
    fineLocalization: null,
    pixelLayer: null,
    quad4Localization: null,
    quad2Localization: null,
    pixel1Localization: null,
    ...partial,
  });
}

/**
 * Verify candidate RGB against a stored SpatialAuthPackage (Mode A).
 * Does not soft-score: HMAC fail ⇒ block TAMPERED.
 * Phase 2 localization is derived evidence only.
 */
export function verifyExactSpatialAuth(params: {
  packageData: SpatialAuthPackageData;
  candidateRgb: Buffer;
  candidateWidth: number;
  candidateHeight: number;
  /** When verifying only primary scale for speed; default true */
  primaryScaleOnly?: boolean;
  masterSecret?: string;
  /** Include ASCII grid preview in localization (debug) */
  includeGridPreview?: boolean;
  /**
   * Phase 4B — enrolled lossless reference RGB (file-pixel-order-v1).
   * Required for trusted 4×4 / 2×2 localization when those flags are enabled.
   */
  referenceRgb?: Buffer;
  referenceWidth?: number;
  referenceHeight?: number;
  /** Skip 4×4 layer (used when validating the reference itself) */
  skipQuad4?: boolean;
  /** Skip 2×2 layer */
  skipQuad2?: boolean;
  /** Skip 1×1 layer */
  skipPixel1?: boolean;
}): ExactSpatialVerificationResult {
  const started = Date.now();
  const pkg = params.packageData;

  const base = {
    verificationMode: 'EXACT' as const,
    dnaRecordId: pkg.dnaRecordId,
    algorithmVersion: pkg.algorithmVersion,
    orientationPolicy: pkg.orientationPolicy,
    width: pkg.width,
    height: pkg.height,
    primaryScale: pkg.primaryScale,
  };

  try {
    if (!isSupportedSpatialAuthVersion(pkg.algorithmVersion)) {
      return emptyResult(base, {
        status: 'UNSUPPORTED_VERSION',
        rootMacValid: false,
        packageIntegrityValid: false,
        detail: `Unsupported algorithmVersion: ${pkg.algorithmVersion}`,
        verificationMs: Date.now() - started,
      });
    }

    const rootMacValid = verifyRootMac({
      dnaRecordId: pkg.dnaRecordId,
      ownerUserId: pkg.ownerUserId,
      width: pkg.width,
      height: pkg.height,
      orientationPolicy: pkg.orientationPolicy,
      globalDnaRef: pkg.globalDnaRef,
      keyId: pkg.keyId,
      algorithmVersion: pkg.algorithmVersion,
      primaryScale: pkg.primaryScale,
      scales: pkg.scales,
      merkleRootHex: pkg.merkleRoot,
      rootMac: pkg.rootMac,
      masterSecret: params.masterSecret,
    });

    if (!rootMacValid) {
      return emptyResult(base, {
        status: 'INVALID_AUTH_PACKAGE',
        rootMacValid: false,
        packageIntegrityValid: false,
        detail: 'rootMac verification failed — package authentication invalid',
        verificationMs: Date.now() - started,
        localization: null,
      });
    }

    let storedLeaves;
    try {
      const decoded = decodeBlockBlob(pkg.blockBlob);
      storedLeaves = decoded.leaves;
      if (decoded.algorithmVersion !== pkg.algorithmVersion) {
        return emptyResult(base, {
          status: 'INVALID_AUTH_PACKAGE',
          rootMacValid: true,
          packageIntegrityValid: false,
          detail: 'blockBlob algorithmVersion mismatch',
          verificationMs: Date.now() - started,
        });
      }
    } catch (err) {
      return emptyResult(base, {
        status: 'INVALID_AUTH_PACKAGE',
        rootMacValid: true,
        packageIntegrityValid: false,
        detail: `blockBlob decode failed: ${String(err)}`,
        verificationMs: Date.now() - started,
      });
    }

    const storedRoot = merkleRootHex(storedLeaves);
    if (storedRoot !== pkg.merkleRoot) {
      return emptyResult(base, {
        status: 'INVALID_AUTH_PACKAGE',
        rootMacValid: true,
        packageIntegrityValid: false,
        detail: 'Stored blockBlob Merkle root does not match package merkleRoot',
        verificationMs: Date.now() - started,
      });
    }

    if (
      params.candidateWidth !== pkg.width ||
      params.candidateHeight !== pkg.height
    ) {
      return emptyResult(base, {
        status: 'DIMENSION_MISMATCH',
        rootMacValid: true,
        packageIntegrityValid: true,
        detail: `Enrolled ${pkg.width}x${pkg.height}, candidate ${params.candidateWidth}x${params.candidateHeight}`,
        verificationMs: Date.now() - started,
        localization: null,
      });
    }

    const expectedLen = pkg.width * pkg.height * 3;
    if (params.candidateRgb.length !== expectedLen) {
      return emptyResult(base, {
        status: 'ERROR',
        rootMacValid: true,
        packageIntegrityValid: true,
        detail: `RGB buffer length ${params.candidateRgb.length} != expected ${expectedLen}`,
        verificationMs: Date.now() - started,
      });
    }

    const primaryOnly = params.primaryScaleOnly !== false;
    const scalesToCheck = primaryOnly
      ? [pkg.primaryScale]
      : [...pkg.scales].sort((a, b) => a - b);

    const imageKey = deriveSpatialBlockKey({
      dnaRecordId: pkg.dnaRecordId,
      ownerUserId: pkg.ownerUserId,
      globalDnaRef: pkg.globalDnaRef,
      keyId: pkg.keyId,
      masterSecret: params.masterSecret,
      algorithmVersion: pkg.algorithmVersion,
    });

    const storedByKey = new Map<string, (typeof storedLeaves)[0]>();
    for (const leaf of storedLeaves) {
      storedByKey.set(`${leaf.scale}:${leaf.blockId}`, leaf);
    }

    const tamperedBlocks: TamperedBlockResult[] = [];
    const primaryHmacPassed = new Map<number, boolean>();
    let blocksChecked = 0;
    let blocksPassed = 0;
    let blocksFailed = 0;
    const candidateLeavesForMerkle = [];

    for (const scale of scalesToCheck) {
      const candidateLeaves = authenticateBlocksForScale({
        rgb: params.candidateRgb,
        width: params.candidateWidth,
        height: params.candidateHeight,
        scale,
        imageKey,
        algorithmVersion: pkg.algorithmVersion,
        dnaRecordId: pkg.dnaRecordId,
        globalDnaRef: pkg.globalDnaRef,
      });

      for (const cand of candidateLeaves) {
        blocksChecked += 1;
        const stored = storedByKey.get(`${cand.scale}:${cand.blockId}`);
        const passed = !!(stored && tagsEqual(cand.tag, stored.tag));
        if (scale === pkg.primaryScale) {
          primaryHmacPassed.set(cand.blockId, passed);
        }
        if (!passed) {
          blocksFailed += 1;
          tamperedBlocks.push({
            blockId: cand.blockId,
            scale: cand.scale,
            x: cand.x,
            y: cand.y,
            width: cand.width,
            height: cand.height,
            status: 'TAMPERED',
          });
        } else {
          blocksPassed += 1;
        }
        candidateLeavesForMerkle.push(cand);
      }
    }

    // Full-package merkle compare (all enrolled scales)
    let merkleRootMatch = false;
    if (blocksFailed > 0 && primaryOnly && scalesToCheck.length < pkg.scales.length) {
      merkleRootMatch = false;
    } else if (primaryOnly && scalesToCheck.length < pkg.scales.length) {
      const allCandidateLeaves = [];
      for (const scale of pkg.scales) {
        allCandidateLeaves.push(
          ...authenticateBlocksForScale({
            rgb: params.candidateRgb,
            width: params.candidateWidth,
            height: params.candidateHeight,
            scale,
            imageKey,
            algorithmVersion: pkg.algorithmVersion,
            dnaRecordId: pkg.dnaRecordId,
            globalDnaRef: pkg.globalDnaRef,
          }),
        );
      }
      merkleRootMatch = merkleRootHex(allCandidateLeaves) === pkg.merkleRoot;
    } else {
      merkleRootMatch = merkleRootHex(candidateLeavesForMerkle) === pkg.merkleRoot;
    }

    const matched = blocksFailed === 0 && merkleRootMatch;
    const status = matched ? 'MATCH' : 'TAMPERED';

    // Phase 2 — derived localization (only when package crypto trusted + geometry OK)
    const locStarted = Date.now();
    // Ensure primary map is complete even if we only checked primary already
    if (!primaryOnly || !primaryHmacPassed.size) {
      const primaryLeaves = authenticateBlocksForScale({
        rgb: params.candidateRgb,
        width: params.candidateWidth,
        height: params.candidateHeight,
        scale: pkg.primaryScale,
        imageKey,
        algorithmVersion: pkg.algorithmVersion,
        dnaRecordId: pkg.dnaRecordId,
        globalDnaRef: pkg.globalDnaRef,
      });
      for (const cand of primaryLeaves) {
        const stored = storedByKey.get(`${cand.scale}:${cand.blockId}`);
        primaryHmacPassed.set(cand.blockId, !!(stored && tagsEqual(cand.tag, stored.tag)));
      }
    }

    const localization = buildSpatialBlockLocalization({
      imageWidth: pkg.width,
      imageHeight: pkg.height,
      primaryScale: pkg.primaryScale,
      hmacPassedByBlockId: primaryHmacPassed,
      includeGridPreview: params.includeGridPreview === true,
    });
    const localizationMs = Date.now() - locStarted;

    // Phase 3A — HKCA fine localization (additive; does not alter Phase 1/2 crypto)
    let fineLocalization = null;
    let pixelLayer = null;
    let pixelVerificationMs = 0;
    if (
      pkg.pixelAuthBlob &&
      pkg.pixelAuthRoot &&
      pkg.pixelRootMac &&
      pkg.pixelAlgoVersion &&
      pkg.pixelScheme &&
      pkg.pixelKeyId &&
      pkg.pixelCellSize &&
      pkg.pixelTagBytes
    ) {
      const pixelPkg: PixelAuthPackageData = {
        algorithmVersion: pkg.pixelAlgoVersion,
        scheme: pkg.pixelScheme,
        keyId: pkg.pixelKeyId,
        cellSize: pkg.pixelCellSize,
        tagBytes: pkg.pixelTagBytes,
        pixelAuthBlob: pkg.pixelAuthBlob,
        pixelAuthRoot: pkg.pixelAuthRoot,
        pixelRootMac: pkg.pixelRootMac,
      };
      const pStart = Date.now();
      pixelLayer = verifyPixelAuthLayer({
        pixel: pixelPkg,
        dnaRecordId: pkg.dnaRecordId,
        ownerUserId: pkg.ownerUserId,
        width: pkg.width,
        height: pkg.height,
        globalDnaRef: pkg.globalDnaRef,
        orientationPolicy: pkg.orientationPolicy,
        candidateRgb: params.candidateRgb,
        candidateWidth: params.candidateWidth,
        candidateHeight: params.candidateHeight,
        masterSecret: params.masterSecret,
        drillParentBlocks: localization.tamperedBlocks.map((b) => ({
          blockId: b.blockId,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
        })),
      });
      pixelVerificationMs = Date.now() - pStart;
      fineLocalization = pixelLayer.fineLocalization;
    }

    // Phase 4B — lazy 4×4 under failed 8×8 (additive; no Phase 1/3A formula changes)
    let quad4Localization = null;
    let quad4VerificationMs = 0;
    if (
      !params.skipQuad4 &&
      isSpatialQuad4AuthEnabled() &&
      fineLocalization &&
      pixelLayer &&
      (pixelLayer.status === 'MATCH' || pixelLayer.status === 'TAMPERED') &&
      pixelLayer.packageIntegrityValid &&
      pixelLayer.pixelRootMacValid
    ) {
      const qStart = Date.now();
      const refW = params.referenceWidth ?? pkg.width;
      const refH = params.referenceHeight ?? pkg.height;
      const secret = params.masterSecret ?? spatialAuthConfig.masterSecret;

      if (!params.referenceRgb) {
        quad4Localization = {
          ...quad4Unavailable('REFERENCE_UNAVAILABLE'),
          verificationMs: Date.now() - qStart,
        };
      } else if (refW !== pkg.width || refH !== pkg.height) {
        quad4Localization = {
          ...quad4Unavailable('REFERENCE_DIMENSION_MISMATCH'),
          verificationMs: Date.now() - qStart,
        };
      } else {
        const refCheck = verifyExactSpatialAuth({
          packageData: pkg,
          candidateRgb: params.referenceRgb,
          candidateWidth: refW,
          candidateHeight: refH,
          masterSecret: secret,
          primaryScaleOnly: true,
          skipQuad4: true,
        });
        if (refCheck.status !== 'MATCH' || refCheck.pixelLayer?.status !== 'MATCH') {
          quad4Localization = {
            ...quad4Unavailable('REFERENCE_NOT_AUTHENTIC'),
            verificationMs: Date.now() - qStart,
          };
        } else {
          quad4Localization = verifyQuad4UnderFailed8x8({
            imageWidth: pkg.width,
            imageHeight: pkg.height,
            dnaRecordId: pkg.dnaRecordId,
            ownerUserId: pkg.ownerUserId,
            globalDnaRef: pkg.globalDnaRef,
            keyId: pkg.pixelKeyId ?? pkg.keyId,
            masterSecret: secret,
            failed8x8: fineLocalization.tamperedCells,
            candidateRgb: params.candidateRgb,
            referenceRgb: params.referenceRgb,
            orientationPolicy: pkg.orientationPolicy,
          });
        }
      }
      quad4VerificationMs = Date.now() - qStart;
    }

    // Phase 4C — lazy 2×2 under failed 4×4 (additive; requires trusted Phase 4B)
    let quad2Localization = null;
    let quad2VerificationMs = 0;
    if (
      !params.skipQuad4 &&
      !params.skipQuad2 &&
      isSpatialQuad2AuthEnabled()
    ) {
      const q2Start = Date.now();
      if (!quad4Localization) {
        quad2Localization = {
          ...quad2Unavailable('PARENT_4X4_REQUIRED'),
          verificationMs: Date.now() - q2Start,
        };
      } else if (!quad4Localization.trusted) {
        quad2Localization = {
          ...quad2Unavailable(
            quad4Localization.unavailableReason
              ? `PARENT_4X4_UNTRUSTED:${quad4Localization.unavailableReason}`
              : 'PARENT_4X4_UNTRUSTED',
          ),
          verificationMs: Date.now() - q2Start,
        };
      } else if (!params.referenceRgb) {
        quad2Localization = {
          ...quad2Unavailable('REFERENCE_UNAVAILABLE'),
          verificationMs: Date.now() - q2Start,
        };
      } else {
        const secret = params.masterSecret ?? spatialAuthConfig.masterSecret;
        quad2Localization = verifyQuad2UnderFailed4x4({
          imageWidth: pkg.width,
          imageHeight: pkg.height,
          dnaRecordId: pkg.dnaRecordId,
          ownerUserId: pkg.ownerUserId,
          globalDnaRef: pkg.globalDnaRef,
          keyId: pkg.pixelKeyId ?? pkg.keyId,
          masterSecret: secret,
          failed4x4: quad4Localization.tamperedCells,
          candidateRgb: params.candidateRgb,
          referenceRgb: params.referenceRgb,
          orientationPolicy: pkg.orientationPolicy,
        });
      }
      quad2VerificationMs = Date.now() - q2Start;
    }

    // Phase 4D/4E — lazy 1×1 under failed 2×2 against ENROLLED tags (requires trusted 4C)
    let pixel1Localization = null;
    let pixel1VerificationMs = 0;
    if (
      !params.skipQuad4 &&
      !params.skipQuad2 &&
      !params.skipPixel1 &&
      isSpatialPixel1AuthEnabled()
    ) {
      const p1Start = Date.now();
      if (!quad2Localization) {
        pixel1Localization = {
          ...pixel1Unavailable('PARENT_2X2_REQUIRED'),
          verificationMs: Date.now() - p1Start,
        };
      } else if (!quad2Localization.trusted) {
        pixel1Localization = {
          ...pixel1Unavailable(
            quad2Localization.unavailableReason
              ? `PARENT_2X2_UNTRUSTED:${quad2Localization.unavailableReason}`
              : 'PARENT_2X2_UNTRUSTED',
          ),
          verificationMs: Date.now() - p1Start,
        };
      } else if (
        !pkg.pixel1AuthBlob ||
        !pkg.pixel1AuthRoot ||
        !pkg.pixel1RootMac
      ) {
        pixel1Localization = {
          ...pixel1Unavailable('PIXEL1_PACKAGE_UNAVAILABLE'),
          verificationMs: Date.now() - p1Start,
        };
      } else {
        const secret = params.masterSecret ?? spatialAuthConfig.masterSecret;
        pixel1Localization = verifyPixel1UnderFailed2x2({
          imageWidth: pkg.width,
          imageHeight: pkg.height,
          dnaRecordId: pkg.dnaRecordId,
          ownerUserId: pkg.ownerUserId,
          globalDnaRef: pkg.globalDnaRef,
          keyId: pkg.pixel1KeyId ?? pkg.pixelKeyId ?? pkg.keyId,
          masterSecret: secret,
          failed2x2: quad2Localization.tamperedCells,
          candidateRgb: params.candidateRgb,
          orientationPolicy: pkg.orientationPolicy,
          pixel1AuthBlob: pkg.pixel1AuthBlob,
          pixel1AuthRoot: pkg.pixel1AuthRoot,
          pixel1RootMac: pkg.pixel1RootMac,
        });
      }
      pixel1VerificationMs = Date.now() - p1Start;
    }

    return withInvestigation({
      ...base,
      status,
      matched,
      tampered: !matched,
      blocksChecked,
      blocksPassed,
      blocksFailed,
      blocksUnknown: localization.stats.blocksUnknown,
      merkleRootMatch,
      rootMacValid: true,
      packageIntegrityValid: true,
      tamperedBlocks,
      exactPassRate: blocksChecked === 0 ? 0 : blocksPassed / blocksChecked,
      localization,
      fineLocalization,
      pixelLayer,
      quad4Localization,
      quad2Localization,
      pixel1Localization,
      localizationMs,
      pixelVerificationMs,
      quad4VerificationMs,
      quad2VerificationMs,
      pixel1VerificationMs,
      verificationMs: Date.now() - started,
    });
  } catch (err) {
    return emptyResult(base, {
      status: 'ERROR',
      rootMacValid: false,
      packageIntegrityValid: false,
      detail: String(err),
      verificationMs: Date.now() - started,
    });
  }
}
