import { prisma } from '@/lib/prisma';
import * as D from '@/lib/defaults';

/**
 * The landing page's read model.
 *
 * Everything the public site renders is fetched here, once, and handed down as
 * props. Two safety properties matter:
 *
 *   * If a table is empty, the section falls back to `lib/defaults.ts` rather
 *     than rendering a hole.
 *   * If the database is unreachable (or `db:push` has not run yet), the whole
 *     read falls back to defaults instead of throwing a 500. The marketing site
 *     stays up even when the content database is down.
 *
 * Dual-deploy note: admin and landing are separate Vercel projects. A long
 * `unstable_cache` TTL meant landing could stay stale for up to an hour even
 * after CMS saves. Content is read fresh from Postgres on each request so
 * admin edits appear immediately when both projects share the same DATABASE_URL.
 */

export const CONTENT_TAG = 'site-content';

export type SectionChrome = {
  index: string;
  label: string;
  title: string;
  lede: string;
  visible: boolean;
};

export type SiteContent = Awaited<ReturnType<typeof loadSiteContent>>;

/** Split newline-separated text into trimmed, non-empty lines. */
function lines(value: string): string[] {
  return value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function fallbackSections(): Record<string, SectionChrome> {
  return Object.fromEntries(
    D.DEFAULT_SECTIONS.map((s) => [
      s.key,
      { index: s.index, label: s.label, title: s.title, lede: s.lede, visible: true },
    ]),
  );
}

function shape() {
  const byOrder = { orderBy: { order: 'asc' as const } };
  return byOrder;
}

async function loadSiteContent() {
  const byOrder = shape();

  const [
    sectionRows,
    hero,
    heroReadouts,
    trustedLogos,
    problems,
    problemContent,
    lifecycleStages,
    features,
    ecosystem,
    whyCards,
    chooseUs,
    industries,
    about,
    aboutPillars,
    stats,
    team,
    testimonials,
    faqs,
    cta,
    settings,
    navLinks,
    footerLinks,
    socialLinks,
  ] = await Promise.all([
    prisma.sectionMeta.findMany(byOrder),
    prisma.heroContent.findUnique({ where: { id: 1 } }),
    prisma.heroReadout.findMany(byOrder),
    prisma.trustedLogo.findMany(byOrder),
    prisma.problemItem.findMany(byOrder),
    prisma.problemContent.findUnique({ where: { id: 1 } }),
    prisma.lifecycleStage.findMany(byOrder),
    prisma.feature.findMany(byOrder),
    prisma.ecosystemProduct.findMany(byOrder),
    prisma.whyCard.findMany(byOrder),
    prisma.chooseUsReason.findMany(byOrder),
    prisma.industry.findMany(byOrder),
    prisma.aboutContent.findUnique({ where: { id: 1 } }),
    prisma.aboutPillar.findMany(byOrder),
    prisma.stat.findMany(byOrder),
    prisma.teamMember.findMany(byOrder),
    prisma.testimonial.findMany({ where: { published: true }, ...byOrder }),
    prisma.faqItem.findMany({ where: { published: true }, ...byOrder }),
    prisma.ctaContent.findUnique({ where: { id: 1 } }),
    prisma.siteSettings.findUnique({ where: { id: 1 } }),
    prisma.navLink.findMany(byOrder),
    prisma.footerLink.findMany(byOrder),
    prisma.socialLink.findMany(byOrder),
  ]);

  const sections: Record<string, SectionChrome> = sectionRows.length
    ? Object.fromEntries(
        sectionRows.map((s) => [
          s.key,
          { index: s.index, label: s.label, title: s.title, lede: s.lede, visible: s.visible },
        ]),
      )
    : fallbackSections();

  // Any section key missing from the database still needs chrome to render.
  for (const [key, value] of Object.entries(fallbackSections())) {
    sections[key] ??= value;
  }

  const featureRows = features.length ? features : D.DEFAULT_FEATURES.map(withId);
  const footerRows = footerLinks.length ? footerLinks : D.DEFAULT_FOOTER_LINKS.map(withId);

  return {
    sections,

    hero: {
      ...(hero ?? { ...D.DEFAULT_HERO, id: 1 }),
      readouts: heroReadouts.length ? heroReadouts : D.DEFAULT_HERO_READOUTS.map(withId),
      logos: (trustedLogos.length ? trustedLogos.map((l) => l.name) : D.DEFAULT_TRUSTED_LOGOS),
    },

    problem: {
      items: problems.length ? problems : D.DEFAULT_PROBLEMS.map(withId),
      ...(problemContent ?? D.DEFAULT_PROBLEM_CONTENT),
    },

    lifecycle: lifecycleStages.length ? lifecycleStages : D.DEFAULT_LIFECYCLE_STAGES.map(withId),

    features: {
      grid: featureRows.filter((f) => !f.featured),
      featured: featureRows.find((f) => f.featured) ?? null,
    },

    ecosystem: (ecosystem.length ? ecosystem : D.DEFAULT_ECOSYSTEM_PRODUCTS.map(withId)).map((p) => ({
      ...p,
      points: lines(p.points),
    })),

    why: (whyCards.length ? whyCards : D.DEFAULT_WHY_CARDS.map(withId)).map((c) => ({
      ...c,
      paragraphs: lines(c.body),
    })),

    chooseUs: chooseUs.length ? chooseUs : D.DEFAULT_CHOOSE_US.map(withId),

    industries: industries.length ? industries : D.DEFAULT_INDUSTRIES.map(withId),

    about: {
      ...(about ?? { ...D.DEFAULT_ABOUT, id: 1 }),
      pillars: aboutPillars.length ? aboutPillars : D.DEFAULT_ABOUT_PILLARS.map(withId),
      stats: stats.length ? stats : D.DEFAULT_STATS.map(withId),
      team,
    },

    testimonials: testimonials.length ? testimonials : D.DEFAULT_TESTIMONIALS.map(withId),

    faqs: faqs.length ? faqs : D.DEFAULT_FAQ.map(withId),

    cta: cta ?? { ...D.DEFAULT_CTA, id: 1 },

    settings: settings ?? { ...D.DEFAULT_SITE_SETTINGS, id: 1 },

    navLinks: navLinks.length ? navLinks : D.DEFAULT_NAV_LINKS.map(withId),

    footer: {
      columns: groupFooterColumns(footerRows.filter((l) => l.column !== 'Legal')),
      legal: footerRows.filter((l) => l.column === 'Legal'),
      socials: socialLinks.length ? socialLinks : D.DEFAULT_SOCIAL_LINKS.map(withId),
      lifecycle: (lifecycleStages.length ? lifecycleStages : D.DEFAULT_LIFECYCLE_STAGES).map((s) => s.key),
    },
  };
}

/** Give a default record the `id` shape the render code expects from Prisma rows. */
let syntheticId = 0;
function withId<T extends object>(row: T): T & { id: string } {
  return { ...row, id: `default-${++syntheticId}` };
}

function groupFooterColumns(rows: { column: string; label: string; href: string }[]) {
  const order: string[] = [];
  const map = new Map<string, { label: string; href: string }[]>();
  for (const row of rows) {
    if (!map.has(row.column)) {
      map.set(row.column, []);
      order.push(row.column);
    }
    map.get(row.column)!.push({ label: row.label, href: row.href });
  }
  return order.map((title) => ({ title, links: map.get(title)! }));
}

/** Defaults-only content, used when the database cannot be reached at all. */
function offlineContent(): SiteContent {
  const featureRows = D.DEFAULT_FEATURES.map(withId);
  const footerRows = D.DEFAULT_FOOTER_LINKS.map(withId);

  return {
    sections: fallbackSections(),
    hero: {
      ...D.DEFAULT_HERO,
      id: 1,
      readouts: D.DEFAULT_HERO_READOUTS.map(withId),
      logos: D.DEFAULT_TRUSTED_LOGOS,
    },
    problem: { items: D.DEFAULT_PROBLEMS.map(withId), ...D.DEFAULT_PROBLEM_CONTENT },
    lifecycle: D.DEFAULT_LIFECYCLE_STAGES.map(withId),
    features: {
      grid: featureRows.filter((f) => !f.featured),
      featured: featureRows.find((f) => f.featured) ?? null,
    },
    ecosystem: D.DEFAULT_ECOSYSTEM_PRODUCTS.map(withId).map((p) => ({ ...p, points: lines(p.points) })),
    why: D.DEFAULT_WHY_CARDS.map(withId).map((c) => ({ ...c, paragraphs: lines(c.body) })),
    chooseUs: D.DEFAULT_CHOOSE_US.map(withId),
    industries: D.DEFAULT_INDUSTRIES.map(withId),
    about: {
      ...D.DEFAULT_ABOUT,
      id: 1,
      pillars: D.DEFAULT_ABOUT_PILLARS.map(withId),
      stats: D.DEFAULT_STATS.map(withId),
      team: [],
    },
    testimonials: D.DEFAULT_TESTIMONIALS.map(withId),
    faqs: D.DEFAULT_FAQ.map(withId),
    cta: { ...D.DEFAULT_CTA, id: 1 },
    settings: { ...D.DEFAULT_SITE_SETTINGS, id: 1 },
    navLinks: D.DEFAULT_NAV_LINKS.map(withId),
    footer: {
      columns: groupFooterColumns(footerRows.filter((l) => l.column !== 'Legal')),
      legal: footerRows.filter((l) => l.column === 'Legal'),
      socials: D.DEFAULT_SOCIAL_LINKS.map(withId),
      lifecycle: D.DEFAULT_LIFECYCLE_STAGES.map((s) => s.key),
    },
  } as SiteContent;
}

export async function getSiteContent(): Promise<SiteContent> {
  try {
    // Fresh read every request — required for dual-deploy (admin + landing).
    return await loadSiteContent();
  } catch (error) {
    console.error('[content] falling back to defaults —', error);
    return offlineContent();
  }
}
