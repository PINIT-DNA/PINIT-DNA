/**
 * The passkey ("fingerprint") step ships as a placeholder by default
 * (config.webauthn.requirePasskey === false) so the flow works across domains.
 * Tests must still exercise the REAL WebAuthn path — the placeholder is a
 * deployment convenience, not the behaviour we want to regress-protect.
 */
process.env.WEBAUTHN_REQUIRE_PASSKEY = 'true';

/**
 * Jest runs one worker per core-ish; sharp/libvips is multi-threaded on its own, so
 * the two multiply into heavy oversubscription. One libvips thread per worker keeps
 * image-heavy suites fast under parallel runs (production keeps sharp's default).
 */
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('sharp').concurrency(1);
} catch {
  /* sharp not installed in this environment — nothing to tune */
}
