/**
 * Client-side forensic report store — DNA comparisons + unified investigations.
 * Persisted in localStorage; legacy sessionStorage comparisons are migrated on read.
 */

import type { ComparisonResult } from '../types/dashboard.types';

const STORAGE_KEY = 'pinit_forensic_reports';
const LEGACY_COMPARISON_KEY = 'pinit_dna_reports';
const MAX_REPORTS = 50;

export const FORENSIC_REPORTS_UPDATED_EVENT = 'pinit-forensic-reports-updated';

/** Minimal investigation payload for list/detail views (full report from unified investigation). */
export type StoredInvestigationReport = Record<string, unknown> & {
  investigationId: string;
  investigatedAt: string;
  summary: {
    ownershipConfidence?: number;
    retrievalConfidence?: number;
    ownershipVerificationConfidence?: number;
    identityConfidence?: number;
    trustScore?: number;
    dnaMatchPercent?: number;
    riskLevel?: string;
    forensicVerdict?: string;
    reportState?: string;
    tamperSeverity?: string;
    identityStatus?: string;
    decisionReason?: string;
  };
  owner?: {
    originalFilename?: string | null;
    ownerPinitId?: string | null;
    ownerName?: string | null;
    vaultId?: string | null;
    dnaRecordId?: string | null;
    certificateId?: string | null;
  };
  timeline?: Array<{ stage: string; timestamp?: string; detail?: string }>;
  evidenceTimeline?: Array<{ eventType: string; summary: string; timestamp: string }>;
  identityRecoveryReport?: {
    originalOwner?: string | null;
    ownerPinitId?: string | null;
    vaultId?: string;
    dnaRecordId?: string | null;
    certificateId?: string | null;
    originalFilename?: string;
    message?: string;
    recovered?: boolean;
  };
  message?: string;
};

export type StoredForensicReport =
  | { kind: 'comparison'; id: string; savedAt: string; data: ComparisonResult }
  | { kind: 'investigation'; id: string; savedAt: string; filename: string; data: StoredInvestigationReport };

function notifyUpdated(): void {
  try {
    window.dispatchEvent(new CustomEvent(FORENSIC_REPORTS_UPDATED_EVENT));
  } catch { /* SSR */ }
}

function readRaw(): StoredForensicReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return migrateLegacyComparisons();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : migrateLegacyComparisons();
  } catch {
    return [];
  }
}

function writeRaw(reports: StoredForensicReport[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports.slice(0, MAX_REPORTS)));
    notifyUpdated();
  } catch { /* quota / privacy mode */ }
}

/** One-time migration from ComparePage sessionStorage format. */
function migrateLegacyComparisons(): StoredForensicReport[] {
  const migrated: StoredForensicReport[] = [];
  try {
    const raw = sessionStorage.getItem(LEGACY_COMPARISON_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    for (const item of parsed) {
      if (item && typeof item === 'object' && typeof item.comparisonId === 'string') {
        migrated.push({
          kind: 'comparison',
          id: item.comparisonId,
          savedAt: item.comparedAt ?? new Date().toISOString(),
          data: item as ComparisonResult,
        });
      }
    }
    if (migrated.length > 0) {
      writeRaw(migrated);
      sessionStorage.removeItem(LEGACY_COMPARISON_KEY);
    }
  } catch { /* ignore */ }
  return migrated;
}

export function listForensicReports(): StoredForensicReport[] {
  return readRaw();
}

export function getForensicReportCount(): number {
  return readRaw().length;
}

/** Preserve live SSE vault candidate fields when final API report omits them (enrichment timeout).
 * Never upgrade NO_SIGNATURE into ownership-verified, and never reinject owner when Acceptance withheld. */
export function mergeLiveSnapshotIntoReport(
  report: StoredInvestigationReport,
  snapshot: {
    ownerName?: string;
    ownerPinitId?: string;
    vaultId?: string;
    dnaRecordId?: string;
    originalFilename?: string;
    confidence?: number;
    dnaMatchPercent?: number;
  } | null,
): StoredInvestigationReport {
  if (!snapshot) return report;
  const reportState = report.summary?.reportState;
  const ownershipVerified = reportState === 'VERIFIED';

  const merged: StoredInvestigationReport = {
    ...report,
    owner: { ...(report.owner ?? {}) },
    summary: { ...(report.summary ?? {}) },
    identityRecoveryReport: report.identityRecoveryReport
      ? { ...report.identityRecoveryReport }
      : undefined,
  };

  const owner = merged.owner ?? {};
  // Candidate vault/DNA for visual compare; also surface registrant + cert on POSSIBLE
  if (!owner.vaultId && snapshot.vaultId) owner.vaultId = snapshot.vaultId;
  if (!owner.dnaRecordId && snapshot.dnaRecordId) owner.dnaRecordId = snapshot.dnaRecordId;
  if (!owner.originalFilename && snapshot.originalFilename) owner.originalFilename = snapshot.originalFilename;

  // Prefer live SSE vault when final report locked a different lookalike (common crop FP).
  // Never overrides VERIFIED ownership.
  const liveConfEarly = snapshot.dnaMatchPercent ?? snapshot.confidence;
  if (
    !ownershipVerified
    && snapshot.vaultId
    && owner.vaultId
    && snapshot.vaultId !== owner.vaultId
    && (liveConfEarly ?? 0) >= 40
  ) {
    const liveName = (snapshot.originalFilename ?? '').toLowerCase();
    const reportName = (owner.originalFilename ?? '').toLowerCase();
    const liveLooksLikeProbeFamily = /whatsapp|crop|screenshot/i.test(liveName);
    const reportLooksUnrelated = reportName.length > 0
      && liveName.length > 0
      && !reportName.includes(liveName.slice(0, 12))
      && !liveName.includes(reportName.slice(0, 12));
    const liveDnaStronger = (liveConfEarly ?? 0) >= (merged.summary?.dnaMatchPercent ?? 0);
    if ((liveLooksLikeProbeFamily && reportLooksUnrelated) || liveDnaStronger) {
      owner.vaultId = snapshot.vaultId;
      if (snapshot.dnaRecordId) owner.dnaRecordId = snapshot.dnaRecordId;
      if (snapshot.originalFilename) owner.originalFilename = snapshot.originalFilename;
    }
  }

  const showCandidateIds = ownershipVerified || reportState === 'POSSIBLE';
  if (showCandidateIds) {
    if (!owner.ownerName && snapshot.ownerName) owner.ownerName = snapshot.ownerName;
    if (!owner.ownerPinitId && snapshot.ownerPinitId) owner.ownerPinitId = snapshot.ownerPinitId;
  }
  merged.owner = owner;

  const liveConf = snapshot.dnaMatchPercent ?? snapshot.confidence;
  if (liveConf != null) {
    const summary = merged.summary ?? {};
    if (!summary.retrievalConfidence || summary.retrievalConfidence < liveConf) {
      summary.retrievalConfidence = Math.round(liveConf);
    }
    // Do not inflate ownership confidence from live lookalike scores
    if (ownershipVerified && (!summary.ownershipConfidence || summary.ownershipConfidence < liveConf)) {
      summary.ownershipConfidence = Math.round(liveConf);
    }
    merged.summary = summary;
  }

  if (showCandidateIds && (snapshot.ownerPinitId || snapshot.vaultId)) {
    const recovery = merged.identityRecoveryReport ?? {};
    merged.identityRecoveryReport = {
      ...recovery,
      originalOwner: recovery.originalOwner ?? snapshot.ownerName ?? null,
      ownerPinitId: recovery.ownerPinitId ?? snapshot.ownerPinitId ?? null,
      vaultId: recovery.vaultId ?? snapshot.vaultId,
      dnaRecordId: recovery.dnaRecordId ?? snapshot.dnaRecordId,
      originalFilename: recovery.originalFilename ?? snapshot.originalFilename,
      recovered: ownershipVerified ? true : (recovery.recovered ?? false),
    };
  } else if (snapshot.vaultId && !merged.identityRecoveryReport?.vaultId) {
    const recovery = merged.identityRecoveryReport ?? {};
    merged.identityRecoveryReport = {
      ...recovery,
      vaultId: recovery.vaultId ?? snapshot.vaultId,
      dnaRecordId: recovery.dnaRecordId ?? snapshot.dnaRecordId,
      originalFilename: recovery.originalFilename ?? snapshot.originalFilename,
      recovered: false,
    };
  }

  const hasVault = !!(merged.owner?.vaultId || snapshot.vaultId);
  const summaryConf = Math.max(
    typeof liveConf === 'number' ? liveConf : 0,
    typeof merged.summary?.retrievalConfidence === 'number' ? merged.summary.retrievalConfidence : 0,
    typeof merged.summary?.dnaMatchPercent === 'number' ? merged.summary.dnaMatchPercent : 0,
  );
  // Only upgrade NO_SIGNATURE → POSSIBLE when there is real scored evidence (not vault filename alone).
  if (hasVault && summaryConf >= 55 && reportState !== 'VERIFIED' && reportState !== 'POSSIBLE') {
    const summary = merged.summary ?? {};
    // Mid-band live rescue stays POSSIBLE similarity — never ORIGINAL_FOUND_PARTIAL ownership label
    if (!summary.forensicVerdict || summary.forensicVerdict === 'NO_SIGNATURE') {
      summary.forensicVerdict = 'POSSIBLE_ASSET';
      summary.reportState = 'POSSIBLE';
    }
    if (!summary.identityStatus || summary.identityStatus === 'NOT_FOUND') {
      summary.identityStatus = 'FOUND';
    }
    if (!summary.riskLevel || summary.riskLevel === 'UNKNOWN') {
      summary.riskLevel = 'MEDIUM';
    }
    merged.summary = summary;
  }

  if (hasVault) {
    const proof = (merged as { identityProof?: Record<string, unknown> }).identityProof ?? {};
    (merged as { identityProof?: Record<string, unknown> }).identityProof = {
      ...proof,
      vaultId: proof.vaultId ?? snapshot.vaultId ?? merged.owner?.vaultId,
      dnaRecordId: proof.dnaRecordId ?? snapshot.dnaRecordId ?? merged.owner?.dnaRecordId,
      ownerPinitId: showCandidateIds
        ? (proof.ownerPinitId ?? snapshot.ownerPinitId ?? merged.owner?.ownerPinitId)
        : undefined,
    };
  }

  return merged;
}

export function saveComparisonReport(result: ComparisonResult): void {
  const existing = readRaw().filter(r => r.id !== result.comparisonId);
  const entry: StoredForensicReport = {
    kind: 'comparison',
    id: result.comparisonId,
    savedAt: result.comparedAt ?? new Date().toISOString(),
    data: result,
  };
  writeRaw([entry, ...existing]);
}

export function saveInvestigationReport(
  report: StoredInvestigationReport,
  filename: string,
): void {
  const normalized = filename.trim().toLowerCase();
  const existing = readRaw().filter((r) => {
    if (r.id === report.investigationId) return false;
    if (r.kind === 'investigation' && r.filename.trim().toLowerCase() === normalized) return false;
    return true;
  });
  const entry: StoredForensicReport = {
    kind: 'investigation',
    id: report.investigationId,
    savedAt: new Date().toISOString(),
    filename,
    data: report,
  };
  writeRaw([entry, ...existing]);
}

export function clearForensicReports(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_COMPARISON_KEY);
    notifyUpdated();
  } catch { /* ignore */ }
}
