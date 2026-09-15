/**
 * Pure portfolio helpers — draft vs published, slugs, editor mapping.
 * No DNA copies. Media stores vault/asset ids only.
 */

export const PORTFOLIO_THEMES = ['editorial', 'atelier', 'studio', 'spectrum'] as const;
export const PORTFOLIO_TEMPLATES = ['individual', 'creator', 'business'] as const;

export function slugifyName(name: string): string {
  const slug = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 48);
  return slug || 'creator';
}

export function isPubliclyReadable(publishState: string, visibility: string): boolean {
  if (publishState !== 'PUBLISHED') return false;
  return visibility === 'public' || visibility === 'unlisted';
}

export function normalizeVisibility(value: unknown): 'public' | 'unlisted' | 'private' {
  const v = String(value || '').toLowerCase();
  if (v === 'public' || v === 'unlisted' || v === 'private') return v;
  return 'unlisted';
}

export function normalizeTheme(value: unknown): string {
  const t = String(value || '').trim().toLowerCase();
  return (PORTFOLIO_THEMES as readonly string[]).includes(t) ? t : 'editorial';
}

export function normalizeTemplate(value: unknown): string {
  const t = String(value || '').trim().toLowerCase();
  return (PORTFOLIO_TEMPLATES as readonly string[]).includes(t) ? t : 'individual';
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asStringArray(v: unknown): string[] {
  return asArray(v).map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      return String(o.name || o.title || o.label || o.with || '').trim();
    }
    return '';
  }).filter(Boolean);
}

export type EditorBody = Record<string, unknown>;

export type IdentityOverlay = {
  name: string;
  photo_url: string;
  pinit_id: string;
  pinit_user_id: string;
  bio?: string;
};

export function uniqueChildSlug(base: string, used: Set<string>): string {
  let slug = slugifyName(base);
  let n = 0;
  while (used.has(slug)) {
    n += 1;
    slug = `${slugifyName(base)}${n}`;
  }
  used.add(slug);
  return slug;
}

/** Parse the current Hub editor payload into relational writes. */
export function parseEditorBody(body: EditorBody) {
  const groups = asArray(body.project_groups);
  const used = new Set<string>();
  const projects = groups.map((raw, index) => {
    const g = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const vaultIds = asArray(g.vault_ids).map((id) => String(id || '')).filter(Boolean);
    const fallback = String(g.hub_vault_id || g.vault_id || '').trim();
    const ids = vaultIds.length ? vaultIds : (fallback ? [fallback] : []);
    const title = String(g.title || g.category || `Project ${index + 1}`);
    return {
      id: String(g.id || ''),
      title,
      slug: uniqueChildSlug(String(g.slug || title), used),
      year: String(g.year || ''),
      category: String(g.category || ''),
      description: String(g.description || ''),
      client: String(g.client || ''),
      role: String(g.role || ''),
      featured: Boolean(g.featured),
      sortOrder: Number.isFinite(Number(g.order)) ? Number(g.order) : index,
      vaultIds: ids,
    };
  });

  const experience = asArray(body.experience).map((raw, index) => {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const period = String(e.year || e.period || '');
    const [start, end] = period.split(/\s*[—–-]\s*/).map((s) => s.trim());
    return {
      role: String(e.role || e.title || ''),
      company: String(e.company || e.org || ''),
      startDate: start || period,
      endDate: end || '',
      description: String(e.summary || e.note || e.description || ''),
      location: String(e.location || ''),
      sortOrder: index,
    };
  });

  const awards = asArray(body.awards).map((raw, index) => {
    const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      title: String(a.title || a.name || ''),
      organization: String(a.issuer || a.org || a.body || ''),
      year: String(a.year || a.period || ''),
      description: String(a.note || a.description || ''),
      sortOrder: index,
    };
  }).filter((a) => a.title);

  const certificateSource = asArray(body.certifications).length
    ? asArray(body.certifications)
    : asArray(body.documents);
  const certificates = certificateSource.map((raw, index) => {
    const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const vaultId = String(c.vault_id || c.document_vault_id || c.documentKey || '').trim();
    return {
      title: String(c.title || c.name || c.originalFileName || '').trim() || (vaultId ? 'Document' : ''),
      issuer: String(c.issuer || c.org || ''),
      issuedOn: String(c.year || c.date || c.period || ''),
      credentialId: String(c.credential_id || '').trim(),
      description: String(c.note || c.description || ''),
      documentKey: vaultId || null,
      relatedSkill: ['license', 'course', 'workshop', 'award'].includes(String(c.kind || c.relatedSkill || '').toLowerCase())
        ? String(c.kind || c.relatedSkill).toLowerCase()
        : 'certificate',
      sortOrder: index,
    };
  }).filter((c) => c.title || c.documentKey);

  const collaborations = [
    ...asArray(body.collaborations).map((raw, index) => {
      const c = typeof raw === 'string' ? { with: raw } : (raw as Record<string, unknown>);
      return {
        name: String(c.with || c.partner || c.name || c.title || ''),
        kind: 'collaboration',
        sortOrder: index,
      };
    }),
    ...asArray(body.clients).map((raw, index) => {
      const c = typeof raw === 'string' ? { name: raw } : (raw as Record<string, unknown>);
      return {
        name: String(c.name || c.title || ''),
        kind: 'client',
        sortOrder: 1000 + index,
      };
    }),
  ].filter((c) => c.name);

  const socialLinks = asArray(body.social_links).map((raw, index) => {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      label: String(s.label || s.network || ''),
      url: String(s.url || ''),
      sortOrder: index,
    };
  }).filter((s) => s.url);

  return {
    slug: (() => {
      if (body.slug == null || !String(body.slug).trim()) return undefined;
      const cleaned = slugifyName(String(body.slug));
      if (!cleaned || cleaned === 'creator') return undefined;
      return cleaned;
    })(),
    visibility: body.visibility != null ? normalizeVisibility(body.visibility) : undefined,
    theme: body.theme != null ? normalizeTheme(body.theme) : undefined,
    template: body.template != null ? normalizeTemplate(body.template) : undefined,
    featuredListingIds: body.featured_listing_ids !== undefined
      ? asArray(body.featured_listing_ids).map(String).filter(Boolean)
      : undefined,
    profile: {
      headline: String(body.headline ?? ''),
      about: String(body.about ?? ''),
      location: String(body.location ?? ''),
      coverUrl: String(body.cover_url ?? ''),
      heroImageRef: String(body.hero_image ?? body.heroImageRef ?? ''),
      quote: String(body.quote ?? ''),
      website: String(body.website ?? ''),
      contactEmail: String(body.contact_email ?? ''),
      contactNote: String(body.contact_note ?? ''),
      availableFor: asStringArray(body.available_for),
      languages: asStringArray(body.languages),
      clientCount: Number(body.client_count) || 0,
      specializations: asStringArray(body.specializations || body.categories),
    },
    projects,
    services: asStringArray(body.services).map((name, sortOrder) => ({ name, sortOrder })),
    skills: asStringArray(body.skills).map((name, sortOrder) => ({ name, sortOrder })),
    experience,
    awards,
    certificates,
    collaborations,
    socialLinks,
  };
}

export function editorFormFromGraph(graph: {
  slug: string;
  visibility: string;
  theme: string;
  template: string;
  profile: {
    headline: string;
    about: string;
    location: string;
    contactEmail: string;
    contactNote: string;
    availableFor: unknown;
    languages: unknown;
    clientCount: number;
  } | null;
  projects: Array<{
    id: string;
    title: string;
    year: string;
    category: string;
    description: string;
    media: Array<{ vaultId: string | null }>;
  }>;
  services: Array<{ name: string }>;
  skills: Array<{ name: string }>;
  experience: Array<{ role: string; company: string; startDate: string; endDate: string; description: string }>;
  awards: Array<{ id: string; title: string; organization: string; year: string; description: string }>;
  certificates?: Array<{
    id: string;
    title: string;
    issuer: string;
    issuedOn: string;
    credentialId: string;
    description: string;
    documentKey?: string | null;
    relatedSkill?: string;
  }>;
  collaborations: Array<{ name: string; kind: string }>;
}): Record<string, unknown> {
  const p = graph.profile;
  const collabs = graph.collaborations.filter((c) => c.kind !== 'client');
  const clients = graph.collaborations.filter((c) => c.kind === 'client');
  return {
    slug: graph.slug,
    visibility: graph.visibility,
    theme: graph.theme,
    template: graph.template,
    headline: p?.headline || '',
    about: p?.about || '',
    location: p?.location || '',
    skills: graph.skills.map((s) => s.name),
    services: graph.services.map((s) => s.name),
    clients: clients.map((c) => c.name),
    collaborations: collabs.map((c) => c.name),
    languages: Array.isArray(p?.languages) ? p?.languages : [],
    client_count: p?.clientCount ? String(p.clientCount) : '',
    available_for: Array.isArray(p?.availableFor) ? p?.availableFor : [],
    experience: graph.experience.map((e, i) => ({
      id: `exp-${i}`,
      title: e.role,
      org: e.company,
      period: [e.startDate, e.endDate].filter(Boolean).join(' — '),
      note: e.description,
    })),
    awards: graph.awards.map((a) => ({
      id: a.id,
      title: a.title,
      org: a.organization,
      period: a.year,
      note: a.description,
    })),
    certifications: (graph.certificates || []).map((c) => ({
      id: c.id,
      title: c.title,
      org: c.issuer,
      period: c.issuedOn,
      note: c.description,
      vault_id: c.documentKey || '',
      kind: c.relatedSkill || 'certificate',
    })),
    project_groups: graph.projects.map((proj) => ({
      id: proj.id,
      title: proj.title,
      category: proj.category,
      year: proj.year,
      description: proj.description,
      vault_ids: proj.media.map((m) => m.vaultId).filter(Boolean),
    })),
    contact_email: p?.contactEmail || '',
    contact_note: p?.contactNote || '',
  };
}

export function assemblePresentation(
  graph: {
    slug: string;
    visibility: string;
    theme: string;
    template: string;
    publishState: string;
    publishedAt: Date | string | null;
    publishedVersion: number;
    profile: {
      headline: string;
      about: string;
      location: string;
      coverUrl: string;
      contactEmail: string;
      contactNote: string;
      availableFor: unknown;
      languages: unknown;
      clientCount: number;
      specializations: unknown;
    } | null;
    projects: Array<{
      id: string;
      slug: string;
      title: string;
      year: string;
      category: string;
      description: string;
      client: string;
      role: string;
      featured: boolean;
      sortOrder: number;
      media: Array<{ vaultId: string | null; assetId: string | null; type: string; sortOrder: number }>;
    }>;
    collections: Array<{
      id: string;
      slug: string;
      title: string;
      description: string;
      sortOrder: number;
      items: Array<{ projectId: string | null; vaultId: string | null; sortOrder: number }>;
    }>;
    services: Array<{ name: string; description?: string }>;
    skills: Array<{ name: string }>;
    experience: Array<{ role: string; company: string; startDate: string; endDate: string; description: string; location: string }>;
    awards: Array<{ title: string; organization: string; year: string; description: string }>;
    certificates: Array<{
      id?: string;
      title: string;
      issuer: string;
      issuedOn: string;
      expiresOn?: string;
      credentialId: string;
      description: string;
      documentKey?: string | null;
      imageKey?: string | null;
      verificationUrl?: string;
      relatedSkill?: string;
    }>;
    collaborations: Array<{ name: string; kind: string; logoUrl?: string; website?: string }>;
    socialLinks: Array<{ label: string; url: string }>;
  },
  identity: IdentityOverlay,
  { ownerView }: { ownerView: boolean },
) {
  const profile = graph.profile;
  const languages = Array.isArray(profile?.languages) ? profile?.languages : [];
  const available = Array.isArray(profile?.availableFor) ? profile?.availableFor : [];
  const categories = Array.isArray(profile?.specializations) ? profile?.specializations : [];
  const projects = [...graph.projects]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((proj) => {
      const vaultIds = proj.media
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) => m.vaultId)
        .filter((id): id is string => Boolean(id));
      return {
        id: proj.id,
        slug: proj.slug,
        title: proj.title,
        category: proj.category,
        year: proj.year,
        client: proj.client,
        role: proj.role,
        description: proj.description,
        featured: proj.featured,
        visible: true,
        hub_protected: vaultIds.length > 0,
        order: proj.sortOrder,
        vault_ids: ownerView ? vaultIds : undefined,
        media_vault_ids: vaultIds,
        gallery: [] as string[],
        cover_url: '',
      };
    });

  const collabs = graph.collaborations.filter((c) => c.kind !== 'client').map((c) => ({
    with: c.name,
    url: c.website || '',
    logo: c.logoUrl || '',
  }));
  const clients = graph.collaborations.filter((c) => c.kind === 'client').map((c) => ({
    name: c.name,
    url: c.website || '',
    logo: c.logoUrl || '',
  }));

  return {
    slug: graph.slug,
    visibility: graph.visibility,
    theme: graph.theme,
    template: graph.template,
    public_path: `/p/${graph.slug}`,
    publish_state: graph.publishState,
    published_at: graph.publishedAt,
    published_version: graph.publishedVersion,
    identity: {
      name: identity.name,
      headline: profile?.headline || '',
      about: profile?.about || identity.bio || '',
      location: profile?.location || '',
      categories,
      photo_url: identity.photo_url,
      cover_url: profile?.coverUrl || '',
      pinit_id: identity.pinit_id,
      pinit_user_id: identity.pinit_user_id,
    },
    skills: graph.skills.map((s) => s.name),
    services: graph.services.map((s) => ({
      title: s.name,
      description: s.description || '',
    })),
    experience: graph.experience.map((e) => ({
      role: e.role,
      company: e.company,
      year: [e.startDate, e.endDate].filter(Boolean).join(' — '),
      summary: e.description,
      location: e.location,
    })),
    awards: graph.awards.map((a) => ({
      title: a.title,
      issuer: a.organization,
      year: a.year,
      note: a.description,
    })),
    certifications: graph.certificates.map((c) => ({
      id: c.id,
      title: c.title,
      issuer: c.issuer,
      year: c.issuedOn,
      expires_on: c.expiresOn || '',
      credential_id: c.credentialId,
      note: c.description,
      kind: c.relatedSkill || 'certificate',
      verification_url: c.verificationUrl || '',
      hub_protected: Boolean(c.documentKey || c.imageKey),
      media_vault_ids: [c.imageKey, c.documentKey].filter(Boolean),
    })),
    clients,
    collaborations: collabs,
    languages,
    client_count: profile?.clientCount || 0,
    available_for: available,
    projects,
    collections: graph.collections.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      sort_order: c.sortOrder,
      items: c.items,
    })),
    selected_work: projects.filter((p) => p.featured).slice(0, 6),
    contact: {
      email: profile?.contactEmail || '',
      note: profile?.contactNote || '',
      use_pinit_form: !profile?.contactEmail,
    },
    social_links: graph.socialLinks,
    owner_view: ownerView,
  };
}

export function stripPublicSecrets(doc: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...doc };
  delete copy.owner_view;
  delete copy.builder;
  const projects = asArray(copy.projects).map((raw) => {
    const p = { ...(raw as Record<string, unknown>) };
    delete p.vault_ids;
    return p;
  });
  copy.projects = projects;
  const certs = asArray(copy.certifications).map((raw) => {
    const c = { ...(raw as Record<string, unknown>) };
    delete c.vault_id;
    delete c.media_vault_ids;
    delete c.documentKey;
    return c;
  });
  copy.certifications = certs;
  return copy;
}
