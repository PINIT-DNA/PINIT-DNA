import { fetchHubProfiles } from '../hub-client.js';
import { allSql, getSql, runSql } from './db.js';
import { sellerMatchClause, extractPinitCode, toUserPinitId } from './pinit-identity.js';
import { exchangePreviewUrl } from './preview-url.js';
import { canList } from './roles.js';

export const DEFAULT_SECTIONS = {
  about: true,
  featured: true,
  skills: true,
  experience: true,
  projects: true,
  certifications: true,
  awards: true,
  clients: true,
  testimonials: true,
  services: true,
  marketplace: true,
  contact: true,
  trust: true,
};

export function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function slugifyName(name) {
  const slug = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 48);
  return slug || 'creator';
}

function stringify(value) {
  return JSON.stringify(value ?? null);
}

function withPreview(item) {
  return {
    ...item,
    preview_url: exchangePreviewUrl(item.asset_id, item.preview_url),
  };
}

function isLiveListing(item) {
  const s = String(item?.status || '').toLowerCase();
  return s === 'published' || s === 'live';
}

function listingCard(item) {
  const row = withPreview(item);
  return {
    listing_id: row.listing_id,
    asset_id: row.asset_id,
    title: row.title,
    tagline: row.tagline || '',
    vertical: row.vertical || '',
    preview_url: row.preview_url || '',
    price_personal: row.price_personal,
    price_commercial: row.price_commercial,
    views: row.views || 0,
    badge_tier: row.badge_tier || '',
    human_percent: row.human_percent,
  };
}

function splitSkills(raw) {
  const value = parseJson(raw, []);
  if (Array.isArray(value)) return { items: value.filter(Boolean), categories: [] };
  return {
    items: Array.isArray(value?.items) ? value.items.filter(Boolean) : [],
    categories: Array.isArray(value?.categories) ? value.categories.filter(Boolean) : [],
  };
}

export function isPublicEmail(email) {
  const value = String(email || '').trim();
  if (!value || !value.includes('@')) return '';
  if (/pinithub\.local$/i.test(value) || /@pinit\.local$/i.test(value) || /^ex-/i.test(value)) return '';
  return value;
}

export function rowToProfile(row) {
  if (!row) return null;
  const skills = splitSkills(row.skills);
  return {
    pinit_id: row.pinit_id,
    slug: row.slug,
    visibility: row.visibility || 'private',
    headline: row.headline || '',
    about: row.about || '',
    location: row.location || '',
    cover_url: row.cover_url || '',
    photo_url: row.photo_url || '',
    skills: skills.items,
    categories: skills.categories,
    experience: parseJson(row.experience, []),
    certifications: parseJson(row.certifications, []),
    awards: parseJson(row.awards, []),
    clients: parseJson(row.clients, []),
    services: parseJson(row.services, []),
    available_for: parseJson(row.available_for, []),
    featured_listing_ids: parseJson(row.featured_listing_ids, []),
    project_groups: parseJson(row.project_groups, []),
    section_visibility: { ...DEFAULT_SECTIONS, ...parseJson(row.section_visibility, {}) },
    contact_email: isPublicEmail(row.contact_email),
    contact_note: row.contact_note || '',
    published_at: row.published_at || null,
    updated_at: row.updated_at || null,
  };
}

async function uniqueSlug(base, pinitId) {
  let slug = slugifyName(base);
  const code = extractPinitCode(pinitId);
  let n = 0;
  while (n < 20) {
    const candidate = n === 0 ? slug : `${slug}${code ? code.toLowerCase() : n}`;
    const existing = await getSql('SELECT pinit_id FROM portfolio_profiles WHERE slug = ?', [candidate]);
    if (!existing || existing.pinit_id === pinitId) return candidate;
    n += 1;
    if (n === 1 && code) slug = `${slugifyName(base)}${code.toLowerCase()}`;
  }
  return `${slug}${Date.now().toString(36)}`;
}

export async function ensureProfile(user) {
  if (!user?.pinit_id) return null;
  const existing = await getSql('SELECT * FROM portfolio_profiles WHERE pinit_id = ?', [user.pinit_id]);
  if (existing) return rowToProfile(existing);

  const name = user.display_name || user.name || 'Creator';
  const slug = await uniqueSlug(name, user.pinit_id);
  const about = String(user.bio || '').trim();
  await runSql(
    `INSERT INTO portfolio_profiles (
      pinit_id, slug, visibility, headline, about, contact_email, skills, experience,
      certifications, awards, clients, services, available_for, featured_listing_ids,
      project_groups, section_visibility
    ) VALUES (?, ?, 'unlisted', ?, ?, ?, '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', ?)`,
    [
      user.pinit_id,
      slug,
      '',
      about,
      user.email || '',
      stringify(DEFAULT_SECTIONS),
    ],
  );
  const created = await getSql('SELECT * FROM portfolio_profiles WHERE pinit_id = ?', [user.pinit_id]);
  return rowToProfile(created);
}

export async function findUserForSlug(slug) {
  const clean = slugifyName(slug);
  if (!clean) return null;
  const bySlug = await getSql('SELECT * FROM portfolio_profiles WHERE slug = ?', [clean]);
  if (bySlug) {
    const user = await getSql('SELECT * FROM users WHERE pinit_id = ?', [bySlug.pinit_id]);
    return { user, profile: rowToProfile(bySlug) };
  }
  const users = await allSql(
    `SELECT * FROM users WHERE LOWER(REPLACE(REPLACE(COALESCE(display_name, name, ''), ' ', ''), '.', '')) = ?`,
    [clean],
  );
  const user = (users || []).find((row) => canList(row.role)) || users?.[0] || null;
  if (!user || !canList(user.role)) return null;
  const profile = await ensureProfile(user);
  return { user, profile };
}

export async function saveProfile(pinitId, patch, { publish = false } = {}) {
  const user = await getSql('SELECT * FROM users WHERE pinit_id = ?', [pinitId]);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  const current = await ensureProfile(user);
  const requestedSlug = patch.slug ? slugifyName(patch.slug) : '';
  const nextSlug = requestedSlug || current.slug;
  if (nextSlug !== current.slug) {
    const taken = await getSql('SELECT pinit_id FROM portfolio_profiles WHERE slug = ?', [nextSlug]);
    if (taken && taken.pinit_id !== pinitId) {
      throw Object.assign(new Error('That portfolio URL is already taken'), { status: 409 });
    }
  }
  const visibility = ['public', 'unlisted', 'private'].includes(patch.visibility)
    ? patch.visibility
    : current.visibility;
  const publishedAt = publish || visibility === 'public'
    ? (current.published_at || new Date().toISOString())
    : current.published_at;

  await runSql(
    `UPDATE portfolio_profiles SET
      slug = ?,
      visibility = ?,
      headline = ?,
      about = ?,
      location = ?,
      cover_url = ?,
      photo_url = ?,
      skills = ?,
      experience = ?,
      certifications = ?,
      awards = ?,
      clients = ?,
      services = ?,
      available_for = ?,
      featured_listing_ids = ?,
      project_groups = ?,
      section_visibility = ?,
      contact_email = ?,
      contact_note = ?,
      published_at = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE pinit_id = ?`,
    [
      nextSlug || current.slug,
      visibility,
      patch.headline ?? current.headline,
      patch.about ?? current.about,
      patch.location ?? current.location,
      patch.cover_url ?? current.cover_url,
      patch.photo_url ?? current.photo_url,
      stringify({
        items: patch.skills ?? current.skills,
        categories: patch.categories ?? current.categories ?? [],
      }),
      stringify(patch.experience ?? current.experience),
      stringify(patch.certifications ?? current.certifications),
      stringify(patch.awards ?? current.awards),
      stringify(patch.clients ?? current.clients),
      stringify(patch.services ?? current.services),
      stringify(patch.available_for ?? current.available_for),
      stringify(patch.featured_listing_ids ?? current.featured_listing_ids),
      stringify(patch.project_groups ?? current.project_groups),
      stringify({ ...DEFAULT_SECTIONS, ...(patch.section_visibility || current.section_visibility) }),
      isPublicEmail(patch.contact_email ?? current.contact_email),
      patch.contact_note ?? current.contact_note,
      publishedAt,
      pinitId,
    ],
  );
  return rowToProfile(await getSql('SELECT * FROM portfolio_profiles WHERE pinit_id = ?', [pinitId]));
}

async function loadSellerListings(pinitId) {
  const scope = sellerMatchClause('pinit_id', pinitId);
  const where = scope.sql.replace(/^\s*AND\s+/i, '');
  return allSql(`SELECT * FROM listings WHERE ${where} ORDER BY created_at DESC`, scope.params);
}

async function loadSalesCount(pinitId) {
  const scope = sellerMatchClause('seller_pinit_id', pinitId);
  const where = scope.sql.replace(/^\s*AND\s+/i, '');
  const row = await getSql(`SELECT COUNT(*) AS n FROM orders_sealed WHERE ${where}`, scope.params);
  return Number(row?.n || 0);
}

async function loadReviews(listingIds) {
  if (!listingIds.length) return [];
  const placeholders = listingIds.map(() => '?').join(', ');
  const rows = await allSql(
    `SELECT listing_id, buyer_name, rating, comment, created_at
     FROM reviews WHERE listing_id IN (${placeholders}) AND comment IS NOT NULL AND TRIM(comment) <> ''
     ORDER BY created_at DESC LIMIT 12`,
    listingIds,
  );
  return rows.map((row) => ({
    ...row,
    verified_transaction: true,
  }));
}

function visible(sections, key) {
  return sections?.[key] !== false;
}

export async function assemblePortfolio(user, profile, { ownerView = false } = {}) {
  if (!user || !profile) return null;
  if (!ownerView && profile.visibility === 'private') return null;
  if (!ownerView && !['public', 'unlisted'].includes(profile.visibility)) return null;

  const listings = await loadSellerListings(user.pinit_id);
  const live = listings.filter(isLiveListing);
  const liveIds = new Set(live.map((row) => row.listing_id));
  const featuredIds = (profile.featured_listing_ids || []).filter((id) => liveIds.has(id));
  const selected = featuredIds
    .map((id) => live.find((row) => row.listing_id === id))
    .filter(Boolean)
    .map(listingCard);

  const marketplace = live.slice(0, 6).map(listingCard);
  const listingVerticals = [...new Set(live.map((row) => row.vertical).filter(Boolean))];
  const projects = (profile.project_groups || [])
    .map((group) => ({
      id: group.id || group.title,
      title: group.title || group.category || 'Project',
      category: group.category || '',
      year: group.year || '',
      client: group.client || '',
      role: group.role || '',
      description: group.description || '',
      tools: Array.isArray(group.tools) ? group.tools : [],
      cover_url: group.cover_url || '',
      items: (group.listing_ids || [])
        .map((id) => live.find((row) => row.listing_id === id))
        .filter(Boolean)
        .map(listingCard),
    }))
    .filter((group) => group.title);

  const reviews = visible(profile.section_visibility, 'testimonials')
    ? await loadReviews(live.map((row) => row.listing_id))
    : [];
  const avg = reviews.length
    ? Math.round((reviews.reduce((sum, row) => sum + Number(row.rating || 0), 0) / reviews.length) * 10) / 10
    : null;

  let hub = null;
  try {
    const { profiles } = await fetchHubProfiles([user.pinit_id]);
    hub = profiles?.[0] || null;
  } catch {
    hub = null;
  }

  const name = String(hub?.name || user.display_name || user.name || 'Creator').trim();
  const hubAbout = String(hub?.bio || user.bio || '').trim();
  const cleanAbout = /connected via pinit hub/i.test(hubAbout) ? '' : hubAbout;
  const verticalLabel = (listingVerticals[0] || '').toLowerCase() === 'images'
    ? 'Photography'
    : (listingVerticals[0] || 'Creative');
  const creatorCategories = (profile.categories || []).length
    ? profile.categories
    : (listingVerticals.length ? [verticalLabel] : []);
  const photo = profile.photo_url || hub?.avatar_url || '';
  const cover = profile.cover_url || selected[0]?.preview_url || '';
  const since = (() => {
    const raw = user.created_at;
    if (!raw) return null;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return String(d.getFullYear());
    const year = String(raw).match(/(20\d{2})/);
    return year ? year[1] : null;
  })();
  const sales = await loadSalesCount(user.pinit_id);
  const sections = profile.section_visibility || DEFAULT_SECTIONS;

  const publicUrlPath = `/p/${profile.slug}`;

  return {
    slug: profile.slug,
    visibility: profile.visibility,
    public_path: publicUrlPath,
    identity: {
      name,
      headline: profile.headline || '',
      about: /connected via pinit hub/i.test(profile.about || '') ? cleanAbout : (profile.about || cleanAbout),
      location: profile.location || '',
      categories: creatorCategories,
      photo_url: photo,
      cover_url: cover,
      pinit_id: user.pinit_id,
      pinit_user_id: hub?.pinit_user_id || toUserPinitId(user.pinit_id),
      user_id: hub?.user_id || '',
      creator_since: since || null,
    },
    skills: visible(sections, 'skills') ? profile.skills : [],
    experience: visible(sections, 'experience') ? profile.experience : [],
    certifications: visible(sections, 'certifications') ? profile.certifications : [],
    awards: visible(sections, 'awards') ? profile.awards : [],
    clients: visible(sections, 'clients') ? profile.clients : [],
    services: visible(sections, 'services') ? profile.services : [],
    available_for: visible(sections, 'services') ? profile.available_for : [],
    selected_work: visible(sections, 'featured') ? selected : [],
    projects: visible(sections, 'projects') ? projects : [],
    marketplace: visible(sections, 'marketplace') ? marketplace : [],
    testimonials: reviews,
    review_summary: reviews.length ? { count: reviews.length, average: avg, verified: true } : null,
    contact: visible(sections, 'contact') ? {
      email: isPublicEmail(profile.contact_email),
      note: profile.contact_note || '',
      use_pinit_form: !isPublicEmail(profile.contact_email),
    } : { email: '', note: '', use_pinit_form: true },
    sections,
    trust: visible(sections, 'trust') ? {
      identity_verified: Boolean(user.biometric_verified || user.hub_linked),
      hub_linked: Boolean(user.hub_linked || hub),
      protected_portfolio: true,
      provenance_available: live.length > 0,
      creator_since: since || null,
      live_listings: live.length,
      licensed_transactions: sales,
      selected_projects: selected.length,
    } : null,
    owner_view: ownerView,
    builder: ownerView ? {
      profile,
      listings: live.map(listingCard),
    } : undefined,
  };
}
