import { twoLines, redactSensitiveTokens, looksLikeShreddedBrief, describeFromPixelStats } from '../../src/services/intelligence/living-asset-brief-text';

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

  it('describes an outdoor scene from pixel stats', () => {
    const width = 8;
    const height = 8;
    const rgb = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        if (y < 3) {
          rgb[i] = 80; rgb[i + 1] = 140; rgb[i + 2] = 220;
        } else {
          rgb[i] = 40; rgb[i + 1] = 140; rgb[i + 2] = 50;
        }
      }
    }
    const hint = describeFromPixelStats({ width, height, channels: 3, rgb });
    expect(hint.line1.toLowerCase()).toMatch(/outdoor|landscape|sky|photograph/);
    expect(hint.line2.toLowerCase()).toMatch(/sky|green|plant|tree|colour|color|daylight/);
  });
});
