/**
 * Profile strength and social-link rules.
 *
 * This file has no imports on purpose. client/src/lib/profile-strength.ts is a
 * byte-for-byte copy so the Profile page can score live while the user types,
 * and tests/profile/profile-strength.test.ts fails if the two drift apart.
 * The server result is the one that is stored and shown everywhere else
 * (the avatar dropdown reads `profileCompletion` from GET /profile).
 */

// ── Social links ────────────────────────────────────────────────────────────

export const LINK_KEYS = ['linkedin', 'github', 'instagram', 'website'] as const;
export type LinkKey = (typeof LINK_KEYS)[number];

export interface ExtraLink {
  label: string;
  /** Full https address. */
  url: string;
}

export interface SocialLinks {
  linkedin: string;
  github: string;
  instagram: string;
  website: string;
  /** Links the user said they do not have. Counts that item as done. */
  skipped: LinkKey[];
  /** Optional extra links. Not scored. */
  extra: ExtraLink[];
  /** Show these links on the public portfolio. */
  showOnPortfolio: boolean;
}

export const MAX_EXTRA_LINKS = 8;
const MAX_LINK_LENGTH = 200;
const MAX_LABEL_LENGTH = 40;

export function emptySocialLinks(): SocialLinks {
  return { linkedin: '', github: '', instagram: '', website: '', skipped: [], extra: [], showOnPortfolio: true };
}

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?$/i;

export const LINK_RULES: Record<LinkKey, { name: string; placeholder: string; error: string }> = {
  linkedin: {
    name: 'LinkedIn',
    placeholder: 'your-name or linkedin.com/in/your-name',
    error: 'Use your LinkedIn profile name or your linkedin.com/in/… link.',
  },
  github: {
    name: 'GitHub',
    placeholder: 'username or github.com/username',
    error: 'Use your GitHub username (letters, numbers and dashes) or your github.com link.',
  },
  instagram: {
    name: 'Instagram',
    placeholder: '@username or instagram.com/username',
    error: 'Use your Instagram username (letters, numbers, dots and underscores) or your instagram.com link.',
  },
  website: {
    name: 'Website or portfolio',
    placeholder: 'https://yoursite.com',
    error: 'Enter a link, like https://yoursite.com',
  },
};

/** Stores a full https link. A bare name with no path is expanded so older saved values still open. */
export function cleanLinkInput(key: LinkKey, raw: string): string {
  let body = String(raw ?? '').trim().replace(/^@/, '');
  if (!body) return '';
  body = body
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (key !== 'website' && body && !body.includes('/')) {
    if (key === 'linkedin') body = `linkedin.com/in/${body}`;
    else if (key === 'github') body = `github.com/${body}`;
    else if (key === 'instagram') body = `instagram.com/${body}`;
  }
  return body ? `https://${body}` : '';
}

/** Same cleaning for an extra link's address. */
export function cleanExtraUrl(raw: string): string {
  const body = String(raw ?? '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  return body ? `https://${body}` : '';
}

function addressBody(value: string): string {
  return value.replace(/^https?:\/\//i, '');
}

/**
 * Social links must point at their own site with a valid username, so an
 * Instagram box cannot hold some other website. A bare username is expanded
 * by cleanLinkInput before it gets here.
 */
const PLATFORMS: Record<Exclude<LinkKey, 'website'>, { host: RegExp; path: RegExp }> = {
  linkedin: { host: /^(?:[a-z]{2,3}\.)?linkedin\.com$/i, path: /^(?:in|pub|company)\/[A-Za-z0-9._%-]{2,100}$/ },
  github: { host: /^github\.com$/i, path: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9._-]{1,100})?$/ },
  instagram: { host: /^instagram\.com$/i, path: /^[A-Za-z0-9._]{1,30}$/ },
};

export function isValidLink(key: LinkKey, value: string): boolean {
  const body = addressBody(value).replace(/^www\./i, '');
  if (!body.length || value.length > MAX_LINK_LENGTH || !DOMAIN_PATTERN.test(body)) return false;
  if (key === 'website') return true;
  const slash = body.indexOf('/');
  if (slash < 0) return false;
  const rule = PLATFORMS[key];
  return rule.host.test(body.slice(0, slash)) && rule.path.test(body.slice(slash + 1));
}

export function isValidExtraUrl(url: string): boolean {
  const body = addressBody(url);
  return body.length > 0 && url.length <= MAX_LINK_LENGTH && DOMAIN_PATTERN.test(body);
}

function labelFromUrl(url: string): string {
  const host = addressBody(url).split('/')[0].replace(/^www\./i, '');
  const name = host.split('.')[0] || 'Link';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The only way a stored link becomes an href. Always https. */
export function linkHref(key: LinkKey, value: string): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v.replace(/^http:\/\//i, 'https://');
  if (v.includes('.')) return `https://${v}`;
  if (key === 'linkedin') return `https://www.linkedin.com/in/${encodeURIComponent(v)}`;
  if (key === 'github') return `https://github.com/${encodeURIComponent(v)}`;
  if (key === 'instagram') return `https://www.instagram.com/${encodeURIComponent(v)}`;
  return `https://${v}`;
}

export type LinksResult = { ok: true; value: SocialLinks } | { ok: false; error: string };

/**
 * Validates links sent by a client. Values are stored as https addresses.
 * A link that is filled in cannot also be marked "I don't have one".
 */
export function normalizeSocialLinks(input: unknown): LinksResult {
  if (input === null || input === undefined) return { ok: true, value: emptySocialLinks() };
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Links must be an object.' };
  const src = input as Record<string, unknown>;
  const out = emptySocialLinks();

  for (const key of LINK_KEYS) {
    const raw = src[key];
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw !== 'string') return { ok: false, error: `${LINK_RULES[key].name}: enter text.` };
    const handle = cleanLinkInput(key, raw);
    if (!handle) continue;
    if (!isValidLink(key, handle)) return { ok: false, error: `${LINK_RULES[key].name}: ${LINK_RULES[key].error}` };
    out[key] = handle;
  }

  if (src.skipped !== undefined) {
    if (!Array.isArray(src.skipped)) return { ok: false, error: 'Skipped links must be a list.' };
    const keys = new Set<LinkKey>();
    for (const k of src.skipped) {
      if (typeof k === 'string' && (LINK_KEYS as readonly string[]).includes(k) && !out[k as LinkKey]) keys.add(k as LinkKey);
    }
    out.skipped = LINK_KEYS.filter((k) => keys.has(k));
  }

  if (src.extra !== undefined) {
    if (!Array.isArray(src.extra)) return { ok: false, error: 'Other links must be a list.' };
    for (const row of src.extra) {
      if (!row || typeof row !== 'object') return { ok: false, error: 'Each other link needs an address.' };
      const r = row as Record<string, unknown>;
      const label = typeof r.label === 'string' ? r.label.trim() : '';
      const url = typeof r.url === 'string' ? cleanExtraUrl(r.url) : '';
      if (!label && !url) continue;
      if (label.length > MAX_LABEL_LENGTH) return { ok: false, error: `Link names can be up to ${MAX_LABEL_LENGTH} characters.` };
      if (!isValidExtraUrl(url)) return { ok: false, error: 'Enter a link like https://behance.net/yourname' };
      const name = label || labelFromUrl(url);
      out.extra.push({ label: name, url });
    }
    if (out.extra.length > MAX_EXTRA_LINKS) return { ok: false, error: `You can add up to ${MAX_EXTRA_LINKS} other links.` };
  }

  if (src.showOnPortfolio !== undefined) {
    if (typeof src.showOnPortfolio !== 'boolean') return { ok: false, error: 'showOnPortfolio must be true or false.' };
    out.showOnPortfolio = src.showOnPortfolio;
  }

  return { ok: true, value: out };
}

/** Reads a stored value without trusting it. Invalid parts are dropped, never thrown. */
export function readStoredSocialLinks(stored: unknown): SocialLinks {
  const out = emptySocialLinks();
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
  const src = stored as Record<string, unknown>;
  for (const key of LINK_KEYS) {
    const v = src[key];
    if (typeof v === 'string') {
      const cleaned = cleanLinkInput(key, v);
      if (cleaned && isValidLink(key, cleaned)) out[key] = cleaned;
    }
  }
  if (Array.isArray(src.skipped)) {
    out.skipped = LINK_KEYS.filter((k) => (src.skipped as unknown[]).includes(k) && !out[k]);
  }
  if (Array.isArray(src.extra)) {
    for (const row of src.extra.slice(0, MAX_EXTRA_LINKS)) {
      const r = (row ?? {}) as Record<string, unknown>;
      const url = typeof r.url === 'string' ? cleanExtraUrl(r.url) : '';
      const label = typeof r.label === 'string' ? r.label.trim() : '';
      if (url && isValidExtraUrl(url)) {
        const name = label || labelFromUrl(url);
        if (name.length <= MAX_LABEL_LENGTH) out.extra.push({ label: name, url });
      }
    }
  }
  if (typeof src.showOnPortfolio === 'boolean') out.showOnPortfolio = src.showOnPortfolio;
  return out;
}

// ── Profile strength ────────────────────────────────────────────────────────

export type StrengthGroupId = 'about' | 'work' | 'links' | 'verification';
export type StrengthItemId =
  | 'photo' | 'name' | 'email' | 'phone' | 'country' | 'bio'
  | 'organization' | 'jobTitle' | 'portfolio'
  | LinkKey
  | 'identity';

export interface StrengthItemDef {
  id: StrengthItemId;
  group: StrengthGroupId;
  label: string;
  weight: number;
  /** 1 easy, 2 takes a minute, 3 a short flow. Used to pick the next step. */
  effort: number;
  required?: boolean;
  skippable?: boolean;
  hint: string;
}

export const STRENGTH_GROUPS: ReadonlyArray<{ id: StrengthGroupId; label: string }> = [
  { id: 'about', label: 'About you' },
  { id: 'work', label: 'Work' },
  { id: 'links', label: 'Links' },
  { id: 'verification', label: 'Verification' },
];

/** Weights sum to 100. Only things a user can complete today are scored. */
export const STRENGTH_ITEMS: ReadonlyArray<StrengthItemDef> = [
  { id: 'photo', group: 'about', label: 'Profile photo', weight: 10, effort: 1, hint: 'Faces build trust on shared links.' },
  { id: 'name', group: 'about', label: 'Full name', weight: 5, effort: 1, required: true, hint: 'Shown on certificates and shared links.' },
  { id: 'email', group: 'about', label: 'Email', weight: 10, effort: 1, required: true, hint: 'Needed for account recovery and receipts.' },
  { id: 'phone', group: 'about', label: 'Phone', weight: 5, effort: 1, required: true, hint: 'Lets us reach you about security events.' },
  { id: 'country', group: 'about', label: 'Country', weight: 5, effort: 1, required: true, hint: 'Used for compliance and regional defaults.' },
  { id: 'bio', group: 'about', label: 'Short bio', weight: 10, effort: 2, hint: 'Two or three sentences about what you do (40+ characters).' },
  { id: 'organization', group: 'work', label: 'Organization', weight: 5, effort: 1, hint: 'Where you work or trade.' },
  { id: 'jobTitle', group: 'work', label: 'Job title', weight: 5, effort: 1, hint: 'What you do, in a few words.' },
  { id: 'portfolio', group: 'work', label: 'Portfolio published', weight: 5, effort: 3, hint: 'Give clients one link to your protected work.' },
  { id: 'linkedin', group: 'links', label: 'LinkedIn', weight: 10, effort: 1, skippable: true, hint: 'The professional link people look for first.' },
  { id: 'github', group: 'links', label: 'GitHub', weight: 5, effort: 1, skippable: true, hint: 'Show the code and projects you ship.' },
  { id: 'instagram', group: 'links', label: 'Instagram', weight: 5, effort: 1, skippable: true, hint: 'Your creative work and behind the scenes.' },
  { id: 'website', group: 'links', label: 'Website or portfolio', weight: 5, effort: 1, skippable: true, hint: 'Your own corner of the internet.' },
  { id: 'identity', group: 'verification', label: 'Identity proof', weight: 15, effort: 3, hint: 'The strongest trust signal on your account.' },
];

export const DEFAULT_FULL_NAME = 'PINIT User';
export const MIN_BIO_LENGTH = 40;

export interface StrengthInput {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  bio?: string | null;
  organization?: string | null;
  jobTitle?: string | null;
  hasPhoto: boolean;
  portfolioPublished: boolean;
  identityOnFile: boolean;
  links: Pick<SocialLinks, LinkKey | 'skipped'>;
}

export type StrengthTier = 'starting' | 'progress' | 'almost' | 'complete';

export interface StrengthItem {
  id: StrengthItemId;
  group: StrengthGroupId;
  label: string;
  weight: number;
  done: boolean;
  skipped: boolean;
  required: boolean;
}

export interface ProfileStrength {
  percent: number;
  tier: StrengthTier;
  tierLabel: string;
  groups: Array<{ id: StrengthGroupId; label: string; earned: number; max: number }>;
  items: StrengthItem[];
  nextStep: { id: StrengthItemId; label: string; hint: string; weight: number } | null;
  missingRequired: StrengthItemId[];
}

const TIER_LABEL: Record<StrengthTier, string> = {
  starting: 'Just getting started',
  progress: 'Making progress',
  almost: 'Almost there',
  complete: 'Profile complete',
};

export function strengthTier(percent: number): StrengthTier {
  if (percent >= 100) return 'complete';
  if (percent >= 70) return 'almost';
  if (percent >= 40) return 'progress';
  return 'starting';
}

const text = (v: string | null | undefined) => String(v ?? '').trim();

function itemDone(id: StrengthItemId, input: StrengthInput): boolean {
  switch (id) {
    case 'photo': return input.hasPhoto;
    case 'name': return text(input.fullName) !== '' && text(input.fullName) !== DEFAULT_FULL_NAME;
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text(input.email));
    case 'phone': return text(input.phone).replace(/\D/g, '').length >= 7;
    case 'country': return text(input.country) !== '';
    case 'bio': return text(input.bio).length >= MIN_BIO_LENGTH;
    case 'organization': return text(input.organization) !== '';
    case 'jobTitle': return text(input.jobTitle) !== '';
    case 'portfolio': return input.portfolioPublished;
    case 'identity': return input.identityOnFile;
    default: {
      const key = id as LinkKey;
      if (input.links.skipped.includes(key)) return true;
      return isValidLink(key, cleanLinkInput(key, input.links[key] ?? ''));
    }
  }
}

export function computeProfileStrength(input: StrengthInput): ProfileStrength {
  const items: StrengthItem[] = STRENGTH_ITEMS.map((def) => {
    const skipped = Boolean(def.skippable) && input.links.skipped.includes(def.id as LinkKey)
      && !isValidLink(def.id as LinkKey, cleanLinkInput(def.id as LinkKey, input.links[def.id as LinkKey] ?? ''));
    return {
      id: def.id,
      group: def.group,
      label: def.label,
      weight: def.weight,
      done: itemDone(def.id, input),
      skipped,
      required: Boolean(def.required),
    };
  });

  const percent = items.reduce((sum, it) => sum + (it.done ? it.weight : 0), 0);
  const groups = STRENGTH_GROUPS.map((g) => {
    const inGroup = items.filter((it) => it.group === g.id);
    return {
      id: g.id,
      label: g.label,
      earned: inGroup.reduce((s, it) => s + (it.done ? it.weight : 0), 0),
      max: inGroup.reduce((s, it) => s + it.weight, 0),
    };
  });

  let next: StrengthItemDef | null = null;
  for (const def of STRENGTH_ITEMS) {
    if (items.find((it) => it.id === def.id)?.done) continue;
    if (!next || def.weight / def.effort > next.weight / next.effort) next = def;
  }

  const tier = strengthTier(percent);
  return {
    percent,
    tier,
    tierLabel: TIER_LABEL[tier],
    groups,
    items,
    nextStep: next ? { id: next.id, label: next.label, hint: next.hint, weight: next.weight } : null,
    missingRequired: items.filter((it) => it.required && !it.done).map((it) => it.id),
  };
}
