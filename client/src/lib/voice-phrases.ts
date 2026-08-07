/** Enterprise voice enrollment phrases — one is chosen at random per session. */
export const VOICE_PHRASES = [
  'My digital identity belongs only to me.',
  'Pinit HUB secures my original content.',
  'I authorize this biometric enrollment today.',
  'This voice confirms my unique PINIT identity.',
  'Only I can access my protected digital vault.',
  'My face, voice, and fingerprint are my keys.',
  'I verify my identity for Pinit HUB access.',
  'This enrollment protects my creative work.',
] as const;

export function pickRandomVoicePhrase(): string {
  const idx = Math.floor(Math.random() * VOICE_PHRASES.length);
  return VOICE_PHRASES[idx] ?? VOICE_PHRASES[0];
}
