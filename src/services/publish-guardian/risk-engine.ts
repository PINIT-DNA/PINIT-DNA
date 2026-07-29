/**
 * Publish Guardian Risk Engine — severity from DNA match + tamper signals.
 */

export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskInput {
  similarity: number; // 0–1 or 0–100
  matchType: string;
  tampered: boolean;
  dnaMatchPercent?: number;
  priorDiscoveries?: number;
  priorTampered?: number;
}

export interface RiskResult {
  score: number; // 0–100
  severity: RiskSeverity;
  reasons: string[];
  recommendInvestigation: boolean;
  recommendAlert: boolean;
}

function normPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n <= 1 ? n * 100 : Math.min(100, Math.max(0, n));
}

export function evaluateRisk(input: RiskInput): RiskResult {
  const sim = normPct(input.similarity);
  const dna = input.dnaMatchPercent != null ? normPct(input.dnaMatchPercent) : sim;
  const reasons: string[] = [];
  let score = Math.round(Math.max(sim, dna) * 0.7);

  if (/EXACT|DUPLICATE/i.test(input.matchType)) {
    score = Math.max(score, 88);
    reasons.push('Exact / duplicate match');
  } else if (/NEAR/i.test(input.matchType)) {
    score = Math.max(score, 72);
    reasons.push('Near-match derivative');
  } else if (/POSSIBLE/i.test(input.matchType)) {
    score = Math.max(score, 55);
    reasons.push('Possible visual match');
  }

  if (input.tampered) {
    score = Math.min(100, score + 12);
    reasons.push('Tampering indicators present');
  }

  if ((input.priorDiscoveries ?? 0) >= 3) {
    score = Math.min(100, score + 5);
    reasons.push('Repeated discoveries');
  }
  if ((input.priorTampered ?? 0) >= 1) {
    score = Math.min(100, score + 5);
    reasons.push('Prior tampered copies');
  }

  score = Math.min(100, Math.max(0, score));

  let severity: RiskSeverity = 'LOW';
  if (score >= 90) severity = 'CRITICAL';
  else if (score >= 75) severity = 'HIGH';
  else if (score >= 50) severity = 'MEDIUM';

  return {
    score,
    severity,
    reasons,
    recommendInvestigation: severity === 'HIGH' || severity === 'CRITICAL' || input.tampered,
    recommendAlert: score >= 50,
  };
}

export function severityRank(s: RiskSeverity): number {
  return { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[s];
}

export function maxSeverity(a: RiskSeverity, b: RiskSeverity): RiskSeverity {
  return severityRank(a) >= severityRank(b) ? a : b;
}
