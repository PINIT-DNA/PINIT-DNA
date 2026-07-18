/**
 * Enterprise Investigation Report — view model.
 * Maps existing Unified Investigation API output into the 11-section report contract.
 * Never invents forensic evidence; missing fields are marked unavailable.
 */

export type EvidenceAvailability = 'available' | 'unavailable' | 'skipped' | 'failed' | 'partial';

export interface EvidenceField<T = string | number | null> {
  value: T;
  availability: EvidenceAvailability;
  note?: string;
}

export interface EnterpriseReportStage {
  id: string;
  label: string;
  status: 'complete' | 'warning' | 'failed' | 'skipped' | string;
  detail?: string;
}

export interface EnterpriseInvestigationViewModel {
  summary: {
    investigationId: string;
    investigatedAt: string;
    status: string;
    finalVerdict: string;
    reportState: string | null;
    acceptanceVerdict: string | null;
    confidence: number;
    confidenceLabel: string;
    riskLevel: string;
    decisionReason: string | null;
    message: string | null;
  };
  stages: EnterpriseReportStage[];
  originalAsset: {
    vaultId: EvidenceField;
    dnaId: EvidenceField;
    certificateId: EvidenceField;
    /** Human status: ISSUED / VALID / NOT ISSUED / … — never stuffed into certificateId */
    certificateStatus: string;
    certificateIssued: boolean;
    ownerName: EvidenceField;
    ownerPinitId: EvidenceField;
    originalFilename: EvidenceField;
    ownershipVerified: boolean;
  };
  suspectAsset: {
    filename: EvidenceField;
    mimeType: EvidenceField;
    sizeBytes: EvidenceField<number | null>;
    sha256: EvidenceField;
  };
  retrieval: {
    assetsSearched: EvidenceField<number | null>;
    topCandidates: Array<{
      rank: number;
      vaultId: string;
      dnaRecordId: string;
      compositeScore: number;
      method: string;
      signals: string[];
      selected?: boolean;
      dnaMatchPercent?: number;
    }>;
    selectedVaultId: EvidenceField;
    retrievalConfidence: EvidenceField<number | null>;
  };
  layers: Array<{
    layer: number;
    name: string;
    score: number;
    status: string;
    explanation: string;
  }>;
  layersAvailability: EvidenceAvailability;
  layersNote?: string;
  visualAi: Array<{
    label: string;
    value: string;
    availability: EvidenceAvailability;
    note?: string;
  }>;
  tamper: {
    overallScore: number;
    primaryVector: string;
    description: string | null;
    changes: Array<{ type: string; detected: boolean; confidence: number; detail: string; where?: string }>;
    vectors: Array<{ label: string; detected: boolean; confidence?: number }>;
  };
  ownershipEvidence: Array<{
    label: string;
    status: string;
    detail: string;
    availability: EvidenceAvailability;
  }>;
  acceptance: {
    verdict: EvidenceField;
    confidence: EvidenceField<number | null>;
    policyVersion: EvidenceField;
    reason: EvidenceField;
    retainOwner: boolean;
  };
  evidenceTimeline: Array<{
    label: string;
    timestamp?: string;
    detail?: string;
  }>;
  investigationSteps: Array<{
    label: string;
    status: string;
    detail?: string;
    elapsedMs?: number;
  }>;
  /** PinIT Sentinel-style forensic evidence cards (Section 3) */
  evidenceCards: Array<{
    id: string;
    title: string;
    subtitle: string;
    statusLabel: string;
    confidence: number | null;
    matched: boolean;
    availability: EvidenceAvailability;
  }>;
  trustScore: number;
  evidenceStrength: 'Strong' | 'Medium' | 'Weak' | 'Insufficient';
  submissionReady: boolean;
  recommendedActions: string[];
  custodySteps: Array<{ label: string; date?: string; detail?: string }>;
}

type LooseReport = Record<string, unknown>;

function layerByNum(layers: EnterpriseInvestigationViewModel['layers'], n: number) {
  return layers.find((l) => l.layer === n);
}

function layerByName(layers: EnterpriseInvestigationViewModel['layers'], re: RegExp) {
  return layers.find((l) => re.test(l.name));
}

function buildEvidenceCards(
  r: LooseReport,
  layers: EnterpriseInvestigationViewModel['layers'],
  visualAi: EnterpriseInvestigationViewModel['visualAi'],
): EnterpriseInvestigationViewModel['evidenceCards'] {
  const proof = (r.identityProof ?? {}) as LooseReport;
  const wm = (proof.watermark ?? {}) as LooseReport;
  const dnaCmp = (r.dnaComparison ?? {}) as LooseReport;
  const layerComps = Array.isArray(dnaCmp.layerComparisons)
    ? (dnaCmp.layerComparisons as Array<LooseReport>)
    : [];

  const l1 = layerByNum(layers, 1) ?? layerByName(layers, /crypt|sha/i);
  const l3 = layerByNum(layers, 3) ?? layerByName(layers, /perceptual|phash|visual/i);
  const l5 = layerByNum(layers, 5) ?? layerByName(layers, /metadata|exif/i);
  const cryptoLayer = layerComps.find((l) => num(l.layer) === 1);

  const hashScore = l1?.score ?? (cryptoLayer ? num(cryptoLayer.similarityPercent) : null);
  const hashMatched = hashScore != null && hashScore >= 95;

  const phashScore = l3?.score ?? null;
  const phashMatched = phashScore != null && phashScore >= 70;

  const aiSignal = visualAi.find((v) => /clip|semantic|ai|visual|orb|embedding/i.test(v.label));
  const aiScore = aiSignal && aiSignal.availability === 'available'
    ? parseInt(aiSignal.value, 10)
    : (num((r.summary as LooseReport)?.dnaMatchPercent) ?? null);
  const aiMatched = aiScore != null && aiScore >= 65;

  const metaScore = l5?.score ?? null;
  const metaMatched = metaScore != null && metaScore >= 50;

  const wmStatus = str(wm.status);
  const wmConf = num(wm.confidence);
  const wmMatched = wmStatus === 'DETECTED' || wmStatus === 'DAMAGED';

  return [
    {
      id: 'hash',
      title: 'Hash Match',
      subtitle: 'SHA-256',
      statusLabel: hashScore == null ? 'Unavailable' : hashMatched ? 'Matched' : 'Mismatch',
      confidence: hashScore,
      matched: hashMatched,
      availability: hashScore != null ? 'available' : 'unavailable',
    },
    {
      id: 'phash',
      title: 'Perceptual Hash',
      subtitle: 'pHash / visual fingerprint',
      statusLabel: phashScore == null ? 'Unavailable' : phashMatched ? 'Matched' : 'Partial',
      confidence: phashScore,
      matched: phashMatched,
      availability: phashScore != null ? 'available' : 'unavailable',
    },
    {
      id: 'ai',
      title: 'AI Visual Match',
      subtitle: aiSignal?.label ?? 'Semantic / structural similarity',
      statusLabel: aiScore == null ? 'Unavailable' : aiMatched ? 'Matched' : 'Review',
      confidence: Number.isFinite(aiScore) ? aiScore : null,
      matched: aiMatched,
      availability: aiScore != null ? 'available' : 'unavailable',
    },
    {
      id: 'metadata',
      title: 'Metadata Comparison',
      subtitle: 'EXIF / XMP',
      statusLabel: metaScore == null ? 'Unavailable' : metaMatched ? 'Matched' : 'Changed',
      confidence: metaScore,
      matched: metaMatched,
      availability: metaScore != null ? 'available' : 'unavailable',
    },
    {
      id: 'watermark',
      title: 'Watermark Detection',
      subtitle: 'PinIT DNA watermark',
      statusLabel: wmStatus ?? 'Unavailable',
      confidence: wmConf ?? (wmMatched ? 100 : wmStatus ? 0 : null),
      matched: wmMatched,
      availability: wmStatus ? 'available' : 'unavailable',
    },
  ];
}

function evidenceStrengthFrom(
  cards: EnterpriseInvestigationViewModel['evidenceCards'],
  conf: number,
  layersAvailable: boolean,
): EnterpriseInvestigationViewModel['evidenceStrength'] {
  if (!layersAvailable && conf < 40) return 'Insufficient';
  const matched = cards.filter((c) => c.matched && c.availability === 'available').length;
  if (matched >= 4 && conf >= 85) return 'Strong';
  if (matched >= 2 && conf >= 55) return 'Medium';
  if (matched >= 1 || conf >= 40) return 'Weak';
  return 'Insufficient';
}

function recommendedActionsFor(
  verdict: string,
  reportState: string | null,
  ownershipVerified: boolean,
): string[] {
  const actions: string[] = [];
  if (reportState === 'VERIFIED' || /VERIFIED/i.test(verdict)) {
    actions.push('Certificate and ownership evidence may be disclosed to authorized parties');
    actions.push('Preserve vault DNA package and investigation export');
    actions.push('Attach signed PDF to legal or compliance workflow');
  } else if (reportState === 'POSSIBLE' || /POSSIBLE/i.test(verdict)) {
    actions.push('Manual review recommended — do not treat as verified ownership');
    actions.push('Compare side-by-side images and layer analysis before action');
    actions.push('Re-run investigation with original-quality probe if available');
  } else {
    actions.push('No verified vault match — treat as unknown asset');
    actions.push('Expand vault search or upload original to vault before re-investigation');
  }
  if (!ownershipVerified) {
    actions.push('Do not issue takedown or ownership claims until VERIFIED verdict');
  }
  return actions;
}

function buildCustodySteps(
  r: LooseReport,
  stages: EnterpriseReportStage[],
  evidenceTimeline: EnterpriseInvestigationViewModel['evidenceTimeline'],
): EnterpriseInvestigationViewModel['custodySteps'] {
  const steps: EnterpriseInvestigationViewModel['custodySteps'] = [];
  const investigatedAt = str(r.investigatedAt);
  const recovery = (r.identityRecoveryReport ?? {}) as LooseReport;
  if (recovery.registrationTimestamp || recovery.createdAt) {
    steps.push({
      label: 'Asset Registered',
      date: str(recovery.registrationTimestamp) ?? str(recovery.createdAt) ?? undefined,
      detail: 'Vault DNA sealed',
    });
  }
  steps.push({
    label: 'Probe Uploaded',
    date: investigatedAt ?? undefined,
    detail: str((r.pipelineAudit as LooseReport | undefined)?.probeImage
      ? ((r.pipelineAudit as LooseReport).probeImage as LooseReport).filename
      : null) ?? undefined,
  });
  for (const s of stages.filter((x) => x.status === 'complete').slice(0, 4)) {
    steps.push({ label: s.label, detail: s.detail });
  }
  if (evidenceTimeline.length) {
    steps.push({
      label: 'Chain of Custody',
      date: evidenceTimeline[0].timestamp,
      detail: `${evidenceTimeline.length} provenance events`,
    });
  }
  steps.push({
    label: 'Report Generated',
    date: investigatedAt ?? undefined,
    detail: 'Enterprise investigation report',
  });
  return steps;
}

function str(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function field<T>(
  value: T | null | undefined,
  empty: T,
  noteWhenMissing = 'Not available from this investigation',
): EvidenceField<T> {
  if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) {
    return { value: empty, availability: 'unavailable', note: noteWhenMissing };
  }
  return { value, availability: 'available' };
}

function verdictLabel(report: LooseReport): string {
  const summary = (report.summary ?? {}) as LooseReport;
  const acceptance = str(summary.acceptanceVerdict);
  if (acceptance) {
    const map: Record<string, string> = {
      VERIFIED_ORIGINAL: 'VERIFIED ORIGINAL',
      VERIFIED_DERIVATIVE: 'VERIFIED DERIVATIVE',
      POSSIBLE_MATCH: 'POSSIBLE MATCH',
      NOT_PINIT: 'UNKNOWN / NOT PINIT',
      INSUFFICIENT_EVIDENCE: 'INSUFFICIENT EVIDENCE',
    };
    return map[acceptance] ?? acceptance.replace(/_/g, ' ');
  }
  const state = str(summary.reportState);
  if (state === 'VERIFIED') return 'OWNERSHIP VERIFIED';
  if (state === 'POSSIBLE') return 'POSSIBLE MATCH';
  if (state === 'NO_SIGNATURE') return 'UNKNOWN ASSET';
  const manifest = report.manifest as LooseReport | undefined;
  if (manifest?.displayLabel) return String(manifest.displayLabel);
  return str(report.message) ?? 'Investigation complete';
}

function reportStatus(report: LooseReport, stages: EnterpriseReportStage[]): string {
  const summary = (report.summary ?? {}) as LooseReport;
  const reportState = str(summary.reportState);
  const acceptance = str(summary.acceptanceVerdict) ?? '';
  const isVerified = reportState === 'VERIFIED' || acceptance.startsWith('VERIFIED');

  // Certificate-not-issued is informational — do not brand a finished VERIFIED case as failed.
  const criticalFailed = stages.some((s) => {
    if (s.status !== 'failed') return false;
    const key = `${s.id} ${s.label}`.toLowerCase();
    return !key.includes('certificate');
  });
  const softWarned = stages.some((s) => {
    if (s.status !== 'warning' && s.status !== 'failed') return false;
    const key = `${s.id} ${s.label}`.toLowerCase();
    return key.includes('certificate') || s.status === 'warning';
  });

  if (summary.acceptanceVerdict === 'INSUFFICIENT_EVIDENCE') return 'Incomplete';
  if (isVerified && !criticalFailed) {
    return softWarned ? 'Investigation complete' : 'Investigation complete';
  }
  if (criticalFailed) return 'Completed with failures';
  if (softWarned) return 'Completed with warnings';
  if (report.success === false) return 'Incomplete';
  return 'Investigation complete';
}

/** Prefer a real certificate id; never treat status prose as an id. */
function resolveCertificateFields(
  owner: LooseReport,
  recovery: LooseReport,
  proof: LooseReport,
  summary: LooseReport,
  vaultId: string | null,
  dnaId: string | null,
): { certificateId: string | null; certificateStatus: string; certificateIssued: boolean } {
  const raw = str(owner.certificateId) ?? str(recovery.certificateId) ?? str(proof.certificateId);
  const looksLikeStatus = !!raw && /NOT[_\s-]?ISSUED|UNKNOWN|PENDING|no certificate|not issued/i.test(raw);
  const issuedId = raw && !looksLikeStatus ? raw : null;

  const rawStatus = str(summary.certificateStatus) ?? '';
  let certificateStatus = 'NOT ISSUED';
  if (issuedId) {
    if (/valid|active|issued/i.test(rawStatus)) certificateStatus = rawStatus.toUpperCase().split(/[—–-]/)[0].trim() || 'ISSUED';
    else certificateStatus = 'ISSUED';
  } else if (/not[_\s-]?issued/i.test(rawStatus) || looksLikeStatus) {
    certificateStatus = 'NOT ISSUED';
  } else if (rawStatus) {
    certificateStatus = rawStatus.split(/[—–]/)[0].trim().toUpperCase() || 'NOT ISSUED';
  }

  // Same derived reference pattern as CertificatesPage when issuance is pending.
  const derived = vaultId
    ? `CERT-DNA-${vaultId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
    : dnaId
      ? `CERT-DNA-${dnaId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
      : null;

  return {
    certificateId: issuedId ?? derived,
    certificateStatus,
    certificateIssued: !!issuedId,
  };
}

function pickVisualMetrics(report: LooseReport): EnterpriseInvestigationViewModel['visualAi'] {
  const out: EnterpriseInvestigationViewModel['visualAi'] = [];
  const forensic = (report.forensicEvidence ?? {}) as LooseReport;
  const reasons = Array.isArray(forensic.matchReasons)
    ? (forensic.matchReasons as Array<LooseReport>)
    : [];

  for (const r of reasons) {
    const label = str(r.label) ?? str(r.signal);
    const percent = num(r.percent);
    if (!label || percent == null) continue;
    out.push({
      label,
      value: `${Math.round(percent)}%${r.matched === false ? ' (not matched)' : ''}`,
      availability: 'available',
    });
  }

  const identity = (report.identityRecovery ?? {}) as LooseReport;
  const signals = Array.isArray(identity.signals) ? (identity.signals as Array<LooseReport>) : [];
  const visualLike = /visual|orb|perceptual|clip|semantic|local|patch|geometric|structural/i;
  for (const s of signals) {
    const label = str(s.label);
    const score = num(s.score);
    if (!label || score == null || !visualLike.test(label)) continue;
    if (out.some((m) => m.label === label)) continue;
    out.push({
      label,
      value: `${Math.round(score)}% · ${str(s.status) ?? 'recorded'}`,
      availability: s.status === 'skipped' ? 'skipped' : s.status === 'failed' ? 'failed' : 'available',
      note: str(s.detail) ?? undefined,
    });
  }

  if (typeof forensic.aiEdited === 'boolean') {
    out.push({
      label: 'AI edit signal',
      value: forensic.aiEdited
        ? `Detected${num(forensic.aiEditConfidence) != null ? ` (${Math.round(num(forensic.aiEditConfidence)!)}%)` : ''}`
        : 'Not detected',
      availability: 'available',
      note: str(forensic.aiEditReason) ?? undefined,
    });
  }

  if (out.length === 0) {
    out.push({
      label: 'Visual / AI metrics',
      value: '—',
      availability: 'unavailable',
      note: 'No visual or AI similarity metrics were returned for this investigation',
    });
  }
  return out;
}

function ownershipEvidence(report: LooseReport, ownershipVerified: boolean): EnterpriseInvestigationViewModel['ownershipEvidence'] {
  const summary = (report.summary ?? {}) as LooseReport;
  const proof = (report.identityProof ?? {}) as LooseReport;
  const wm = (proof.watermark ?? {}) as LooseReport;
  const recovery = (report.identityRecoveryReport ?? {}) as LooseReport;
  const timeline = Array.isArray(report.evidenceTimeline)
    ? (report.evidenceTimeline as unknown[])
    : Array.isArray(report.timeline)
      ? (report.timeline as unknown[])
      : [];

  const dnaPct = num(summary.dnaMatchPercent);
  const layers = Array.isArray(report.layerAnalysis) ? report.layerAnalysis.length : 0;

  return [
    {
      label: 'DNA Package / 15-layer compare',
      status: layers > 0
        ? `${dnaPct ?? '—'}% · ${layers} layers`
        : 'Not compared',
      detail: layers > 0
        ? (str(summary.decisionReason) ?? 'Layer comparison available')
        : '15-layer DNA comparison was not completed for this run',
      availability: layers > 0 ? 'available' : 'unavailable',
    },
    {
      label: 'Watermark',
      status: str(wm.status) ?? 'UNKNOWN',
      detail: str(wm.reason)
        ?? (wm.status === 'DETECTED'
          ? `Recovered${wm.confidence != null ? ` · ${wm.confidence}%` : ''}`
          : 'No watermark evidence returned'),
      availability: wm.status ? 'available' : 'unavailable',
    },
    {
      label: 'Certificate',
      status: str(summary.certificateStatus) ?? 'UNKNOWN',
      detail: str(proof.certificateId)
        ?? str((report.owner as LooseReport | undefined)?.certificateId)
        ?? str(recovery.certificateId)
        ?? 'No certificate reference on this report',
      availability: (proof.certificateId || (report.owner as LooseReport | undefined)?.certificateId || recovery.certificateId)
        ? 'available'
        : 'unavailable',
    },
    {
      label: 'Timeline / chain of custody',
      status: timeline.length ? `${timeline.length} events` : 'No events',
      detail: timeline.length
        ? 'Evidence timeline populated from vault provenance'
        : 'No timeline events were attached to this investigation',
      availability: timeline.length ? 'available' : 'unavailable',
    },
    {
      label: 'Ownership claim',
      status: ownershipVerified ? 'Verified' : 'Not verified',
      detail: ownershipVerified
        ? 'Acceptance retained ownership for this verdict'
        : 'Ownership is withheld until Acceptance returns a VERIFIED_* verdict',
      availability: ownershipVerified ? 'available' : 'partial',
    },
  ];
}

/**
 * Build the Enterprise Investigation Report view model from an existing API report.
 */
export function buildEnterpriseInvestigationViewModel(
  report: unknown,
): EnterpriseInvestigationViewModel {
  const r = (report ?? {}) as LooseReport;
  const summary = (r.summary ?? {}) as LooseReport;
  const owner = (r.owner ?? {}) as LooseReport;
  const proof = (r.identityProof ?? {}) as LooseReport;
  const recovery = (r.identityRecoveryReport ?? {}) as LooseReport;
  const dnaCmp = (r.dnaComparison ?? {}) as LooseReport;
  const fileB = (dnaCmp.fileB ?? {}) as LooseReport;
  const fileA = (dnaCmp.fileA ?? {}) as LooseReport;
  const audit = (r.pipelineAudit ?? {}) as LooseReport;
  const probe = (audit.probeImage ?? {}) as LooseReport;
  const tamper = (r.tamperAnalysis ?? {}) as LooseReport;
  const manifest = (r.manifest ?? {}) as LooseReport;

  const stages: EnterpriseReportStage[] = Array.isArray(r.pipeline)
    ? (r.pipeline as Array<LooseReport>).map((s) => ({
        id: String(s.id ?? s.label ?? ''),
        label: String(s.label ?? s.id ?? 'Stage'),
        status: String(s.status ?? 'skipped'),
        detail: str(s.detail) ?? undefined,
      }))
    : [];

  const ownershipVerified = summary.reportState === 'VERIFIED';
  const vaultId = str(owner.vaultId) ?? str(recovery.vaultId) ?? str(proof.vaultId);
  const dnaId = str(owner.dnaRecordId) ?? str(recovery.dnaRecordId) ?? str(proof.dnaRecordId);
  const certFields = resolveCertificateFields(owner, recovery, proof, summary, vaultId, dnaId);

  const candidates = Array.isArray(r.candidateRanking)
    ? (r.candidateRanking as Array<LooseReport>).map((c, i) => ({
        rank: num(c.rank) ?? i + 1,
        vaultId: String(c.vaultId ?? ''),
        dnaRecordId: String(c.dnaRecordId ?? ''),
        compositeScore: num(c.compositeScore) ?? 0,
        method: String(c.method ?? '—'),
        signals: Array.isArray(c.signals) ? (c.signals as string[]) : [],
        selected: Boolean(c.selected),
        dnaMatchPercent: num(c.dnaMatchPercent) ?? undefined,
      }))
    : Array.isArray(audit.candidateRanking)
      ? (audit.candidateRanking as Array<LooseReport>).map((c, i) => {
          const scores = (c.scores ?? {}) as LooseReport;
          return {
            rank: num(c.rank) ?? i + 1,
            vaultId: String(c.vaultId ?? ''),
            dnaRecordId: String(c.dnaRecordId ?? ''),
            compositeScore: num(scores.composite) ?? 0,
            method: 'pipeline_audit',
            signals: [] as string[],
            selected: Boolean(c.selected),
            dnaMatchPercent: num(scores.dna15Overall) ?? undefined,
          };
        })
      : [];

  const layersRaw = Array.isArray(r.layerAnalysis)
    ? (r.layerAnalysis as Array<LooseReport>)
    : [];
  const layers = layersRaw.map((l) => ({
    layer: num(l.layer) ?? 0,
    name: String(l.name ?? `Layer ${l.layer}`),
    score: num(l.matchPercent) ?? 0,
    status: String(l.status ?? 'skipped'),
    explanation: String(l.explanation ?? ''),
  }));

  const conf = num(summary.acceptanceConfidence)
    ?? num(manifest.confidence)
    ?? num(summary.dnaMatchPercent)
    ?? num(summary.retrievalConfidence)
    ?? num(summary.ownershipConfidence)
    ?? 0;

  const confLabel = num(summary.dnaMatchPercent) != null && (summary.dnaMatchPercent as number) >= 40
    ? 'DNA match'
    : num(summary.retrievalConfidence) != null
      ? 'Retrieval confidence'
      : 'Confidence';

  const evidenceTimeline = Array.isArray(r.evidenceTimeline) && (r.evidenceTimeline as unknown[]).length
    ? (r.evidenceTimeline as Array<LooseReport>).map((e) => ({
        label: String(e.eventType ?? e.summary ?? 'Event'),
        timestamp: str(e.timestamp) ?? undefined,
        detail: str(e.summary) ?? str(e.locationLabel) ?? undefined,
      }))
    : Array.isArray(r.timeline)
      ? (r.timeline as Array<LooseReport>).map((e) => ({
          label: String(e.stage ?? 'Stage'),
          timestamp: str(e.timestamp) ?? undefined,
          detail: str(e.detail) ?? undefined,
        }))
      : [];

  const investigationSteps = Array.isArray(r.progressTimeline)
    ? (r.progressTimeline as Array<LooseReport>).map((e) => ({
        label: String(e.label ?? e.stepId ?? 'Step'),
        status: String(e.status ?? 'complete'),
        detail: str(e.detail) ?? undefined,
        elapsedMs: num(e.elapsedMs) ?? undefined,
      }))
    : stages.map((s) => ({
        label: s.label,
        status: s.status,
        detail: s.detail,
      }));

  const assetsSearched = num(audit.vaultRecordsLoaded)
    ?? (candidates.length > 0 ? candidates.length : null);

  const changes = Array.isArray(tamper.changesVsOriginal)
    ? (tamper.changesVsOriginal as Array<LooseReport>).map((c) => ({
        type: String(c.type ?? 'Change'),
        detected: Boolean(c.detected),
        confidence: num(c.confidence) ?? 0,
        detail: String(c.detail ?? ''),
        where: str(c.where) ?? undefined,
      }))
    : [];

  const vectors = Array.isArray(tamper.vectors)
    ? (tamper.vectors as Array<LooseReport>).map((v) => ({
        label: String(v.label ?? 'Vector'),
        detected: Boolean(v.detected),
        confidence: num(v.confidence) ?? undefined,
      }))
    : [];

  const visualAi = pickVisualMetrics(r);
  const evidenceCards = buildEvidenceCards(r, layers, visualAi);
  const layersOk = layers.length > 0;
  const trustScore = Math.round(
    num(summary.trustScore)
    ?? num((r.identityRecovery as LooseReport | undefined)?.compositeScores
      ? ((r.identityRecovery as LooseReport).compositeScores as LooseReport).trustScore
      : null)
    ?? conf,
  );
  const evidenceStrength = evidenceStrengthFrom(evidenceCards, conf, layersOk);
  const finalVerdict = verdictLabel(r);
  const reportStateStr = str(summary.reportState);
  const submissionReady = reportStateStr === 'VERIFIED'
    && evidenceStrength !== 'Insufficient'
    && !stages.some((s) => {
      if (s.status !== 'failed') return false;
      return !`${s.id} ${s.label}`.toLowerCase().includes('certificate');
    });

  return {
    summary: {
      investigationId: String(r.investigationId ?? '—'),
      investigatedAt: String(r.investigatedAt ?? new Date().toISOString()),
      status: reportStatus(r, stages),
      finalVerdict,
      reportState: str(summary.reportState),
      acceptanceVerdict: str(summary.acceptanceVerdict),
      confidence: Math.round(conf),
      confidenceLabel: confLabel,
      riskLevel: str(summary.riskLevel) ?? 'UNKNOWN',
      decisionReason: str(summary.decisionReason) ?? str(manifest.decisionReason),
      message: str(r.message),
    },
    stages,
    originalAsset: {
      vaultId: field(vaultId, '—'),
      dnaId: field(dnaId, '—'),
      certificateId: field(
        certFields.certificateId,
        'Pending issuance',
        'No certificate issued yet — derived DNA reference shown for tracking',
      ),
      certificateStatus: certFields.certificateStatus,
      certificateIssued: certFields.certificateIssued,
      ownerName: field(
        ownershipVerified || summary.reportState === 'POSSIBLE'
          ? (str(owner.ownerName) ?? str(recovery.originalOwner))
          : null,
        '—',
        ownershipVerified ? 'Owner not resolved' : 'Owner withheld until verified',
      ),
      ownerPinitId: field(
        ownershipVerified || summary.reportState === 'POSSIBLE'
          ? (str(owner.ownerPinitId) ?? str(recovery.ownerPinitId) ?? str(proof.ownerPinitId))
          : null,
        '—',
        'PINIT ID withheld until verified',
      ),
      originalFilename: field(
        str(owner.originalFilename) ?? str(recovery.originalFilename) ?? str(fileA.filename),
        '—',
      ),
      ownershipVerified,
    },
    suspectAsset: {
      filename: field(str(fileB.filename) ?? str(probe.filename), '—'),
      mimeType: field(str(fileB.mimeType) ?? str(probe.mimeType), '—'),
      sizeBytes: field(num(fileB.sizeBytes) ?? num(probe.sizeBytes), null as number | null),
      sha256: field(str(r.currentFileHash) ?? str(probe.sha256) ?? str(recovery.currentHash), '—'),
    },
    retrieval: {
      assetsSearched: field(assetsSearched, null as number | null, 'Vault search count not recorded'),
      topCandidates: candidates,
      selectedVaultId: field(vaultId, '—', 'No authoritative candidate selected'),
      retrievalConfidence: field(
        num(summary.retrievalConfidence) ?? num(summary.ownershipConfidence),
        null as number | null,
      ),
    },
    layers,
    layersAvailability: layers.length > 0 ? 'available' : 'unavailable',
    layersNote: layers.length > 0
      ? undefined
      : 'No layer comparison — vault match or deep DNA compare required',
    visualAi,
    tamper: {
      overallScore: num(tamper.overallTamperScore) ?? 0,
      primaryVector: str(tamper.primaryVector) ?? 'NONE',
      description: str(tamper.description),
      changes,
      vectors,
    },
    ownershipEvidence: ownershipEvidence(r, ownershipVerified),
    acceptance: {
      verdict: field(str(summary.acceptanceVerdict) ?? str(summary.reportState), '—'),
      confidence: field(num(summary.acceptanceConfidence) ?? conf, null as number | null),
      policyVersion: field(
        str(summary.acceptancePolicyVersion) ?? str(manifest.acceptancePolicyVersion),
        '—',
        'Policy version not attached to this report',
      ),
      reason: field(
        str(summary.decisionReason) ?? str(manifest.decisionReason) ?? str(r.message),
        '—',
      ),
      retainOwner: ownershipVerified,
    },
    evidenceTimeline,
    investigationSteps,
    evidenceCards,
    trustScore,
    evidenceStrength,
    submissionReady,
    recommendedActions: recommendedActionsFor(finalVerdict, reportStateStr, ownershipVerified),
    custodySteps: buildCustodySteps(r, stages, evidenceTimeline),
  };
}
