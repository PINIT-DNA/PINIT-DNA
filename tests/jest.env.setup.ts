/**
 * The passkey ("fingerprint") step ships as a placeholder by default
 * (config.webauthn.requirePasskey === false) so the flow works across domains.
 * Tests must still exercise the REAL WebAuthn path — the placeholder is a
 * deployment convenience, not the behaviour we want to regress-protect.
 */
process.env.WEBAUTHN_REQUIRE_PASSKEY = 'true';
