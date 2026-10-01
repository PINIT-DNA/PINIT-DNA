import { twoLines } from '../../src/services/intelligence/living-asset-brief-text';

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
});
