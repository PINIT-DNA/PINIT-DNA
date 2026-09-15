import { PIXEL_EVIDENCE_POLICY } from '../../types/dna-vnext.types';
import type {
  DnaVnextInvestigationSection,
  DnaVnextProvenanceRecord,
  RobustWatermarkRecovery,
} from '../../types/dna-vnext.types';

export function buildDnaVnextInvestigationSection(params: {
  provenance?: DnaVnextProvenanceRecord | null;
  watermark?: RobustWatermarkRecovery | null;
  spatialMatch: boolean;
  hmacAvailable: boolean;
  transformations: string[];
}): DnaVnextInvestigationSection {
  const wm = params.watermark?.recovered ? params.watermark : null;
  return {
    policy: PIXEL_EVIDENCE_POLICY,
    mechanisms: {
      dnaA: {
        present: params.hmacAvailable,
        role: 'Cryptographic authentication of mapped 8×8 patches after spatial alignment',
      },
      dnaB: {
        present: !!wm,
        role: 'Robust provenance / candidate recovery. Does not classify pixels.',
        recovery: wm,
      },
      dnaC: {
        present: params.spatialMatch,
        role: 'Spatial fingerprints (patches, tiles, features) locate where vault content appears',
      },
    },
    provenance: params.provenance ?? null,
    transformations: params.transformations,
    note:
      'Green/orange/grey is a 1×1 localization map of the upload. '
      + 'A pixel is classified from its surrounding authenticated region, not because it stores a Vault ID. '
      + 'Watermark recovery never paints the whole image green.',
  };
}

export function transformationsFromTamper(tamper: {
  cropDetection?: { homographyFound?: boolean; cropPercent?: number; missingPercent?: number } | null;
  changesVsOriginal?: Array<{ type: string; detected?: boolean }>;
  primaryVector?: string | null;
}): string[] {
  const out: string[] = [];
  if (tamper.cropDetection?.homographyFound) out.push('geometric_alignment');
  if ((tamper.cropDetection?.cropPercent ?? tamper.cropDetection?.missingPercent ?? 0) > 2) {
    out.push('crop_or_partial_frame');
  }
  for (const c of tamper.changesVsOriginal ?? []) {
    if (c.detected) out.push(c.type.toLowerCase().replace(/\s+/g, '_'));
  }
  if (tamper.primaryVector && tamper.primaryVector !== 'UNKNOWN') {
    out.push(tamper.primaryVector.toLowerCase());
  }
  return [...new Set(out)];
}
