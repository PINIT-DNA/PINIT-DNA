import { twoLines, redactSensitiveTokens, looksLikeShreddedBrief } from '../../src/services/intelligence/living-asset-brief-text';

describe('living asset two-line brief', () => {
  it('keeps only the first two sentences', () => {
    const [a, b] = twoLines(
      'I show palm trees beside a house on the water. Green water fills the foreground. Extra sentence should be dropped.',
      'fallback one',
      'fallback two',
    );
    expect(a).toBe('I show palm trees beside a house on the water.');
    expect(b).toBe('Green water fills the foreground.');
  });

  it('does not turn normal headings into [id] tokens', () => {
    const kept = redactSensitiveTokens(
      'CHAPTER 4: SOCIAL MEDIA MARKETING. Social media helps businesses connect with customers.',
    );
    expect(kept).toContain('SOCIAL MEDIA MARKETING');
    expect(kept).not.toMatch(/\[id\]/);
  });

  it('redacts digit-heavy identifiers', () => {
    expect(redactSensitiveTokens('Aadhaar 1234 5678 9012 on file')).toContain('[number]');
  });

  it('treats [id] soup as a shredded brief', () => {
    expect(looksLikeShreddedBrief('A [id] ON [id] [id] MEDIA [id] BY [id]')).toBe(true);
    expect(looksLikeShreddedBrief('I am an internship report about social media marketing.')).toBe(false);
  });
});
