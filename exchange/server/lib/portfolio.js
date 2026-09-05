import { fetchHubProfiles, fetchHubPublishedPortfolio } from '../hub-client.js';
import { allSql, getSql, runSql } from './db.js';
import { loadVerifiedLedger, ledgerTimeline } from './portfolio-ledger.js';
import { sellerMatchClause, extractPinitCode, toUserPinitId, toExchangePinitId } from './pinit-identity.js';
import { exchangePreviewUrl, isHubVaultId } from './preview-url.js';
import { canList } from './roles.js';
import { findUserByPinitId } from './rbac.js';

export const PORTFOLIO_THEMES = ['editorial', 'atelier', 'studio', 'spectrum'];
export const PORTFOLIO_TEMPLATES = ['individual', 'creator', 'business'];

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
  collaborations: true,
  availability: true,
};

function normalizeTheme(value) {
  const t = String(value || '').trim().toLowerCase();
  return PORTFOLIO_THEMES.includes(t) ? t : 'editorial';
}

function normalizeTemplate(value) {
  const t = String(value || '').trim().toLowerCase();
  return PORTFOLIO_TEMPLATES.includes(t) ? t : 'individual';
}

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
  if (Array.isArray(value)) {
    return { items: value.filter(Boolean), categories: [], client_count: 0, languages: [] };
  }
  return {
    items: Array.isArray(value?.items) ? value.items.filter(Boolean) : [],
    categories: Array.isArray(value?.categories) ? value.categories.filter(Boolean) : [],
    client_count: Number(value?.client_count) || 0,
    languages: Array.isArray(value?.languages) ? value.languages.filter(Boolean) : [],
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
    theme: normalizeTheme(row.theme),
    template: normalizeTemplate(row.template),
    headline: row.headline || '',
    about: row.about || '',
    location: row.location || '',
    cover_url: row.cover_url || '',
    photo_url: row.photo_url || '',
    languages: parseJson(row.languages, []),
    skills: skills.items,
    categories: skills.categories,
    client_count: skills.client_count,
    languages: skills.languages,
    experience: parseJson(row.experience, []),
    certifications: parseJson(row.certifications, []),
    awards: parseJson(row.awards, []),
    clients: parseJson(row.clients, []),
    collaborations: parseJson(row.collaborations, []),
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

export async function readProfileByPinitId(pinitId) {
  if (!pinitId) return null;
  const existing = await getSql('SELECT * FROM portfolio_profiles WHERE pinit_id = ?', [pinitId]);
  return rowToProfile(existing);
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

export async function ensurePortfolioUser(pinitId, extras = {}) {
  const existing = await findUserByPinitId(pinitId);
  if (existing) return existing;
  const code = extractPinitCode(pinitId);
  if (!code) {
    throw Object.assign(new Error('Invalid Pinit ID'), { status: 400 });
  }
  const exchangeId = toExchangePinitId(pinitId);
  const name = String(extras.name || 'Pinit member').trim() || 'Pinit member';
  const email = `portfolio.${code.toLowerCase()}@pinit.local`;
  try {
    await runSql(
      `INSERT INTO users (
        pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan, bio
      ) VALUES (?, ?, ?, ?, 'buyer', 'verified', 1, 'none', ?)`,
      [exchangeId, `EX-${code}`, name, email, extras.bio || ''],
    );
  } catch (err) {
    const again = await findUserByPinitId(pinitId) || await findUserByPinitId(exchangeId);
    if (again) return again;
    throw err;
  }
  return findUserByPinitId(exchangeId);
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
      collaborations = ?,
      languages = ?,
      services = ?,
      available_for = ?,
      featured_listing_ids = ?,
      project_groups = ?,
      section_visibility = ?,
      contact_email = ?,
      contact_note = ?,
      theme = ?,
      template = ?,
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
        client_count: patch.client_count ?? current.client_count ?? 0,
        languages: patch.languages ?? current.languages ?? [],
      }),
      stringify(patch.experience ?? current.experience),
      stringify(patch.certifications ?? current.certifications),
      stringify(patch.awards ?? current.awards),
      stringify(patch.clients ?? current.clients),
      stringify(patch.collaborations ?? current.collaborations),
      stringify(patch.languages ?? current.languages),
      stringify(patch.services ?? current.services),
      stringify(patch.available_for ?? current.available_for),
      stringify(patch.featured_listing_ids ?? current.featured_listing_ids),
      stringify(patch.project_groups ?? current.project_groups),
      stringify({ ...DEFAULT_SECTIONS, ...(patch.section_visibility || current.section_visibility) }),
      isPublicEmail(patch.contact_email ?? current.contact_email),
      patch.contact_note ?? current.contact_note,
      normalizeTheme(patch.theme ?? current.theme),
      normalizeTemplate(patch.template ?? current.template),
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

export async function listLegacyProfiles() {
  const rows = await allSql('SELECT * FROM portfolio_profiles');
  return rows.map(rowToProfile).filter(Boolean);
}

/**
 * Hub published document + Exchange shop/verified at read time.
 * Does not write either database.
 */
export async function decorateHubPortfolio(hubDoc, { ownerView = false } = {}) {
  if (!hubDoc) return null;
  const pinitId = hubDoc.identity?.pinit_id || '';
  const user = pinitId ? await findUserByPinitId(pinitId) : null;
  const listings = user ? await loadSellerListings(user.pinit_id) : [];
  const live = listings.filter(isLiveListing);
  const marketplace = live.slice(0, 6).map(listingCard);
  const projects = (hubDoc.projects || []).map((group) => {
    const vaultIds = Array.isArray(group.media_vault_ids)
      ? group.media_vault_ids.map((id) => String(id || '')).filter(Boolean)
      : (Array.isArray(group.vault_ids) ? group.vault_ids.map(String).filter(Boolean) : []);
    const galleryFromVault = vaultIds
      .map((id) => (isHubVaultId(id) ? exchangePreviewUrl(id, '') : ''))
      .filter(Boolean);
    return {
      ...group,
      cover_url: group.cover_url || galleryFromVault[0] || '',
      gallery: (Array.isArray(group.gallery) && group.gallery.length) ? group.gallery : galleryFromVault,
      vault_ids: ownerView ? vaultIds : undefined,
      media_vault_ids: undefined,
    };
  });
  const featuredWork = projects.filter((p) => p.featured).slice(0, 6).map((p) => ({
    work_id: p.id,
    title: p.title,
    tagline: [p.category, p.role].filter(Boolean).join(' · ') || '',
    vertical: p.category || '',
    preview_url: p.cover_url || '',
    year: p.year,
    role: p.role,
    hub_protected: Boolean(p.hub_protected),
  }));
  const certifications = (Array.isArray(hubDoc.certifications) ? hubDoc.certifications : []).map((c) => {
    const vaultIds = Array.isArray(c.media_vault_ids)
      ? c.media_vault_ids.map((id) => String(id || '')).filter(Boolean)
      : [];
    const preview = vaultIds
      .map((id) => (isHubVaultId(id) ? exchangePreviewUrl(id, '') : ''))
      .find(Boolean) || c.preview_url || '';
    return {
      ...c,
      preview_url: preview,
      hub_protected: vaultIds.length > 0 || Boolean(c.hub_protected),
      media_vault_ids: ownerView ? vaultIds : undefined,
    };
  });
  const ledger = user ? await loadVerifiedLedger(user.pinit_id) : {
    total: 0, shown: 0, entries: [], summary: { assets_protected: 0, since: null, latest: null, avg_human_percent: null, tiers: {} },
  };

  return {
    ...hubDoc,
    projects,
    certifications,
    selected_work: featuredWork.length ? featuredWork : (hubDoc.selected_work || []),
    marketplace: live.length ? marketplace : [],
    verified: {
      total: ledger.total,
      shown: ledger.shown,
      entries: ledger.entries,
      summary: ledger.summary,
      timeline: ledgerTimeline(ledger),
    },
    license: ledger.total > 0 ? {
      badge: 'Pinit Verified',
      role: 'Creator',
      assets_sealed: ledger.total,
      since: ledger.summary?.since || null,
      identity_verified: true,
    } : (hubDoc.license || null),
    owner_view: ownerView,
  };
}

export async function loadPublishedFromHub(slug, previewToken) {
  const hubDoc = await fetchHubPublishedPortfolio(slug, previewToken);
  if (hubDoc) return decorateHubPortfolio(hubDoc, { ownerView: Boolean(previewToken) });
  return null;
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
    .map((group, index) => {
      const vaultIds = Array.isArray(group.vault_ids)
        ? group.vault_ids.map((id) => String(id || '')).filter(Boolean)
        : [];
      const vaultId = String(group.hub_vault_id || group.vault_id || vaultIds[0] || '');
      const galleryFromVault = vaultIds
        .map((id) => (isHubVaultId(id) ? exchangePreviewUrl(id, '') : ''))
        .filter(Boolean);
      const gallery = (Array.isArray(group.gallery) ? group.gallery : []).length
        ? group.gallery
        : galleryFromVault;
      return {
      id: group.id || group.title || `work-${index}`,
      title: group.title || group.category || 'Project',
      category: group.category || '',
      year: group.year || '',
      client: group.client || '',
      role: group.role || '',
      description: group.description || '',
      outcome: group.outcome || '',
      tools: Array.isArray(group.tools) ? group.tools : [],
      collaborators: Array.isArray(group.collaborators) ? group.collaborators : [],
      cover_url: group.cover_url || galleryFromVault[0] || '',
      gallery,
      featured: Boolean(group.featured),
      visible: group.visible !== false,
      hub_protected: Boolean(group.hub_protected || vaultId),
      order: Number.isFinite(Number(group.order)) ? Number(group.order) : index,
      items: (group.listing_ids || [])
        .map((id) => live.find((row) => row.listing_id === id))
        .filter(Boolean)
        .map(listingCard),
      ...(ownerView ? {
        hub_vault_id: vaultId || undefined,
        vault_ids: vaultIds.length ? vaultIds : (vaultId ? [vaultId] : []),
      } : {}),
    };
    })
    .filter((group) => group.title && group.visible !== false)
    .sort((a, b) => a.order - b.order);

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
  const photo = hub?.avatar_url || profile.photo_url || '';
  const cover = profile.cover_url || selected[0]?.preview_url || projects.find((p) => p.cover_url)?.cover_url || '';
  const headline = String(hub?.job_title || profile.headline || '').trim();
  const about = cleanAbout || ( /connected via pinit hub/i.test(profile.about || '') ? '' : (profile.about || ''));
  const location = String(hub?.location || profile.location || '').trim();
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
  const template = normalizeTemplate(profile.template);
  const isIndividual = template === 'individual';
  const featuredProjects = projects.filter((p) => p.featured).slice(0, 6);
  const listingFill = isIndividual
    ? []
    : selected.slice(0, Math.max(0, 6 - featuredProjects.length));
  const featuredWork = [
    ...featuredProjects.map((p) => ({
      work_id: p.id,
      title: p.title,
      tagline: [p.category, p.role].filter(Boolean).join(' · ') || '',
      vertical: p.category || '',
      preview_url: p.cover_url || p.items?.[0]?.preview_url || '',
      year: p.year,
      role: p.role,
      hub_protected: Boolean(p.hub_protected),
    })),
    ...listingFill,
  ].slice(0, 6);
  const theme = normalizeTheme(profile.theme);
  const cta = template === 'business'
    ? { primary: 'Contact Agency', secondary: 'View Opportunity' }
    : template === 'creator'
      ? { primary: 'Collaborate', secondary: 'View Exchange' }
      : { primary: 'Connect', secondary: null };

  const publicUrlPath = `/p/${profile.slug}`;

  // The verified ledger. Read from hub_assets, never from anything the
  // person can edit — the whole point is that this cannot be typed in.
  const ledger = await loadVerifiedLedger(user.pinit_id);

  return {
    slug: profile.slug,
    visibility: profile.visibility,
    theme,
    template,
    public_path: publicUrlPath,
    identity: {
      name,
      headline,
      about,
      location,
      categories: creatorCategories,
      photo_url: photo,
      cover_url: cover,
      pinit_id: user.pinit_id,
      pinit_user_id: hub?.pinit_user_id || toUserPinitId(user.pinit_id),
      creator_since: since || null,
    },
    skills: visible(sections, 'skills') ? profile.skills : [],
    experience: visible(sections, 'experience') ? profile.experience : [],
    certifications: visible(sections, 'certifications') ? profile.certifications : [],
    awards: visible(sections, 'awards') ? profile.awards : [],
    clients: visible(sections, 'clients') ? profile.clients : [],
    collaborations: visible(sections, 'collaborations') ? (profile.collaborations || []) : [],
    languages: profile.languages || [],
    client_count: Number(profile.client_count) || 0,
    languages: Array.isArray(profile.languages) ? profile.languages : [],
    services: visible(sections, 'services') ? profile.services : [],
    available_for: visible(sections, 'availability') || visible(sections, 'services')
      ? profile.available_for
      : [],
    selected_work: visible(sections, 'featured') ? featuredWork : [],
    projects: visible(sections, 'projects') ? projects : [],
    marketplace: visible(sections, 'marketplace') && live.length ? marketplace : [],
    testimonials: reviews.length ? reviews : [],
    review_summary: reviews.length ? { count: reviews.length, average: avg, verified: true } : null,
    contact: visible(sections, 'contact') ? {
      email: isPublicEmail(profile.contact_email),
      note: profile.contact_note || '',
      use_pinit_form: !isPublicEmail(profile.contact_email),
    } : { email: '', note: '', use_pinit_form: true },
    cta,
    sections,
    trust: !isIndividual && visible(sections, 'trust') && live.length > 0 ? {
      identity_verified: Boolean(user.biometric_verified || user.hub_linked || hub),
      hub_linked: Boolean(user.hub_linked || hub),
      protected_portfolio: true,
      provenance_available: live.length > 0,
      creator_since: since || null,
      live_listings: live.length,
      licensed_transactions: sales,
      selected_projects: featuredWork.length || selected.length,
    } : null,
    verified: {
      total: ledger.total,
      shown: ledger.shown,
      entries: ledger.entries,
      summary: ledger.summary,
      timeline: ledgerTimeline(ledger),
    },
    license: ledger.total > 0 ? {
      badge: 'Pinit Verified',
      role: /photo/i.test(`${headline} ${(creatorCategories || []).join(' ')}`)
        ? 'Photographer'
        : /design|ui|ux/i.test(`${headline} ${(creatorCategories || []).join(' ')}`)
          ? 'Designer'
          : 'Creator',
      assets_sealed: ledger.total,
      since: ledger.summary?.since || since,
      identity_verified: Boolean(user.biometric_verified || user.hub_linked || hub),
    } : null,
    owner_view: ownerView,
    builder: ownerView ? {
      profile,
      listings: live.map(listingCard),
      identity_source: {
        name,
        headline,
        about,
        location,
        photo_url: photo,
      },
    } : undefined,
  };
}
