/**
 * Asset Activity — the complete lifecycle of one asset, across all of Pinit.
 *
 * One Asset.id, one continuous lifecycle, every real event connected to it:
 * protected → stored → certified → added to a portfolio → shared → opened →
 * downloaded → listed on Exchange → sold → matched by monitoring → investigated →
 * evidence written → certificate checked → forwarded → link stopped → deleted.
 *
 * Nothing here writes, and nothing is invented. Every line comes from a row that
 * already exists in one of the stores the platform already keeps:
 *
 *   asset_timeline_events   already keyed on Asset.id
 *   platform_events         keyed on its own entity (vault, certificate, share
 *                           link, investigation, portfolio…), resolved back to
 *                           the canonical Asset.id at read time
 *   the record tables       assets, dna_records, vault_records, certificates,
 *                           share_links, share_access_logs, asset_discoveries,
 *                           evidence_records, incidents, portfolio_project_media,
 *                           exchange.listings, exchange.orders_sealed
 *
 * Asset.id, Vault id, DNA id, Certificate id and Exchange order id stay separate
 * identifiers — this resolves between them rather than merging them.
 *
 * Rows are grouped for display by content hash, so protecting the same bytes
 * twice reads as one file with a "Protected again" line rather than two files.
 * Each event still belongs to exactly one Asset.id.
 *
 * Deletion: deleting a file removes the stored copy, not the history. The asset,
 * its DNA and its certificate are kept, so the lifecycle stays readable and ends
 * with "Deleted from Hub".
 *
 * Read-only, and owner-scoped in every query.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

/** A share link belongs to an asset by id, or through the vault or DNA record it came from. */
const LINK_MATCHES_ASSET = `(
  s."assetId" = a.id
  OR (a."vaultId" IS NOT NULL AND s."vaultId" = a."vaultId")
  OR (a."dnaId" IS NOT NULL AND s."dnaRecordId" = a."dnaId")
)`;

export type ActivityEventType =
  // Hub
  | 'PROTECTED' | 'PROTECTED_AGAIN' | 'VAULT_STORED' | 'VAULT_VIEWED'
  | 'VAULT_DOWNLOADED' | 'VAULT_ISSUE' | 'RENAMED' | 'DELETED' | 'ARCHIVED'
  // Certificate
  | 'CERTIFICATE_ISSUED' | 'CERTIFICATE_CHECKED' | 'CERTIFICATE_REVOKED' | 'CERTIFICATE_EXPIRED'
  // Portfolio
  | 'PORTFOLIO_ADDED' | 'PORTFOLIO_PUBLISHED' | 'PORTFOLIO_VIEWED'
  // Sharing
  | 'SHARE_CREATED' | 'SHARE_FORWARDED' | 'SHARE_VIEWED' | 'SHARE_DOWNLOADED'
  | 'SHARE_COPIED' | 'SHARE_SCREENSHOT' | 'SHARE_STOPPED' | 'SHARE_EXPIRED' | 'SHARE_RISK'
  // Exchange
  | 'EXCHANGE_LIST_STARTED' | 'EXCHANGE_LISTED' | 'EXCHANGE_UNLISTED' | 'EXCHANGE_VIEWED'
  | 'SOLD' | 'CART_ADDED' | 'WISHLIST_ADDED'
  // Monitoring, investigation, evidence
  | 'MONITORING_STARTED' | 'FOUND_ONLINE' | 'TAMPERING' | 'DUPLICATE_BLOCKED'
  | 'INVESTIGATION_STARTED' | 'INVESTIGATION_COMPLETED' | 'EVIDENCE_CREATED'
  // Review
  | 'VERSION_APPROVED' | 'VERSION_CHANGES' | 'STATUS_CHANGE' | 'NOTE';

export interface ActivityEvent {
  id: string;
  at: Date;
  type: ActivityEventType;
  title: string;
  detail: string;
  meta?: Record<string, string>;
  /** Set when the line came from a share link, so the UI can open that link's page. */
  token?: string;
}

export interface ActivityFile {
  /** Stable per file, not per protection run. */
  key: string;
  /** The newest asset for this file — what the Tracking page opens. */
  assetId: string;
  assetIds: string[];
  dnaIds: string[];
  vaultIds: string[];
  filename: string;
  /** Other names the same bytes were saved under, if any. */
  otherFilenames: string[];
  assetType: string;
  status: string;
  sizeBytes: number;
  protectedAt: Date;
  lastActivityAt: Date;
  timesProtected: number;
  certificateId: string | null;
  /** True once the stored copy has been removed from Hub. */
  deleted: boolean;
  events: ActivityEvent[];
}

export interface OwnerActivity {
  files: ActivityFile[];
  /** Sources that could not be read — reported, never shown as "nothing happened". */
  unavailable: string[];
}

type Row = Record<string, unknown>;

/** Optional sources answer null when unreadable, so a gap is never reported as zero. */
async function safeRows<T>(label: string, sql: string, ...params: unknown[]): Promise<T[] | null> {
  try {
    return await prisma.$queryRawUnsafe<T[]>(sql, ...params);
  } catch (err) {
    logger.warn(`[AssetActivity] ${label} unavailable`, { error: String(err) });
    return null;
  }
}

const str = (v: unknown): string => String(v ?? '').trim();
const kb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;

const place = (city: unknown, country: unknown): string =>
  [city, country].map(str).filter(Boolean).join(', ');

/** Only name the forwarder when the stored label is a person, not plumbing. */
function forwardLabel(label: unknown): string {
  const who = str(label);
  if (!who || who.toLowerCase() === 'original link') return 'A recipient passed this link on';
  return `Passed on by ${who}`;
}

/** Links repeat in a long log, so each line says which one it was. */
const linkTail = (token: string): string => `link ...${token.slice(-6)}`;

const ACCESS_EVENTS: Record<string, { type: ActivityEventType; title: string }> = {
  VIEWED: { type: 'SHARE_VIEWED', title: 'Opened' },
  DOWNLOADED: { type: 'SHARE_DOWNLOADED', title: 'Downloaded' },
  COPIED: { type: 'SHARE_COPIED', title: 'Content copied' },
  COPY_ATTEMPT: { type: 'SHARE_COPIED', title: 'Copy blocked' },
  SCREENSHOT_ATTEMPT: { type: 'SHARE_SCREENSHOT', title: 'Screenshot blocked' },
  PRINT_ATTEMPT: { type: 'SHARE_SCREENSHOT', title: 'Print blocked' },
};

/**
 * Platform events worth a line in a human lifecycle.
 *
 * Anything absent is deliberately left out: scan heartbeats (thousands of rows),
 * account events, and the events that are already drawn from their own record —
 * dna.generated, vault.stored, certificate.issued, share.link.created and
 * share.link.viewed would each be a second copy of a line already shown.
 */
const PLATFORM_EVENTS: Record<string, { type: ActivityEventType; title: string }> = {
  'vault.previewed': { type: 'VAULT_VIEWED', title: 'Viewed in your vault' },
  'vault.protected_download.ready': { type: 'VAULT_DOWNLOADED', title: 'Downloaded from your vault' },
  'vault.deleted': { type: 'DELETED', title: 'Deleted from Hub' },
  'vault.integrity.issue': { type: 'VAULT_ISSUE', title: 'Storage check raised an issue' },
  'certificate.verified': { type: 'CERTIFICATE_CHECKED', title: 'Certificate checked' },
  'share.link.revoked': { type: 'SHARE_STOPPED', title: 'Link stopped' },
  'share.link.expired': { type: 'SHARE_EXPIRED', title: 'Link expired' },
  'share.link.forwarded': { type: 'SHARE_FORWARDED', title: 'Link forwarded' },
  'share.risk.new_device': { type: 'SHARE_RISK', title: 'Opened from a new device' },
  'duplicate.upload.blocked': { type: 'DUPLICATE_BLOCKED', title: 'Someone tried to re-upload this file' },
  'investigation.started': { type: 'INVESTIGATION_STARTED', title: 'Investigation started' },
  'investigation.completed': { type: 'INVESTIGATION_COMPLETED', title: 'Investigation completed' },
  'forensics.ai.tampering': { type: 'TAMPERING', title: 'Tampering detected' },
  'monitoring.started': { type: 'MONITORING_STARTED', title: 'Monitoring started' },
  'exchange.list_intent_created': { type: 'EXCHANGE_LIST_STARTED', title: 'Listing started on Exchange' },
  'exchange.listing_confirmed': { type: 'EXCHANGE_LISTED', title: 'Listed on Exchange' },
  'portfolio.viewed': { type: 'PORTFOLIO_VIEWED', title: 'Your portfolio was viewed' },
  'version.approved': { type: 'VERSION_APPROVED', title: 'New version approved' },
  'version.changes_requested': { type: 'VERSION_CHANGES', title: 'Changes requested on a version' },
};

/** Timeline rows the platform already keeps against Asset.id. */
const TIMELINE_EVENTS: Record<string, { type: ActivityEventType; title?: string }> = {
  // Written by the Exchange bridge when someone opens the listing, not the vault.
  VIEWED: { type: 'EXCHANGE_VIEWED' },
  LISTED: { type: 'EXCHANGE_LISTED' },
  UNLISTED: { type: 'EXCHANGE_UNLISTED' },
  SOLD: { type: 'SOLD' },
  PAID: { type: 'SOLD' },
  DELIVERED: { type: 'SOLD' },
  CART_ADDED: { type: 'CART_ADDED' },
  WISHLIST_ADDED: { type: 'WISHLIST_ADDED' },
  DISCOVERY: { type: 'FOUND_ONLINE' },
  TAMPERING: { type: 'TAMPERING' },
  INVESTIGATION: { type: 'INVESTIGATION_COMPLETED' },
  EVIDENCE: { type: 'EVIDENCE_CREATED' },
  MONITORING_STARTED: { type: 'MONITORING_STARTED' },
  STATUS_CHANGE: { type: 'STATUS_CHANGE' },
  RENAMED: { type: 'RENAMED' },
  ALERT: { type: 'NOTE' },
  RESOLVED: { type: 'NOTE' },
  NOTE: { type: 'NOTE' },
};

/** Timeline rows already drawn from their own record — a second copy helps nobody. */
const TIMELINE_IGNORED = new Set(['CREATED', 'PROTECTED', 'CERTIFICATE', 'SHARED', 'SHARE_VIEWED', 'SHARE_DOWNLOADED', 'MONITORING_SCAN', 'EXPORT_CAPTURE']);

/** One event, and the asset it belongs to. */
interface Pending {
  assetId: string;
  event: ActivityEvent;
  /** Lower wins when two sources describe the same action. */
  priority: number;
}

/**
 * Every protected file of one owner with its complete lifecycle.
 */
export async function getOwnerActivity(
  ownerUserId: string,
  options?: { limit?: number },
): Promise<OwnerActivity> {
  const owner = str(ownerUserId);
  if (!owner) return { files: [], unavailable: [] };
  const limit = Math.min(Math.max(options?.limit ?? 200, 1), 500);

  const assets = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT a.id, a."originalFilename", a."assetType"::text AS asset_type, a.status::text AS status,
            a."sizeBytes", a."createdAt", a."updatedAt", a."contentHash", a."dnaId", a."vaultId",
            a."monitorRecordId"
       FROM assets a
      WHERE a."ownerUserId" = $1
      ORDER BY a."createdAt" DESC
      LIMIT ${limit}`,
    owner,
  );
  if (!assets.length) return { files: [], unavailable: [] };

  const assetIds = assets.map((a) => String(a['id']));
  const dnaIds = assets.map((a) => a['dnaId']).filter((v): v is string => typeof v === 'string');
  const vaultIds = assets.map((a) => a['vaultId']).filter((v): v is string => typeof v === 'string');
  const unavailable: string[] = [];

  // --- every source, read in parallel --------------------------------------

  const [
    dnaRows, vaults, certificates, links, discoveries, purchases, listings,
    timeline, evidence, incidents, portfolioMedia, versions,
  ] = await Promise.all([
    dnaIds.length
      ? safeRows<Row>('protection records',
          `SELECT d.id, d."createdAt" FROM dna_records d WHERE d.id = ANY($1::text[])`, dnaIds)
      : [],

    dnaIds.length || vaultIds.length
      ? safeRows<Row>('vault storage',
          `SELECT v.id, v."dnaRecordId", v."createdAt", v."encryptedSizeBytes"
             FROM vault_records v
            WHERE v.id = ANY($1::text[]) OR v."dnaRecordId" = ANY($2::text[])`, vaultIds, dnaIds)
      : [],

    safeRows<Row>('certificates',
      `SELECT c."certificateId", c.status::text AS status, c."issuedAt", c."expiresAt", c."revokedAt",
              c."assetId", c."vaultId", c."dnaRecordId"
         FROM certificates c
        WHERE c."assetId" = ANY($1::text[]) OR c."vaultId" = ANY($2::text[])
           OR c."dnaRecordId" = ANY($3::text[])`, assetIds, vaultIds, dnaIds),

    safeRows<Row>('share links',
      `SELECT a.id AS asset_id, s.id, s.token, s."createdAt", s."updatedAt", s."isActive",
              s."expiresAt", s."allowDownload", s."recipientEmail",
              s."parentLinkId", s."forwardedByLabel", s."sourceContext", s.depth
         FROM assets a
         JOIN share_links s ON ${LINK_MATCHES_ASSET}
        WHERE a."ownerUserId" = $1 AND a.id = ANY($2::text[])`, owner, assetIds),

    safeRows<Row>('copies found online',
      `SELECT d.id, d."assetId", d.platform, d.url, d."createdAt"
         FROM asset_discoveries d WHERE d."assetId" = ANY($1::text[])`, assetIds),

    safeRows<Row>('Exchange sales',
      `SELECT asset_id, order_id, license_tier, buyer_pinit_id, sealed_at
         FROM exchange.orders_sealed WHERE asset_id = ANY($1::text[])`, assetIds),

    safeRows<Row>('Exchange listings',
      `SELECT listing_id, asset_id, status, title, created_at
         FROM exchange.listings WHERE asset_id = ANY($1::text[])`, assetIds),

    safeRows<Row>('asset timeline',
      `SELECT t.id, t."assetId", t."eventType"::text AS event_type, t.title, t.detail,
              t.platform, t.url, t."createdAt"
         FROM asset_timeline_events t WHERE t."assetId" = ANY($1::text[])`, assetIds),

    dnaIds.length
      ? safeRows<Row>('evidence records',
          `SELECT e.id, e."evidenceCode", e."evidenceType", e.description, e."dnaRecordId", e."createdAt"
             FROM evidence_records e
            WHERE e."ownerUserId" = $1 AND e."dnaRecordId" = ANY($2::text[])`, owner, dnaIds)
      : [],

    safeRows<Row>('investigation cases',
      `SELECT i.id, i."incidentCode", i.title, i.status, i.severity, i."assetId", i."dnaRecordId",
              i."createdAt", i."closedAt", i."resolvedAt"
         FROM incidents i
        WHERE i."assetId" = ANY($1::text[]) OR i."dnaRecordId" = ANY($2::text[])`, assetIds, dnaIds),

    safeRows<Row>('portfolio',
      `SELECT m.id, m."assetId", m."vaultId", m."createdAt", pr.title AS project_title,
              po.id AS portfolio_id, po."publishState", po."publishedAt"
         FROM portfolio_project_media m
         JOIN portfolio_projects pr ON pr.id = m."projectId"
         JOIN portfolios po ON po.id = pr."portfolioId"
        WHERE po."userId" = $1
          AND (m."assetId" = ANY($2::text[]) OR m."vaultId" = ANY($3::text[]))`,
      owner, assetIds, vaultIds),

    safeRows<Row>('versions',
      `SELECT v.id, v."assetId" FROM asset_versions v WHERE v."assetId" = ANY($1::text[])`, assetIds),
  ]);

  for (const [rows, label] of [
    [dnaRows, 'protection records'], [vaults, 'vault storage'], [certificates, 'certificates'],
    [links, 'share links'], [discoveries, 'copies found online'], [purchases, 'Exchange sales'],
    [listings, 'Exchange listings'], [timeline, 'asset timeline'], [evidence, 'evidence records'],
    [incidents, 'investigation cases'], [portfolioMedia, 'portfolio'], [versions, 'versions'],
  ] as Array<[unknown[] | null, string]>) {
    if (rows === null) unavailable.push(label);
  }

  const linkRows = links ?? [];
  const linkIds = linkRows.map((l) => String(l['id']));
  const logs = linkIds.length
    ? await safeRows<Row>('link activity',
        `SELECT l.id, l."shareLinkId", l.action, l."createdAt", l.country, l.city,
                l."recipientName", l.device, l.browser
           FROM share_access_logs l WHERE l."shareLinkId" = ANY($1::text[])`, linkIds)
    : [];
  if (logs === null) unavailable.push('link activity');

  // --- resolve every other identifier back to Asset.id ----------------------
  // Asset id, vault id, DNA id, certificate id and share-link id stay separate
  // identifiers. This only records which asset each one belongs to.

  const byVault = new Map<string, string[]>();
  const byDna = new Map<string, string[]>();
  const byMonitor = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, assetId: string) => {
    const list = map.get(key);
    if (list) list.push(assetId);
    else map.set(key, [assetId]);
  };
  for (const a of assets) {
    const id = String(a['id']);
    if (typeof a['vaultId'] === 'string') add(byVault, a['vaultId'], id);
    if (typeof a['dnaId'] === 'string') add(byDna, a['dnaId'], id);
    if (typeof a['monitorRecordId'] === 'string') add(byMonitor, a['monitorRecordId'], id);
  }

  const assetsFor = (assetId?: unknown, vaultId?: unknown, dnaId?: unknown): string[] => {
    const direct = str(assetId);
    if (direct && assetIds.includes(direct)) return [direct];
    const fromVault = byVault.get(str(vaultId)) ?? [];
    const fromDna = byDna.get(str(dnaId)) ?? [];
    return [...new Set([...fromVault, ...fromDna])];
  };

  const byCertificate = new Map<string, string[]>();
  for (const c of certificates ?? []) {
    const owners = assetsFor(c['assetId'], c['vaultId'], c['dnaRecordId']);
    if (owners.length) byCertificate.set(String(c['certificateId']), owners);
  }

  const byShareLink = new Map<string, string[]>();
  for (const l of linkRows) add(byShareLink, String(l['id']), String(l['asset_id']));

  const byPortfolio = new Map<string, string[]>();
  for (const m of portfolioMedia ?? []) {
    for (const id of assetsFor(m['assetId'], m['vaultId'], null)) {
      add(byPortfolio, String(m['portfolio_id']), id);
    }
  }

  const byVersion = new Map<string, string[]>();
  for (const v of versions ?? []) add(byVersion, String(v['id']), String(v['assetId']));

  const byIncident = new Map<string, string[]>();
  for (const i of incidents ?? []) {
    const owners = assetsFor(i['assetId'], null, i['dnaRecordId']);
    if (owners.length) byIncident.set(String(i['id']), owners);
  }

  /** Which assets a platform event belongs to, by the entity it was raised against. */
  const platformEventAssets = (entityType: string, entityId: string): string[] => {
    switch (entityType) {
      case 'asset': return assetIds.includes(entityId) ? [entityId] : [];
      case 'vault': return byVault.get(entityId) ?? [];
      case 'dna_record': return byDna.get(entityId) ?? [];
      case 'certificate': return byCertificate.get(entityId) ?? [];
      case 'share_link': return byShareLink.get(entityId) ?? [];
      case 'monitor_record': return byMonitor.get(entityId) ?? [];
      case 'portfolio': return byPortfolio.get(entityId) ?? [];
      case 'asset_version': return byVersion.get(entityId) ?? [];
      case 'investigation': return byIncident.get(entityId) ?? [];
      default: return [];
    }
  };

  const platformNames = Object.keys(PLATFORM_EVENTS);
  const platformEvents = await safeRows<Row>('platform events',
    `SELECT p.id, p.name, p."entityType", p."entityId", p.title, p.body, p."createdAt"
       FROM platform_events p
      WHERE p."ownerUserId" = $1 AND p.name = ANY($2::text[])
      ORDER BY p."createdAt" ASC`, owner, platformNames);
  if (platformEvents === null) unavailable.push('platform events');

  // --- collect every event --------------------------------------------------

  const pending: Pending[] = [];
  const push = (assetIdsFor: string[], priority: number, event: ActivityEvent) => {
    for (const assetId of assetIdsFor) pending.push({ assetId, event, priority });
  };

  const protectedAtByDna = new Map<string, Date>();
  for (const d of dnaRows ?? []) protectedAtByDna.set(String(d['id']), new Date(d['createdAt'] as string));

  const vaultById = new Map<string, Row>();
  const vaultByDna = new Map<string, Row>();
  for (const v of vaults ?? []) {
    vaultById.set(String(v['id']), v);
    vaultByDna.set(String(v['dnaRecordId']), v);
  }

  // The spine: protected, stored, archived.
  const firstProtectionPerHash = new Map<string, string>();
  const orderedAssets = [...assets].sort(
    (x, y) => new Date(x['createdAt'] as string).getTime() - new Date(y['createdAt'] as string).getTime(),
  );
  for (const r of orderedAssets) {
    const id = String(r['id']);
    const hash = str(r['contentHash']) || `asset:${id}`;
    const first = !firstProtectionPerHash.has(hash);
    if (first) firstProtectionPerHash.set(hash, id);

    const at = (typeof r['dnaId'] === 'string' ? protectedAtByDna.get(r['dnaId']) : undefined)
      ?? new Date(r['createdAt'] as string);

    push([id], 0, {
      id: `protected-${id}`,
      at,
      type: first ? 'PROTECTED' : 'PROTECTED_AGAIN',
      title: first ? 'Protected' : 'Protected again',
      detail: first
        ? `Identity created · ${str(r['asset_type']).toLowerCase()} · ${kb(Number(r['sizeBytes'] ?? 0))}`
        : `The same file was protected again · ${kb(Number(r['sizeBytes'] ?? 0))}`,
      meta: { 'Saved as': str(r['originalFilename']) },
    });

    const vault = (typeof r['vaultId'] === 'string' ? vaultById.get(r['vaultId']) : undefined)
      ?? (typeof r['dnaId'] === 'string' ? vaultByDna.get(r['dnaId']) : undefined);
    if (vault) {
      push([id], 0, {
        id: `vault-${String(vault['id'])}`,
        at: new Date(vault['createdAt'] as string),
        type: 'VAULT_STORED',
        title: 'Stored securely',
        detail: `Encrypted and saved in your vault · ${kb(Number(vault['encryptedSizeBytes'] ?? 0))}`,
      });
    }

    if (str(r['status']) === 'ARCHIVED') {
      push([id], 0, {
        id: `archived-${id}`,
        at: new Date((r['updatedAt'] ?? r['createdAt']) as string),
        type: 'ARCHIVED',
        title: 'Archived',
        detail: 'Removed from your active files — its record and evidence are kept',
      });
    }
  }

  // Certificates: issued, revoked, expired. Checks come from platform events.
  const now = new Date();
  for (const c of certificates ?? []) {
    const id = String(c['certificateId']);
    const owners = byCertificate.get(id) ?? [];
    if (!owners.length) continue;
    push(owners, 0, {
      id: `cert-${id}`,
      at: new Date(c['issuedAt'] as string),
      type: 'CERTIFICATE_ISSUED',
      title: 'Ownership certificate issued',
      detail: 'Anyone with the link can check this file is yours',
      meta: { 'Certificate ID': id },
    });
    if (c['revokedAt']) {
      push(owners, 0, {
        id: `cert-revoked-${id}`,
        at: new Date(c['revokedAt'] as string),
        type: 'CERTIFICATE_REVOKED',
        title: 'Certificate revoked',
        detail: 'The certificate no longer verifies',
        meta: { 'Certificate ID': id },
      });
    }
    const expiresAt = c['expiresAt'] ? new Date(c['expiresAt'] as string) : null;
    if (expiresAt && expiresAt < now) {
      push(owners, 0, {
        id: `cert-expired-${id}`,
        at: expiresAt,
        type: 'CERTIFICATE_EXPIRED',
        title: 'Certificate expired',
        detail: 'Issue a new one to keep it checkable',
        meta: { 'Certificate ID': id },
      });
    }
  }

  // Portfolio: added, and the portfolio published after it was added.
  const publishedSeen = new Set<string>();
  for (const m of portfolioMedia ?? []) {
    const owners = assetsFor(m['assetId'], m['vaultId'], null);
    if (!owners.length) continue;
    const addedAt = new Date(m['createdAt'] as string);
    push(owners, 0, {
      id: `portfolio-${String(m['id'])}`,
      at: addedAt,
      type: 'PORTFOLIO_ADDED',
      title: 'Added to your portfolio',
      detail: str(m['project_title']) ? `In "${str(m['project_title'])}"` : 'Shown on your public portfolio',
    });
    const publishedAt = m['publishedAt'] ? new Date(m['publishedAt'] as string) : null;
    const portfolioId = String(m['portfolio_id']);
    if (publishedAt && publishedAt >= addedAt && str(m['publishState']) === 'PUBLISHED') {
      for (const assetId of owners) {
        const key = `${portfolioId}:${assetId}`;
        if (publishedSeen.has(key)) continue;
        publishedSeen.add(key);
        push([assetId], 0, {
          id: `portfolio-published-${key}`,
          at: publishedAt,
          type: 'PORTFOLIO_PUBLISHED',
          title: 'Portfolio published',
          detail: 'Your portfolio went public with this file on it',
        });
      }
    }
  }

  // Sharing: links, forwards, and what recipients did.
  const logsByLink = new Map<string, Row[]>();
  for (const l of logs ?? []) {
    const id = String(l['shareLinkId']);
    const list = logsByLink.get(id);
    if (list) list.push(l);
    else logsByLink.set(id, [l]);
  }

  for (const l of linkRows) {
    const assetId = String(l['asset_id']);
    const linkId = String(l['id']);
    const token = String(l['token']);
    const forwarded = Boolean(l['parentLinkId']);
    const recipient = str(l['recipientEmail']);

    push([assetId], 0, {
      id: `link-${linkId}`,
      at: new Date(l['createdAt'] as string),
      type: forwarded ? 'SHARE_FORWARDED' : 'SHARE_CREATED',
      title: forwarded ? 'Forwarded by a recipient' : 'Shared',
      detail: forwarded
        ? forwardLabel(l['forwardedByLabel'])
        : [
            recipient ? `Sent to ${recipient}` : 'Anyone with the link',
            l['expiresAt'] ? `expires ${new Date(l['expiresAt'] as string).toLocaleDateString()}` : 'no expiry',
            l['allowDownload'] ? 'download allowed' : 'view only',
            linkTail(token),
          ].join(' · '),
      token,
      meta: str(l['sourceContext']) && str(l['sourceContext']) !== 'hub'
        ? { Source: 'Exchange purchase' }
        : undefined,
    });

    // A link that is off but has no revoked/expired event of its own still says
    // so. A link past its expiry date expired; anything else was stopped by hand.
    if (!l['isActive']) {
      const stoppedAt = new Date((l['updatedAt'] ?? l['createdAt']) as string);
      const expiresAt = l['expiresAt'] ? new Date(l['expiresAt'] as string) : null;
      const expired = Boolean(expiresAt && expiresAt <= stoppedAt);
      push([assetId], 5, {
        id: `link-stopped-${linkId}`,
        at: stoppedAt,
        type: expired ? 'SHARE_EXPIRED' : 'SHARE_STOPPED',
        title: expired ? 'Link expired' : 'Link stopped',
        detail: expired
          ? `The ${linkTail(token)} reached its expiry date`
          : `The ${linkTail(token)} was stopped`,
        token,
      });
    }

    for (const log of logsByLink.get(linkId) ?? []) {
      const mapped = ACCESS_EVENTS[str(log['action']).toUpperCase()];
      if (!mapped) continue;
      const who = str(log['recipientName']);
      const where = place(log['city'], log['country']);
      push([assetId], 0, {
        id: `log-${String(log['id'])}`,
        at: new Date(log['createdAt'] as string),
        type: mapped.type,
        title: mapped.title,
        detail: [who || 'Someone', where ? `in ${where}` : null, str(log['device']) || null, linkTail(token)]
          .filter(Boolean)
          .join(' · '),
        token,
      });
    }
  }

  // Monitoring findings.
  for (const d of discoveries ?? []) {
    push([String(d['assetId'])], 0, {
      id: `found-${String(d['id'])}`,
      at: new Date(d['createdAt'] as string),
      type: 'FOUND_ONLINE',
      title: 'Copy found online',
      detail: [str(d['platform']) || 'Web', str(d['url'])].filter(Boolean).join(' · '),
      meta: str(d['url']) ? { URL: str(d['url']) } : undefined,
    });
  }

  // Exchange: listed, then sold.
  for (const l of listings ?? []) {
    const assetId = str(l['asset_id']);
    if (!assetIds.includes(assetId)) continue;
    const status = str(l['status']).toLowerCase();
    push([assetId], 5, {
      id: `listing-${str(l['listing_id'])}`,
      at: new Date(l['created_at'] as string),
      type: 'EXCHANGE_LISTED',
      title: 'Listed on Exchange',
      detail: str(l['title']) || 'Available to licence',
    });
    if (status === 'unlisted' || status === 'removed' || status === 'archived') {
      push([assetId], 0, {
        id: `unlisted-${str(l['listing_id'])}`,
        // No unlist timestamp is recorded, so this line carries the listing's own
        // date rather than a guessed one, and says only that it is no longer listed.
        at: new Date(l['created_at'] as string),
        type: 'EXCHANGE_UNLISTED',
        title: 'No longer listed on Exchange',
        detail: 'The listing was taken down',
      });
    }
  }

  for (const p of purchases ?? []) {
    const assetId = str(p['asset_id']);
    if (!assetIds.includes(assetId)) continue;
    push([assetId], 0, {
      id: `sold-${str(p['order_id']) || assetId}`,
      at: new Date(p['sealed_at'] as string),
      type: 'SOLD',
      title: 'Purchased on Exchange',
      detail: `${str(p['license_tier']) || 'Licence'} · buyer ${str(p['buyer_pinit_id']) || 'unknown'}`,
    });
  }

  // Investigations and the evidence they produced.
  for (const i of incidents ?? []) {
    const owners = byIncident.get(String(i['id'])) ?? [];
    if (!owners.length) continue;
    push(owners, 5, {
      id: `case-${String(i['id'])}`,
      at: new Date(i['createdAt'] as string),
      type: 'INVESTIGATION_STARTED',
      title: 'Investigation opened',
      detail: str(i['title']) || str(i['incidentCode']),
    });
    const closedAt = i['closedAt'] ?? i['resolvedAt'];
    if (closedAt) {
      push(owners, 5, {
        id: `case-closed-${String(i['id'])}`,
        at: new Date(closedAt as string),
        type: 'INVESTIGATION_COMPLETED',
        title: 'Investigation closed',
        detail: str(i['status']) || 'Closed',
      });
    }
  }

  for (const e of evidence ?? []) {
    const owners = byDna.get(str(e['dnaRecordId'])) ?? [];
    if (!owners.length) continue;
    push(owners, 0, {
      id: `evidence-${String(e['id'])}`,
      at: new Date(e['createdAt'] as string),
      type: 'EVIDENCE_CREATED',
      title: 'Evidence record created',
      detail: str(e['description']) || str(e['evidenceType']),
      meta: { Reference: str(e['evidenceCode']) },
    });
  }

  // The platform's own event stream, resolved back to the asset it concerns.
  for (const p of platformEvents ?? []) {
    const mapped = PLATFORM_EVENTS[str(p['name'])];
    if (!mapped) continue;
    const owners = platformEventAssets(str(p['entityType']), str(p['entityId']));
    if (!owners.length) continue;
    push(owners, 0, {
      id: `pe-${String(p['id'])}`,
      at: new Date(p['createdAt'] as string),
      type: mapped.type,
      title: mapped.title,
      detail: str(p['body']) || str(p['title']),
    });
  }

  // The timeline the platform already keeps against Asset.id.
  for (const t of timeline ?? []) {
    const eventType = str(t['event_type']);
    if (TIMELINE_IGNORED.has(eventType)) continue;
    const mapped = TIMELINE_EVENTS[eventType];
    if (!mapped) continue;
    const title = str(t['title']);

    // Deleting a file is recorded here, against the asset, and survives the
    // vault row it refers to. This is the end of the lifecycle.
    const isRemoval = eventType === 'STATUS_CHANGE' && /removed|deleted/i.test(title);

    push([String(t['assetId'])], 1, {
      id: `tl-${String(t['id'])}`,
      at: new Date(t['createdAt'] as string),
      type: isRemoval ? 'DELETED' : mapped.type,
      title: isRemoval ? 'Deleted from Hub' : (mapped.title ?? title),
      detail: isRemoval
        ? 'The stored file was removed — its identity, certificate and history are kept'
        : str(t['detail']) || str(t['url']) || str(t['platform']),
    });
  }

  // --- one action, one line -------------------------------------------------
  // Two sources can describe the same action (a link revoked in its own row and
  // in the event stream). Keep the first by priority, within the same minute.
  const eventsByAsset = new Map<string, ActivityEvent[]>();
  const seen = new Set<string>();
  const seenLoose = new Set<string>();
  for (const item of [...pending].sort((x, y) => x.priority - y.priority)) {
    const minute = Math.floor(item.event.at.getTime() / 60_000);
    const loose = `${item.assetId}|${item.event.type}|${minute}`;
    const key = `${loose}|${item.event.token ?? ''}`;
    if (seen.has(key)) continue;
    // One action, one line: an event that names no link is the same action as a
    // tokened one of its kind in that minute (a forward recorded twice, once by
    // the link row and once by the event stream).
    if (!item.event.token && seenLoose.has(loose)) continue;
    seen.add(key);
    seenLoose.add(loose);
    const list = eventsByAsset.get(item.assetId);
    if (list) list.push(item.event);
    else eventsByAsset.set(item.assetId, [item.event]);
  }

  // --- group the assets into files -----------------------------------------
  const groups = new Map<string, Row[]>();
  for (const a of assets) {
    const hash = str(a['contentHash']);
    const key = hash ? `hash:${hash}` : `asset:${String(a['id'])}`;
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }

  const files: ActivityFile[] = [];
  for (const [key, rows] of groups) {
    const ordered = [...rows].sort(
      (x, y) => new Date(x['createdAt'] as string).getTime() - new Date(y['createdAt'] as string).getTime(),
    );
    const newest = ordered[ordered.length - 1]!;
    const ids = ordered.map((r) => String(r['id']));

    const events = ids
      .flatMap((id) => eventsByAsset.get(id) ?? [])
      .sort((x, y) => x.at.getTime() - y.at.getTime());

    const names = ordered.map((r) => str(r['originalFilename'])).filter(Boolean);
    const filename = str(newest['originalFilename']);
    const certificate = events.find((e) => e.type === 'CERTIFICATE_ISSUED');

    files.push({
      key,
      assetId: String(newest['id']),
      assetIds: ids,
      dnaIds: ordered.map((r) => r['dnaId']).filter((v): v is string => typeof v === 'string'),
      vaultIds: ordered.map((r) => r['vaultId']).filter((v): v is string => typeof v === 'string'),
      filename,
      otherFilenames: [...new Set(names.filter((n) => n !== filename))],
      assetType: str(newest['asset_type']) || 'OTHER',
      status: str(newest['status']),
      sizeBytes: Number(newest['sizeBytes'] ?? 0),
      protectedAt: events[0]?.at ?? new Date(ordered[0]!['createdAt'] as string),
      lastActivityAt: events.length
        ? events[events.length - 1]!.at
        : new Date(newest['createdAt'] as string),
      timesProtected: ordered.length,
      certificateId: certificate?.meta?.['Certificate ID'] ?? null,
      // Deleted only when no stored copy is left. One copy being removed after a
      // re-protect is a line in the log, not the end of the file.
      deleted: ordered.every((r) => !r['vaultId']) && events.some((e) => e.type === 'DELETED'),
      events,
    });
  }

  files.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  return { files, unavailable };
}
