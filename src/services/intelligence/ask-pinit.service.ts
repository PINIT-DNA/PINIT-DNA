/**
 * PINIT Intelligence — Ask PINIT.
 *
 * The model never sees a database. This service loads owner-scoped rows,
 * classifies each field as recorded / derived / unknown, then answers from
 * those facts only.
 */
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { classifyProtectOrigin, protectOriginLabel } from '../../lib/protect-origin';
import { reverseGeocodePlace } from '../../lib/reverse-geocode';
import { getOwnerActivity, type ActivityFile } from '../tracking/asset-activity.service';
import {
  intentNeedsAsset,
  parseAskPinitIntent,
  parseAskPinitTimeRange,
  parseLocationQuestionKind,
  questionRefersToCurrentAsset,
  questionUsesFollowUpPronoun,
  extractSearchTokens,
  type AskPinitIntent,
} from './ask-pinit-intent';
import {
  buildIntelligenceReportPayload,
  chunksFromIntelligenceReport,
  generateFromEvidence,
  retrieveEvidenceChunks,
} from './ask-pinit-rag';
import { resolveAsset, lastConversationAsset, type ConversationHint } from './ask-pinit-resolve';

export type FactKind = 'recorded' | 'derived' | 'unknown';

export interface AskPinitBlock {
  kind: 'heading' | 'fact' | 'note' | 'event';
  text: string;
  citation: FactKind;
}

export interface AskPinitLink {
  label: string;
  href: string;
}

export interface AskPinitReply {
  intent: AskPinitIntent;
  title: string;
  spoken: string;
  answer: string;
  confidence: number;
  blocks: AskPinitBlock[];
  links: AskPinitLink[];
  resolved?: { vaultId?: string; assetId?: string | null; filename?: string };
}

type VaultFact = {
  vaultId: string;
  assetId: string | null;
  dnaRecordId: string;
  filename: string;
  mimeType: string;
  protectedAt: Date;
  sha256: string | null;
  status: string;
  contentLabel: string | null;
  capturedAt: Date | null;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsPlaceName: string | null;
  gpsFullAddress: string | null;
  gpsVillage: string | null;
  gpsMandal: string | null;
  gpsDistrict: string | null;
  gpsCity: string | null;
  gpsState: string | null;
  gpsPincode: string | null;
  gpsCountry: string | null;
  device: string | null;
  lastVerifyAt: Date | null;
  lastVerifyPassed: boolean | null;
  authenticityVerdict: string | null;
  authenticityDisplay: string | null;
  authenticitySummary: string | null;
  aiProbability: number | null;
  analysisStatus: string | null;
  software: string | null;
  captureMethod: string | null;
};

function readAuthenticity(raw: unknown): {
  verdict: string | null;
  display: string | null;
  summary: string | null;
  aiProbability: number | null;
} {
  if (!raw || typeof raw !== 'object') {
    return { verdict: null, display: null, summary: null, aiProbability: null };
  }
  const o = raw as Record<string, unknown>;
  const scores = (o.scores && typeof o.scores === 'object') ? o.scores as Record<string, unknown> : {};
  const verdict = typeof o.verdict === 'string' ? o.verdict : typeof o.label === 'string' ? o.label : null;
  const display = typeof o.verdictDisplay === 'string' ? o.verdictDisplay
    : typeof o.labelDisplay === 'string' ? o.labelDisplay
      : verdict;
  const summary = typeof o.summary === 'string' ? o.summary : null;
  const aiProbability = typeof scores.aiProbability === 'number' ? scores.aiProbability : null;
  return { verdict, display, summary, aiProbability };
}

type ShareFact = {
  id: string;
  vaultId: string;
  filename: string;
  token: string;
  createdAt: Date;
  isActive: boolean;
  linkType: string;
  viewCount: number;
  downloadCount: number;
  recipientLabel: string | null;
  recipientEmail: string | null;
  expiresAt: Date | null;
};

function fmtWhen(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

function shortHash(h: string | null): string | null {
  if (!h) return null;
  if (h.length < 20) return h;
  return `${h.slice(0, 8)}…${h.slice(-8)}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(): Date {
  const d = startOfToday();
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d;
}

function pickVault(
  vaults: VaultFact[],
  question: string,
  contextVaultId?: string,
  conversation?: ConversationHint[],
): VaultFact | null {
  const hit = resolveAsset(vaults, question, { contextVaultId, conversation });
  return hit ? vaults.find((v) => v.vaultId === hit.vaultId) ?? null : null;
}

function block(kind: AskPinitBlock['kind'], text: string, citation: FactKind): AskPinitBlock {
  return { kind, text, citation };
}

function linksFor(v: VaultFact): AskPinitLink[] {
  const links: AskPinitLink[] = [
    { label: 'Open Living Asset', href: `/vault/${encodeURIComponent(v.vaultId)}` },
  ];
  if (v.assetId) {
    links.push({ label: 'View Timeline', href: `/tracking/${encodeURIComponent(v.assetId)}` });
  } else {
    links.push({ label: 'Open Tracking', href: '/tracking' });
  }
  links.push({ label: 'Open Intelligence Report', href: `/intelligence/${encodeURIComponent(v.vaultId)}` });
  return links;
}

async function loadFacts(ownerUserId: string) {
  const vaultRows = await prisma.vaultRecord.findMany({
    where: { dnaRecord: { ownerUserId } },
    orderBy: { createdAt: 'desc' },
    take: 150,
    select: {
      id: true,
      originalFileName: true,
      originalMimeType: true,
      createdAt: true,
      contentLabel: true,
      contentAnalysis: true,
      contentAnalysisStatus: true,
      dnaRecordId: true,
      dnaRecord: {
        select: {
          id: true,
          sha256Hash: true,
          status: true,
          createdAt: true,
          fileAnalysis: true,
          fileAnalysisLabel: true,
          metadataLayer: {
            select: {
              capturedAt: true,
              gpsLatitude: true,
              gpsLongitude: true,
              deviceMake: true,
              deviceModel: true,
              software: true,
              exifData: true,
            },
          },
          verifications: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { passed: true, createdAt: true },
          },
        },
      },
    },
  });

  const vaults: VaultFact[] = vaultRows.map((row) => {
    const meta = row.dnaRecord.metadataLayer;
    const ver = row.dnaRecord.verifications[0];
    const device = [meta?.deviceMake, meta?.deviceModel].filter(Boolean).join(' ').trim() || null;
    const protect = (meta?.exifData && typeof meta.exifData === 'object'
      ? (meta.exifData as { pinitProtect?: {
        captureMethod?: string | null;
        placeName?: string | null;
        fullAddress?: string | null;
        city?: string | null;
        village?: string | null;
        mandal?: string | null;
        district?: string | null;
        state?: string | null;
        pincode?: string | null;
        country?: string | null;
      } }).pinitProtect
      : null);
    const analysis = readAuthenticity(row.contentAnalysis);
    const dnaAnalysis = readAuthenticity(row.dnaRecord.fileAnalysis);
    const verdict = analysis.verdict || dnaAnalysis.verdict || row.contentLabel || row.dnaRecord.fileAnalysisLabel || null;
    return {
      vaultId: row.id,
      assetId: null,
      dnaRecordId: row.dnaRecordId,
      filename: row.originalFileName,
      mimeType: row.originalMimeType,
      protectedAt: row.createdAt,
      sha256: row.dnaRecord.sha256Hash,
      status: row.dnaRecord.status,
      contentLabel: row.contentLabel,
      capturedAt: meta?.capturedAt ?? null,
      gpsLat: meta?.gpsLatitude ?? null,
      gpsLng: meta?.gpsLongitude ?? null,
      gpsPlaceName: protect?.placeName || [protect?.village, protect?.city, protect?.state].filter(Boolean).join(', ') || null,
      gpsFullAddress: protect?.fullAddress ?? null,
      gpsVillage: protect?.village ?? null,
      gpsMandal: protect?.mandal ?? null,
      gpsDistrict: protect?.district ?? null,
      gpsCity: protect?.city ?? null,
      gpsState: protect?.state ?? null,
      gpsPincode: protect?.pincode ?? null,
      gpsCountry: protect?.country ?? null,
      device,
      lastVerifyAt: ver?.createdAt ?? null,
      lastVerifyPassed: ver?.passed ?? null,
      authenticityVerdict: verdict,
      authenticityDisplay: analysis.display || dnaAnalysis.display || verdict,
      authenticitySummary: analysis.summary || dnaAnalysis.summary,
      aiProbability: analysis.aiProbability ?? dnaAnalysis.aiProbability,
      analysisStatus: row.contentAnalysisStatus || null,
      software: meta?.software ?? null,
      captureMethod: protect?.captureMethod ?? null,
    };
  });

  const vaultIds = vaults.map((v) => v.vaultId);
  const assetRows = vaultIds.length
    ? await prisma.asset.findMany({
        where: { ownerUserId, vaultId: { in: vaultIds } },
        select: { id: true, vaultId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    : [];
  const assetByVault = new Map<string, string>();
  for (const a of assetRows) {
    if (a.vaultId && !assetByVault.has(a.vaultId)) assetByVault.set(a.vaultId, a.id);
  }
  for (const v of vaults) v.assetId = assetByVault.get(v.vaultId) ?? null;

  const shares = await prisma.shareLink.findMany({
    where: {
      OR: [
        { ownerUserId },
        ...(vaultIds.length ? [{ vaultId: { in: vaultIds } }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 400,
    select: {
      id: true,
      vaultId: true,
      filename: true,
      token: true,
      createdAt: true,
      isActive: true,
      linkType: true,
      viewCount: true,
      downloadCount: true,
      recipientLabel: true,
      recipientEmail: true,
      expiresAt: true,
    },
  });

  const shareIds = shares.map((s) => s.id);
  const recentLogs = shareIds.length
    ? await prisma.shareAccessLog.findMany({
        where: { shareLinkId: { in: shareIds } },
        orderBy: { createdAt: 'desc' },
        take: 400,
        select: {
          shareLinkId: true,
          action: true,
          createdAt: true,
          country: true,
          city: true,
          gpsCity: true,
          gpsState: true,
          recipientName: true,
        },
      })
    : [];

  const ownedDnaIds = vaults.map((v) => v.dnaRecordId);
  const incidents = ownedDnaIds.length
    ? await prisma.incident.findMany({
        where: {
          dnaRecordId: { in: ownedDnaIds },
          status: { notIn: ['CLOSED', 'RESOLVED'] },
        },
        take: 40,
        select: { id: true, severity: true, status: true, description: true, dnaRecordId: true, createdAt: true },
      })
    : [];

  const portfolioVaultIds = await prisma.portfolioCollectionItem.findMany({
    where: {
      vaultId: { not: null },
      collection: { portfolio: { userId: ownerUserId } },
    },
    select: { vaultId: true },
  });

  return {
    vaults,
    shares: shares as ShareFact[],
    recentLogs,
    incidents,
    portfolioVaultIds: new Set(portfolioVaultIds.map((p) => p.vaultId).filter(Boolean) as string[]),
  };
}

function sharesFor(shares: ShareFact[], vaultId: string): ShareFact[] {
  return shares.filter((s) => s.vaultId === vaultId);
}

function downloadCount(shares: ShareFact[], vaultId: string): number {
  return sharesFor(shares, vaultId).reduce((n, s) => n + (s.downloadCount || 0), 0);
}

function viewCount(shares: ShareFact[], vaultId: string): number {
  return sharesFor(shares, vaultId).reduce((n, s) => n + (s.viewCount || 0), 0);
}

function locationBlocks(
  v: VaultFact,
  logs: Array<{ shareLinkId: string; createdAt: Date; country: string | null; city: string | null; gpsCity: string | null; gpsState: string | null }>,
  shares: ShareFact[],
  kind: 'capture' | 'access' | 'storage' | 'now',
): AskPinitBlock[] {
  const blocks: AskPinitBlock[] = [block('heading', v.filename, 'recorded')];
  const linkIds = new Set(sharesFor(shares, v.vaultId).map((s) => s.id));
  const locLogs = logs.filter((l) => linkIds.has(l.shareLinkId) && (l.country || l.city || l.gpsCity));

  if (kind === 'storage' || kind === 'now') {
    blocks.push(block('fact', `${v.filename} is stored in your PINIT Vault (vault record ${v.vaultId}).`, 'recorded'));
  }

  if (kind === 'capture' || kind === 'now') {
    if (v.gpsLat != null && v.gpsLng != null) {
      if (v.gpsVillage) blocks.push(block('fact', `Village / locality: ${v.gpsVillage}.`, 'recorded'));
      if (v.gpsMandal) blocks.push(block('fact', `Mandal: ${v.gpsMandal}.`, 'recorded'));
      if (v.gpsDistrict || v.gpsCity) blocks.push(block('fact', `District / city: ${v.gpsDistrict || v.gpsCity}.`, 'recorded'));
      if (v.gpsState) blocks.push(block('fact', `State: ${v.gpsState}.`, 'recorded'));
      if (v.gpsPincode) blocks.push(block('fact', `PIN: ${v.gpsPincode}.`, 'recorded'));
      if (v.gpsCountry) blocks.push(block('fact', `Country: ${v.gpsCountry}.`, 'recorded'));
      if (v.gpsPlaceName) {
        blocks.push(block(
          'fact',
          `Recorded capture place: ${v.gpsPlaceName}.`,
          'recorded',
        ));
      }
      if (v.gpsFullAddress && v.gpsFullAddress !== v.gpsPlaceName) {
        blocks.push(block('fact', `Full recorded address: ${v.gpsFullAddress}.`, 'recorded'));
      }
      if (!v.gpsPlaceName && !v.gpsFullAddress) {
        blocks.push(block(
          'note',
          `PINIT has GPS ${v.gpsLat.toFixed(5)}, ${v.gpsLng.toFixed(5)} but does not have a recorded place name for those coordinates.`,
          'unknown',
        ));
      } else {
        blocks.push(block(
          'fact',
          `GPS (file metadata): ${v.gpsLat.toFixed(5)}, ${v.gpsLng.toFixed(5)}.`,
          'recorded',
        ));
      }
    } else if (kind === 'capture') {
      blocks.push(block('note', 'PINIT doesn’t have a recorded capture location for this asset.', 'unknown'));
    }
  }

  if (kind === 'access' || kind === 'now') {
    if (locLogs.length) {
      const latest = locLogs[0];
      const place = [latest.gpsCity || latest.city, latest.gpsState, latest.country].filter(Boolean).join(', ');
      blocks.push(block(
        'fact',
        `Latest recorded access location: ${place} · ${fmtWhen(latest.createdAt)} (share/view activity, not capture).`,
        'recorded',
      ));
      const unique = [...new Set(locLogs.slice(0, 8).map((l) => [l.gpsCity || l.city, l.country].filter(Boolean).join(', ')))];
      if (unique.length > 1) {
        blocks.push(block('fact', `Other recorded access places: ${unique.slice(1, 6).join('; ')}.`, 'recorded'));
      }
    } else {
      blocks.push(block('note', 'PINIT doesn’t have a recorded city/country for share/access events on this asset.', 'unknown'));
    }
  }

  blocks.push(block(
    'note',
    'Capture location, access location, and vault storage are different records. PINIT does not know a file’s current physical place unless one of those records includes it.',
    'unknown',
  ));
  return blocks;
}

function storyBlocks(
  v: VaultFact,
  shares: ShareFact[],
  activity: ActivityFile | undefined,
  inPortfolio: boolean,
  investigationCount: number,
): AskPinitBlock[] {
  const s = sharesFor(shares, v.vaultId);
  const blocks: AskPinitBlock[] = [
    block('heading', `Here’s the story of ${v.filename}.`, 'derived'),
    block('fact', `Origin — protected in PINIT Vault on ${fmtWhen(v.protectedAt)}.`, 'recorded'),
  ];
  const originLabel = protectOriginLabel(v.captureMethod);
  if (originLabel) {
    blocks.push(block('fact', `Protect origin — ${originLabel}.`, 'recorded'));
  }
  if (v.capturedAt) {
    blocks.push(block('fact', `Capture time in file metadata: ${fmtWhen(v.capturedAt)}.`, 'recorded'));
  } else {
    blocks.push(block('note', 'No separate capture timestamp is stored beyond the protection time.', 'unknown'));
  }
  const id = shortHash(v.sha256);
  if (id) blocks.push(block('fact', `Identity (SHA-256): ${id}`, 'recorded'));
  blocks.push(block(
    'fact',
    `Protection — ${v.contentLabel || v.status}. DNA status: ${v.status}.`,
    'recorded',
  ));
  blocks.push(block(
    'fact',
    `Activity — ${viewCount(shares, v.vaultId)} recorded views and ${downloadCount(shares, v.vaultId)} protected downloads across ${s.length} secure/share link${s.length === 1 ? '' : 's'}.`,
    'derived',
  ));
  if (inPortfolio) blocks.push(block('fact', 'This asset is in your portfolio.', 'recorded'));
  if (investigationCount > 0) {
    blocks.push(block('fact', `Investigation — ${investigationCount} open case${investigationCount === 1 ? '' : 's'} on this DNA record.`, 'recorded'));
  } else {
    blocks.push(block('note', 'No open investigation is recorded for this asset.', 'recorded'));
  }
  const today = startOfToday();
  const todayEvents = (activity?.events ?? []).filter((e) => e.at >= today);
  if (todayEvents.length) {
    blocks.push(block('heading', 'Recorded today', 'recorded'));
    for (const e of todayEvents.slice(0, 8)) {
      blocks.push(block('event', `${fmtWhen(e.at)} — ${e.title}`, 'recorded'));
    }
  } else {
    blocks.push(block('note', 'No new activity recorded today.', 'recorded'));
  }
  return blocks;
}

function fmtClock(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

function makeReply(
  intent: AskPinitIntent,
  title: string,
  blocks: AskPinitBlock[],
  links: AskPinitLink[],
  picked?: VaultFact | null,
  confidence = 0.92,
): AskPinitReply {
  const answer = blocks.map((b) => b.text).join('\n');
  return {
    intent,
    title,
    blocks,
    links,
    answer,
    spoken: answer.replace(/\n+/g, ' '),
    confidence,
    resolved: picked
      ? { vaultId: picked.vaultId, assetId: picked.assetId, filename: picked.filename }
      : undefined,
  };
}

function contextIds(pathname?: string, body?: { assetId?: string; portfolioId?: string; reportId?: string; vaultId?: string }) {
  const path = pathname || '';
  const vaultFromPath = path.match(/\/vault\/([0-9a-f-]{20,})/i)?.[1];
  const intelFromPath = path.match(/\/intelligence\/([0-9a-f-]{20,})/i)?.[1];
  const trackingFromPath = path.match(/\/tracking\/([0-9a-f-]{20,})/i)?.[1];
  return {
    vaultId: body?.vaultId || vaultFromPath || intelFromPath,
    assetId: body?.assetId || trackingFromPath,
    portfolioId: body?.portfolioId,
    reportId: body?.reportId,
    pathname: path,
  };
}

export async function askPinit(
  ownerUserId: string,
  input: {
    question: string;
    vaultId?: string;
    pathname?: string;
    assetId?: string;
    portfolioId?: string;
    reportId?: string;
    conversation?: ConversationHint[];
  },
): Promise<AskPinitReply> {
  const question = input.question.trim();
  const intent = parseAskPinitIntent(question);
  if (intent === 'GREETING') {
    const hi = 'Hi. Ask me about your protected assets, sharing, activity, or protection.';
    return makeReply(intent, 'Hi', [block('fact', hi, 'derived')], [], null, 0.99);
  }
  const range = parseAskPinitTimeRange(question);
  const ctx = contextIds(input.pathname, input);
  const facts = await loadFacts(ownerUserId);
  let picked = pickVault(facts.vaults, question, ctx.vaultId, input.conversation)
    ?? (ctx.assetId
      ? facts.vaults.find((v) => v.assetId === ctx.assetId) ?? null
      : null);
  if (!picked && (intent === 'ASSET_LOCATION' || intent === 'ASSET_CAPTURE_TIME' || intent === 'ASSET_SHARING' || intent === 'ASSET_VIEWS')) {
    const prior = lastConversationAsset(input.conversation);
    if (prior?.vaultId) picked = facts.vaults.find((v) => v.vaultId === prior.vaultId) ?? null;
    if (!picked && prior?.filename) {
      picked = facts.vaults.find((v) => v.filename.toLowerCase() === prior.filename!.toLowerCase()) ?? null;
    }
  }
  if (!picked && facts.vaults.length === 1 && (
    intent === 'ASSET_SHARING' || intent === 'ASSET_VIEWS' || intent === 'ASSET_DOWNLOADS'
    || intent === 'ASSET_OVERVIEW' || intent === 'ASSET_AUTHENTICITY' || intent === 'ASSET_ACTIVITY'
    || intent === 'ASSET_TIMELINE' || intent === 'ASSET_LOCATION' || intent === 'ASSET_STORAGE'
    || intent === 'ASSET_PROTECTION_STATUS' || intent === 'ASSET_DNA' || intent === 'ASSET_IDENTITY'
  )) {
    picked = facts.vaults[0];
  }

  const intel = picked ? await buildIntelligenceReportPayload(picked.vaultId) : null;

  const needsActivity = [
    'ASSET_ACTIVITY', 'ASSET_TIMELINE', 'ASSET_OVERVIEW', 'RECENT_ACTIVITY',
    'ATTENTION_ITEMS', 'ASSETS_QUIET', 'RECENT_DOWNLOADS', 'GENERAL_PINIT_HELP',
    'ASSET_MONITORING', 'ASSET_DUPLICATES',
  ].includes(intent);
  const activity = needsActivity
    ? await getOwnerActivity(ownerUserId, { limit: 80 })
    : { files: [] as ActivityFile[], unavailable: [] as string[] };
  const activityFor = (vaultId: string) => activity.files.find((f) => f.vaultIds.includes(vaultId));

  const empty = (title: string, note: string, conf = 0.99): AskPinitReply =>
    makeReply(intent, title, [block('note', note, 'unknown')], [], picked, conf);

  if (facts.vaults.length === 0) {
    return empty('No protected assets', 'There are no protected assets on this account yet.');
  }

  if (intentNeedsAsset(intent) && !picked) {
    const tokens = question.replace(/[^\w.\- ]/g, ' ').trim();
    return empty(
      'Which asset?',
      `I couldn’t find an asset matching “${tokens.slice(0, 80) || 'that name'}”. Use the filename, or open the Living Asset page and ask about “this”.`,
    );
  }

  const resolved = picked ?? undefined;

  let built: AskPinitReply | null = null;

  if (picked && (intent === 'ASSET_LOCATION' || intent === 'ASSET_STORAGE')) {
    if (picked.gpsLat != null && picked.gpsLng != null && (!picked.gpsVillage || !picked.gpsCountry || !picked.gpsPlaceName)) {
      const geo = await reverseGeocodePlace(picked.gpsLat, picked.gpsLng);
      picked.gpsPlaceName = geo.label || picked.gpsPlaceName;
      picked.gpsFullAddress = geo.fullAddress || picked.gpsFullAddress;
      picked.gpsVillage = geo.village || picked.gpsVillage;
      picked.gpsMandal = geo.mandal || picked.gpsMandal;
      picked.gpsDistrict = geo.district || picked.gpsDistrict;
      picked.gpsCity = geo.city || picked.gpsCity;
      picked.gpsState = geo.state || picked.gpsState;
      picked.gpsPincode = geo.pincode || picked.gpsPincode;
      picked.gpsCountry = geo.country || picked.gpsCountry;
    }
    const kind = intent === 'ASSET_STORAGE' ? 'storage' : parseLocationQuestionKind(question);
    built = makeReply(intent, picked.filename, locationBlocks(picked, facts.recentLogs, facts.shares, kind), linksFor(picked), picked);
  } else if (picked && intent === 'ASSET_CAPTURE_TIME') {
    const blocks: AskPinitBlock[] = [block('heading', picked.filename, 'recorded')];
    const originKind = classifyProtectOrigin(picked.captureMethod);
    const originLabel = protectOriginLabel(picked.captureMethod);
    if (originKind === 'upload') {
      blocks.push(block(
        'fact',
        `${picked.filename} was uploaded to PINIT Protect on ${fmtWhen(picked.protectedAt)}.`,
        'recorded',
      ));
    } else if (originKind === 'camera') {
      blocks.push(block(
        'fact',
        `${picked.filename} was captured with the PINIT camera${picked.capturedAt ? ` on ${fmtWhen(picked.capturedAt)}` : ''}.`,
        'recorded',
      ));
      blocks.push(block('fact', `It was then protected in PINIT Vault on ${fmtWhen(picked.protectedAt)}.`, 'recorded'));
    } else if (originLabel) {
      blocks.push(block('fact', `Recorded protect origin: ${originLabel}.`, 'recorded'));
      blocks.push(block('fact', `Protected in PINIT Vault on ${fmtWhen(picked.protectedAt)}.`, 'recorded'));
    } else {
      blocks.push(block(
        'note',
        'PINIT doesn’t have a recorded protect origin (uploaded vs PINIT camera) for this asset.',
        'unknown',
      ));
      blocks.push(block('fact', `It was protected in PINIT Vault on ${fmtWhen(picked.protectedAt)}.`, 'recorded'));
    }
    if (originKind === 'upload' && picked.capturedAt) {
      blocks.push(block(
        'note',
        `The file metadata records a capture/create time of ${fmtWhen(picked.capturedAt)}. That is the file’s own timestamp, not a PINIT camera capture.`,
        'recorded',
      ));
    } else if (originKind !== 'camera' && picked.capturedAt && originKind !== 'upload') {
      blocks.push(block('fact', `The file metadata records capture on ${fmtWhen(picked.capturedAt)}.`, 'recorded'));
    }
    if (picked.device) blocks.push(block('fact', `Recorded device: ${picked.device}`, 'recorded'));
    if (picked.software) blocks.push(block('fact', `Recorded software: ${picked.software}`, 'recorded'));
    if (originLabel) {
      blocks.push(block('fact', `Recorded capture method: ${picked.captureMethod}.`, 'recorded'));
    }
    built = makeReply(intent, picked.filename, blocks, linksFor(picked), picked);
  } else if (picked && (intent === 'ASSET_PROTECTION_STATUS' || intent === 'ASSET_IDENTITY' || intent === 'ASSET_DNA' || intent === 'ASSET_VERIFICATION')) {
    const blocks: AskPinitBlock[] = [block('heading', picked.filename, 'recorded')];
    blocks.push(block('fact', `Protection: ${picked.contentLabel || picked.status}. DNA status: ${picked.status}.`, 'recorded'));
    blocks.push(block('fact', `Protected on ${fmtWhen(picked.protectedAt)} on this account.`, 'recorded'));
    blocks.push(block('note', 'PINIT does not store a separate “who protected it” name beyond the account owner.', 'unknown'));
    const id = shortHash(picked.sha256);
    if (intent !== 'ASSET_PROTECTION_STATUS') {
      if (id) blocks.push(block('fact', `DNA identity (SHA-256): ${id}`, 'recorded'));
      else blocks.push(block('note', 'No SHA-256 identity is stored on this record.', 'unknown'));
      blocks.push(block('fact', `DNA record: ${picked.dnaRecordId}`, 'recorded'));
    }
    if (picked.lastVerifyAt != null) {
      blocks.push(block('fact', `Last verification: ${picked.lastVerifyPassed ? 'passed' : 'did not pass'} on ${fmtWhen(picked.lastVerifyAt)}.`, 'recorded'));
    } else if (intent === 'ASSET_VERIFICATION') {
      blocks.push(block('note', 'No verification event is recorded for this asset.', 'unknown'));
    }
    built = makeReply(intent, picked.filename, blocks, linksFor(picked), picked);
  } else if (picked && intent === 'ASSET_AUTHENTICITY') {
    const blocks: AskPinitBlock[] = [block('heading', picked.filename, 'recorded')];
    const verdict = (picked.authenticityVerdict || '').toUpperCase();
    if (!verdict || verdict === 'UNKNOWN' || picked.analysisStatus === 'NOT_ANALYZED') {
      blocks.push(block(
        'note',
        `PINIT doesn’t have a recorded authenticity verdict for ${picked.filename}. I will not guess whether it is a natural photo or AI-edited.`,
        'unknown',
      ));
    } else {
      blocks.push(block(
        'fact',
        `Recorded authenticity verdict: ${picked.authenticityDisplay || picked.authenticityVerdict}.`,
        'recorded',
      ));
      if (picked.authenticitySummary) {
        blocks.push(block('fact', picked.authenticitySummary, 'recorded'));
      }
      if (picked.aiProbability != null) {
        blocks.push(block('fact', `Recorded AI probability: ${Math.round(picked.aiProbability)}.`, 'recorded'));
      }
      if (['ORIGINAL'].includes(verdict)) {
        blocks.push(block('note', 'That stored verdict means PINIT classified this file as original, not AI-generated. It is not a new live scan.', 'derived'));
      } else if (['AI_GENERATED', 'LIKELY_AI', 'DEEPFAKE'].includes(verdict)) {
        blocks.push(block('note', 'That stored verdict means PINIT recorded AI-generation or synthetic-content signals for this file.', 'derived'));
      } else if (['EDITED', 'LIKELY_EDITED'].includes(verdict)) {
        blocks.push(block('note', 'That stored verdict means the file looks edited. It does not by itself prove AI generation.', 'derived'));
      }
    }
    built = makeReply(intent, picked.filename, blocks, linksFor(picked), picked);
  } else if (intent === 'ASSET_SHARING' || intent === 'ASSET_VIEWS' || intent === 'ASSET_DOWNLOADS') {
    const dist = intel?.distribution;
    const shareSet = picked ? sharesFor(facts.shares, picked.vaultId) : facts.shares;
    const title = picked?.filename || intel?.identity.filename || 'Sharing';
    const total = dist?.totalShareLinks ?? shareSet.length;
    const active = dist?.activeLinks ?? shareSet.filter((s) => s.isActive).length;
    const views = dist?.totalViews ?? (picked ? viewCount(facts.shares, picked.vaultId) : 0);
    const downloads = dist?.totalDownloads ?? (picked ? downloadCount(facts.shares, picked.vaultId) : 0);
    const newest = [...shareSet].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const blocks: AskPinitBlock[] = [block('heading', title, 'recorded')];
    blocks.push(block(
      'fact',
      `${title} currently has ${total} recorded share link${total === 1 ? '' : 's'}.`,
      'recorded',
    ));
    blocks.push(block('fact', `Active links: ${active}. Inactive: ${Math.max(0, total - active)}.`, 'derived'));
    if (newest) {
      blocks.push(block('fact', `Most recent link created ${fmtWhen(newest.createdAt)} (${newest.linkType || 'link'}).`, 'recorded'));
    }
    blocks.push(block('fact', `Recorded views: ${views}. Recorded protected downloads: ${downloads}.`, 'derived'));
    if (dist?.recipients?.length) {
      blocks.push(block('fact', `Recorded recipient labels: ${dist.recipients.slice(0, 8).join(', ')}.`, 'recorded'));
    }
    if (total === 0) {
      blocks.push(block('note', `I don't have any recorded share links for ${title}.`, 'recorded'));
    }
    blocks.push(block('note', 'Source: PINIT share records.', 'recorded'));
    if (intent === 'ASSET_VIEWS') {
      const linkIds = new Set(shareSet.map((s) => s.id));
      const accessors = [...new Set(facts.recentLogs
        .filter((l) => linkIds.has(l.shareLinkId) && l.recipientName)
        .map((l) => l.recipientName as string))];
      if (accessors.length) {
        blocks.push(block('fact', `Recorded access labels: ${accessors.slice(0, 8).join(', ')}.`, 'recorded'));
      } else {
        blocks.push(block('note', 'No named recipient is recorded on access events. Counts above are from share records.', 'unknown'));
      }
    }
    const expired = shareSet.filter((s) => s.expiresAt && s.expiresAt < new Date()).length;
    if (expired) blocks.push(block('fact', `Recorded expired links: ${expired}.`, 'recorded'));
    const shareLinks = picked ? linksFor(picked) : [{ label: 'Open Share Activity', href: '/access-intelligence' }];
    if (picked) shareLinks.push({ label: 'Open Share Activity', href: '/access-intelligence' });
    built = makeReply(intent, title, blocks, shareLinks, picked);
  } else if (picked && (intent === 'ASSET_ACTIVITY' || intent === 'ASSET_TIMELINE' || intent === 'ASSET_OVERVIEW')) {
    if (intent === 'ASSET_OVERVIEW') {
      const inv = facts.incidents.filter((i) => i.dnaRecordId === picked.dnaRecordId).length;
      built = makeReply(
        intent,
        picked.filename,
        storyBlocks(picked, facts.shares, activityFor(picked.vaultId), facts.portfolioVaultIds.has(picked.vaultId), inv),
        linksFor(picked),
        picked,
      );
    } else {
      const file = activityFor(picked.vaultId);
      const lastOnly = /\blast activity\b|\blast (access|event)\b|\blatest activity\b/i.test(question);
      const label = lastOnly ? 'recorded' : (range?.label ?? 'today');
      const from = lastOnly ? new Date(0) : (range?.from ?? startOfToday());
      const to = range?.to ?? new Date();
      const events = (file?.events ?? []).filter((e) => e.at >= from && e.at <= to).slice(0, 12);
      const blocks: AskPinitBlock[] = [block('heading', `${picked.filename} has ${events.length} recorded event${events.length === 1 ? '' : 's'} ${label}:`, 'derived')];
      for (const e of events) {
        blocks.push(block('event', `• ${fmtClock(e.at)} — ${e.title}`, 'recorded'));
      }
      if (!events.length) {
        blocks.push(block('note', `No recorded events ${label} for this asset.`, 'recorded'));
      }
      blocks.push(block('fact', `Current protection: ${picked.contentLabel || picked.status}`, 'recorded'));
      built = makeReply(intent, picked.filename, blocks, linksFor(picked), picked);
    }
  } else if (intent === 'ASSET_INVESTIGATIONS' || intent === 'ASSET_REPORTS') {
    const inv = picked
      ? facts.incidents.filter((i) => i.dnaRecordId === picked.dnaRecordId)
      : facts.incidents;
    const blocks: AskPinitBlock[] = [block('heading', picked?.filename || 'Investigations', 'recorded')];
    if (!inv.length) {
      blocks.push(block('note', picked
        ? 'No open investigation is recorded for this asset.'
        : 'No open investigation is recorded on this account.', 'recorded'));
    } else {
      for (const i of inv.slice(0, 8)) {
        blocks.push(block('event', `${fmtWhen(i.createdAt)} — ${i.status} · ${i.severity}${i.description ? ` · ${i.description}` : ''}`, 'recorded'));
      }
    }
    const links = picked ? linksFor(picked) : [{ label: 'View Investigation', href: '/pinit-hub/investigation' }];
    if (picked) {
      links.push({ label: 'View Investigation', href: '/pinit-hub/investigation' });
      links.push({ label: 'View Report', href: `/intelligence/${encodeURIComponent(picked.vaultId)}` });
    }
    built = makeReply(intent, picked?.filename || 'Investigations', blocks, links, picked);
  } else if (intent === 'RECENT_SHARES') {
    const from = range?.from ?? startOfWeek();
    const recent = facts.shares.filter((s) => s.createdAt >= from || s.isActive);
    const blocks: AskPinitBlock[] = [block('heading', 'Recorded sharing', 'derived')];
    if (!recent.length) blocks.push(block('note', 'No share links are recorded in that period.', 'recorded'));
    for (const s of recent.slice(0, 10)) {
      blocks.push(block('event', `${s.filename} — ${s.isActive ? 'active' : 'inactive'} ${s.linkType || 'link'} · ${fmtWhen(s.createdAt)}`, 'recorded'));
    }
    built = makeReply(intent, 'Sharing', blocks, [{ label: 'Open Share Activity', href: '/access-intelligence' }], resolved);
  } else if (intent === 'RECENT_DOWNLOADS') {
    const from = range?.from ?? startOfToday();
    const logs = facts.recentLogs.filter((l) => l.action === 'DOWNLOADED' && l.createdAt >= from);
    const blocks: AskPinitBlock[] = [block('heading', `Protected downloads ${range?.label ?? 'today'}`, 'derived')];
    if (!logs.length) blocks.push(block('note', 'No protected downloads are recorded in that period.', 'recorded'));
    for (const l of logs.slice(0, 12)) {
      const share = facts.shares.find((s) => s.id === l.shareLinkId);
      blocks.push(block('event', `${share?.filename || 'Asset'} — ${fmtWhen(l.createdAt)}`, 'recorded'));
    }
    built = makeReply(intent, 'Downloads', blocks, [{ label: 'Open Tracking', href: '/tracking' }], resolved);
  } else if (intent === 'RECENT_ACTIVITY' || intent === 'USER_ASSETS' || intent === 'GENERAL_PINIT_HELP') {
    if (picked && intent === 'GENERAL_PINIT_HELP') {
      const tokens = extractSearchTokens(question);
      const aboutAsset = questionRefersToCurrentAsset(question)
        || questionUsesFollowUpPronoun(question)
        || tokens.some((t) => picked.filename.toLowerCase().includes(t));
      if (aboutAsset) {
        const inv = facts.incidents.filter((i) => i.dnaRecordId === picked.dnaRecordId).length;
        built = makeReply(
          'ASSET_OVERVIEW',
          picked.filename,
          storyBlocks(picked, facts.shares, activityFor(picked.vaultId), facts.portfolioVaultIds.has(picked.vaultId), inv),
          linksFor(picked),
          picked,
        );
      } else {
        built = makeReply(
          intent,
          'PINIT Intelligence',
          [
            block('note', 'I only answer from recorded Hub facts: assets, capture/upload origin, sharing, activity, DNA, and investigations.', 'derived'),
            block('fact', `You currently have ${facts.vaults.length} protected asset${facts.vaults.length === 1 ? '' : 's'}.`, 'recorded'),
            block('note', 'Ask about a filename (for example Dress.jpeg), or open the Living Asset page and ask about this asset.', 'derived'),
          ],
          [{ label: 'My Assets', href: '/vault' }],
          null,
          0.7,
        );
      }
    } else if (intent === 'USER_ASSETS' || (intent === 'GENERAL_PINIT_HELP' && !picked)) {
      const q = question.toLowerCase();
      let list = facts.vaults;
      if (/\bphoto|image|jpeg|png|jpg\b/.test(q)) list = list.filter((v) => /^image\//i.test(v.mimeType) || /\.(png|jpe?g|webp|gif)$/i.test(v.filename));
      else if (/\bvideos?\b/.test(q)) list = list.filter((v) => /^video\//i.test(v.mimeType) || /\.(mp4|mov|webm)$/i.test(v.filename));
      else if (/\bdocuments?\b/.test(q)) list = list.filter((v) => /pdf|word|text|document/i.test(v.mimeType) || /\.(pdf|docx?|txt)$/i.test(v.filename));
      if (range) list = list.filter((v) => v.protectedAt >= range.from && v.protectedAt <= range.to);
      const latest = facts.vaults[0];
      const first = facts.vaults[facts.vaults.length - 1];
      const blocks: AskPinitBlock[] = [
        block('heading', `You currently have ${facts.vaults.length} protected asset${facts.vaults.length === 1 ? '' : 's'}.`, 'recorded'),
      ];
      if (latest) {
        blocks.push(block('fact', `Most recently protected: ${latest.filename} on ${fmtWhen(latest.protectedAt)}.`, 'recorded'));
      }
      if (first && /\bfirst\b/.test(q)) {
        blocks.push(block('fact', `First recorded protected asset: ${first.filename} on ${fmtWhen(first.protectedAt)}.`, 'recorded'));
      }
      if (!list.length) {
        blocks.push(block('note', 'No protected assets match that filter in Hub records.', 'recorded'));
      }
      for (const v of list.slice(0, 12)) blocks.push(block('event', `${v.filename} — protected ${fmtWhen(v.protectedAt)}`, 'recorded'));
      built = makeReply(intent, 'Your assets', blocks, [{ label: 'My Assets', href: '/vault' }], resolved, 0.9);
    } else {
      const today = startOfToday();
      const todayFiles = activity.files.filter((f) => f.events.some((e) => e.at >= today));
      const blocks: AskPinitBlock[] = [
        block('heading', 'What changed across your protected assets today', 'derived'),
        block('fact', `${todayFiles.length} asset${todayFiles.length === 1 ? '' : 's'} have recorded activity today.`, 'derived'),
      ];
      for (const f of todayFiles.slice(0, 8)) {
        const ev = f.events.filter((e) => e.at >= today).slice(0, 3).map((e) => e.title).join('; ');
        blocks.push(block('event', `${f.filename} — ${ev}`, 'recorded'));
      }
      if (!todayFiles.length) blocks.push(block('note', 'No new recorded events today.', 'recorded'));
      built = makeReply(intent, 'Today', blocks, [{ label: 'Open Tracking', href: '/tracking' }], resolved);
    }
  } else if (intent === 'ATTENTION_ITEMS' || intent === 'ASSETS_QUIET') {
    const suspicious = activity.files.filter((f) =>
      f.events.some((e) => /TAMPER|SCREENSHOT|RISK|DUPLICATE/i.test(e.type)),
    );
    const quiet = facts.vaults.filter((v) => {
      const last = activityFor(v.vaultId)?.lastActivityAt;
      return !last || last < new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    });
    const blocks: AskPinitBlock[] = [block('heading', 'Recorded items that may need your attention', 'derived')];
    if (facts.incidents.length) {
      blocks.push(block('fact', `${facts.incidents.length} open investigation case${facts.incidents.length === 1 ? '' : 's'}.`, 'recorded'));
    }
    if (suspicious.length) {
      blocks.push(block('fact', `${suspicious.length} asset${suspicious.length === 1 ? '' : 's'} have a recorded risk/tamper/screenshot/duplicate event.`, 'recorded'));
    }
    blocks.push(block('fact', `${quiet.length} asset${quiet.length === 1 ? '' : 's'} have had no recorded activity in 14 days.`, 'derived'));
    if (intent === 'ASSETS_QUIET') {
      for (const v of quiet.slice(0, 10)) blocks.push(block('event', v.filename, 'recorded'));
    }
    if (!facts.incidents.length && !suspicious.length) {
      blocks.push(block('note', 'No open investigation or tamper event is recorded.', 'recorded'));
    }
    built = makeReply(intent, 'Attention', blocks, [{ label: 'Open Intelligence Center', href: '/pinit-hub/investigation' }], resolved);
  } else if (intent === 'ASSET_MONITORING' || intent === 'ASSET_DUPLICATES') {
    const disc = intel?.discovery;
    const risk = intel?.risk;
    const title = picked?.filename || 'Monitoring';
    const blocks: AskPinitBlock[] = [block('heading', title, 'recorded')];
    if (disc) {
      blocks.push(block('fact', `Recorded monitor matches: ${disc.totalMatches} (exact ${disc.exactMatches}, high ${disc.highMatches}, possible ${disc.possibleMatches}).`, 'recorded'));
      blocks.push(block('fact', `Monitoring active: ${disc.monitoringActive ? 'yes' : 'no'}.`, 'recorded'));
    } else {
      blocks.push(block('note', 'No monitoring payload is recorded for a resolved asset.', 'unknown'));
    }
    if (risk?.leakIndicators?.length) {
      for (const t of risk.leakIndicators.slice(0, 6)) blocks.push(block('event', t, 'recorded'));
    } else if (intent === 'ASSET_DUPLICATES') {
      blocks.push(block('note', 'No duplicate/match indicator is recorded. Similarity is not treated as ownership.', 'recorded'));
    }
    const inv = picked ? facts.incidents.filter((i) => i.dnaRecordId === picked.dnaRecordId) : facts.incidents;
    if (inv.length) {
      blocks.push(block('fact', `${inv.length} open investigation case${inv.length === 1 ? '' : 's'} on this DNA record.`, 'recorded'));
    }
    built = makeReply(intent, title, blocks, picked ? linksFor(picked) : [{ label: 'Open Intelligence Center', href: '/pinit-hub/investigation' }], picked);
  } else if (intent === 'ACCOUNT_STATUS') {
    const activeShares = facts.shares.filter((s) => s.isActive).length;
    const blocks: AskPinitBlock[] = [
      block('heading', 'Account records', 'recorded'),
      block('fact', `Protected assets on this account: ${facts.vaults.length}.`, 'recorded'),
      block('fact', `Recorded share links: ${facts.shares.length} (${activeShares} active).`, 'recorded'),
      block('fact', `Portfolio-linked protected assets: ${facts.portfolioVaultIds.size}.`, 'recorded'),
      block('note', 'Plan, quota, and remaining storage are on your account page. This answer only uses Hub counts already loaded.', 'unknown'),
    ];
    built = makeReply(intent, 'Account', blocks, [{ label: 'Account', href: '/profile' }], resolved);
  } else if (intent === 'PORTFOLIO_ASSETS' || intent === 'PORTFOLIO_OVERVIEW') {
    const items = facts.vaults.filter((v) => facts.portfolioVaultIds.has(v.vaultId));
    const blocks: AskPinitBlock[] = [
      block('heading', `${items.length} protected asset${items.length === 1 ? '' : 's'} in your portfolio.`, 'recorded'),
    ];
    if (!items.length) blocks.push(block('note', 'No protected assets are recorded in your portfolio.', 'unknown'));
    for (const v of items.slice(0, 12)) blocks.push(block('event', v.filename, 'recorded'));
    built = makeReply(intent, 'Portfolio', blocks, [{ label: 'Open Portfolio', href: '/profile' }], resolved);
  }

  if (!built) {
    built = empty(
      'PINIT Intelligence',
      'Ask about a protected asset, sharing, activity, or protection. I only answer from your Hub records.',
      0.6,
    );
  }

  const pinIds = intent === 'ASSET_SHARING' || intent === 'ASSET_VIEWS' || intent === 'ASSET_DOWNLOADS'
    ? ['sharing']
    : intent === 'ASSET_AUTHENTICITY'
      ? ['authenticity', 'protection']
    : intent === 'ASSET_LOCATION' || intent === 'ASSET_CAPTURE_TIME' || intent === 'ASSET_STORAGE'
      ? ['origin', 'place', 'capture', 'access-location']
      : intent === 'ASSET_INVESTIGATIONS' || intent === 'ASSET_MONITORING' || intent === 'ASSET_DUPLICATES'
        ? ['investigation']
        : intent === 'ASSET_PROTECTION_STATUS' || intent === 'ASSET_DNA' || intent === 'ASSET_IDENTITY' || intent === 'ASSET_VERIFICATION'
          ? ['protection', 'identity']
          : ['sharing', 'protection', 'capture', 'investigation'];
  const chunks = chunksFromIntelligenceReport(intel);
  if (picked?.authenticityVerdict) {
    chunks.unshift({
      id: 'authenticity',
      text: `AUTHENTICITY (stored Hub analysis, not a new scan): filename=${picked.filename}. verdict=${picked.authenticityVerdict}. display=${picked.authenticityDisplay ?? 'not recorded'}. summary=${picked.authenticitySummary ?? 'not recorded'}. aiProbability=${picked.aiProbability ?? 'not recorded'}. analysisStatus=${picked.analysisStatus ?? 'not recorded'}.`,
    });
  }
  if (picked?.captureMethod) {
    chunks.unshift({
      id: 'origin',
      text: `PROTECT ORIGIN (recorded at protect time): filename=${picked.filename}. captureMethod=${picked.captureMethod}. kind=${classifyProtectOrigin(picked.captureMethod)}. label=${protectOriginLabel(picked.captureMethod)}. This is not inferred from EXIF.`,
    });
  }
  if (picked?.gpsPlaceName || picked?.gpsFullAddress) {
    chunks.unshift({
      id: 'place',
      text: `CAPTURE PLACE NAME from GPS reverse-geocode of recorded coordinates: place=${picked.gpsPlaceName ?? 'not recorded'}. fullAddress=${picked.gpsFullAddress ?? 'not recorded'}. lat=${picked.gpsLat ?? 'n/a'} lng=${picked.gpsLng ?? 'n/a'}. Do not invent a different city.`,
    });
  }
  const retrieved = await retrieveEvidenceChunks(question, chunks, pinIds);
  if (retrieved.length) {
    const spoken = await generateFromEvidence({
      question,
      draft: built.answer,
      evidence: retrieved,
    });
    built = { ...built, answer: spoken, spoken };
  }

  if (process.env.NODE_ENV !== 'production') {
    logger.info('Ask PINIT RAG', {
      question: question.slice(0, 180),
      intent,
      asset: picked?.filename ?? null,
      origin: picked ? classifyProtectOrigin(picked.captureMethod) : null,
      shareLinks: intel?.distribution.totalShareLinks ?? null,
      views: intel?.distribution.totalViews ?? null,
      downloads: intel?.distribution.totalDownloads ?? null,
      chunks: retrieved.map((c) => c.id),
    });
  }

  return built;
}

export async function getAskPinitInsights(ownerUserId: string): Promise<{
  activitiesToday: number;
  sharesCreatedToday: number;
  downloadsToday: number;
}> {
  const start = startOfToday();
  const [sharesCreatedToday, downloadsToday, accessToday, protectedToday] = await Promise.all([
    prisma.shareLink.count({ where: { ownerUserId, createdAt: { gte: start } } }),
    prisma.shareAccessLog.count({
      where: {
        createdAt: { gte: start },
        action: 'DOWNLOADED',
        shareLink: { ownerUserId },
      },
    }),
    prisma.shareAccessLog.count({
      where: { createdAt: { gte: start }, shareLink: { ownerUserId } },
    }),
    prisma.vaultRecord.count({
      where: { createdAt: { gte: start }, dnaRecord: { ownerUserId } },
    }),
  ]);
  return {
    activitiesToday: accessToday + sharesCreatedToday + protectedToday,
    sharesCreatedToday,
    downloadsToday,
  };
}
