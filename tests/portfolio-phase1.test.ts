import {
  isPubliclyReadable,
  parseEditorBody,
  slugifyName,
  stripPublicSecrets,
} from '../src/services/portfolio/portfolio-document';

describe('portfolio phase 1 ownership helpers', () => {
  test('slugify matches Exchange (letters and numbers only)', () => {
    expect(slugifyName('Ashwitha Reddy')).toBe('ashwithareddy');
  });

  test('public endpoint rules: draft never public', () => {
    expect(isPubliclyReadable('DRAFT', 'public')).toBe(false);
    expect(isPubliclyReadable('PUBLISHED', 'private')).toBe(false);
    expect(isPubliclyReadable('PUBLISHED', 'unlisted')).toBe(true);
    expect(isPubliclyReadable('PUBLISHED', 'public')).toBe(true);
  });

  test('collections become projects with vault references, not JSON blobs', () => {
    const parsed = parseEditorBody({
      project_groups: [{
        id: 'col1',
        title: 'Jewellery',
        vault_ids: ['vault-a', 'vault-b'],
      }],
    });
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0].vaultIds).toEqual(['vault-a', 'vault-b']);
    expect(parsed.projects[0].slug).toBe('jewellery');
  });

  test('public strip removes owner vault ids', () => {
    const stripped = stripPublicSecrets({
      owner_view: true,
      projects: [{ title: 'A', vault_ids: ['secret'] }],
    });
    expect(stripped.owner_view).toBeUndefined();
    expect((stripped.projects as Array<{ vault_ids?: string[] }>)[0].vault_ids).toBeUndefined();
  });
});
