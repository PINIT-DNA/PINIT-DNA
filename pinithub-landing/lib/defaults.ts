/**
 * Launch content for seed + offline fallback.
 *
 * Framing: PINITHUB (platform) → PinIT Hub (live product).
 * Lead with customer outcomes; introduce mechanisms underneath.
 * Available now: Protect → Prove → Share → Detect → Investigate.
 * Coming soon: Exchange, Career, licensing / marketplace commerce.
 *
 * Editing here does not update an already-seeded database.
 * Use /admin or `npm run db:apply-defaults` for that.
 */

export const DEFAULT_HERO = {
  badgeLabel: 'Digital asset intelligence',
  badgeText: 'Protect · Prove · Share · Detect · Investigate',
  headline1: 'Protect what you create.',
  headline2: 'Prove what you own.',
  headline3: '',
  lede:
    'PINITHUB gives creators, teams, and organizations a secure control layer for digital assets—from protection and ownership evidence to accountable sharing and investigation.',
  ctaPrimary: 'Talk to our team',
  ctaSecondary: 'Explore the platform',
  videoUrl: 'https://go.screenpal.com/watch/cOj123nv0bo',
  stat1Key: 'Protect',
  stat1Value: 'Secure the original',
  stat2Key: 'Prove',
  stat2Value: 'Ownership evidence',
  stat3Key: 'Investigate',
  stat3Value: 'When something leaks',
  logosLabel: 'Not another cloud drive — a control layer for what happens to your assets',
};

/** Scene cues — customer outcomes, not engineering jargon. */
export const DEFAULT_HERO_READOUTS = [
  { label: 'LIVE TODAY', value: 'PROTECT → PROVE → SHARE', accent: false, position: 'top-[14%] left-[4%]' },
  { label: 'YOUR SPACE', value: 'PRIVATE WORKSPACE', accent: true, position: 'right-[3%] bottom-[26%]' },
  { label: 'WHEN NEEDED', value: 'DETECT · INVESTIGATE', accent: false, position: 'bottom-[10%] left-[10%]' },
];

/** Empty until real customer logos are approved. */
export const DEFAULT_TRUSTED_LOGOS: string[] = [];

export const DEFAULT_PROBLEMS = [
  {
    icon: 'Boxes',
    title: 'Assets scatter',
    body: 'Files move across devices, teams, platforms, and workflows—faster than anyone can track.',
  },
  {
    icon: 'FileWarning',
    title: 'Ownership becomes hard to prove',
    body: 'Copies, exports, and transformations can separate an asset from its original evidence.',
  },
  {
    icon: 'Share2',
    title: 'Sharing creates blind spots',
    body: 'Once an asset leaves your workspace, visibility and accountability often disappear.',
  },
  {
    icon: 'TrendingDown',
    title: 'Misuse is discovered too late',
    body: 'When a copy appears elsewhere, investigation starts without enough evidence to act.',
  },
];

export const DEFAULT_PROBLEM_CONTENT = {
  resolutionTitle: 'Not another place to put your files.',
  resolutionBody:
    'PINITHUB is a control layer for what happens to them—protect the original, establish proof, control access, detect misuse, and investigate what happened.',
};

/**
 * Primary loop matches what PinIT Hub ships.
 * metric = status badge: "Available now" | "Coming soon"
 */
export const DEFAULT_LIFECYCLE_STAGES = [
  {
    key: 'Protect',
    icon: 'ShieldCheck',
    headline: 'Secure the original when it enters your workspace.',
    body: 'Assets are protected as they are created or uploaded—so protection starts before a file escapes into the wild.',
    metric: 'Available now',
    metricLabel: 'PinIT Hub',
  },
  {
    key: 'Prove',
    icon: 'Fingerprint',
    headline: 'Establish ownership evidence that travels with the asset.',
    body: 'Every protected asset receives persistent identity and provenance evidence you can compare later—beyond filename and metadata.',
    metric: 'Available now',
    metricLabel: 'Ownership evidence',
  },
  {
    key: 'Share',
    icon: 'Share2',
    headline: 'Share without losing control.',
    body: 'Time-bound, access-controlled sharing with activity visibility and the ability to revoke when access should end.',
    metric: 'Available now',
    metricLabel: 'Accountable sharing',
  },
  {
    key: 'Detect',
    icon: 'Radar',
    headline: 'Find what changed or escaped.',
    body: 'Monitor authorized sources and surface copies that look like your protected assets—so issues appear earlier.',
    metric: 'Available now',
    metricLabel: 'Monitoring',
  },
  {
    key: 'Investigate',
    icon: 'Search',
    headline: 'Turn a suspicious copy into evidence.',
    body: 'Compare assets, review activity, and build an investigation trail when something leaves your control.',
    metric: 'Available now',
    metricLabel: 'Investigation',
  },
  {
    key: 'License',
    icon: 'ScrollText',
    headline: 'License when you choose to go commercial.',
    body: 'Rights, terms, and controlled licensing workflows are planned for PINIT Exchange—not sold as live marketplace today.',
    metric: 'Coming soon',
    metricLabel: 'PINIT Exchange',
  },
  {
    key: 'Monetize',
    icon: 'DollarSign',
    headline: 'Monetize protected assets—only when you make them available.',
    body: 'Discover, license, and sell through Exchange is on the roadmap. Protecting an asset in Hub does not list it for sale.',
    metric: 'Coming soon',
    metricLabel: 'PINIT Exchange',
  },
];

export const DEFAULT_FEATURES = [
  {
    icon: 'ShieldCheck',
    title: 'Protect',
    body: 'Secure the original. Encrypted asset storage with protection and provenance established when an asset enters your workspace.',
    span: 'lg:col-span-2',
    tint: '#2D7BFF',
    glow: 'rgba(45,123,255,0.08)',
    featured: false,
  },
  {
    icon: 'Fingerprint',
    title: 'Prove',
    body: 'Establish ownership evidence. Persistent asset identity that can be compared against later copies or transformations.',
    span: 'lg:col-span-2',
    tint: '#55E6FF',
    glow: 'rgba(85,230,255,0.08)',
    featured: false,
  },
  {
    icon: 'Share2',
    title: 'Share',
    body: 'Share without losing control. Access-controlled sharing with activity visibility and revocation when you need it.',
    span: 'lg:col-span-2',
    tint: '#6F5CFF',
    glow: 'rgba(111,92,255,0.08)',
    featured: false,
  },
  {
    icon: 'Radar',
    title: 'Detect',
    body: 'Find what changed or escaped. Monitor sources and compare discovered copies against your protected assets.',
    span: 'lg:col-span-3',
    tint: '#14D991',
    glow: 'rgba(20,217,145,0.07)',
    featured: false,
  },
  {
    icon: 'Search',
    title: 'Investigate',
    body: 'Turn a suspicious copy into evidence. Compare assets, inspect provenance, reconstruct activity, and build a trail.',
    span: 'lg:col-span-3',
    tint: '#55E6FF',
    glow: 'rgba(85,230,255,0.08)',
    featured: false,
  },
  {
    icon: 'ScanFace',
    title: 'Identity & access',
    body: 'Strong account identity and controlled access so only the right people enter the workspace that holds your assets.',
    span: 'lg:col-span-3',
    tint: '#6F5CFF',
    glow: 'rgba(111,92,255,0.07)',
    featured: false,
  },
  {
    icon: 'Building2',
    title: 'Teams & workspaces',
    body: 'Organization workspaces for shared governance—roles, team access, and policy-minded control without claiming every enterprise IdP feature today.',
    span: 'lg:col-span-3',
    tint: '#B8C2D0',
    glow: 'rgba(184,194,208,0.06)',
    featured: false,
  },
  {
    icon: 'ShieldCheck',
    title: 'One control layer around every asset',
    body: 'Protect → Prove → Share → Detect → Investigate. The PinIT Hub loop for ownership and accountability—not a generic storage feature grid.',
    span: 'sm:col-span-2 lg:col-span-6',
    tint: '#14D991',
    glow: 'rgba(20,217,145,0.06)',
    featured: true,
  },
];

export const DEFAULT_ECOSYSTEM_PRODUCTS = [
  {
    name: 'PinIT Hub',
    tagline: 'Available now · private asset workspace',
    body: 'Protect and manage digital assets privately. Your assets do not need to be listed, published, or sold to stay protected inside Hub.',
    points: 'Protect & store privately\nProve ownership evidence\nShare with control\nDetect & investigate',
    tint: '#2D7BFF',
    glow: 'rgba(45,123,255,0.10)',
    artKey: 'vault',
    ctaLabel: 'Get started',
    ctaHref: 'https://pinit-dna.vercel.app/register/account-type',
  },
  {
    name: 'PINIT Exchange',
    tagline: 'Coming soon · commerce when you choose',
    body: 'Turn protected assets into commerce only when you make them available. Buyers browse and license; sellers list and sell—roles stay separate.',
    points: 'List & license (planned)\nBuy & acquire (planned)\nPrivate Hub stays private\nRoles enforce actions',
    tint: '#6F5CFF',
    glow: 'rgba(111,92,255,0.10)',
    artKey: 'exchange',
    ctaLabel: 'Ask about the roadmap',
    ctaHref: '#demo',
  },
  {
    name: 'PINIT Career',
    tagline: 'Roadmap · professional identity',
    body: 'Verified portfolios and professional identity built on protected work—future PINITHUB surface, not part of live Hub today.',
    points: 'Verified portfolios (planned)\nProfessional identity (planned)\nCredentials (planned)',
    tint: '#55E6FF',
    glow: 'rgba(85,230,255,0.08)',
    artKey: 'career',
    ctaLabel: 'Talk to our team',
    ctaHref: '#demo',
  },
];

export const DEFAULT_WHY_CARDS = [
  {
    kicker: 'Positioning',
    title: 'Evidence. Control. Accountability.',
    glow: 'rgba(85,230,255,0.08)',
    artKey: 'fragment',
    body: [
      'Customers do not wake up needing fingerprints or forensics jargon. They need to protect what they create, prove what they own, and respond when assets escape.',
      'PINITHUB is built as that control layer—with deeper mechanisms underneath when you need them.',
    ].join('\n'),
  },
  {
    kicker: 'Private first',
    title: 'Not every asset needs to be sold',
    glow: 'rgba(45,123,255,0.08)',
    artKey: 'horizon',
    body: [
      'Protect an asset privately inside PINITHUB without publishing it, listing it, or exposing it to a marketplace.',
      'Hub is your private workspace. Exchange is optional commerce—only when you choose.',
    ].join('\n'),
  },
  {
    kicker: 'Honesty',
    title: 'Ship what we claim',
    glow: 'rgba(111,92,255,0.08)',
    artKey: 'network',
    body: [
      'Available now vs Coming soon is labeled clearly so demos and procurement stay aligned.',
      'PinIT Hub is live. Exchange and Career extend the platform as they ship—not as brochure filler.',
    ].join('\n'),
  },
];

export const DEFAULT_CHOOSE_US = [
  {
    icon: 'Lock',
    title: 'Your workspace. Your assets. Your choice.',
    body: 'Protect assets privately without listing or selling them. Commerce is optional—never the default.',
    stat: 'Private by design',
  },
  {
    icon: 'Fingerprint',
    title: 'Proof that travels with the asset',
    body: 'Ownership evidence stays with the asset so later copies can be compared—when disputes or leaks happen.',
    stat: 'Evidence when it matters',
  },
  {
    icon: 'Share2',
    title: 'Accountable sharing',
    body: 'Share with access control and visibility—so “who still has this?” is answerable after a file leaves chat.',
    stat: 'Share with a trail',
  },
  {
    icon: 'Search',
    title: 'Investigation when something breaks',
    body: 'Compare assets and reconstruct activity for the moments storage products stop being enough.',
    stat: 'Leak response ready',
  },
  {
    icon: 'Building2',
    title: 'Built for assets that matter',
    body: 'Identity, workspace governance, encryption, and evidence trails for creators through enterprises.',
    stat: 'Enterprise-minded',
  },
  {
    icon: 'Map',
    title: 'Honest roadmap',
    body: 'Exchange commerce and Career are labeled Coming soon—so what you see in a demo matches what ships today.',
    stat: 'Procurement-safe',
  },
];

export const DEFAULT_INDUSTRIES = [
  { icon: 'Palette', name: 'Creators', useCase: 'Protect originals and prove authorship before work circulates.' },
  { icon: 'Megaphone', name: 'Agencies', useCase: 'Govern client deliverables with share control and revoke when work ends.' },
  { icon: 'Building', name: 'Enterprises', useCase: 'Keep sensitive digital assets under identity, access, and evidence.' },
  { icon: 'Camera', name: 'Photographers', useCase: 'Protect sets and track where shares travel after delivery.' },
  { icon: 'Radio', name: 'Media', useCase: 'Investigate leaked cuts with ownership evidence and share history.' },
  { icon: 'Baseline', name: 'Marketing', useCase: 'Control approved assets leaving the brand system.' },
  { icon: 'GraduationCap', name: 'Education', useCase: 'Protect course materials and investigate unauthorized redistribution.' },
  { icon: 'Compass', name: 'Design & architecture', useCase: 'Vault drawings and revisions with clearer ownership history.' },
  { icon: 'PenLine', name: 'Writers & publishers', useCase: 'Protect manuscripts and prove earlier drafts when disputes arise.' },
  { icon: 'Cpu', name: 'Technology', useCase: 'Govern sensitive docs, datasets, and deliverables with accountability.' },
  { icon: 'Landmark', name: 'Public sector', useCase: 'Strengthen custody-style trails for sensitive digital records.' },
  { icon: 'Code2', name: 'Product teams', useCase: 'Track shared packages and sensitive artifacts with access trails.' },
];

export const DEFAULT_ABOUT = {
  title: 'The company behind PINITHUB',
  lede: 'PINITHUB is developed by TheCareerTech Pvt. Ltd.—building a Digital Asset Intelligence platform that starts with protection, proof, and accountability.',
  body1:
    'We started from a practical failure mode: files escape, ownership is hard to prove, and investigation starts too late. PinIT Hub addresses that loop first.',
  body2:
    'Our commitment: ship what we claim, label what is roadmap, and grow Exchange and Career when those products are real.',
  hqLabel: 'THECAREERTECH PVT. LTD.',
};

export const DEFAULT_ABOUT_PILLARS = [
  { title: 'Honest product claims', body: 'Available now vs Coming soon is labeled so demos and procurement stay aligned.' },
  { title: 'Proof over storage', body: 'Protection, provenance, accountable sharing, and investigation—not another undifferentiated drive.' },
  { title: 'Private before commerce', body: 'Hub is the private workspace. Exchange is optional commerce when you choose.' },
  { title: 'Built in Bangalore', body: 'Developed by TheCareerTech Pvt. Ltd. with a focus on security and accountability.' },
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
      'We needed ownership proof before a sensitive campaign went out. PinIT Hub gave us a trail we could show legal—not another folder sync.',
    name: 'Ananya R.',
    role: 'Creative Operations Lead · Bengaluru, India',
    company: '',
    initials: 'AR',
    tint: '#55E6FF',
    rating: 5,
  },
  {
    quote:
      'Accountable sharing finally answered “who still has this?” when a deck leaked internally. Revoking access without hunting links saved us a day.',
    name: 'Rahul M.',
    role: 'IT Security Manager · Hyderabad, India',
    company: '',
    initials: 'RM',
    tint: '#2D7BFF',
    rating: 5,
  },
  {
    quote:
      'Investigation used to mean screenshots and guesswork. Comparing assets and reviewing share history felt built for accountability.',
    name: 'Kavya P.',
    role: 'Media Operations · Mumbai, India',
    company: '',
    initials: 'KP',
    tint: '#6F5CFF',
    rating: 5,
  },
  {
    quote:
      'We did not need another drive—we needed proof when assets leave the team. The protect-and-prove loop matched how we actually work.',
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
    question: 'What is PINITHUB?',
    answer:
      'PINITHUB is a Digital Asset Intelligence platform. PinIT Hub—available now—helps you protect originals, establish ownership evidence, share with accountability, detect misuse, and investigate what happened. PINIT Exchange and Career are on the roadmap.',
  },
  {
    question: 'Do my assets have to be listed or sold?',
    answer:
      'No. Hub is a private asset workspace. You can protect and manage assets without publishing, listing, or exposing them to a marketplace. Commerce through Exchange is optional and coming later.',
  },
  {
    question: 'How is this different from cloud storage?',
    answer:
      'Cloud drives store files. PINITHUB adds a control layer: protection at intake, ownership evidence, accountable sharing, monitoring when enabled, and investigation tools when something escapes.',
  },
  {
    question: 'What is available in PinIT Hub today?',
    answer:
      'Protect, prove, share, detect, and investigate—plus identity and org workspaces. Marketplace licensing, buy/sell checkout, and Career are not live products yet.',
  },
  {
    question: 'How will buyers and sellers work on Exchange?',
    answer:
      'When Exchange ships: buyers can browse, discover, and buy/license—and keep private assets in their own Hub—but cannot list or sell. Sellers can protect, list, and sell/license—but cannot buy. Roles determine marketplace actions.',
  },
  {
    question: 'Can we try it before committing?',
    answer:
      'Yes. Get started in Hub, or book a live demo focused on protect, share, and investigate—not a fictional marketplace tour.',
  },
];

export const DEFAULT_CTA = {
  headline: 'Protect what you create.',
  lede: 'Start in PinIT Hub—your private workspace for protection, proof, accountable sharing, and investigation. Ask us about Exchange as roadmap—we will not oversell it.',
  ctaPrimary: 'Talk to our team',
  ctaSecondary: 'Book a demo',
  footnote: 'No credit card required · Focused on what ships today',
};

export const DEFAULT_SITE_SETTINGS = {
  footerTagline:
    'PINITHUB — Digital Asset Intelligence. PinIT Hub is live for protect, prove, share, detect, and investigate. Exchange and Career are on the roadmap. Private workspace first—commerce only when you choose.',
  supportEmail: 'hello@pinithub.com',
  officeAddress: 'TheCareerTech Pvt. Ltd., Bangalore, India',
  responseTime: 'Under 1 business hour',
  demoLength: '30 minutes, tailored to your stack',
  newsletterLabel: 'Product updates',
  newsletterHint: 'Occasional. What shipped—and what is still roadmap.',
  copyrightName: 'PINITHUB · TheCareerTech Pvt. Ltd.',
  demoFormEnabled: true,
  announcement: '',
  announcementHref: '#demo',
  metaTitle: 'PINITHUB — Protect what you create. Prove what you own.',
  metaDescription:
    'PINITHUB is a Digital Asset Intelligence platform. Protect originals, prove ownership, share with accountability, detect misuse, and investigate—starting with PinIT Hub.',
  metaKeywords:
    'PINITHUB, PinIT Hub, digital asset intelligence, ownership evidence, encrypted vault, Smart Share, asset investigation',
  siteUrl: 'https://pinithub.com',
};

export const DEFAULT_NAV_LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Solutions', href: '#solutions' },
  { label: 'Security', href: '#security' },
  { label: 'Company', href: '#company' },
];

export const DEFAULT_FOOTER_LINKS: { column: string; label: string; href: string }[] = [
  ...['Protect', 'Prove', 'Share', 'Detect', 'Investigate'].map((label) => ({
    column: 'PinIT Hub',
    label,
    href: '#how-it-works',
  })),
  ...[
    { label: 'Private workspace', href: '#resources' },
    { label: 'PINIT Exchange (roadmap)', href: '#resources' },
    { label: 'PINIT Career (roadmap)', href: '#resources' },
    { label: 'Book a Demo', href: '#demo' },
    { label: 'Get started', href: 'https://pinit-dna.vercel.app/register/account-type' },
  ].map((row) => ({ column: 'Platform', ...row })),
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
    key: 'problem',
    index: '01',
    label: 'The problem',
    title: 'Digital assets move faster than their proof.',
    lede: 'Files scatter. Ownership gets hard to prove. Sharing creates blind spots. Misuse is found too late. PINITHUB closes that gap.',
  },
  {
    key: 'lifecycle',
    index: '02',
    label: 'How it works',
    title: 'Protect → Prove → Share → Detect → Investigate',
    lede: 'One clear lifecycle for every asset. Licensing and monetization via Exchange are Coming soon—not sold as live today.',
  },
  {
    key: 'features',
    index: '03',
    label: 'Capabilities',
    title: 'One control layer around every asset',
    lede: 'Benefit first. Mechanisms underneath. Built for creators, teams, and organizations that need evidence—not another drive.',
  },
  {
    key: 'chooseUs',
    index: '04',
    label: 'Why PINITHUB',
    title: 'Built for assets that matter',
    lede: 'Private workspace, ownership evidence, accountable sharing, and investigation—with an honest roadmap for commerce.',
  },
  {
    key: 'ecosystem',
    index: '05',
    label: 'Platform',
    title: 'One platform. Multiple ways to use it.',
    lede: 'Hub is your private asset workspace—available now. Exchange and Career extend the platform when they ship.',
  },
  {
    key: 'industries',
    index: '06',
    label: 'Who it is for',
    title: 'Same need. Different assets.',
    lede: 'Creators, agencies, enterprises, and media teams all need protection, proof, and accountability.',
  },
  {
    key: 'why',
    index: '07',
    label: 'Principles',
    title: 'Evidence. Control. Accountability.',
    lede: 'Lead with outcomes customers understand. Keep technical depth available without making it the first sentence.',
  },
  {
    key: 'about',
    index: '08',
    label: 'Company',
    title: 'The company behind PINITHUB',
    lede: 'Developed by TheCareerTech Pvt. Ltd., Bangalore—shipping Hub first, with Exchange and Career on the roadmap.',
  },
  {
    key: 'testimonials',
    index: '09',
    label: 'Voices',
    title: 'What teams in India are saying',
    lede: 'Permissioned feedback from teams using PinIT Hub—no company names, no inflated claims.',
  },
  {
    key: 'faq',
    index: '10',
    label: 'Questions',
    title: 'Straight answers',
    lede: 'What is live, what is private, what is roadmap—and how buyers and sellers will differ when Exchange ships.',
  },
  {
    key: 'demo',
    index: '11',
    label: 'See it live',
    title: 'See PINITHUB in action',
    lede: 'Walk protect, share, and investigate on real scenarios—and ask candidly about the roadmap.',
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
