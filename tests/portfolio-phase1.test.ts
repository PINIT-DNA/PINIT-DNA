import {
  isPubliclyReadable,
  parseEditorBody,
  stripPublicSecrets,
} from '../src/services/portfolio/portfolio-document';

describe('portfolio phase 1 ownership helpers', () => {
  test('empty slug in the editor is ignored so a real URL is not replaced with creator', () => {
    const parsed = parseEditorBody({ slug: '', headline: 'Hi' });
    expect(parsed.slug).toBeUndefined();
    expect(parsed.profile.headline).toBe('Hi');
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
      certifications: [{ title: 'CV', media_vault_ids: ['secret'], vault_id: 'secret' }],
    });
    expect(stripped.owner_view).toBeUndefined();
    expect((stripped.projects as Array<{ vault_ids?: string[] }>)[0].vault_ids).toBeUndefined();
    expect((stripped.certifications as Array<{ vault_id?: string }>)[0].vault_id).toBeUndefined();
  });

  test('documents from vault become certificates with a vault pointer', () => {
    const parsed = parseEditorBody({
      certifications: [{
        title: 'CV 2026',
        issuer: 'Self',
        vault_id: 'vault-cv',
      }],
    });
    expect(parsed.certificates).toHaveLength(1);
    expect(parsed.certificates[0].title).toBe('CV 2026');
    expect(parsed.certificates[0].documentKey).toBe('vault-cv');
  });
});
