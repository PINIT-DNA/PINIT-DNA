/**
 * Launch content for seed + offline fallback.
 *
 * Framing: PINITHUB (platform brand) → PinIT Hub (live product).
 * Available now: protect, vault, share, monitor, investigate.
 * Coming soon: Exchange, Career, full collaboration, SSO/SCIM, licensing.
 *
 * Editing here does not update an already-seeded database.
 * Use /admin or `npm run db:apply-defaults` for that.
 */

export const DEFAULT_HERO = {
  badgeLabel: 'Live today',
  badgeText: 'PinIT Hub — protect, prove, share, detect, investigate',
  headline1: 'Prove ownership.',
  headline2: 'Protect originals.',
  headline3: 'Investigate leaks.',
  lede:
    'PINITHUB is the Digital Asset Intelligence platform. PinIT Hub — available now — captures multi-layer DNA fingerprints, stores encrypted originals in Vault, tracks every share, and helps you investigate misuse. Exchange and Career are on the roadmap.',
  ctaPrimary: 'Book a Live Demo',
  ctaSecondary: 'Watch Demo',
  // Prefer CMS; otherwise NEXT_PUBLIC_DEMO_VIDEO_URL / site default is used.
  videoUrl: 'https://go.screenpal.com/watch/cOj123nv0bo',
  stat1Key: 'DNA',
  stat1Value: 'Multi-layer fingerprinting',
  stat2Key: 'Vault',
  stat2Value: 'Encrypted originals + certificates',
  stat3Key: 'Investigate',
  stat3Value: 'Forensic share & leak trails',
  logosLabel: 'Built for teams that need proof, not another cloud drive',
};

/** Non-metric scene cues — no fabricated KPI numbers. */
export const DEFAULT_HERO_READOUTS = [
  { label: 'CORE LOOP', value: 'PROTECT → PROVE', accent: false, position: 'top-[14%] left-[4%]' },
  { label: 'MODULE', value: 'PINIT VAULT', accent: true, position: 'right-[3%] bottom-[26%]' },
  { label: 'FOCUS', value: 'SHARE · DETECT · INVESTIGATE', accent: false, position: 'bottom-[10%] left-[10%]' },
];

/** Empty until real customer logos are approved. */
export const DEFAULT_TRUSTED_LOGOS: string[] = [];

export const DEFAULT_PROBLEMS = [
  { icon: 'Boxes', title: 'Assets scattered everywhere', body: 'Drives, inboxes, chat threads, local machines. Nobody knows what exists — or who owns it.' },
  { icon: 'FileWarning', title: 'Weak ownership proof', body: 'Filenames and EXIF are not evidence. When a file leaks, provenance is already gone.' },
  { icon: 'ShieldAlert', title: 'Security outside governance', body: 'Sensitive originals live outside encryption, access control, and audit trails.' },
  { icon: 'Copy', title: 'Shares without accountability', body: 'Links get forwarded. Access is forgotten. Revocation is guesswork.' },
  { icon: 'Layers', title: 'Lost context after handoff', body: 'Authorship, certificates, and history evaporate the moment someone leaves the team.' },
  { icon: 'TrendingDown', title: 'Hard to investigate misuse', body: 'When a copy appears elsewhere, teams lack fingerprints, share trails, and forensic comparison.' },
];

export const DEFAULT_PROBLEM_CONTENT = {
  resolutionTitle: 'Protection and provenance — not another cloud drive.',
  resolutionBody:
    'PinIT Hub gives organizations DNA-backed ownership proof, an encrypted Vault for originals, tracked shares, monitoring when enabled, and investigation tools when something goes wrong.',
};

/**
 * Primary loop matches what PinIT Hub ships.
 * metric = status badge shown in the UI: "Available now" | "Coming soon"
 */
export const DEFAULT_LIFECYCLE_STAGES = [
  {
    key: 'Protect',
    icon: 'ShieldCheck',
    headline: 'Protection begins when you create or publish.',
    body: 'PinIT Hub captures DNA at upload/export, stores encrypted originals in Vault, and attaches provenance before the asset leaves your control — including via Publish Guardian.',
    metric: 'Available now',
    metricLabel: 'PinIT Hub',
  },
  {
    key: 'Prove',
    icon: 'Fingerprint',
    headline: 'Ownership beyond filename and EXIF.',
    body: 'Multi-layer DNA fingerprinting and certificates give verifiable authenticity so disputes and leaks start from evidence, not memory.',
    metric: 'Available now',
    metricLabel: 'DNA + certificates',
  },
  {
    key: 'Share',
    icon: 'Share2',
    headline: 'Share with tracking — and revoke when needed.',
    body: 'Smart Share adds access intelligence: who opened what, geo signals, forward chains, and the ability to cut access without hunting links.',
    metric: 'Available now',
    metricLabel: 'Smart Share',
  },
  {
    key: 'Detect',
    icon: 'Radar',
    headline: 'Continuous monitoring when you enable it.',
    body: 'Watch for re-uploads and public appearances across configured crawler sources so leaked copies surface earlier in the cycle.',
    metric: 'Available now',
    metricLabel: 'Monitoring',
  },
  {
    key: 'Investigate',
    icon: 'Search',
    headline: 'Unified investigation and forensic comparison.',
    body: 'Trace share history, compare files, and build an account of what left your tenancy — the accountability layer most cloud drives never ship.',
    metric: 'Available now',
    metricLabel: 'Forensics',
  },
  {
    key: 'License',
    icon: 'ScrollText',
    headline: 'Machine-readable rights — on the roadmap.',
    body: 'Territories, terms, and expiry enforced by the platform are planned for PinIT Exchange. Not shipped in PinIT Hub today.',
    metric: 'Coming soon',
    metricLabel: 'PinIT Exchange',
  },
  {
    key: 'Monetize',
    icon: 'DollarSign',
    headline: 'Marketplace licensing — planned, not live.',
    body: 'Sell and license through PinIT Exchange is architecture and planning work. There is no live marketplace checkout from this product yet.',
    metric: 'Coming soon',
    metricLabel: 'PinIT Exchange',
  },
];

export const DEFAULT_FEATURES = [
  {
    icon: 'Fingerprint',
    title: 'Multi-layer DNA fingerprinting',
    body: 'Prove ownership beyond filename and EXIF with fingerprints built for dispute and leak investigation.',
    span: 'lg:col-span-4',
    tint: '#55E6FF',
    glow: 'rgba(85,230,255,0.16)',
    featured: false,
  },
  {
    icon: 'Lock',
    title: 'Encrypted Vault + certificates',
    body: 'Secure originals in Vault with verifiable authenticity certificates — the storage foundation inside PinIT Hub.',
    span: 'lg:col-span-2',
    tint: '#2D7BFF',
    glow: 'rgba(45,123,255,0.16)',
    featured: false,
  },
  {
    icon: 'Share2',
    title: 'Smart Share',
    body: 'Share with tracking, revoke access, and inspect geo and forward-chain signals when accountability matters.',
    span: 'lg:col-span-2',
    tint: '#6F5CFF',
    glow: 'rgba(111,92,255,0.16)',
    featured: false,
  },
  {
    icon: 'Radar',
    title: 'Monitoring',
    body: 'Detect re-uploads and public copies when crawler monitoring is enabled for your workspace.',
    span: 'lg:col-span-2',
    tint: '#14D991',
    glow: 'rgba(20,217,145,0.14)',
    featured: false,
  },
  {
    icon: 'Search',
    title: 'Investigation & forensic diff',
    body: 'Investigate leaks with share trails and file comparison — not just a download log.',
    span: 'lg:col-span-2',
    tint: '#55E6FF',
    glow: 'rgba(85,230,255,0.16)',
    featured: false,
  },
  {
    icon: 'Puzzle',
    title: 'Publish Guardian',
    body: 'Protect at the moment of upload or export with the browser extension workflow, so DNA and Vault start before the file escapes.',
    span: 'lg:col-span-2',
    tint: '#2D7BFF',
    glow: 'rgba(45,123,255,0.16)',
    featured: false,
  },
  {
    icon: 'ScanFace',
    title: 'Biometric identity',
    body: 'Face auth and ShortId support stronger identity for creator and team protection workflows where enabled.',
    span: 'lg:col-span-2',
    tint: '#6F5CFF',
    glow: 'rgba(111,92,255,0.16)',
    featured: false,
  },
  {
    icon: 'Building2',
    title: 'Org workspaces',
    body: 'Teams, API keys, webhooks, and subscription tiers for organizations that need shared governance — without claiming SSO/SCIM today.',
    span: 'lg:col-span-2',
    tint: '#B8C2D0',
    glow: 'rgba(184,194,208,0.12)',
    featured: false,
  },
  {
    icon: 'ShieldCheck',
    title: 'Accountability loop',
    body: 'Protect → Prove → Share → Detect → Investigate. The core PinIT Hub loop for ownership and leak response — not a generic DAM feature grid.',
    span: 'sm:col-span-2 lg:col-span-6',
    tint: '#14D991',
    glow: 'rgba(20,217,145,0.12)',
    featured: true,
  },
];

export const DEFAULT_ECOSYSTEM_PRODUCTS = [
  {
    name: 'PinIT Vault',
    tagline: 'Available now · inside PinIT Hub',
    body: 'Enterprise storage, AI indexing, search, versioning, and compliance encryption — shipped as the foundation module of PinIT Hub, not a separate live product URL today.',
    points: 'Encrypted originals\nCertificates & provenance\nSearch inside Hub',
    tint: '#2D7BFF',
    glow: 'rgba(45,123,255,0.18)',
    artKey: 'vault',
    ctaLabel: 'Open PinIT Hub',
    ctaHref: 'https://dna-pinit-web.vercel.app',
  },
  {
    name: 'PinIT Exchange',
    tagline: 'Coming soon · roadmap',
    body: 'Licensing, marketplace commerce, and royalties are planned. There is no live checkout or rights engine in production from this codebase yet.',
    points: 'Licensing engine (planned)\nMarketplace (planned)\nRoyalties (planned)',
    tint: '#6F5CFF',
    glow: 'rgba(111,92,255,0.18)',
    artKey: 'exchange',
    ctaLabel: 'Talk about the roadmap',
    ctaHref: '#demo',
  },
  {
    name: 'PinIT Career',
    tagline: 'Coming soon · future product',
    body: 'Verified portfolios, AI résumés, and talent discovery are a future PINITHUB product — not part of the live PinIT Hub protect/investigate platform today.',
    points: 'Portfolios (planned)\nTalent discovery (planned)\nCredentials (planned)',
    tint: '#55E6FF',
    glow: 'rgba(85,230,255,0.18)',
    artKey: 'career',
    ctaLabel: 'Book a demo',
    ctaHref: '#demo',
  },
];

export const DEFAULT_WHY_CARDS = [
  {
    kicker: 'Origin',
    title: 'Why we exist',
    glow: 'rgba(85,230,255,0.14)',
    artKey: 'fragment',
    body: [
      'Digital assets are valuable — and fragile. Files scatter, ownership is hard to prove, shares escape governance, and leaks leave teams without forensic trails.',
      'PINITHUB exists to put intelligence, ownership proof, and accountability around the assets organizations already create.',
      'PinIT Hub is the product you can use today. Exchange and Career extend the platform vision over time.',
    ].join('\n'),
  },
  {
    kicker: 'Vision',
    title: 'Our vision',
    glow: 'rgba(45,123,255,0.14)',
    artKey: 'horizon',
    body: [
      'To make Digital Asset Intelligence the standard layer for protect, prove, share, detect, and investigate — then grow into licensing and creator careers as those products ship.',
      'A future where every asset carries provenance, and misuse can be investigated with evidence.',
    ].join('\n'),
  },
  {
    kicker: 'Mission',
    title: 'Our mission',
    glow: 'rgba(111,92,255,0.14)',
    artKey: 'network',
    body: [
      'Eliminate digital chaos where it hurts most: ownership, vault security, accountable sharing, and investigation.',
      'Ship honest capabilities first. Roadmap the rest without overselling procurement.',
    ].join('\n'),
  },
];

export const DEFAULT_CHOOSE_US = [
  {
    icon: 'Fingerprint',
    title: 'Proof, not placeholders',
    body: 'DNA fingerprinting and certificates are built for ownership disputes and leak response — the differentiated layer generic cloud drives skip.',
    stat: 'Evidence-grade provenance',
  },
  {
    icon: 'Lock',
    title: 'Vault inside the product',
    body: 'Encrypted originals and authenticity live in PinIT Hub. You are not buying a disconnected storage silo with a marketing name.',
    stat: 'Security with the asset',
  },
  {
    icon: 'Share2',
    title: 'Accountable sharing',
    body: 'Smart Share, revoke, and access intelligence so “who has this file?” is answerable after the link leaves chat.',
    stat: 'Share with a trail',
  },
  {
    icon: 'Search',
    title: 'Investigate when it breaks',
    body: 'Forensic comparison and investigation workflows for the moments storage products stop being enough.',
    stat: 'Leak response ready',
  },
  {
    icon: 'Puzzle',
    title: 'Protect at publish time',
    body: 'Publish Guardian and Hub capture DNA and Vault state at upload/export — before the asset is already public.',
    stat: 'Earlier in the lifecycle',
  },
  {
    icon: 'Map',
    title: 'Honest roadmap',
    body: 'Exchange, Career, SSO/SCIM, and full collaboration are labeled Coming soon — so demos match what you can show today.',
    stat: 'Procurement-safe messaging',
  },
];

export const DEFAULT_INDUSTRIES = [
  { icon: 'Palette', name: 'Creators', useCase: 'Prove authorship and protect originals before they circulate.' },
  { icon: 'Code2', name: 'Developers', useCase: 'Track sensitive build artifacts and shared packages with accountability.' },
  { icon: 'Megaphone', name: 'Agencies', useCase: 'Govern client deliverables with share trails and revoke when retainers end.' },
  { icon: 'Building', name: 'Enterprises', useCase: 'Keep vaulted originals and investigation tooling under org workspaces.' },
  { icon: 'Landmark', name: 'Governments', useCase: 'Strengthen chain-of-custody style trails for sensitive digital records.' },
  { icon: 'GraduationCap', name: 'Educational', useCase: 'Protect course assets and investigate unauthorized redistribution.' },
  { icon: 'Camera', name: 'Photographers', useCase: 'Fingerprint sets and track where shares travel after delivery.' },
  { icon: 'Compass', name: 'Architects', useCase: 'Vault drawings and revisions with clearer ownership history.' },
  { icon: 'PenLine', name: 'Writers', useCase: 'Protect manuscripts and prove earlier drafts when disputes arise.' },
  { icon: 'Radio', name: 'Media', useCase: 'Investigate leaked cuts with fingerprints and share intelligence.' },
  { icon: 'Baseline', name: 'Marketing', useCase: 'Control approved assets leaving the brand system via tracked shares.' },
  { icon: 'Cpu', name: 'Technology', useCase: 'Govern model weights, datasets, and docs with vault + monitoring.' },
];

export const DEFAULT_ABOUT = {
  title: 'The company behind PINITHUB',
  lede: 'PINITHUB is developed by TheCareerTech Pvt. Ltd., a technology company building platforms for creators and organizations that need digital asset intelligence — starting with PinIT Hub.',
  body1:
    'We started with a practical failure mode: files escape, ownership is hard to prove, and investigation starts too late. PinIT Hub addresses that loop first.',
  body2:
    'Our commitment: ship what we claim, label what is roadmap, and grow Exchange and Career when those products are real — not when the brochure needs them.',
  hqLabel: 'THECAREERTECH PVT. LTD.',
};

export const DEFAULT_ABOUT_PILLARS = [
  { title: 'Honest product claims', body: 'Available now vs Coming soon is labeled so demos and procurement stay aligned.' },
  { title: 'Proof over storage', body: 'DNA, Vault, share trails, and investigation — not another undifferentiated drive.' },
  { title: 'Platform over time', body: 'PINITHUB is the parent brand; PinIT Hub is live; Exchange and Career follow.' },
  { title: 'Built in Hyderabad', body: 'Developed by TheCareerTech Pvt. Ltd. with a focus on security and accountability.' },
];

/** No unverified company KPIs. */
export const DEFAULT_STATS: {
  value: number;
  suffix: string;
  label: string;
  decimals: number;
}[] = [];

export const DEFAULT_TEAM: {
  name: string;
  role: string;
  bio: string;
  initials: string;
  tint: string;
}[] = [];

/** India-focused quotes — no company names. */
export const DEFAULT_TESTIMONIALS: {
  quote: string;
  name: string;
  role: string;
  company: string;
  initials: string;
  tint: string;
  rating: number;
}[] = [
  {
    quote:
      'We needed ownership proof before a sensitive campaign went out. PinIT Hub’s DNA and Vault gave us a trail we could actually show legal — not another folder sync.',
    name: 'Ananya R.',
    role: 'Creative Operations Lead · Bengaluru, India',
    company: '',
    initials: 'AR',
    tint: '#55E6FF',
    rating: 5,
  },
  {
    quote:
      'Smart Share finally answered “who forwarded this?” when a deck leaked internally. Revoking access without hunting links saved us a full day.',
    name: 'Rahul M.',
    role: 'IT Security Manager · Hyderabad, India',
    company: '',
    initials: 'RM',
    tint: '#2D7BFF',
    rating: 5,
  },
  {
    quote:
      'Investigation used to mean screenshots and guesswork. Fingerprint comparison and share history in Hub is the first tool that felt built for accountability.',
    name: 'Kavya P.',
    role: 'Media Operations · Mumbai, India',
    company: '',
    initials: 'KP',
    tint: '#6F5CFF',
    rating: 5,
  },
  {
    quote:
      'We did not need another drive — we needed proof when assets leave the team. Hub’s protect-and-prove loop matched how we actually work.',
    name: 'Vikram S.',
    role: 'Head of Digital Assets · Chennai, India',
    company: '',
    initials: 'VS',
    tint: '#14D991',
    rating: 5,
  },
];

export const DEFAULT_FAQ = [
  {
    question: 'What is available in PinIT Hub today?',
    answer:
      'Protect and provenance workflows: DNA fingerprinting, encrypted Vault with certificates, Smart Share with tracking and revoke, monitoring when enabled, investigation/forensic comparison, org workspaces, and Publish Guardian at upload/export. PinIT Exchange and PinIT Career are not live products yet.',
  },
  {
    question: 'Does PinIT Hub replace our current storage?',
    answer:
      'Vault stores encrypted originals as part of Hub’s protection workflow. Many teams keep existing drives while Hub becomes the system of record for protected assets and proof. Full “replace every drive in a week” migration is not what we claim today.',
  },
  {
    question: 'Where is our data stored?',
    answer:
      'Assets are stored according to your Hub workspace configuration. Broad regional data-residency productization (pick-any-region enterprise residency) is not positioned as a shipped guarantee on this page — ask on a demo for your tenancy options.',
  },
  {
    question: 'How does AI handle confidential material?',
    answer:
      'Indexing and search features run in service of your workspace. Ask on a live demo how your tenancy isolates enrichment and what can be excluded by policy for your deployment.',
  },
  {
    question: 'Can we try it before committing?',
    answer:
      'Yes. Book a live demo — we walk PinIT Hub against scenarios that match how you protect and share assets, not a fictional marketplace tour.',
  },
  {
    question: 'Do you support SSO and SCIM today?',
    answer:
      'Not as a marketed shipped enterprise suite on this landing page. Org teams, API keys, and webhooks exist in Hub; SSO/SCIM and similar IdP automation remain roadmap. We will not pretend otherwise in procurement.',
  },
];

export const DEFAULT_CTA = {
  headline: 'See PinIT Hub on your assets — not a brochure.',
  lede: 'Book a live demo of protect, vault, share, detect, and investigate. Ask us anything about Exchange and Career as roadmap — we will not oversell them.',
  ctaPrimary: 'Book a Live Demo',
  ctaSecondary: 'Talk to Sales',
  footnote: 'No credit card required · 30-minute session · Focused on what ships today',
};

export const DEFAULT_SITE_SETTINGS = {
  footerTagline:
    'PINITHUB — Digital Asset Intelligence. PinIT Hub is live for protect, prove, share, detect, and investigate. PinIT Exchange and PinIT Career are on the roadmap.',
  supportEmail: 'hello@pinithub.com',
  officeAddress: 'TheCareerTech Pvt. Ltd., Hyderabad, India',
  responseTime: 'Under 1 business hour',
  demoLength: '30 minutes, tailored to your stack',
  newsletterLabel: 'Get the intelligence briefing',
  newsletterHint: 'Monthly. Product, research, and nothing else.',
  copyrightName: 'PINITHUB · TheCareerTech Pvt. Ltd.',
  demoFormEnabled: true,
  announcement: '',
  announcementHref: '#demo',
  metaTitle: 'PINITHUB — PinIT Hub for digital asset protection & provenance',
  metaDescription:
    'PINITHUB’s PinIT Hub protects digital assets with DNA fingerprints, encrypted Vault, tracked shares, monitoring, and investigation. Exchange and Career are on the roadmap.',
  metaKeywords:
    'PinIT Hub, PINITHUB, digital asset protection, DNA fingerprint, encrypted vault, provenance, forensic investigation, Smart Share',
  siteUrl: 'https://pinithub.com',
};

export const DEFAULT_NAV_LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'Solutions', href: '#solutions' },
  { label: 'Ecosystem', href: '#resources' },
  { label: 'Company', href: '#company' },
  { label: 'Demo', href: '#demo' },
];

export const DEFAULT_FOOTER_LINKS: { column: string; label: string; href: string }[] = [
  ...['DNA fingerprinting', 'Encrypted Vault', 'Smart Share', 'Monitoring', 'Investigation'].map((label) => ({
    column: 'PinIT Hub',
    label,
    href: '#solutions',
  })),
  ...[
    { label: 'PinIT Vault (in Hub)', href: '#resources' },
    { label: 'PinIT Exchange (roadmap)', href: '#resources' },
    { label: 'PinIT Career (roadmap)', href: '#resources' },
    { label: 'Book a Demo', href: '#demo' },
    { label: 'Open PinIT Hub', href: 'https://dna-pinit-web.vercel.app' },
  ].map((row) => ({ column: 'Ecosystem', ...row })),
  ...['About', 'FAQ', 'Contact'].map((label) => ({
    column: 'Company',
    label,
    href: label === 'FAQ' ? '#faq' : label === 'About' ? '#company' : '#demo',
  })),
  { column: 'Legal', label: 'Privacy', href: '#privacy' },
  { column: 'Legal', label: 'Terms', href: '#terms' },
  { column: 'Legal', label: 'Cookies', href: '#cookies' },
];

export const DEFAULT_SOCIAL_LINKS = [
  { platform: 'Linkedin', label: 'PINITHUB on LinkedIn', href: '#linkedin' },
  { platform: 'Twitter', label: 'PINITHUB on Twitter', href: '#twitter' },
  { platform: 'Youtube', label: 'PINITHUB on YouTube', href: '#youtube' },
  { platform: 'Github', label: 'PINITHUB on GitHub', href: '#github' },
];

export const DEFAULT_SECTIONS = [
  {
    key: 'about',
    index: '02',
    label: 'About',
    title: 'The company behind PINITHUB',
    lede: 'Developed by TheCareerTech Pvt. Ltd., Hyderabad — building PinIT Hub first, with Exchange and Career on the platform roadmap.',
  },
  {
    key: 'problem',
    index: '03',
    label: 'The problem',
    title: 'Assets escape. Proof disappears. Investigation starts too late.',
    lede: 'Scattered files, weak ownership evidence, shares without trails, and security outside governance — the failure modes PinIT Hub is built to address.',
  },
  {
    key: 'lifecycle',
    index: '04',
    label: 'What ships today',
    title: 'Protect → Prove → Share → Detect → Investigate',
    lede: 'The PinIT Hub core loop is available now. Licensing and monetization via Exchange are labeled Coming soon — not sold as live.',
  },
  {
    key: 'features',
    index: '05',
    label: 'Capabilities',
    title: 'Differentiated protection and accountability',
    lede: 'DNA, Vault, Smart Share, monitoring, investigation, Publish Guardian, and org workspaces — framed as what Hub ships, not a full DAM + marketplace.',
  },
  {
    key: 'ecosystem',
    index: '06',
    label: 'The ecosystem',
    title: 'One platform brand. Clear product status.',
    lede: 'PINITHUB is the parent. PinIT Vault lives inside Hub today. PinIT Exchange and PinIT Career are roadmap products — not separate live apps from this page.',
  },
  {
    key: 'why',
    index: '07',
    label: 'Why PINITHUB',
    title: 'Built on proof and accountability',
    lede: 'We are not positioning another generic cloud drive. We are building Digital Asset Intelligence starting with protection and provenance.',
  },
  {
    key: 'chooseUs',
    index: '08',
    label: 'Why teams choose Hub',
    title: 'Reasons that survive a live demo',
    lede: 'Every claim below maps to PinIT Hub capabilities you can show — or is explicitly marked as roadmap elsewhere on the page.',
  },
  {
    key: 'industries',
    index: '09',
    label: 'Industries',
    title: 'Same failure modes. Different assets.',
    lede: 'Creators, agencies, enterprises, and media teams all need ownership proof and accountable sharing — Hub starts there.',
  },
  {
    key: 'testimonials',
    index: '10',
    label: 'Proof',
    title: 'What teams in India are saying',
    lede: 'Permissioned feedback from Indian teams using PinIT Hub — no company names, no inflated claims.',
  },
  {
    key: 'faq',
    index: '11',
    label: 'Questions',
    title: 'What procurement should ask',
    lede: 'Straight answers on what is live in PinIT Hub versus what remains roadmap.',
  },
  {
    key: 'demo',
    index: '12',
    label: 'Book a live demo',
    title: 'Book a live demo',
    lede: 'See PinIT Hub on protect, vault, share, and investigate — and ask candidly about the roadmap.',
  },
];

/* ---------------- Demo booking form option lists ---------------- */

export const DEMO_COUNTRIES = [
  'United States', 'United Kingdom', 'Canada', 'India', 'Australia', 'Germany', 'France',
  'Netherlands', 'Singapore', 'United Arab Emirates', 'Japan', 'Brazil', 'South Africa', 'Other',
];

export const DEMO_SIZES = ['1 – 10', '11 – 50', '51 – 200', '201 – 1,000', '1,001 – 5,000', '5,000+'];

export const DEMO_INDUSTRIES = [
  'Media & Entertainment', 'Marketing & Advertising', 'Technology', 'Education', 'Government',
  'Architecture & Design', 'Photography', 'Publishing', 'Retail & E-commerce', 'Other',
];

export const DEMO_TIMES = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30'];

export const DEMO_STATUSES = ['NEW', 'CONTACTED', 'SCHEDULED', 'COMPLETED', 'REJECTED'] as const;

export type DemoStatus = (typeof DEMO_STATUSES)[number];
