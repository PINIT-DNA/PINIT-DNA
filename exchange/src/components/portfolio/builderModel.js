import { listingPreviewUrl } from '../../lib/listing-preview.js';

export const SECTIONS = [
  { id: 'identity', label: 'Identity', fields: ['headline', 'location', 'categories'] },
  { id: 'about', label: 'About', fields: ['about'] },
  { id: 'featured', label: 'Featured Work', fields: ['featured_listing_ids'] },
  { id: 'projects', label: 'Projects', fields: ['project_groups'] },
  { id: 'experience', label: 'Experience', fields: ['experience'] },
  { id: 'skills', label: 'Skills', fields: ['skills'] },
  { id: 'certifications', label: 'Certifications', fields: ['certifications'] },
  { id: 'awards', label: 'Awards', fields: ['awards'] },
  { id: 'clients', label: 'Clients', fields: ['clients'] },
  { id: 'testimonials', label: 'Testimonials', fields: ['testimonials'] },
  { id: 'services', label: 'Services', fields: ['services'] },
  { id: 'marketplace', label: 'Marketplace', fields: ['marketplace'] },
  { id: 'trust', label: 'Trust', fields: ['trust'] },
  { id: 'contact', label: 'Contact', fields: ['contact'] },
  { id: 'visibility', label: 'Visibility', fields: ['visibility'] },
];

export function slugifyName(name) {
  const slug = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 48);
  return slug || 'creator';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function emptyForm() {
  return {
    slug: '',
    visibility: 'unlisted',
    headline: '',
    about: '',
    location: '',
    cover_url: '',
    photo_url: '',
    categories: [],
    skills: [],
    experience: [],
    certifications: [],
    awards: [],
    clients: [],
    services: [],
    available_for: [],
    featured_listing_ids: [],
    project_groups: [],
    contact_email: '',
    contact_note: '',
    section_visibility: {},
  };
}

export function formFromPayload(data) {
  const root = data?.portfolio && typeof data.portfolio === 'object' ? data.portfolio : data;
  const p = root?.builder?.profile || {};
  const vis = p.visibility || root?.visibility || 'unlisted';
  return {
    slug: p.slug || root?.slug || '',
    visibility: ['public', 'unlisted', 'private'].includes(vis) ? vis : 'unlisted',
    headline: p.headline || root?.identity?.headline || '',
    about: /connected via pinit hub/i.test(p.about || '') ? '' : (p.about || root?.identity?.about || ''),
    location: p.location || root?.identity?.location || '',
    cover_url: p.cover_url || '',
    photo_url: p.photo_url || root?.identity?.photo_url || '',
    categories: Array.isArray(p.categories) ? p.categories : asArray(root?.identity?.categories),
    skills: asArray(p.skills),
    experience: asArray(p.experience),
    certifications: asArray(p.certifications),
    awards: asArray(p.awards),
    clients: asArray(p.clients),
    services: asArray(p.services).map((s) => (typeof s === 'string' ? { title: s } : s)),
    available_for: asArray(p.available_for),
    featured_listing_ids: asArray(p.featured_listing_ids),
    project_groups: asArray(p.project_groups),
    contact_email: p.contact_email || '',
    contact_note: p.contact_note || '',
    section_visibility: p.section_visibility && typeof p.section_visibility === 'object' ? p.section_visibility : {},
  };
}

function listingById(listings, id) {
  return listings.find((row) => row.listing_id === id);
}

export function previewFromForm(form, { name, listings, trust, testimonials }) {
  const live = listings || [];
  const selected = (form.featured_listing_ids || [])
    .map((id) => listingById(live, id))
    .filter(Boolean);
  const cover = form.cover_url || listingPreviewUrl(selected[0]) || '';
  const sections = { featured: true, about: true, projects: true, skills: true, experience: true, certifications: true, awards: true, clients: true, testimonials: true, services: true, marketplace: true, contact: true, trust: true, ...(form.section_visibility || {}) };
  return {
    slug: form.slug,
    visibility: form.visibility,
    sections,
    identity: {
      name,
      headline: form.headline,
      about: form.about,
      location: form.location,
      categories: form.categories,
      photo_url: form.photo_url,
      cover_url: cover,
    },
    selected_work: sections.featured === false ? [] : selected,
    projects: (form.project_groups || []).map((g) => ({
      ...g,
      items: (g.listing_ids || []).map((id) => listingById(live, id)).filter(Boolean),
    })),
    skills: form.skills,
    experience: form.experience,
    certifications: form.certifications,
    awards: form.awards,
    clients: form.clients,
    services: form.services,
    available_for: form.available_for,
    marketplace: live.slice(0, 4),
    testimonials: testimonials || [],
    review_summary: (testimonials || []).length
      ? {
        count: testimonials.length,
        average: Math.round((testimonials.reduce((s, t) => s + Number(t.rating || 0), 0) / testimonials.length) * 10) / 10,
      }
      : null,
    contact: { email: form.contact_email, note: form.contact_note },
    trust,
  };
}

export function sectionComplete(id, form) {
  const f = form || emptyForm();
  if (id === 'identity') return Boolean(f.headline || f.location || (f.categories || []).length);
  if (id === 'about') return Boolean(String(f.about || '').trim());
  if (id === 'featured') return (f.featured_listing_ids || []).length > 0;
  if (id === 'projects') return (f.project_groups || []).length > 0;
  if (id === 'experience') return (f.experience || []).length > 0;
  if (id === 'skills') return (f.skills || []).length > 0;
  if (id === 'certifications') return (f.certifications || []).length > 0;
  if (id === 'awards') return (f.awards || []).length > 0;
  if (id === 'clients') return (f.clients || []).length > 0;
  if (id === 'services') return (f.services || []).length > 0 || (f.available_for || []).length > 0;
  if (id === 'contact') return Boolean(f.contact_email || f.contact_note);
  if (id === 'visibility') return Boolean(f.visibility);
  return true;
}

export function moveItem(list, from, to) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
