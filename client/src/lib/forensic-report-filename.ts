/**
 * Evidence-report file names are filed under the investigated asset, not the
 * investigation UUID. Keep sanitisation conservative so the name stays readable.
 */
import { buildEnterpriseInvestigationViewModel } from './enterprise-investigation-report-model';

export function stripAssetExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,8}$/, '').trim();
}

/**
 * The name of the thing that was investigated — the subject of the document.
 * Prefer the original asset on record; fall back to the examined file only when
 * no original was retrieved, and never fall back to the investigation UUID.
 */
export function investigatedAssetName(report: unknown): string {
  const vm = buildEnterpriseInvestigationViewModel(report);
  const r = (report ?? {}) as Record<string, unknown>;
  const owner = (r.owner ?? {}) as Record<string, unknown>;
  const dna = (r.dnaComparison ?? {}) as Record<string, unknown>;
  const fileA = (dna.fileA ?? {}) as Record<string, unknown>;
  const fileB = (dna.fileB ?? {}) as Record<string, unknown>;
  const recovery = (r.identityRecoveryReport ?? {}) as Record<string, unknown>;

  const candidates: unknown[] = [
    vm.originalAsset.originalFilename.value,
    owner.originalFilename,
    fileA.filename,
    recovery.originalFilename,
    vm.suspectAsset.filename.value,
    fileB.filename,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const name = stripAssetExtension(candidate);
    if (name && name !== '—' && name.toLowerCase() !== 'unknown') return name;
  }
  return 'Unidentified Asset';
}

/**
 * Filesystem-safe without becoming unreadable: drop only what Windows, macOS and
 * Linux actually reject, keep spaces and case. A name that sanitises down to
 * nothing would produce " - Evidence Report.pdf", so guard that too.
 */
export function safeFilenamePart(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 120)
    .trim();
  return cleaned || 'Unidentified Asset';
}

/** The asset's own name, safe to put on disk — the stem every export is filed under. */
export function forensicExportBaseName(report: unknown): string {
  return safeFilenamePart(investigatedAssetName(report));
}

/** "<Asset Name> - Evidence Report.pdf" — filed under what it is about. */
export function forensicReportFilename(
  report: unknown,
  suffix = 'Evidence Report',
): string {
  return `${forensicExportBaseName(report)} - ${suffix}.pdf`;
}
