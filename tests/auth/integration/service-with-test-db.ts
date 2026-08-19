/**
 * Loads biometricAuthService with DATABASE_URL pointed at DATABASE_URL_TEST,
 * so the ambient Prisma singleton (src/lib/prisma.ts, imported transitively)
 * connects to the disposable test database instead of the real one.
 *
 * Uses require() (not a static import) so the env override below is guaranteed
 * to run before the module graph is evaluated — a static import would be
 * hoisted by some toolchains and could race the env assignment.
 */
if (process.env['DATABASE_URL_TEST']) {
  process.env['DATABASE_URL'] = process.env['DATABASE_URL_TEST'];
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = require('../../../src/services/auth/biometric-auth.service') as
  typeof import('../../../src/services/auth/biometric-auth.service');

export const biometricAuthService = mod.biometricAuthService;
export const DuplicateFaceError = mod.DuplicateFaceError;
export const DuplicateVoiceError = mod.DuplicateVoiceError;
