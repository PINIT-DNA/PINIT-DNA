import { readFileSync } from 'fs';
import { join } from 'path';
import {
  cleanLinkInput,
  computeProfileStrength,
  emptySocialLinks,
  isValidLink,
  linkHref,
  normalizeSocialLinks,
  readStoredSocialLinks,
  STRENGTH_ITEMS,
  type StrengthInput,
} from '../../src/services/profile/profile-strength';

const blank = (): StrengthInput => ({
  fullName: 'PINIT User',
  email: '',
  phone: '',
  country: '',
  bio: '',
  organization: '',
  jobTitle: '',
  hasPhoto: false,
  portfolioPublished: false,
  identityOnFile: false,
  links: emptySocialLinks(),
});

const full = (): StrengthInput => ({
  fullName: 'Ashwitha Reddy',
  email: 'ashwitha@example.com',
  phone: '+91 98765 43210',
  country: 'India',
  bio: 'I build tools that help creators protect and prove ownership of their work.',
  organization: 'Pinit',
  jobTitle: 'Engineer',
  hasPhoto: true,
  portfolioPublished: true,
  identityOnFile: true,
  links: { ...emptySocialLinks(), linkedin: 'ashwitha-reddy', github: 'ashwitha', instagram: 'ash.creates', website: 'ashwitha.dev' },
});

describe('profile strength', () => {
  it('weights sum to 100', () => {
    expect(STRENGTH_ITEMS.reduce((s, i) => s + i.weight, 0)).toBe(100);
  });

  it('scores an empty account at 0 and a full one at 100', () => {
    const empty = computeProfileStrength(blank());
    expect(empty.percent).toBe(0);
    expect(empty.tier).toBe('starting');
    expect(empty.missingRequired).toEqual(['name', 'email', 'phone', 'country']);

    const done = computeProfileStrength(full());
    expect(done.percent).toBe(100);
    expect(done.tier).toBe('complete');
    expect(done.tierLabel).toBe('Profile complete');
    expect(done.nextStep).toBeNull();
    expect(done.groups.map((g) => [g.id, g.earned, g.max])).toEqual([
      ['about', 45, 45], ['work', 15, 15], ['links', 25, 25], ['verification', 15, 15],
    ]);
  });

  it('removes exactly each item weight when that item is missing', () => {
    const cases: Array<[Partial<StrengthInput>, number]> = [
      [{ hasPhoto: false }, 10],
      [{ fullName: 'PINIT User' }, 5],
      [{ email: 'not-an-email' }, 10],
      [{ phone: '12345' }, 5],
      [{ country: '  ' }, 5],
      [{ bio: 'Too short' }, 10],
      [{ organization: '' }, 5],
      [{ jobTitle: '' }, 5],
      [{ portfolioPublished: false }, 5],
      [{ identityOnFile: false }, 15],
    ];
    for (const [patch, weight] of cases) {
      expect(computeProfileStrength({ ...full(), ...patch }).percent).toBe(100 - weight);
    }
  });

  it('counts a skipped link as done, but not an invalid one', () => {
    const base = full();
    const skipped = computeProfileStrength({ ...base, links: { ...base.links, github: '', skipped: ['github'] } });
    expect(skipped.percent).toBe(100);
    expect(skipped.items.find((i) => i.id === 'github')).toMatchObject({ done: true, skipped: true });

    const bad = computeProfileStrength({ ...base, links: { ...base.links, github: 'bad name!' } });
    expect(bad.percent).toBe(95);
  });

  it('uses tier thresholds 40 / 70 / 100', () => {
    const at = (identity: boolean, photo: boolean, links: boolean) => computeProfileStrength({
      ...blank(),
      fullName: 'A B', email: 'a@b.co', phone: '9876543210', country: 'India', // 25
      identityOnFile: identity, // +15
      hasPhoto: photo, // +10
      links: links ? { ...emptySocialLinks(), skipped: ['linkedin', 'github', 'instagram', 'website'] } : emptySocialLinks(), // +25
    });
    expect(at(false, false, false)).toMatchObject({ percent: 25, tier: 'starting' });
    expect(at(true, false, false)).toMatchObject({ percent: 40, tier: 'progress' });
    expect(at(true, true, true)).toMatchObject({ percent: 75, tier: 'almost' });
  });

  it('suggests the missing item with the best weight for the effort', () => {
    // Photo (10 / effort 1) beats identity (15 / 3) and bio (10 / 2).
    expect(computeProfileStrength(blank()).nextStep?.id).toBe('photo');
    const s = computeProfileStrength({ ...full(), identityOnFile: false, bio: '' });
    expect(s.nextStep?.id).toBe('bio'); // bio 10/2 = 5 ties identity 15/3 = 5; earlier in the list wins
    expect(computeProfileStrength({ ...full(), identityOnFile: false, portfolioPublished: false }).nextStep?.id).toBe('identity');
  });
});

describe('social links', () => {
  it('keeps a full link and expands a bare name', () => {
    expect(cleanLinkInput('linkedin', 'https://www.linkedin.com/in/ashwitha-reddy/')).toBe('https://linkedin.com/in/ashwitha-reddy');
    expect(cleanLinkInput('linkedin', 'https://linkedin.com/company/pinit')).toBe('https://linkedin.com/company/pinit');
    expect(cleanLinkInput('github', 'https://github.com/ashwitha2004')).toBe('https://github.com/ashwitha2004');
    expect(cleanLinkInput('github', 'ashwitha2004')).toBe('https://github.com/ashwitha2004');
    expect(cleanLinkInput('instagram', 'https://instagram.com/ash.creates?igsh=abc')).toBe('https://instagram.com/ash.creates');
    expect(cleanLinkInput('website', 'https://ashwitha.dev/')).toBe('https://ashwitha.dev');
  });

  it('accepts valid links and drops a skip for a filled link', () => {
    const r = normalizeSocialLinks({
      linkedin: 'https://linkedin.com/in/ashwitha',
      github: 'ashwitha2004',
      instagram: '',
      website: 'ashwitha.dev/work',
      skipped: ['github', 'instagram', 'nonsense'],
      extra: [{ label: 'Behance', url: 'https://behance.net/ash' }, { label: '', url: '' }, { url: 'https://youtube.com/@pinit' }],
      showOnPortfolio: false,
    });
    expect(r).toEqual({
      ok: true,
      value: {
        linkedin: 'https://linkedin.com/in/ashwitha', github: 'https://github.com/ashwitha2004', instagram: '', website: 'https://ashwitha.dev/work',
        skipped: ['instagram'],
        extra: [{ label: 'Behance', url: 'https://behance.net/ash' }, { label: 'Youtube', url: 'https://youtube.com/@pinit' }],
        showOnPortfolio: false,
      },
    });
  });

  it.each([
    [{ github: 'has spaces' }, 'GitHub'],
    [{ website: 'javascript:alert(1)' }, 'Website'],
    [{ website: 'notadomain' }, 'Website'],
    [{ website: 'evil.com/"><script>' }, 'Website'],
    [{ linkedin: 42 }, 'LinkedIn'],
    [{ extra: [{ label: 'X', url: 'javascript:alert(1)' }] }, 'Enter a link'],
    [{ showOnPortfolio: 'yes' }, 'showOnPortfolio'],
  ])('rejects %j', (input, message) => {
    const r = normalizeSocialLinks(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  it('caps extra links', () => {
    const extra = Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, url: `site${i}.com` }));
    expect(normalizeSocialLinks({ extra }).ok).toBe(false);
  });

  it('only builds https links', () => {
    expect(linkHref('linkedin', 'https://linkedin.com/in/ash')).toBe('https://linkedin.com/in/ash');
    expect(linkHref('github', 'https://github.com/ash/repo')).toBe('https://github.com/ash/repo');
    expect(linkHref('instagram', 'ash')).toBe('https://www.instagram.com/ash');
    expect(linkHref('website', 'ash.dev/x')).toBe('https://ash.dev/x');
  });

  it('reads stored values without trusting them', () => {
    expect(readStoredSocialLinks(null)).toEqual(emptySocialLinks());
    expect(readStoredSocialLinks('junk')).toEqual(emptySocialLinks());
    const r = readStoredSocialLinks({ github: 'bad name', website: 'ok.dev', skipped: ['website', 'linkedin'], extra: [{ label: 'x', url: 'javascript:1' }] });
    expect(r).toMatchObject({ github: '', website: 'https://ok.dev', skipped: ['linkedin'], extra: [] });
  });
});

describe('client copy', () => {
  it('is byte-identical to the server module so the live score matches the saved one', () => {
    const root = join(__dirname, '..', '..');
    const norm = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
    expect(norm('client/src/lib/profile-strength.ts')).toBe(norm('src/services/profile/profile-strength.ts'));
  });
});

describe('social links accept a username or a link to their own site only', () => {
  it.each([
    ['instagram', 'ashwitha.creates', 'https://instagram.com/ashwitha.creates'],
    ['instagram', '@ashwitha_r', 'https://instagram.com/ashwitha_r'],
    ['instagram', 'https://www.instagram.com/ashwitha.creates/?igsh=abc', 'https://instagram.com/ashwitha.creates'],
    ['github', 'ashwitha2004', 'https://github.com/ashwitha2004'],
    ['linkedin', 'kavvam-ashwitha', 'https://linkedin.com/in/kavvam-ashwitha'],
    ['linkedin', 'https://in.linkedin.com/in/ashwitha/', 'https://in.linkedin.com/in/ashwitha'],
  ] as const)('%s: %s', (key, raw, expected) => {
    const cleaned = cleanLinkInput(key, raw);
    expect(cleaned).toBe(expected);
    expect(isValidLink(key, cleaned)).toBe(true);
  });

  it.each([
    ['instagram', 'https://evil.com/phish'],
    ['instagram', 'bad name!'],
    ['github', 'https://gitlab.com/someone'],
    ['linkedin', 'https://linkedin.com/feed'],
  ] as const)('rejects %s: %s', (key, raw) => {
    expect(isValidLink(key, cleanLinkInput(key, raw))).toBe(false);
  });
});
