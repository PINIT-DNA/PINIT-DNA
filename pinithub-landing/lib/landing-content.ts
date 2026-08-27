/**
 * Enterprise landing narrative — data-driven public marketing content.
 * Independent of CMS seed tables so the IA can evolve without Prisma migrations.
 * Demo booking / newsletter still use existing APIs.
 */

export type StatusKind = 'available' | 'roadmap' | 'partial';

export const LANDING_NAV = [
  { id: 'platform', label: 'Platform', href: '#platform' },
  { id: 'workflow', label: 'How it works', href: '#workflow' },
  { id: 'capabilities', label: 'Capabilities', href: '#capabilities' },
  { id: 'security', label: 'Security', href: '#security' },
  { id: 'use-cases', label: 'Use cases', href: '#use-cases' },
  { id: 'status', label: 'Roadmap', href: '#status' },
] as const;

export const LANDING_HERO = {
  eyebrow: 'Digital Asset Intelligence Platform',
  headline: 'Protect what you create.\nProve what you own.',
  lede:
    'PINITHUB is a control layer for digital assets—protect originals, establish ownership evidence, share with accountability, detect misuse, and investigate when something escapes.',
  primaryCta: 'Get started',
  secondaryCta: 'Explore the platform',
  tertiaryCta: 'Request a demo',
  loop: ['Protect', 'Prove', 'Share', 'Detect', 'Investigate'] as const,
  differentiator: 'Not another cloud drive — a control layer for what happens to your assets.',
};

export const PLATFORM_LOOP = {
  index: '01',
  label: 'Platform at a glance',
  title: 'One control layer around every asset',
  lede:
    'PinIT Hub — available now — connects protection, ownership evidence, accountable sharing, monitoring, and investigation in a single workspace.',
  pillars: [
    {
      title: 'Protect',
      body: 'Secure the original when an asset enters your workspace.',
      tint: '#6D5EF0',
    },
    {
      title: 'Prove',
      body: 'Establish ownership evidence that can be compared later.',
      tint: '#E879F9',
    },
    {
      title: 'Share',
      body: 'Grant access without losing visibility or control.',
      tint: '#A855F7',
    },
    {
      title: 'Detect',
      body: 'Surface copies and changes against protected assets.',
      tint: '#14D991',
    },
    {
      title: 'Investigate',
      body: 'Turn a suspicious copy into an evidence trail.',
      tint: '#F5B942',
    },
  ],
};

export const WORKFLOW_STEPS = [
  {
    key: 'Protect',
    status: 'available' as StatusKind,
    headline: 'Secure the original at intake',
    body: 'Protection begins when an asset is created or uploaded—before it circulates across teams, devices, and platforms.',
  },
  {
    key: 'Prove',
    status: 'available' as StatusKind,
    headline: 'Create evidence that travels with the asset',
    body: 'Persistent identity and provenance support later comparison—beyond filename and basic metadata.',
  },
  {
    key: 'Share',
    status: 'available' as StatusKind,
    headline: 'Share without losing accountability',
    body: 'Time-bound, access-controlled sharing with activity visibility and revocation when access should end.',
  },
  {
    key: 'Detect',
    status: 'available' as StatusKind,
    headline: 'Find what changed or escaped',
    body: 'Compare discovered copies against protected assets so issues surface earlier in the lifecycle.',
  },
  {
    key: 'Investigate',
    status: 'available' as StatusKind,
    headline: 'Build a usable evidence trail',
    body: 'Inspect provenance, reconstruct activity, and prepare an investigation narrative when misuse appears.',
  },
];

export const EVIDENCE_FLOW = {
  index: '02',
  label: 'From asset to evidence',
  title: 'How an asset gains identity, control, and a trail',
  lede:
    'Cloud storage stops at “file saved.” PINITHUB continues through proof, access, detection, and investigation.',
  stages: [
    { label: 'Asset enters Hub', detail: 'Upload or protect at publish time' },
    { label: 'Protected original', detail: 'Encrypted storage in Vault' },
    { label: 'Ownership evidence', detail: 'Fingerprint + provenance record' },
    { label: 'Controlled share', detail: 'Access rules + activity signals' },
    { label: 'Detection & review', detail: 'Compare copies · investigate' },
  ],
};

export const CAPABILITY_SECTIONS = {
  dna: {
    id: 'dna',
    index: '03',
    label: 'Ownership evidence',
    title: 'Proof that travels with the asset',
    lede:
      'When a copy appears later, teams need more than a filename. PINITHUB creates multi-layer evidence that can be compared against discovered files.',
    points: [
      'Benefit first: know what you own and what matches later copies',
      'Mechanism underneath: multi-layer digital fingerprinting and provenance',
      'Built for disputes and leak response—not decorative metadata',
    ],
    status: 'available' as StatusKind,
    mockupTitle: 'Asset evidence panel',
  },
  vault: {
    id: 'vault',
    index: '04',
    label: 'Encrypted Vault',
    title: 'Secure the original — privately',
    lede:
      'Vault stores protected originals inside PinIT Hub. Assets do not need to be listed or sold to stay protected.',
    points: [
      'Encrypted originals as part of the protection workflow',
      'Private workspace by default — commerce is optional',
      'Certificates and authenticity sit with the asset, not a disconnected silo',
    ],
    status: 'available' as StatusKind,
    mockupTitle: 'Vault inventory',
  },
  share: {
    id: 'smart-share',
    index: '05',
    label: 'Smart Share',
    title: 'Share without losing control',
    lede:
      'Once a file leaves chat, most teams cannot answer who still has access. Smart Share keeps sharing accountable.',
    points: [
      'Access-controlled links with expiry and revoke',
      'Activity visibility when accountability matters',
      'Designed for handoffs that still need governance',
    ],
    status: 'available' as StatusKind,
    mockupTitle: 'Share access console',
  },
  monitoring: {
    id: 'monitoring',
    index: '06',
    label: 'Monitoring',
    title: 'Find what changed or escaped',
    lede:
      'Monitoring helps surface re-uploads and public appearances against protected asset evidence—when enabled for your workspace.',
    points: [
      'Compare discovered material to protected fingerprints',
      'Earlier signal than waiting for a manual leak report',
      'Scoped to configured sources—not a claim of monitoring the entire internet',
    ],
    status: 'available' as StatusKind,
    mockupTitle: 'Detection feed',
  },
  investigation: {
    id: 'investigation',
    index: '07',
    label: 'Investigation',
    title: 'Turn a suspicious copy into evidence',
    lede:
      'When something looks wrong, investigation tools help compare assets, review activity, and assemble a trail teams can act on.',
    points: [
      'Side-by-side comparison against protected originals',
      'Share and access history as part of the narrative',
      'Built for accountability—not screenshots and guesswork',
    ],
    status: 'available' as StatusKind,
    mockupTitle: 'Investigation workspace',
  },
};

export const SECURITY = {
  index: '08',
  label: 'Enterprise security',
  title: 'Built for assets that matter',
  lede:
    'Identity, encryption, access control, and evidence trails—oriented for creators through organizations without overclaiming every enterprise IdP feature.',
  items: [
    {
      title: 'Identity',
      body: 'Strong account identity and controlled entry into the workspace that holds your assets.',
    },
    {
      title: 'Encryption',
      body: 'Protected originals stored as part of the Hub protection workflow.',
    },
    {
      title: 'Access control',
      body: 'Share with rules, visibility, and revoke—so access is not forever by default.',
    },
    {
      title: 'Audit & evidence',
      body: 'Activity and comparison trails that support investigation when misuse appears.',
    },
    {
      title: 'Workspaces',
      body: 'Organization workspaces for shared governance—teams and policy-minded control.',
    },
    {
      title: 'Honest scope',
      body: 'SSO/SCIM and advanced IdP automation remain roadmap—not marketed as shipped here.',
    },
  ],
};

export const USE_CASES = {
  index: '09',
  label: 'Who it is for',
  title: 'Same failure modes. Different assets.',
  lede: 'Teams that create valuable digital work need protection, proof, and accountability—not another folder sync.',
  items: [
    { name: 'Creators', useCase: 'Protect originals and prove authorship before work circulates.' },
    { name: 'Agencies', useCase: 'Govern client deliverables with share control and revoke when work ends.' },
    { name: 'Enterprises', useCase: 'Keep sensitive assets under identity, access, and evidence.' },
    { name: 'Media & marketing', useCase: 'Investigate leaks and control approved assets leaving the brand system.' },
    { name: 'Design & architecture', useCase: 'Vault drawings and revisions with clearer ownership history.' },
    { name: 'Education & public sector', useCase: 'Protect materials and strengthen custody-style digital trails.' },
  ],
};

export const PRODUCT_STATUS = {
  index: '10',
  label: 'Product status',
  title: 'Available now vs roadmap',
  lede:
    'PinIT Hub is live for the protect → investigate loop. Exchange and Career extend the platform when they ship—clearly labeled.',
  available: [
    'PinIT Hub private workspace',
    'Protect & encrypted Vault',
    'Ownership evidence (DNA / provenance)',
    'Smart Share with revoke',
    'Monitoring when enabled',
    'Investigation & comparison',
    'Identity & org workspaces',
  ],
  roadmap: [
    'PINIT Exchange marketplace checkout',
    'Licensing & royalties engine',
    'Buyer / seller role marketplace actions',
    'PINIT Career verified portfolios',
    'SSO / SCIM enterprise IdP suite',
  ],
  roles: {
    note: 'When Exchange ships, roles determine marketplace actions—not just hidden buttons.',
    buyer: ['Browse & discover', 'Buy / license', 'Private Hub workspace', 'Cannot list or sell'],
    seller: ['Protect & list', 'Sell / license', 'Private Hub workspace', 'Cannot buy on marketplace'],
  },
};

export const FINAL_CTA = {
  title: 'Protect your digital assets',
  lede:
    'Start in PinIT Hub—your private workspace for protection, proof, accountable sharing, and investigation. Request a demo if you want a guided walkthrough of what ships today.',
  primary: 'Get started',
  secondary: 'Request a demo',
};

export const LANDING_FOOTER = {
  tagline:
    'PINITHUB — Digital Asset Intelligence. PinIT Hub is live for protect, prove, share, detect, and investigate. Exchange and Career are on the roadmap.',
  columns: [
    {
      title: 'Platform',
      links: [
        { label: 'How it works', href: '#workflow' },
        { label: 'Capabilities', href: '#capabilities' },
        { label: 'Security', href: '#security' },
        { label: 'Roadmap', href: '#status' },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'Request a demo', href: '#demo' },
        { label: 'Get started', href: 'signup' },
        { label: 'Log in', href: 'login' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { label: 'Privacy', href: '#privacy' },
        { label: 'Terms', href: '#terms' },
        { label: 'Cookies', href: '#cookies' },
      ],
    },
  ],
  copyright: 'PINITHUB · TheCareerTech Pvt. Ltd., Bangalore',
};
