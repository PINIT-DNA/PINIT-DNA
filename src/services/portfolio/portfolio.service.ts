import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { AppError } from '../../api/middleware/error.middleware';
import { publicAvatarUrl } from '../../lib/avatar-storage';
import {
  extractPinitCode,
  toExchangePinitId,
  toUserPinitId,
} from '../../lib/pinit-identity';
import { logger } from '../../lib/logger';
import {
  assemblePresentation,
  editorFormFromGraph,
  isPubliclyReadable,
  normalizeVisibility,
  parseEditorBody,
  slugifyName,
  stripPublicSecrets,
  type EditorBody,
  type IdentityOverlay,
} from './portfolio-document';

const GRAPH = {
  profile: true,
  projects: { include: { media: { orderBy: { sortOrder: 'asc' as const } } }, orderBy: { sortOrder: 'asc' as const } },
  collections: { include: { items: { orderBy: { sortOrder: 'asc' as const } } }, orderBy: { sortOrder: 'asc' as const } },
  services: { orderBy: { sortOrder: 'asc' as const } },
  skills: { orderBy: { sortOrder: 'asc' as const } },
  experience: { orderBy: { sortOrder: 'asc' as const } },
  awards: { orderBy: { sortOrder: 'asc' as const } },
  certificates: { orderBy: { sortOrder: 'asc' as const } },
  collaborations: { orderBy: { sortOrder: 'asc' as const } },
  socialLinks: { orderBy: { sortOrder: 'asc' as const } },
} as const;

type Graph = Awaited<ReturnType<typeof loadGraph>>;

async function loadGraph(portfolioId: string) {
  return prisma.portfolio.findUniqueOrThrow({
    where: { id: portfolioId },
    include: GRAPH,
  });
}

async function identityForUser(userId: string): Promise<IdentityOverlay & { shortId: string; fullName: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, shortId: true, fullName: true, avatarUrl: true, bio: true, updatedAt: true },
  });
  if (!user) throw new AppError(404, 'User not found');
  const photo = user.avatarUrl
    ? publicAvatarUrl(user.shortId, user.updatedAt instanceof Date ? user.updatedAt.getTime() : undefined)
    : '';
  return {
    name: user.fullName || 'Creator',
    photo_url: photo,
    pinit_id: toExchangePinitId(user.shortId) || user.shortId,
    pinit_user_id: toUserPinitId(user.shortId) || user.shortId,
    bio: user.bio || '',
    shortId: user.shortId,
    fullName: user.fullName,
  };
}

function exchangeAppUrl(): string {
  return config.exchange.appUrl.replace(/\/$/, '');
}

export function issuePreviewToken(userId: string, slug: string): string {
  return jwt.sign(
    { purpose: 'portfolio_preview', sub: userId, slug },
    config.jwt.secret,
    { expiresIn: '2h' },
  );
}

export function verifyPreviewToken(token: string, slug: string): { sub: string } | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as { purpose?: string; sub?: string; slug?: string };
    if (decoded.purpose !== 'portfolio_preview' || decoded.slug !== slug || !decoded.sub) return null;
    return { sub: decoded.sub };
  } catch {
    return null;
  }
}

async function uniquePortfolioSlug(base: string, userId: string): Promise<string> {
  const root = slugifyName(base) || `p${userId.replace(/[^a-z0-9]/gi, '').slice(0, 10).toLowerCase()}` || 'portfolio';
  for (let n = 0; n < 30; n += 1) {
    const candidate = n === 0 ? root : `${root}${n}`;
    const taken = await prisma.portfolio.findFirst({
      where: { slug: candidate, NOT: { userId } },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${root}${Date.now().toString(36)}`;
}

async function resolveAssetIds(vaultIds: string[], ownerUserId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!vaultIds.length) return map;
  const assets = await prisma.asset.findMany({
    where: { ownerUserId, vaultId: { in: vaultIds } },
    select: { id: true, vaultId: true },
  });
  for (const a of assets) {
    if (a.vaultId) map.set(a.vaultId, a.id);
  }
  return map;
}

async function replaceDraft(portfolioId: string, ownerUserId: string, body: EditorBody) {
  const parsed = parseEditorBody(body);
  const current = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!current) throw new AppError(404, 'Portfolio not found');

  const requested = parsed.slug && parsed.slug !== 'creator' ? parsed.slug : undefined;
  const slug = requested
    ? await uniquePortfolioSlug(requested, ownerUserId)
    : current.slug;

  const allVaults = parsed.projects.flatMap((p) => p.vaultIds);
  const assetByVault = await resolveAssetIds(allVaults, ownerUserId);

  await prisma.$transaction(async (tx) => {
    await tx.portfolioProjectMedia.deleteMany({ where: { project: { portfolioId } } });
    await tx.portfolioCollectionItem.deleteMany({ where: { collection: { portfolioId } } });
    await tx.portfolioProject.deleteMany({ where: { portfolioId } });
    await tx.portfolioCollection.deleteMany({ where: { portfolioId } });
    await tx.portfolioService.deleteMany({ where: { portfolioId } });
    await tx.portfolioSkill.deleteMany({ where: { portfolioId } });
    await tx.portfolioExperience.deleteMany({ where: { portfolioId } });
    await tx.portfolioAward.deleteMany({ where: { portfolioId } });
    await tx.portfolioCertificate.deleteMany({ where: { portfolioId } });
    await tx.portfolioCollaboration.deleteMany({ where: { portfolioId } });
    await tx.portfolioSocialLink.deleteMany({ where: { portfolioId } });

    await tx.portfolio.update({
      where: { id: portfolioId },
      data: {
        slug,
        visibility: parsed.visibility ?? current.visibility,
        theme: parsed.theme ?? current.theme,
        template: parsed.template ?? current.template,
        ...(parsed.featuredListingIds !== undefined
          ? { featuredListingIds: parsed.featuredListingIds }
          : {}),
      },
    });

    await tx.portfolioProfile.upsert({
      where: { portfolioId },
      create: { id: randomUUID(), portfolioId, ...parsed.profile },
      update: parsed.profile,
    });

    for (const proj of parsed.projects) {
      const projectId = proj.id && proj.id.length > 8 ? proj.id : randomUUID();
      await tx.portfolioProject.create({
        data: {
          id: projectId,
          portfolioId,
          slug: proj.slug,
          title: proj.title,
          year: proj.year,
          category: proj.category,
          description: proj.description,
          client: proj.client,
          role: proj.role,
          featured: proj.featured,
          sortOrder: proj.sortOrder,
          media: {
            create: proj.vaultIds.map((vaultId, i) => ({
              id: randomUUID(),
              sortOrder: i,
              type: 'IMAGE',
              vaultId,
              assetId: assetByVault.get(vaultId) || null,
            })),
          },
        },
      });
      await tx.portfolioCollection.create({
        data: {
          id: randomUUID(),
          portfolioId,
          slug: proj.slug,
          title: proj.title,
          description: proj.description,
          sortOrder: proj.sortOrder,
          items: {
            create: [
              { id: randomUUID(), sortOrder: 0, projectId },
              ...proj.vaultIds.map((vaultId, i) => ({
                id: randomUUID(),
                sortOrder: i + 1,
                vaultId,
                assetId: assetByVault.get(vaultId) || null,
              })),
            ],
          },
        },
      });
    }

    if (parsed.services.length) {
      await tx.portfolioService.createMany({
        data: parsed.services.map((s) => ({ id: randomUUID(), portfolioId, name: s.name, sortOrder: s.sortOrder })),
      });
    }
    if (parsed.skills.length) {
      await tx.portfolioSkill.createMany({
        data: parsed.skills.map((s) => ({ id: randomUUID(), portfolioId, name: s.name, sortOrder: s.sortOrder })),
      });
    }
    if (parsed.experience.length) {
      await tx.portfolioExperience.createMany({
        data: parsed.experience.map((e) => ({ id: randomUUID(), portfolioId, ...e })),
      });
    }
    if (parsed.awards.length) {
      await tx.portfolioAward.createMany({
        data: parsed.awards.map((a) => ({ id: randomUUID(), portfolioId, ...a })),
      });
    }
    if (parsed.certificates.length) {
      await tx.portfolioCertificate.createMany({
        data: parsed.certificates.map((c) => ({ id: randomUUID(), portfolioId, ...c })),
      });
    }
    if (parsed.collaborations.length) {
      await tx.portfolioCollaboration.createMany({
        data: parsed.collaborations.map((c) => ({ id: randomUUID(), portfolioId, ...c })),
      });
    }
    if (parsed.socialLinks.length) {
      await tx.portfolioSocialLink.createMany({
        data: parsed.socialLinks.map((s) => ({ id: randomUUID(), portfolioId, ...s })),
      });
    }
  });
}

function toOwnerPayload(graph: Graph, identity: IdentityOverlay, extra: Record<string, unknown> = {}) {
  const form = editorFormFromGraph(graph as Parameters<typeof editorFormFromGraph>[0]);
  const presentation = assemblePresentation(graph as Parameters<typeof assemblePresentation>[0], identity, { ownerView: true });
  const previewToken = issuePreviewToken(graph.userId, graph.slug);
  const publicUrl = `${exchangeAppUrl()}/p/${graph.slug}`;
  return {
    success: true,
    ...form,
    ...presentation,
    portfolio: { ...presentation, ...form },
    hub_identity: {
      name: identity.name,
      photo_url: identity.photo_url,
    },
    publish_state: graph.publishState,
    published_version: graph.publishedVersion,
    published_at: graph.publishedAt,
    public_url: publicUrl,
    preview_url: `${publicUrl}?preview=1&pt=${encodeURIComponent(previewToken)}`,
    preview_token: previewToken,
    exchange_app_url: exchangeAppUrl(),
    ...extra,
  };
}

async function findUserForImportedPinitId(pinitId: string) {
  const code = extractPinitCode(pinitId);
  if (!code) return null;
  const ids = [pinitId, toUserPinitId(pinitId), toExchangePinitId(pinitId)].filter(Boolean);
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { shortId: { in: ids } },
        { shortId: { endsWith: `-${code}` } },
      ],
    },
    select: { id: true, shortId: true, updatedAt: true },
  });
  if (!users.length) return null;
  users.sort((a, b) => {
    const rank = (s: string) => (s.includes('-USER-') ? 3 : s.includes('-EX-') ? 1 : 2);
    return rank(b.shortId) - rank(a.shortId) || b.updatedAt.getTime() - a.updatedAt.getTime();
  });
  return users[0];
}

async function fetchExchangeProfiles(): Promise<EditorBody[]> {
  const res = await fetch(`${config.exchange.apiUrl}/api/hub/portfolios`, {
    headers: {
      Accept: 'application/json',
      'X-PinIT-Bridge-Secret': config.exchange.bridgeSecret,
    },
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({})) as { profiles?: EditorBody[] };
  return Array.isArray(data.profiles) ? data.profiles : [];
}

export const portfolioService = {
  async getOrCreate(userId: string) {
    const identity = await identityForUser(userId);
    let row = await prisma.portfolio.findUnique({ where: { userId } });
    if (!row) {
      const slug = await uniquePortfolioSlug(identity.fullName || identity.shortId, userId);
      row = await prisma.portfolio.create({
        data: {
          userId,
          slug,
          visibility: 'unlisted',
          publishState: 'DRAFT',
          profile: { create: { headline: '', about: '', location: '' } },
        },
      });
      return row;
    }
    const named = slugifyName(identity.fullName || identity.shortId);
    if (named && row.slug === 'creator') {
      const slug = await uniquePortfolioSlug(identity.fullName || identity.shortId, userId);
      if (slug !== row.slug) {
        row = await prisma.portfolio.update({ where: { id: row.id }, data: { slug } });
      }
    }
    return row;
  },

  async getMine(userId: string) {
    await this.getOrCreate(userId);
    await this.importFromExchangeIfEmpty(userId);
    const row = await prisma.portfolio.findUniqueOrThrow({ where: { userId } });
    const graph = await loadGraph(row.id);
    const identity = await identityForUser(userId);
    return toOwnerPayload(graph, identity);
  },

  async saveDraft(userId: string, body: EditorBody) {
    const row = await this.getOrCreate(userId);
    await replaceDraft(row.id, userId, body);
    const graph = await loadGraph(row.id);
    const identity = await identityForUser(userId);
    return toOwnerPayload(graph, identity, { saved: true });
  },

  async publish(userId: string, body?: EditorBody) {
    if (body && Object.keys(body).length) {
      await this.saveDraft(userId, body);
    }
    const row = await prisma.portfolio.findUniqueOrThrow({ where: { userId } });
    if (!row.slug) throw new AppError(400, 'Set a portfolio URL before publishing.');
    const graph = await loadGraph(row.id);
    const identity = await identityForUser(userId);
    const snapshot = assemblePresentation(graph as Parameters<typeof assemblePresentation>[0], identity, { ownerView: false });
    const vis = normalizeVisibility(row.visibility);
    await prisma.portfolio.update({
      where: { id: row.id },
      data: {
        publishState: 'PUBLISHED',
        publishedAt: new Date(),
        publishedVersion: { increment: 1 },
        publishedSnapshot: snapshot as object,
        visibility: vis === 'private' ? 'unlisted' : vis,
      },
    });
    const next = await loadGraph(row.id);
    return toOwnerPayload(next, identity, { published: true });
  },

  async unpublish(userId: string) {
    const row = await prisma.portfolio.findUnique({ where: { userId } });
    if (!row) throw new AppError(404, 'Portfolio not found');
    await prisma.portfolio.update({
      where: { id: row.id },
      data: { publishState: 'DRAFT' },
    });
    const graph = await loadGraph(row.id);
    const identity = await identityForUser(userId);
    return toOwnerPayload(graph, identity, { unpublished: true });
  },

  async previewMine(userId: string) {
    const row = await this.getOrCreate(userId);
    const graph = await loadGraph(row.id);
    const identity = await identityForUser(userId);
    return assemblePresentation(graph as Parameters<typeof assemblePresentation>[0], identity, { ownerView: true });
  },

  async getPublicBySlug(slug: string, previewToken?: string) {
    const clean = slugifyName(slug) || String(slug || '').toLowerCase();
    const row = await prisma.portfolio.findFirst({
      where: { slug: { equals: clean, mode: 'insensitive' } },
    });
    if (!row) throw new AppError(404, 'Portfolio not found');

    if (previewToken) {
      const ok = verifyPreviewToken(previewToken, row.slug);
      if (ok?.sub === row.userId) {
        const graph = await loadGraph(row.id);
        const identity = await identityForUser(row.userId);
        return assemblePresentation(graph as Parameters<typeof assemblePresentation>[0], identity, { ownerView: true });
      }
    }

    if (!isPubliclyReadable(row.publishState, row.visibility) || !row.publishedSnapshot) {
      throw new AppError(404, 'This portfolio is not public');
    }
    const identity = await identityForUser(row.userId);
    const snap = row.publishedSnapshot as Record<string, unknown>;
    const identitySnap = (snap.identity && typeof snap.identity === 'object')
      ? snap.identity as Record<string, unknown>
      : {};
    return stripPublicSecrets({
      ...snap,
      published_version: row.publishedVersion,
      publish_state: row.publishState,
      identity: {
        ...identitySnap,
        name: identity.name,
        photo_url: identity.photo_url,
        pinit_id: identity.pinit_id,
        pinit_user_id: identity.pinit_user_id,
      },
    });
  },

  async importFromExchangeIfEmpty(userId: string): Promise<boolean> {
    const row = await prisma.portfolio.findUnique({
      where: { userId },
      include: {
        projects: true,
        profile: true,
        skills: true,
        services: true,
        experience: true,
        awards: true,
        collaborations: true,
        certificates: true,
      },
    });
    if (!row) return false;
    const touched = row.updatedAt.getTime() - row.createdAt.getTime() > 3000;
    const hasContent = Boolean(
      touched
      || row.profile?.headline
      || row.profile?.about
      || row.profile?.location
      || row.projects.length
      || row.skills.length
      || row.services.length
      || row.experience.length
      || row.awards.length
      || row.collaborations.length
      || row.certificates.length
    );
    if (hasContent) return false;
    try {
      const profiles = await fetchExchangeProfiles();
      const identity = await identityForUser(userId);
      const code = extractPinitCode(identity.shortId);
      const match = profiles.find((p) => extractPinitCode(String(p.pinit_id || '')) === code);
      if (!match) return false;
      await replaceDraft(row.id, userId, {
        ...match,
        slug: match.slug || row.slug,
      });
      if (match.visibility === 'public' || match.published_at) {
        await this.publish(userId);
      }
      logger.info('[portfolio] backfilled from Exchange', { userId, slug: match.slug });
      return true;
    } catch (err) {
      logger.warn('[portfolio] Exchange backfill skipped', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  },

  async backfillAllFromExchange() {
    const profiles = await fetchExchangeProfiles();
    const results: Array<{ pinit_id: string; userId?: string; slug?: string; status: string }> = [];
    for (const profile of profiles) {
      const pinitId = String(profile.pinit_id || '');
      const user = await findUserForImportedPinitId(pinitId);
      if (!user) {
        results.push({ pinit_id: pinitId, status: 'no_hub_user' });
        continue;
      }
      await this.getOrCreate(user.id);
      const row = await prisma.portfolio.findUniqueOrThrow({ where: { userId: user.id } });
      await replaceDraft(row.id, user.id, { ...profile, slug: profile.slug || row.slug });
      if (profile.visibility === 'public' || profile.published_at) {
        await this.publish(user.id);
      }
      const next = await prisma.portfolio.findUniqueOrThrow({ where: { userId: user.id } });
      results.push({ pinit_id: pinitId, userId: user.id, slug: next.slug, status: 'imported' });
    }
    return results;
  },
};
