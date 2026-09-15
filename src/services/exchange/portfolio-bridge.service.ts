/**
 * @deprecated Phase 1: Hub owns portfolio rows. Do not PUT Exchange
 * portfolio_profiles. Photo lives on User.avatarUrl and is resolved at read time.
 */
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { toExchangePinitId, toRootPinitId } from '../../lib/pinit-identity';
import { publicAvatarUrl } from '../../lib/avatar-storage';

function bridgeHeaders() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-PinIT-Bridge-Secret': config.exchange.bridgeSecret,
  };
}

/**
 * Cache key for the portrait.
 *
 * The avatar always writes to the same object path, so a URL without a version
 * serves whatever the browser cached last — which is why a newly uploaded photo
 * kept showing the old one. Keyed on updatedAt rather than Date.now() so the URL
 * is stable until the profile actually changes, and the 1.6 MB image is not
 * re-fetched on every read.
 */
function avatarVersion(user: { updatedAt?: Date | null }): number | undefined {
  const t = user.updatedAt instanceof Date ? user.updatedAt.getTime() : undefined;
  return Number.isFinite(t) ? t : undefined;
}

async function hubUser(ownerUserId: string) {
  const user = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: {
      id: true,
      shortId: true,
      fullName: true,
      email: true,
      bio: true,
      jobTitle: true,
      country: true,
      avatarUrl: true,
      updatedAt: true,
    },
  });
  if (!user) throw new AppError(404, 'User not found');
  const pinitId = toExchangePinitId(user.shortId) || toRootPinitId(user.shortId) || user.shortId;
  return { user, pinitId };
}

async function readJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  return data as Record<string, unknown>;
}

export const portfolioBridgeService = {
  async getMine(ownerUserId: string) {
    const { user, pinitId } = await hubUser(ownerUserId);
    const qs = new URLSearchParams({
      pinitId,
      name: user.fullName || '',
      email: user.email || '',
      bio: user.bio || '',
    });
    const res = await fetch(`${config.exchange.apiUrl}/api/hub/portfolio?${qs.toString()}`, {
      headers: bridgeHeaders(),
    });
    const data = await readJson(res);
    if (!res.ok) {
      throw new AppError(res.status === 401 ? 502 : res.status, String(data.error || 'Unable to load portfolio'));
    }
    const slug = String((data as { slug?: string }).slug || '');
    const publicPath = String((data as { public_path?: string }).public_path || (slug ? `/p/${slug}` : ''));
    return {
      ...data,
      hub_identity: {
        name: user.fullName,
        headline: user.jobTitle || '',
        about: user.bio || '',
        location: user.country || '',
        photo_url: user.avatarUrl ? publicAvatarUrl(user.shortId, avatarVersion(user)) : '',
      },
      public_url: publicPath ? `${config.exchange.appUrl}${publicPath}` : config.exchange.appUrl,
      exchange_app_url: config.exchange.appUrl,
    };
  },

  async saveMine(ownerUserId: string, body: Record<string, unknown>) {
    const { user, pinitId } = await hubUser(ownerUserId);
    const res = await fetch(`${config.exchange.apiUrl}/api/hub/portfolio`, {
      method: 'PUT',
      headers: bridgeHeaders(),
      body: JSON.stringify({
        ...body,
        pinitId,
        name: user.fullName,
        email: user.email,
        bio: user.bio,
        headline: user.jobTitle || body.headline,
        location: user.country || body.location,
        photo_url: user.avatarUrl ? publicAvatarUrl(user.shortId, avatarVersion(user)) : '',
        about: body.about ?? user.bio,
      }),
    });
    const data = await readJson(res);
    if (!res.ok) {
      throw new AppError(res.status === 409 ? 409 : 502, String(data.error || 'Unable to save portfolio'));
    }
    const slug = String((data as { slug?: string }).slug || '');
    return {
      ...data,
      public_url: slug ? `${config.exchange.appUrl}/p/${slug}` : config.exchange.appUrl,
      exchange_app_url: config.exchange.appUrl,
    };
  },

  async syncPhoto(ownerUserId: string) {
    const { user, pinitId } = await hubUser(ownerUserId);
    const res = await fetch(`${config.exchange.apiUrl}/api/hub/portfolio`, {
      method: 'PUT',
      headers: bridgeHeaders(),
      body: JSON.stringify({
        pinitId,
        photo_url: user.avatarUrl ? publicAvatarUrl(user.shortId, avatarVersion(user)) : '',
      }),
    });
    if (!res.ok) {
      const data = await readJson(res);
      throw new AppError(502, String(data.error || 'Unable to sync portfolio photo'));
    }
  },
};
