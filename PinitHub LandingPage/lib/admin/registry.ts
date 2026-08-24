import { prisma } from '@/lib/prisma';
import type { FieldDef } from './fields';

/**
 * The minimal shape every Prisma model delegate used here provides. The
 * generic collection/singleton actions in `lib/admin/actions.ts` are written
 * once against this interface instead of once per model.
 */
export type CrudDelegate = {
  findMany: (args?: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  findUnique: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  create: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  update: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  updateMany: (args: Record<string, unknown>) => Promise<unknown>;
  delete: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  count: (args?: Record<string, unknown>) => Promise<number>;
};

const delegate = (d: unknown) => d as CrudDelegate;

export type ListCollectionKey =
  | 'heroReadouts'
  | 'trustedLogos'
  | 'problemItems'
  | 'lifecycleStages'
  | 'features'
  | 'ecosystemProducts'
  | 'whyCards'
  | 'chooseUsReasons'
  | 'industries'
  | 'aboutPillars'
  | 'stats'
  | 'teamMembers'
  | 'testimonials'
  | 'faqItems'
  | 'navLinks'
  | 'footerLinks'
  | 'socialLinks';

export type SingletonKey = 'heroContent' | 'problemContent' | 'aboutContent' | 'ctaContent' | 'siteSettings';

export type ListCollectionConfig = {
  kind: 'list';
  key: ListCollectionKey;
  label: string;
  /** Short line shown under the label on the content index. */
  description: string;
  delegate: CrudDelegate;
  fields: FieldDef[];
  defaults: Record<string, FieldDef extends never ? never : unknown>;
  /** New row's display label in confirm dialogs — falls back to the first field. */
  titleField?: string;
};

export type SingletonConfig = {
  kind: 'singleton';
  key: SingletonKey;
  label: string;
  description: string;
  delegate: CrudDelegate;
  fields: FieldDef[];
};

export type CollectionConfig = ListCollectionConfig | SingletonConfig;

const ART_KEY_ECOSYSTEM = ['career', 'exchange', 'vault'] as const;
const ART_KEY_WHY = ['fragment', 'horizon', 'network'] as const;
const SOCIAL_PLATFORMS = ['Linkedin', 'Twitter', 'Youtube', 'Github', 'Instagram', 'Facebook'] as const;
const FOOTER_COLUMNS = ['Platform', 'Solutions', 'Resources', 'Company', 'Support', 'Legal'] as const;

export const LIST_REGISTRY: Record<ListCollectionKey, ListCollectionConfig> = {
  heroReadouts: {
    kind: 'list',
    key: 'heroReadouts',
    label: 'Hero readouts',
    description: 'The instrument callouts floating around the 3D core.',
    delegate: delegate(prisma.heroReadout),
    fields: [
      { key: 'label', label: 'Label', kind: 'text', required: true },
      { key: 'value', label: 'Value', kind: 'text', required: true },
      { key: 'accent', label: 'Accent (highlighted)', kind: 'boolean' },
      {
        key: 'position',
        label: 'Position',
        kind: 'text',
        hint: 'Tailwind classes, e.g. top-[14%] left-[4%]',
      },
    ],
    defaults: { label: '', value: '', accent: false, position: 'top-[14%] left-[4%]' },
  },
  trustedLogos: {
    kind: 'list',
    key: 'trustedLogos',
    label: 'Trusted-by logos',
    description: 'Wordmarks in the hero marquee.',
    delegate: delegate(prisma.trustedLogo),
    fields: [{ key: 'name', label: 'Name', kind: 'text', required: true }],
    defaults: { name: '' },
  },
  problemItems: {
    kind: 'list',
    key: 'problemItems',
    label: 'Problem ledger',
    description: 'The scattered-assets list in section 01.',
    delegate: delegate(prisma.problemItem),
    fields: [
      { key: 'icon', label: 'Icon', kind: 'icon' },
      { key: 'title', label: 'Title', kind: 'text', required: true },
      { key: 'body', label: 'Body', kind: 'textarea', required: true },
    ],
    defaults: { icon: 'Boxes', title: '', body: '' },
  },
  lifecycleStages: {
    kind: 'list',
    key: 'lifecycleStages',
    label: 'Lifecycle stages',
    description: 'The seven-stage rail in section 02.',
    delegate: delegate(prisma.lifecycleStage),
    fields: [
      { key: 'key', label: 'Short name', kind: 'text', required: true, hint: 'Shown on the rail tab, e.g. "Create"' },
      { key: 'icon', label: 'Icon', kind: 'icon' },
      { key: 'headline', label: 'Headline', kind: 'text', required: true },
      { key: 'body', label: 'Body', kind: 'textarea', required: true },
      { key: 'metric', label: 'Metric', kind: 'text', required: true },
      { key: 'metricLabel', label: 'Metric label', kind: 'text', required: true },
    ],
    defaults: { key: '', icon: 'Sparkles', headline: '', body: '', metric: '', metricLabel: '' },
    titleField: 'key',
  },
  features: {
    kind: 'list',
    key: 'features',
    label: 'Capabilities',
    description: 'The capability grid in section 03. Mark exactly one row "Featured" for the full-width analytics card.',
    delegate: delegate(prisma.feature),
    fields: [
      { key: 'icon', label: 'Icon', kind: 'icon' },
      { key: 'title', label: 'Title', kind: 'text', required: true },
      { key: 'body', label: 'Body', kind: 'textarea', required: true },
      { key: 'span', label: 'Grid span', kind: 'text', hint: 'Tailwind classes, e.g. lg:col-span-2' },
      { key: 'tint', label: 'Tint', kind: 'color' },
      { key: 'glow', label: 'Glow', kind: 'text', hint: 'rgba(...) used for the hover glow' },
      { key: 'featured', label: 'Featured (full-width card)', kind: 'boolean' },
    ],
    defaults: {
      icon: 'Sparkles',
      title: '',
      body: '',
      span: 'lg:col-span-2',
      tint: '#55E6FF',
      glow: 'rgba(85,230,255,0.16)',
      featured: false,
    },
  },
  ecosystemProducts: {
    kind: 'list',
    key: 'ecosystemProducts',
    label: 'Ecosystem products',
    description: 'The three product cards in section 04.',
    delegate: delegate(prisma.ecosystemProduct),
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true },
      { key: 'tagline', label: 'Tagline', kind: 'text', required: true },
      { key: 'body', label: 'Body', kind: 'textarea', required: true },
      { key: 'points', label: 'Bullet points', kind: 'textarea', hint: 'One per line' },
      { key: 'tint', label: 'Tint', kind: 'color' },
      { key: 'glow', label: 'Glow', kind: 'text', hint: 'rgba(...) used for the card glow' },
      { key: 'artKey', label: 'Illustration', kind: 'select', options: ART_KEY_ECOSYSTEM, required: true },
      { key: 'ctaLabel', label: 'CTA label', kind: 'text' },
      { key: 'ctaHref', label: 'CTA link', kind: 'text' },
    ],
    defaults: {
      name: '',
      tagline: '',
      body: '',
      points: '',
      tint: '#55E6FF',
      glow: 'rgba(85,230,255,0.18)',
      artKey: 'career',
      ctaLabel: 'Learn more',
      ctaHref: '#demo',
    },
  },
  whyCards: {
    kind: 'list',
    key: 'whyCards',
    label: 'Why PINITHUB cards',
    description: 'Origin / vision / mission cards in section 05.',
    delegate: delegate(prisma.whyCard),
    fields: [
      { key: 'kicker', label: 'Kicker', kind: 'text', required: true },
      { key: 'title', label: 'Title', kind: 'text', required: true },
      { key: 'body', label: 'Body', kind: 'textarea', required: true, hint: 'One paragraph per line' },
      { key: 'glow', label: 'Glow', kind: 'text', hint: 'rgba(...) used for the card glow' },
      { key: 'artKey', label: 'Illustration', kind: 'select', options: ART_KEY_WHY, required: true },
    ],
    defaults: { kicker: '', title: '', body: '', glow: 'rgba(85,230,255,0.14)', artKey: 'fragment' },
  },
  chooseUsReasons: {
    kind: 'list',
    key: 'chooseUsReasons',
    label: 'Why companies choose us',
    description: 'The procurement matrix in section 06.',
    delegate: delegate(prisma.chooseUsReason),
    fields: [
      { key: 'icon', label: 'Icon', kind: 'icon' },
      { key: 'title', label: 'Title', kind: 'text', required: true },
      { key: 'body', label: 'Body', kind: 'textarea', required: true },
      { key: 'stat', label: 'Stat line', kind: 'text', required: true },
    ],
    defaults: { icon: 'ShieldCheck', title: '', body: '', stat: '' },
  },
  industries: {
    kind: 'list',
    key: 'industries',
    label: 'Industries',
    description: 'The industry grid in section 07.',
    delegate: delegate(prisma.industry),
    fields: [
      { key: 'icon', label: 'Icon', kind: 'icon' },
      { key: 'name', label: 'Name', kind: 'text', required: true },
      { key: 'useCase', label: 'Use case', kind: 'textarea', required: true },
    ],
    defaults: { icon: 'Palette', name: '', useCase: '' },
  },
  aboutPillars: {
    kind: 'list',
    key: 'aboutPillars',
    label: 'About pillars',
    description: 'The four commitments in section 08.',
    delegate: delegate(prisma.aboutPillar),
    fields: [
      { key: 'title', label: 'Title', kind: 'text', required: true },
      { key: 'body', label: 'Body', kind: 'textarea', required: true },
    ],
    defaults: { title: '', body: '' },
  },
  stats: {
    kind: 'list',
    key: 'stats',
    label: 'Company stats',
    description: 'The counters beside the HQ visualization in section 08.',
    delegate: delegate(prisma.stat),
    fields: [
      { key: 'value', label: 'Value', kind: 'number', required: true },
      { key: 'suffix', label: 'Suffix', kind: 'text', hint: 'e.g. "+", "M+", "%"' },
      { key: 'label', label: 'Label', kind: 'text', required: true },
      { key: 'decimals', label: 'Decimal places', kind: 'number', min: 0, max: 4, step: 1 },
    ],
    defaults: { value: 0, suffix: '', label: '', decimals: 0 },
  },
  teamMembers: {
    kind: 'list',
    key: 'teamMembers',
    label: 'Team',
    description: 'Leadership shown beneath About. Empty list hides the block entirely.',
    delegate: delegate(prisma.teamMember),
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true },
      { key: 'role', label: 'Role', kind: 'text', required: true },
      { key: 'bio', label: 'Bio', kind: 'textarea' },
      { key: 'initials', label: 'Initials', kind: 'text', required: true },
      { key: 'tint', label: 'Tint', kind: 'color' },
    ],
    defaults: { name: '', role: '', bio: '', initials: '', tint: '#55E6FF' },
  },
  testimonials: {
    kind: 'list',
    key: 'testimonials',
    label: 'Testimonials',
    description: 'The proof carousel in section 09.',
    delegate: delegate(prisma.testimonial),
    fields: [
      { key: 'quote', label: 'Quote', kind: 'textarea', required: true },
      { key: 'name', label: 'Name', kind: 'text', required: true },
      { key: 'role', label: 'Role', kind: 'text', required: true },
      { key: 'company', label: 'Company', kind: 'text', required: true },
      { key: 'initials', label: 'Initials', kind: 'text', required: true },
      { key: 'tint', label: 'Tint', kind: 'color' },
      { key: 'rating', label: 'Rating (1–5)', kind: 'number', min: 1, max: 5, step: 1, required: true },
      { key: 'published', label: 'Published', kind: 'boolean' },
    ],
    defaults: {
      quote: '',
      name: '',
      role: '',
      company: '',
      initials: '',
      tint: '#55E6FF',
      rating: 5,
      published: true,
    },
  },
  faqItems: {
    kind: 'list',
    key: 'faqItems',
    label: 'FAQ',
    description: 'The objections list before the demo call.',
    delegate: delegate(prisma.faqItem),
    fields: [
      { key: 'question', label: 'Question', kind: 'text', required: true },
      { key: 'answer', label: 'Answer', kind: 'textarea', required: true },
      { key: 'published', label: 'Published', kind: 'boolean' },
    ],
    defaults: { question: '', answer: '', published: true },
    titleField: 'question',
  },
  navLinks: {
    kind: 'list',
    key: 'navLinks',
    label: 'Nav links',
    description: 'The top navigation bar.',
    delegate: delegate(prisma.navLink),
    fields: [
      { key: 'label', label: 'Label', kind: 'text', required: true },
      { key: 'href', label: 'Link', kind: 'text', required: true },
    ],
    defaults: { label: '', href: '#' },
  },
  footerLinks: {
    kind: 'list',
    key: 'footerLinks',
    label: 'Footer links',
    description: 'Grouped footer columns, plus the "Legal" row at the base.',
    delegate: delegate(prisma.footerLink),
    fields: [
      { key: 'column', label: 'Column', kind: 'select', options: FOOTER_COLUMNS, required: true },
      { key: 'label', label: 'Label', kind: 'text', required: true },
      { key: 'href', label: 'Link', kind: 'text', required: true },
    ],
    defaults: { column: 'Platform', label: '', href: '#demo' },
  },
  socialLinks: {
    kind: 'list',
    key: 'socialLinks',
    label: 'Social links',
    description: 'Icons in the footer base row.',
    delegate: delegate(prisma.socialLink),
    fields: [
      { key: 'platform', label: 'Platform', kind: 'select', options: SOCIAL_PLATFORMS, required: true },
      { key: 'label', label: 'Accessible label', kind: 'text', required: true },
      { key: 'href', label: 'Link', kind: 'text', required: true },
    ],
    defaults: { platform: 'Linkedin', label: '', href: '#' },
  },
};

export const SINGLETON_REGISTRY: Record<SingletonKey, SingletonConfig> = {
  heroContent: {
    kind: 'singleton',
    key: 'heroContent',
    label: 'Hero',
    description: 'The opening section headline, CTAs, and stat strip.',
    delegate: delegate(prisma.heroContent),
    fields: [
      { key: 'badgeLabel', label: 'Badge label', kind: 'text', required: true },
      { key: 'badgeText', label: 'Badge text', kind: 'text', required: true },
      { key: 'headline1', label: 'Headline line 1', kind: 'text', required: true },
      { key: 'headline2', label: 'Headline line 2', kind: 'text', required: true },
      { key: 'headline3', label: 'Headline line 3', kind: 'text', required: true },
      { key: 'lede', label: 'Lede', kind: 'textarea', required: true },
      { key: 'ctaPrimary', label: 'Primary CTA', kind: 'text', required: true },
      { key: 'ctaSecondary', label: 'Secondary CTA', kind: 'text', required: true },
      {
        key: 'videoUrl',
        label: 'Platform video',
        kind: 'text',
        placeholder: 'https://www.youtube.com/watch?v=...',
        hint: 'YouTube, Vimeo, or a direct video file link. Leave blank to scroll to the platform section instead.',
      },
      { key: 'stat1Key', label: 'Stat 1 key', kind: 'text' },
      { key: 'stat1Value', label: 'Stat 1 value', kind: 'text' },
      { key: 'stat2Key', label: 'Stat 2 key', kind: 'text' },
      { key: 'stat2Value', label: 'Stat 2 value', kind: 'text' },
      { key: 'stat3Key', label: 'Stat 3 key', kind: 'text' },
      { key: 'stat3Value', label: 'Stat 3 value', kind: 'text' },
      { key: 'logosLabel', label: 'Logos strip label', kind: 'text' },
    ],
  },
  problemContent: {
    kind: 'singleton',
    key: 'problemContent',
    label: 'Problem — resolution',
    description: 'The "One platform" statement beneath the problem ledger.',
    delegate: delegate(prisma.problemContent),
    fields: [
      { key: 'resolutionTitle', label: 'Title', kind: 'text', required: true },
      { key: 'resolutionBody', label: 'Body', kind: 'textarea', required: true },
    ],
  },
  aboutContent: {
    kind: 'singleton',
    key: 'aboutContent',
    label: 'About — company copy',
    description: 'The narrative copy and HQ label in section 08.',
    delegate: delegate(prisma.aboutContent),
    fields: [
      { key: 'title', label: 'Title', kind: 'text', required: true },
      { key: 'lede', label: 'Lede', kind: 'textarea', required: true },
      { key: 'body1', label: 'Body paragraph 1', kind: 'textarea', required: true },
      { key: 'body2', label: 'Body paragraph 2', kind: 'textarea', required: true },
      { key: 'hqLabel', label: 'HQ visual label', kind: 'text', required: true },
    ],
  },
  ctaContent: {
    kind: 'singleton',
    key: 'ctaContent',
    label: 'Final CTA',
    description: 'The closing call-to-action section.',
    delegate: delegate(prisma.ctaContent),
    fields: [
      { key: 'headline', label: 'Headline', kind: 'text', required: true },
      { key: 'lede', label: 'Lede', kind: 'textarea', required: true },
      { key: 'ctaPrimary', label: 'Primary CTA', kind: 'text', required: true },
      { key: 'ctaSecondary', label: 'Secondary CTA', kind: 'text', required: true },
      { key: 'footnote', label: 'Footnote', kind: 'text' },
    ],
  },
  siteSettings: {
    kind: 'singleton',
    key: 'siteSettings',
    label: 'Site settings',
    description: 'Global chrome, contact details, and SEO.',
    delegate: delegate(prisma.siteSettings),
    fields: [
      { key: 'footerTagline', label: 'Footer tagline', kind: 'textarea', required: true },
      { key: 'supportEmail', label: 'Support email', kind: 'text', required: true },
      { key: 'officeAddress', label: 'Office address', kind: 'text', required: true },
      { key: 'responseTime', label: 'Response time', kind: 'text', required: true },
      { key: 'demoLength', label: 'Demo length', kind: 'text', required: true },
      { key: 'newsletterLabel', label: 'Newsletter label', kind: 'text' },
      { key: 'newsletterHint', label: 'Newsletter hint', kind: 'text' },
      { key: 'copyrightName', label: 'Copyright name', kind: 'text' },
      { key: 'demoFormEnabled', label: 'Demo booking form enabled', kind: 'boolean' },
      { key: 'announcement', label: 'Announcement bar text', kind: 'text', hint: 'Empty hides the bar entirely' },
      { key: 'announcementHref', label: 'Announcement bar link', kind: 'text' },
      { key: 'metaTitle', label: 'SEO — meta title', kind: 'text', required: true },
      { key: 'metaDescription', label: 'SEO — meta description', kind: 'textarea', required: true },
      { key: 'metaKeywords', label: 'SEO — meta keywords', kind: 'textarea', hint: 'Comma-separated' },
      { key: 'siteUrl', label: 'Canonical site URL', kind: 'text', required: true },
    ],
  },
};

export function listConfig(key: string): ListCollectionConfig | undefined {
  return Object.prototype.hasOwnProperty.call(LIST_REGISTRY, key)
    ? LIST_REGISTRY[key as ListCollectionKey]
    : undefined;
}

export function singletonConfig(key: string): SingletonConfig | undefined {
  return Object.prototype.hasOwnProperty.call(SINGLETON_REGISTRY, key)
    ? SINGLETON_REGISTRY[key as SingletonKey]
    : undefined;
}
