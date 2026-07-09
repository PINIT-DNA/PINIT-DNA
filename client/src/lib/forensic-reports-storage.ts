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
    originalFilename?: string;
    message?: string;
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
