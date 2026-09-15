# PINIT HUB Biometric Auth Rebuild — Isolated Module

**Status: implemented and verified locally, not yet committed/pushed.**

> **Part 2 — biometric data storage / DB design** is documented in the
> "Data storage design" section at the end of this file (template versioning,
> quality/status/key-version metadata, granular audit events, and the
> similarity-distance leak fix).

Scope was strictly the biometric-auth module — no Vault, DNA engine, Assets,
Certificates, Exchange, Marketplace, Monitoring, Investigations, Reports,
Notifications, Admin, or unrelated DB tables/routes/UI were touched. No
existing biometric database records were read, modified, or deleted. The
existing UI (colors, layout, step cards, wording, animations) was not
redesigned — only backend orchestration and a few client call-sites changed.

## Implementation outcome

All items below from the original plan were implemented as designed and
verified (`tsc --noEmit` clean on backend + client; `tests/auth` suite: 88
passed, 0 failed, 18 skipped [DB-dependent integration tests, which skip
cleanly without `DATABASE_URL_TEST`]; live end-to-end pass against the running
local dev database — new face registers, duplicate face rejected generically,
two concurrent registrations of the same face resolve to exactly one account
against real Postgres, correct-face login succeeds, wrong-face login denied).

**Files changed:**
- `src/services/auth/biometric-auth.service.ts` — `register()` restructured
- `src/services/auth/biometric-matching.service.ts` — voice-duplicate primitives added
- `src/services/auth/webauthn.service.ts` — `attachPendingPasskey` generalized to run inside a transaction
- `src/services/auth/webauthn-store.ts` — generalized to accept an optional transaction client
- `src/api/controllers/face-auth.controller.ts` — stopped forwarding leaked `shortId`
- `client/src/lib/face-api-client.ts` — dropped the shortId-interpolation branch
- `client/src/pages/auth/RegistrationFlow.tsx` — removed the Supabase raw-face-image upload
- `client/src/pages/auth/LoginFlow.tsx` — removed the Supabase login-timestamp write
- `client/src/components/auth/FaceAuth.tsx` — guardrail comment only (no functional change needed)
- New tests: `tests/auth/voice-match-gate.test.ts`, `tests/auth/webauthn-ownership-fix.test.ts`,
  `tests/auth/duplicate-message-generic.test.ts`, `tests/auth/integration/*` (7 files)

**One real, pre-existing, out-of-scope finding surfaced during live verification:**
any two accounts registered without a device fingerprint collide on the
existing `FingerprintTemplate.templateHash` unique constraint, because the
fingerprint-proxy derivation falls back to the identical literal
`device:unknown` for both. Not something this rebuild's scope covered (it's
unrelated to face/voice duplicate detection) — worth a follow-up decision.

Three real test accounts were created against the live dev database during
verification (`PINIT-E9YE586A`, `PINIT-YKLZUBYL`, `PINIT-TUCJPQRN`,
`fullName: "PINIT User"`) — left in place, not deleted.

---

## Context — defects this rebuild fixes

The biometric register/login flow worked, but had real, confirmed defects
that undermined the "1 face = 1 account" / "no partial accounts" guarantees
the product requires:

1. **TOCTOU race condition**: the face-duplicate check (`findMatchingFace`) ran outside any lock/transaction. Two concurrent registrations with the same face could both see "no match" and both create accounts.
2. **Orphan-account bug**: `attachPendingPasskey` (binds the WebAuthn credential to the new user) ran **after** the User/BiometricIdentity/FaceTemplate transaction had already committed. If it failed, you got an orphaned account with no credential.
3. **No voice duplicate check existed at all** — "one voice = one account" was not enforced, despite a `voiceDuplicate` threshold already sitting unused in config.
4. **WebAuthn ownership check bug**: `credentialIdOwnedByOtherUser` queried a stale, unenforced `User.webauthnCredentialId` field instead of the authoritative `WebAuthnCredential` table.
5. **Duplicate-registration response leaked identity**: on a face-duplicate hit, the API returned the *other* user's `shortId` in the 409 body, and the client interpolated it into a message shown on screen — a direct account-enumeration leak.
6. **Client-side biometric data left the backend's control entirely**: `RegistrationFlow.tsx`/`LoginFlow.tsx` called `client/src/lib/identity-store.ts`, which wrote the raw base64 JPEG enrollment frame (register) and login timestamps (login) straight from the browser to a public Supabase table (`hoid_identities`) authenticated only by a public anon key — bypassing the backend's encryption entirely. Nothing else in the app read this data back.

**Decisions confirmed with the product owner before implementation:**
- Kept the existing **real** WebAuthn implementation for the "Fingerprint" step as-is (it already does cryptographic attestation/assertion verification via `@simplewebauthn/server` — no dummy/simulated mode was added). Only the ownership-check bug in it was fixed.
- Removed **both** `identity-store.ts` calls (`storeIdentity()` in `RegistrationFlow.tsx` and `touchLastLogin()` in `LoginFlow.tsx`) — no biometric-auth data is written to the client-authenticated public Supabase table anymore.
- Kept the standalone `/face-auth` pathway (`FaceAuth.tsx`/`FaceLoginPage.tsx`) working against the new backend contract — verified it already only reads `success`/`matched`/`message`/HTTP status from responses (never `shortId`), so it needed no functional change, just a guardrail comment.

Registration already followed the required Face → Fingerprint(WebAuthn) →
Voice order (`RegistrationFlow.tsx`'s `ORDER` array) and login was already
strictly 1:1 (`verifyClaimedFace`, never ranks a gallery) — both confirmed
correct going in, not restructured.

---

## Design

### 1. Race-condition fix: Postgres advisory lock inside one transaction

**Chosen over `SERIALIZABLE` + retry**: `findMatchingFace`/`findMatchingVoice`
decrypt and scan every registered template — expensive and CPU-bound. Under
`SERIALIZABLE` that produces high false-conflict retry rates. A
`pg_advisory_xact_lock` is explicit, cheap, needs **zero schema changes**, and
gives a hard mutual-exclusion guarantee. Registration volume is low, so fully
serializing registration is an accepted, simple tradeoff (documented in code
comments so it isn't "optimized" away later without understanding why).

Two fixed lock keys, acquired in a fixed order (face, then voice) to avoid
deadlocks:

```ts
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pinit:biometric:face:register'))`;
if (voiceNorm) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pinit:biometric:voice:register'))`;
}
```

`_xact_` variant = transaction-scoped, auto-released on commit/rollback, no
leak risk from a crashed connection. `prisma.$transaction(cb, { timeout:
20000, maxWait: 10000 })` since the decrypt-scan is CPU-bound and could
otherwise hit Prisma's default interactive-transaction timeout.

**Tradeoff, documented in code**: because the duplicate scan runs inside the
lock, registration latency grows with registry size and every registration
waits behind whichever one currently holds the lock. Accepted, explicit side
effect of the race fix. If it ever becomes a real bottleneck at scale, the
fix is an ANN index (pgvector) — explicitly out of scope here.

### 2. Restructured `register()` — `src/services/auth/biometric-auth.service.ts`

New order:
1. Embedding quality check, PAD liveness, pending-passkey shape check, normalize embeddings, encrypt templates — unchanged, outside the transaction (pure compute / stateless checks, no DB).
2. Pre-mint a candidate `shortId` outside the tx (existing `mintUniqueShortId`, kept as a fast path) — the `User.shortId @unique` constraint remains the actual correctness guarantee, not the pre-check.
3. **One `prisma.$transaction`:**
   - Acquire face lock, then voice lock (if voice present).
   - Re-run the duplicate scan **inside the lock, against `tx`**: `findMatchingFace(faceNorm, tx)`. On hit → throw `DuplicateFaceError` (rolls back the transaction).
   - If voice present: `findMatchingVoice(voiceNorm, tx)` → throw `DuplicateVoiceError` on hit.
   - `credentialIdOwnedByOtherUser(credentialId, undefined, tx)` (fixed version — see §4) → throw `WebAuthnOwnedError` on hit.
   - `tx.user.create`, `tx.biometricIdentity.create`, `tx.faceTemplate.create`, `tx.voiceTemplate.create` (if present), `tx.fingerprintTemplate.create` — unchanged shapes. `User.webauthnCredentialId` is left `null` at creation, set only after the verified attach below.
   - **Passkey attach moves inside this same transaction** — no second WebAuthn ceremony needed. The ceremony (browser `navigator.credentials.create` + `/passkey/register/finish`) already happened earlier as its own HTTP round trip; what's left is just the DB write. `attachPendingPasskey` and the underlying `webauthn-store.ts` functions now accept an optional `db: PrismaClient | Prisma.TransactionClient`, defaulting to the ambient `prisma`. If attach fails → throw `PasskeyAttachError` → rolls back **everything**, fixing the orphan-account bug directly.
4. Outer error mapping: `DuplicateFaceError`/`DuplicateVoiceError` → the same generic 409 `"You're already registered with PINIT."` (no shortId, no distance, no ambiguous flag — collapses the old "single match" vs "ambiguous multi-match" messages into one, since the more specific one was itself a smaller leak). `WebAuthnOwnedError` → existing 409 device-authenticator message. `PasskeyAttachError` → existing 403 reason strings, unchanged wording. A `shortId` collision (`P2002`) → one retry with a freshly minted id, then a generic 500.
5. After the transaction commits: subscription/org bootstrap, session/JWT issuance — unchanged, outside the tx (non-critical/best-effort; a failure here is login friction, not an orphan account).

### 3. Voice duplicate detection

Mirrors the face pattern exactly:
- `rankVoiceMatches()` / `isDuplicateVoiceEnrollment()` in `biometric-matching.service.ts`, reusing `isConfidentFaceMatch`'s margin logic, parameterized by the already-defined `THRESHOLDS.voiceDuplicate` (0.35).
- `loadAllVoiceTemplates()` / `findMatchingVoice()` in `biometric-auth.service.ts`, mirroring `loadAllFaceTemplates`/`findMatchingFace`, both generalized to accept an optional db-client param (default ambient `prisma`) rather than maintaining separate Tx-suffixed twins.
- Called inside the locked transaction — a voice-duplicate hit rolls back the whole transaction (no partial face-only account).

### 4. WebAuthn ownership-check fix

`credentialIdOwnedByOtherUser()` now queries the authoritative
`WebAuthnCredential` table via `findWebAuthnByCredentialId` instead of the
stale `User.webauthnCredentialId` field. This also closes a second latent
gap: the old check could miss real collisions because that field only ever
reflected the *last* attached credential, not the full set. The
`User.webauthnCredentialId` column itself was **not** removed (still read by
`loadFingerprintForUser`/`upsertDevice`) — just no longer trusted for
uniqueness. Full removal is a candidate for a future, separate cleanup.

### 5. Prisma schema

**No changes.** The advisory-lock approach needs no new tables/columns.
`WebAuthnCredential.credentialId`, `FaceTemplate.templateHash`,
`VoiceTemplate.templateHash` were already `@unique` — useful as
exact-duplicate-value belt-and-braces, not a substitute for the
similarity-based checks (two capture sessions never produce byte-identical
embeddings).

### 6. Client-side changes

- `RegistrationFlow.tsx`: removed the `storeIdentity()` call, its import, and the now-dead `faceImageRef`/`onCapture` wiring that only fed it.
- `LoginFlow.tsx`: removed the `touchLastLogin()` call and its import.
- `client/src/lib/identity-store.ts`: left in place (harmless with zero callers) rather than deleting exports.
- `client/src/lib/face-api-client.ts`: removed the `data.shortId` 409-message-interpolation branch; surfaces only the backend's generic message now. Dropped `shortId` from `FaceAuthResponse`.
- `src/api/controllers/face-auth.controller.ts`: `faceRegister`'s 409 branch no longer forwards `result.shortId`.
- `client/src/components/auth/FaceAuth.tsx`: no functional change (verified it never read `shortId`) — added a guardrail comment.
- **Not touched** (reused exactly as-is): `FaceRoundScan.tsx`, `BiometricStep.tsx`, `VoiceCaptureStep.tsx`, `parts.tsx`, `lib/face-liveness.ts`, `lib/webauthn.ts`, `lib/voice-fingerprint.ts`, `lib/face-capture.ts`, `FaceLoginPage.tsx`.

### 7. Error message audit (generic-message discipline)

| Situation | Message | Status |
|---|---|---|
| Face duplicate (single or ambiguous multi-match) | "You're already registered with PINIT." | 409 |
| Voice duplicate | "You're already registered with PINIT." (identical to face dup) | 409 |
| WebAuthn credential already owned by another account | "This device authenticator is already registered to another Pinit HUB account. Sign in instead." | 409 |
| Poor-quality face capture | "Invalid or low-quality face embedding. Recapture and try again." | 400 |
| Multiple faces / liveness fail | existing `padDenyMessage()` — unchanged | 403 |
| Login wrong face / wrong claimed ID | existing generic "Could not verify this face for the claimed account." — unchanged | 200, `success:false` |

Server-side audit logging (`logSecurityEvent('DUPLICATE_REGISTRATION', { detail: { distance, ambiguous } })`)
still records distance/ambiguity for operational tuning — server-only, never
returned to the client.

---

## Test coverage

**Pure unit tests (no DB):** `tests/auth/voice-match-gate.test.ts`,
`tests/auth/webauthn-ownership-fix.test.ts`,
`tests/auth/duplicate-message-generic.test.ts`.

**Integration tests against a real Postgres test DB** (guarded on
`DATABASE_URL_TEST`, skip cleanly if unset):
`tests/auth/integration/face-duplicate-registration.test.ts`,
`voice-duplicate-registration.test.ts`,
`concurrent-face-registration.test.ts` (the race-condition test — 2-way and
5-way concurrent registration of the same face, asserts exactly one winner),
`no-orphan-on-failure.test.ts` (asserts zero rows across every biometric
table on every failure path, including passkey-attach-fails-inside-the-tx),
`pinit-id-uniqueness.test.ts`, `login-1to1.test.ts`,
`jwt-subject-and-isolation.test.ts`. Shared fixtures/helpers live in
`tests/auth/integration/{db-setup,fixtures,service-with-test-db}.ts`.

**Manual regression** (not automated — JWT shape is unchanged so these were
expected unaffected): Vault, DNA generation, Assets, Certificates, Exchange,
dashboard/Portfolio, Monitoring, Investigations, Notifications, Admin.

To run the integration suite: point `DATABASE_URL_TEST` at a disposable
Postgres database with migrations already applied (`prisma migrate deploy`
against it once, out of band), then `npx jest tests/auth/integration`.

---

# Part 2 — Biometric Data Storage / Database Design

Follow-up to the rebuild above, covering the *data model* rather than the
orchestration. Same scope discipline: biometric-auth module only, no schema or
code changes to Vault, DNA, Assets, Certificates, Exchange, Marketplace,
Monitoring, Investigations, Admin, or any unrelated table.

## Read-only audit findings (before any change)

| Metric | Value |
|---|---|
| Users | 10 |
| BiometricIdentity | 4 |
| FaceTemplate | 4 |
| VoiceTemplate | 1 |
| FingerprintTemplate | 4 |
| WebAuthnCredential | 4 |
| Users with `faceRegistered=true` but no BiometricIdentity | 0 |
| BiometricIdentity with no FaceTemplate | 0 |
| Duplicate face template hashes | 0 |
| Duplicate voice template hashes | 0 |
| Owners with >1 BiometricIdentity | 0 (structurally impossible — `userId` is DB-unique) |

**Raw face images: none exist.** The public Supabase table the removed client
code targeted (`hoid_identities`) **does not exist in this project** — verified
by direct query. So although the vulnerability was real in code (and is now
removed), no raw face image or login timestamp was ever actually persisted
there. No other code path writes face images anywhere.

**6 of the 10 users** are empty `authMethod: "password"` shells (no face
embedding, no BiometricIdentity, no credential) created by an unrelated,
currently-unreachable legacy service (`src/services/auth/auth.service.ts`,
whose HTTP route returns 403). Not a biometric defect; left untouched.

## Changes made

### Schema (migration written, NOT applied)

`prisma/migrations/20260818180000_add_biometric_template_metadata/migration.sql`
adds to `face_templates`, `voice_templates`, `fingerprint_templates`:
`updatedAt`, `embeddingVersion`, `modelVersion`, `algorithmVersion`,
`qualityScore` (nullable), `status`, `encryptionKeyVersion`.

Additive only — every column defaulted or nullable, existing rows backfill
automatically, no drops/renames/data loss.

**The migration file was written by hand on purpose.** `prisma migrate diff`
also wanted to emit `DROP TABLE "spatial_auth_packages"` — a DNA-engine table
(holding 2 real rows: `dnaRecordId`, `merkleRoot`, `pixelAuthBlob`, multiscale
local-DNA data) that exists in the database but was never added to
`schema.prisma`. That is pre-existing drift unrelated to biometrics, and
dropping it would destroy DNA data in a module explicitly out of scope. The
drop is excluded from the migration. **This drift still exists and should be
reconciled separately** — anyone running a Prisma migration generator against
this database will hit the same proposed drop.

Also note: `prisma migrate dev` cannot run against this database at all — an
older migration (`20260617000000_add_thumbnail_canary`) fails to replay cleanly
into a shadow database (`P3006`/`P1014`: "the underlying table for model
`users` does not exist"). Pre-existing, unrelated, not fixed here. Use
`prisma migrate deploy` (which never resets and never uses a shadow DB).

### Template metadata written at enrollment

`register()` now stamps every template with `embeddingVersion`, `modelVersion`
(`face-api-tiny-v1` / `web-audio-fft-v1` / `webauthn-device-v1`),
`algorithmVersion`, `status`, and `encryptionKeyVersion`
(`CURRENT_ENCRYPTION_KEY_VERSION`, new export in `biometric-crypto.service.ts`).

`qualityScore` is populated only where a real signal exists: **face** uses the
PAD sharpness score already computed during liveness evaluation; **voice** and
**fingerprint** are `null` (voice quality is gated client-side and never
reaches the server; the fingerprint template is a derived device proxy, not a
captured sample). Not fabricated to fill the column.

### Granular audit events

`SecurityEventType` extended with `FACE_REGISTERED`, `FACE_DUPLICATE_REJECTED`,
`FACE_LOGIN_SUCCESS`, `FACE_LOGIN_FAILED`, `VOICE_REGISTERED`,
`VOICE_DUPLICATE_REJECTED`, `WEBAUTHN_REGISTERED`, `WEBAUTHN_LOGIN_SUCCESS`,
`WEBAUTHN_LOGIN_FAILED`. Call sites in `biometric-auth.service.ts` updated to
emit these instead of the coarse `BIOMETRIC_MATCH`/`BIOMETRIC_FAILURE`.
`eventType` is a plain string column with no external consumers, so this
required no migration.

`VOICE_LOGIN_FAILED`/`VOICE_LOGIN_SUCCESS` deliberately **not** added: login
fusion (`fuseBiometricScores`) currently gates pass/fail on face only
(`verified = faceOk`), so a voice-specific login event could never fire. Adding
it would be dead code.

### Similarity-distance leak fixed (found during this work)

`login()`'s failure response carried a `distance` field (the euclidean distance
between the probe and the enrolled template), and
`face-auth.controller.ts` forwarded it to the browser as
`distance: result.distance ?? null` on **every failed login**. That let a
caller measure how close a given face is to an enrolled one and iterate toward
a match. Removed from both the service's `deny()` helper and the controller
response. No client code consumed it (verified by grep), so nothing broke.

Persisted `FACE_LOGIN_SUCCESS` audit events also no longer carry
`fusion.scores` (which contained face/voice/fingerprint distances).

### New tests

- `tests/auth/no-raw-fingerprint-data.test.ts` — structural proof that
  `deriveFingerprintTemplate` is a pure function of two opaque id strings, and
  that the WebAuthn store persists only `credentialId`/`publicKey`/`signCount`.
- `tests/auth/integration/no-embedding-in-response.test.ts` — recursively walks
  entire register/login/duplicate-rejection responses for any 64+ numeric array
  or embedding-suggestive key name.
- `tests/auth/integration/no-embedding-in-logs.test.ts` — spies on the real
  logger through a full register+login cycle and applies the same recursive
  scan to every logged argument.

## Still outstanding

- **The migration has not been applied.** `DATABASE_URL` points at the
  production Supabase instance; the SQL is written and reviewable but must be
  applied deliberately via `npx prisma migrate deploy`.
- Until it is applied, `register()` will fail at runtime against that database,
  because the code now writes columns that do not exist there yet. Apply the
  migration before exercising registration again.
- Pre-existing `spatial_auth_packages` schema drift (see above) — separate decision.
