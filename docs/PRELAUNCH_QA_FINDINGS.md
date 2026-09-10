# Pre-launch QA — findings log

Manual test run against localhost (Hub client :3002, backend :4000).
Test plan: https://claude.ai/code/artifact/13008ba5-4af4-4abd-ae81-a2c73bce85f2

Local dev writes to the **production Supabase database** — there is no dev database.
Accepted for this run: the database is being reset before launch.

---

## Fixed during the run

### F5 · Video: catch a re-encoded copy at upload
**Severity:** HIGH — a stolen video was minted a fresh identity · **FIXED**

Three of six duplicate detectors are hard-gated to `image/`, so a re-encoded video
uploaded to another account was caught by **nothing** and received its own DNA record
and certificate.

Added a seventh detector, `NEAR_DUPLICATE_VIDEO_FRAMES`
(`duplicate-check.service.ts`), comparing keyframe perceptual hashes. Probe hashes
come from the existing `buildVideoAssetDna`; stored hashes from `Asset.fingerprints`,
so no vault is decrypted. Scoring is asymmetric nearest-neighbour, matching how
`partial-video-recovery` scores an investigation, via a new
`compareVideoFrameHashes()` beside `verifyVideoDna`. Ownership policy is inherited
from `_finalizeMatch` — unowned ignored, same-account allowed, cross-account blocked
and named. Video gets its own `DUPLICATE_VIDEO_BUDGET_MS` (15s) since frame decode
exceeds the 8s image budget.

**Verified on real video**, not mocks — a half-resolution crf-30 re-encode
(324 KB -> 58 KB, every byte different, all tails stripped):

| probe vs original | similarity | verdict |
|---|---|---|
| re-encoded (half size, crf30) | **1.00** (7/7 frames) | BLOCKED |
| itself | 1.00 (7/7) | BLOCKED |
| unrelated video | **0.00** (0/7) | allowed |

**Not done (decided):** frame watermark embedding. Naive LSB does not survive H.264 —
the codec discards the low-order bits the watermark occupies — so it would be
destroyed by our own re-encode. A transcode-surviving watermark needs DCT/spread
spectrum with error correction: R&D, not a patch.

### F6 · Media temp paths collided under concurrency
**Where:** `forensics/media-tools.service.ts` · **Severity:** HIGH — wrong video fingerprinted · **FIXED**

Found while proving F5 on real files: three concurrent `buildVideoAssetDna()` calls
made an **unrelated video score 1.00** against the original.

All three media temp paths were `Date.now()`-only:

```js
path.join(os.tmpdir(), `pinit-frames-${Date.now()}`)   // + pinit-dna, pinit-dna-audio
```

Two jobs starting in the same millisecond share one input path or one frame
directory: one video overwrites the other and the wrong pictures get fingerprinted,
and the `finally` cleanup deletes a directory the other job is still reading. Routine
whenever two users protect a video at once.

Fixed with a `uniqueTempName()` helper adding `crypto.randomUUID()`. Re-ran the same
concurrent scenario: re-encode 1.00 BLOCKED, unrelated 0.00 allowed.

### F7 · ffmpeg-missing fallback faked perceptual hashes
**Where:** `forensics/video-dna-enhancements.service.ts` · **FIXED**

Without ffmpeg, `framePHashes` was set to container-byte SHA slices. Those are
16-hex, identical in shape to a real Block-Mean-Hash-64, so every downstream hamming
comparator accepted them and compared meaningless bits. Now left empty —
`algorithmVersion` already records `2.2-binary-fallback` — and
`compareVideoFrameHashes` returns 0 when either side is empty, so a fallback record
can never match anything.


### F3 · Production fix pass — O3, O4, O6, O7 + video path
All five carry regression tests that were verified to FAIL with the fix reverted.

| Item | Change | File |
|---|---|---|
| O6 | Unowned records can no longer block an upload. Added `_isUnownedRecord` guard on the exact-match branch and on the shared `_finalizeMatch` path, and excluded `ownerUserId: null` from all four candidate queries (sha exact, crypto sha, normalized hash, pHash scan pool). | `services/duplicate/duplicate-check.service.ts` |
| O3 | The PARENT forwarding carve-out is now scoped to `oneTimeUse` only. A parent revoked by the owner, or deactivated because its vault was deleted, reports `isActive:false` with `inactiveReason:'revoked'` like every other link type. | `services/share/share-link.service.ts` |
| O4 | `describeUnavailableShare()` maps each reason to its own sentence and a 410 (403 for `tampered`) — never a 500 and never "inactive, expired, or exhausted". Plus a removed-vault guard before `vaultService.retrieve` so a deleted file answers 410, not 500. | `api/controllers/share-link.controller.ts` |
| O7 | `buildDuplicateMessage()` extracted and exported. It only claims another account when a shortId is in hand; otherwise it says the file is already registered and offers a support route. | `api/controllers/dna.controller.ts` |
| VIDEO | `assetService.attachMediaFingerprints()` reuses the existing `buildVideoAssetDna` / `buildDocumentAssetDna` adapters and is now called from the Hub protect path, owner-scoped, fire-and-forget. Watermark `method` labels corrected: `video-keyframe-tail+metadata` -> `video-container-tail`, `audio-frequency-tail` -> `audio-container-tail`. | `services/assets/asset.service.ts`, `services/vault/vault.service.ts`, `services/watermark/vault-watermark-engine.service.ts` |

### F4 · Unhandled rejection could terminate the backend
**Where:** `services/vault/vault.service.ts` · **Severity:** production crash risk · **FIXED**

Two best-effort indexers ran as `void fn()` with `.catch()` attached to the dynamic
**import** promise rather than to the work:

```js
import('../block-dna/investigate').then(({ enrollBlockDnaForVaultImage }) => {
  void enrollBlockDnaForVaultImage({ ... });   // rejection escapes
}).catch(() => {});
```

A corrupt or truncated image makes these reject. There is no `unhandledRejection`
handler in `server.ts`, and Node terminates the process on an unhandled rejection.
Video never reaches this (the block is guarded by `mimeType.startsWith('image/')`),
so it was not a video crash — but a bad JPEG could take the API down.

Fixed by returning the work from `.then` so the existing `.catch` covers it, and
logging the failure. This also stopped the jest worker crash that was blocking the
suite: `tests/services` + `tests/vault` now run clean at 26 suites / 210 tests.


### F1 · Share links generated with an unreachable port
**Where:** `.env` line 65 · **Severity:** blocks all local share testing

`PUBLIC_APP_URL=http://localhost:3000`, but the Vite client is pinned to **3002**
(`client/vite.config.ts`, `strictPort`). Every generated share URL pointed at a port
nothing listens on — `ERR_CONNECTION_REFUSED`. The token itself was always valid;
only the displayed origin was wrong.

`share-link.service.ts:566` already falls back to `http://localhost:3002`, so the
env var was overriding a correct default with a stale one.

**Fixed:** `PUBLIC_APP_URL=http://localhost:3002`. Backend restarted. Backup at
`.env.bak-qa`. `.env` is gitignored — local only, nothing ships. Production is
unaffected (it sets the Vercel URL).

### F2 · "Different File" button did not change the file
**Where:** `client/src/App.tsx:182` · **Severity:** blocks the user · **FIXED**

**Not a dead end** — the file card already carried a working "<- Change file" link.
The bug was that the prominent button in the red banner read "Different File" and
did not change the file; its handler only cleared the banner state:

```js
onClick={() => { setError(null); setDuplicateInfo(null); }}
```

`selectedFile` was never cleared, so the refused file stayed selected and the page
still showed a primary "Protect This Asset" button for a file the server had just
refused — a refusal and an invitation to proceed on the same screen. Users reach for
the labelled button in the error, not the smaller link below it, so the escape route
that worked was the one they were least likely to find.

**Fixed:** a duplicate refusal now clears the selection and returns to the empty
upload zone; a transient error still keeps the file so Retry is one click. Button
relabelled "Choose a different file". Client TypeScript passes.

---

## Open findings

### O1 · Raw UUIDs on show in the Vault side panel
**Check:** 3.5 · **Result:** FAIL · **Severity:** cosmetic, but against the stated goal

Three technical ids visible in the normal (non-forensic) view of an asset:

| Location | Value shown |
|---|---|
| Directly under the status chips | `fe39f9fa-331…` — no label at all |
| File identity → Record | `b700ba45-8cb4-42…` |
| Chain of custody → Asset | `fe39f9fa-3319-4f…` |

The Chain of custody one is arguably correct — an asset id genuinely belongs in a
chain of custody. The unlabelled one under the status chips is the real problem:
it tells the user nothing and looks like a defect.

**Not fixed.** Test-first; no code changed.

### O2 · Search with no matches says "No assets yet"
**Check:** 11.4 · **Result:** FAIL · **Severity:** reads as data loss

`client/src/pages/VaultPage.tsx:503` (grid) and `:546` (table) both branch on
`filtered.length === 0` and render the same empty state:

> **No assets yet** — Protect your first asset to start building your protected library.

That copy is correct only when the user genuinely has no assets. When a search or
type filter excludes everything, a user with 5 protected files is told to protect
their first one — which looks like their library was wiped.

**Needs:** two distinct states — "nothing protected yet" (with the call to action)
versus "nothing matches <term>" (with a clear-search action). Both call sites.

**Not fixed.** Test-first; no code changed.

### O3 · A deactivated PARENT share link reports itself as active
**Check:** 1.8 / 5.4 · **Result:** FAIL · **Severity:** high (trust + correctness)

Deleting a vault deactivates its share links (`isActive=false` confirmed in the
database). The public info endpoint still returns `"isActive": true,
"inactiveReason": null`.

**Cause:** `src/services/share/share-link.service.ts` `getPublicInfo`.

```js
const parentAcceptsForwards = isParent && !isExpired && !isExhausted && signatureValid;
const linkAccessible = ... && (link.isActive || parentAcceptsForwards);
```

The carve-out exists so a PARENT stays open for new devices to mint forwarding
hops after `oneTimeUse` is consumed. But it applies to **any** inactive parent, so
a parent deactivated by revocation or by vault deletion still reads as live. The
`inactiveReason` ladder compounds it: for a parent it only ever assigns
`'one_time'`, never `'revoked'`.

Confirmed on token `k4DW3L-1UA` — `linkType=PARENT`, `isActive=false`,
`oneTimeUse=false`. It should never have qualified for the forwarding carve-out.

**Consequence in the UI:** the viewer header shows "Verified Pinit asset",
"Expires Sep 17" and an enabled **Share further** button on a dead link. The chrome
asserts trust and offers to propagate a URL that cannot work.

**Needs:** scope `parentAcceptsForwards` to the case it was written for — a parent
consumed by `oneTimeUse` — and give parents a `'revoked'` reason like every other
link type.

### O4 · Dead share link surfaces as "Internal server error"
**Check:** 1.8 · **Result:** FAIL · **Severity:** medium (leaks internals publicly)

`GET /api/v1/share/:token/file` returns **HTTP 500** for a link whose vault was
deleted; the viewer renders "Access Blocked — Internal server error".

`vaultService.retrieve` throws `Vault record not found` and falls through to the
generic error handler. A deleted file is an **expected** state, not a server fault.

**Needs:** a deliberate 410 with recipient-facing copy — "This link was turned off
because the file was removed." No 500, and no implementation wording on a public
page.

**Security note — NOT a leak.** Verified directly against the API, no browser
cache involved: the file endpoint returns 49 bytes of JSON error, not image bytes.
The image seen on first load was the browser's cached copy and disappeared on
refresh. No content is served for a deleted asset.

### O5 · Credential card action buttons overflow and clip
**Check:** 11.3 · **Result:** FAIL · **Severity:** cosmetic

On `/certificates`, each card's action row (Preview certificate · View verification ·
View protected file · Revoke) is wider than the card. "View prot..." is cut mid-word
and each card grows its own horizontal scrollbar.

Actions should wrap to a second line, or collapse the secondary ones behind an
overflow menu. A user cannot see that a "View protected file" action exists without
scrolling sideways inside a card.

**Not fixed.** Test-first; no code changed.

### O6 · Ownerless probe DNA records block users from their own files
**Check:** 2.4 · **Result:** FAIL · **Severity:** HIGH — blocks legitimate protection

Uploading `The beach (2).jpg` (the user's own photo) was refused with
*"This file already exists under another PINIT account."* It matched
`[probe] The beach (1).jpg` — a DNA record with `ownerUserId = NULL`.

`duplicate-check.service.ts` selects candidates with
`status IN ('COMPLETE','PARTIAL','PROCESSING')` and **no owner filter and no probe
exclusion**. The same/different-account policy then compares `record.ownerUserId`
against the uploader; `NULL !== uploaderId`, so an ownerless record is classified as
"another account" and blocks.

Production counts at time of test:

| | |
|---|---|
| DNA records total | 402 |
| ownerless (`ownerUserId IS NULL`) | 344 (85%) |
| named `[probe]` | 230 |
| **ownerless AND live to the check** | **166** (COMPLETE 104, PARTIAL 60, PROCESSING 2) |

`lib/dna-immutability.ts` intends probes to be soft-archived to `status='FAILED'`,
which the check does exclude — but 166 ownerless rows sit in live statuses anyway,
including rows already renamed `[probe] …`, so the archive set the name but the
status never settled.

**Consequence:** a real user can be permanently blocked from protecting their own
file and told it belongs to a stranger, with no way to resolve it.

**Needs:** (a) exclude `ownerUserId IS NULL` and `[probe]` rows from duplicate
candidates; (b) find why soft-archive leaves rows in live statuses; (c) a boot-time
sweep to archive existing ownerless probes.

A fresh production database hides this at launch but does not fix it — the probe
path keeps creating ownerless records.

### O7 · Duplicate block claims "another account" when it cannot name one
**Check:** 2.4 · **Result:** FAIL · **Severity:** medium

The message already names the owner when one is resolved — verified on a genuine
cross-account block:

> "This file already exists under another PINIT account. **This file belongs to
> PINIT-6QGDDPMF.** Duplicate DNA cannot be generated across accounts."

That case is correct. The bug is the fallback: when the match is an ownerless probe
(see O6) no owner can be named, yet the message still asserts the file belongs to
another account:

> "This file already exists under another PINIT account. Duplicate DNA cannot be
> generated across accounts."

**The missing owner name is the signal.** No resolved owner should never produce a
"belongs to another account" claim — that branch is reachable only via an ownerless
record, which is not another account at all.

**Needs:** when no owner can be named, say what is actually known ("This file is
already registered on Pinit") and offer a resolution path. Only claim another
account when a shortId is in hand. Fixing O6 removes most occurrences; this branch
should still be made honest.

### O8 · Asset.fingerprints never populated on the Hub protect path
**Check:** 2.2 · **Result:** FAIL · **Severity:** medium

`Asset.fingerprints` is NULL for **every asset in the system** — 0 of 28.

| capturedVia | assetType | assets | with fingerprints |
|---|---|---|---|
| hub_protect_file | IMAGE | 19 | 0 |
| hub_protect_file | DOCUMENT | 7 | 0 |
| hub_protect_file | VIDEO | 2 | 0 |

Two protect paths exist and they differ. `asset.service.ts` builds
`buildVideoAssetDna` / `buildDocumentAssetDna` and passes `fingerprints` into
`ensureAssetFromProtect`. `vault.service.ts:334` — the Hub upload path — never
computes them and omits the field entirely. 100% of real protections use the Hub
path, so the adapter output is never stored.

**Not "videos have no DNA".** The DnaRecord still holds the real layers;
`Asset.fingerprints` is the additive Asset-layer snapshot (per the schema comment:
"Video/document DNA fingerprints and adapter metadata"). But anything reading
fingerprints from the Asset — comparison, matching, the Exchange bridge — sees
nothing for every asset in the system.

**Needs:** the Hub path should compute and pass fingerprints for VIDEO and DOCUMENT
the way the Publish Guardian path already does.

### O9 · Video shows blank protection metrics instead of hiding them
**Check:** 2.2 / 11.4 · **Result:** FAIL · **Severity:** cosmetic

The Vault side panel for a video shows Content, Tamper and Authenticity each as a
bare em-dash. For an image those carry real values ("AI Generated", "0% none found",
"61%"). Content analysis is image-based and does not apply to video, but three empty
rows read as failed analysis rather than not-applicable.

Per the Value Curve principle already applied to the relationship graph — hide
sections with no members — these rows should be omitted for video, or state plainly
that content analysis applies to images.

### O10 · Video watermark is a byte-tail append, mislabelled as keyframe embedding
**Check:** 2.2 · **Result:** FAIL · **Severity:** HIGH — the core promise is not met for video

**CORRECTION to an earlier version of this finding.** I first reported video as
"9/15 layers, COMPLETE is a lie". That was wrong: I counted only the image layer
tables. Video runs all 15 layers — L1-L6 via `VideoDnaEngine`, stored as JSON in
`dnaRecord.universalFingerprints`; L7-L15 in the layer tables. `COMPLETE` is
truthful. Verified on Coffee.mp4: L1 sha256, L2 container_layout_hash,
L3 binary_chunk_simhash, L4 container_codec_fingerprint, L5 video_container_metadata,
L6 hmac_sha256 — all `success: true`.

**The real gap is embedding, not fingerprinting.**
`watermark/vault-watermark-engine.service.ts` `embedVideo()`:

```js
const tag = Buffer.from(`PINIT-VAULT-VIDEO|${payload}
`, 'utf8');
return { buffer: Buffer.concat([buffer, tag]),
         method: 'video-keyframe-tail+metadata', embedded: true };
```

It appends plaintext to the end of the file. There is no keyframe embedding and no
container metadata write, despite the method name asserting both. Functionally it is
`embedGenericTail` with a different label.

| media | embedding | survives re-encode |
|---|---|---|
| image | real pixel work (`embedImage` + L6 stego + L11 DCT) | yes |
| video | trailing byte append | **no** — stripped by any transcode, remux or platform re-upload |

For images the product promise (invisible watermark, per-pixel signature) is met.
For video it is not, and the reported `method` overstates what ran.

**Minimum correct fix (no new protection system):** report the method honestly, and
wire the existing `buildVideoAssetDna` into the Hub path so the video adapter output
is stored. Real keyframe watermarking is substantial work (frame decode + DCT embed +
re-encode) and is a roadmap item, not a patch.

---

## Confirmed as designed (not bugs)

### D1 · Same account may re-protect the same file
`duplicate-check.service.ts` header states the policy explicitly:
same `ownerUserId` -> ALLOW, different account -> BLOCK. This is why four content
hashes have two protections each (`Ganesha.png` = the renamed `ChatGPT Image Sep 3`,
plus both `Ocean.jpg`, both `OIP.jpg`, both `ChatGPT Sep 7`).

The guard is against someone else claiming your work, not against you re-protecting
your own. **Open product question:** should same-account re-protection be blocked
too? Trade-off — a creator re-protecting an updated crop of their own photo would
then be refused.

### D2 · Duplicate detection is content-based, not filename-based
Six methods run before DNA generation: SHA-256 exact, TEP tracked export, embedded
PINIT identity, vault signature + OCR, normalized pixel hash, and pHash
near-duplicate at a 0.90 threshold. Renaming a file does not evade it — which is
exactly why the renamed `The beach (2).jpg` was caught.

### O11 · `/dna-records` removed from nav but still reachable
**Check:** 2.5 · **Result:** WATCH · **Severity:** low, verify at Suite 08

DNA identity now lives in asset details, and `/dna-records` was taken out of the
sidebar — a deliberate simplification, so check 2.5 as written is **N/A**.

The route is still live and reachable from two entry points:

| Entry point | File |
|---|---|
| Business dashboard, "DNA generated" tile | `client/src/components/business/dashboard/BusinessOpsSections.tsx:111` |
| DNA notification deep-links (`/dna-records?id=...`) | `client/src/lib/notification-config.tsx:164` |

Fine if it is intended as a drill-down from those two places. But the table holds
**402 DNA records of which 344 are ownerless probes** (`[probe] Untitled design.png`
alone appears 230 times), so whoever lands there sees a list that is 85% test
artifacts unless the page filters them.

**To verify at Suite 08:** click "DNA generated" on the Business dashboard and see
what the list actually contains.

---

## Requested changes (after the run)

### R1 · Share flow should not take two full pages
**Raised at:** step 1.4 · **Decision:** one page, link appears in place

Today: `/vault/assets/:id/share` to configure, then a navigation to
`/vault/assets/:id/shares/:shareId` to see the result. Two full pages to produce
one URL.

**Agreed shape:** keep `/share` as a single page. On Create, the generated link, QR
and copy button appear in the right-hand panel where the asset summary sits — no
navigation, and "create another link" without going back. The toggles themselves
are fine and stay as they are.

---

## Passed so far

| Check | What it proved |
|---|---|
| 1.2 | Identity chain built: 1 asset ← 1 vault ← 1 DNA, 2 timeline events, 0 duplicates |
| 1.3 | Relationship graph shows only non-empty groups (Owner, 1 connection) |
| 1.4 | Share config toggles all work; link created with a valid token |
| 1.5 | Vault delete succeeded; asset left My Assets (6 files -> 5) |
| 1.6 | **The fix.** `vaultId` cleared on delete; system dangling count stayed at 7, did not become 8 |
| 1.7 | Asset row, DNA and timeline survived; third event `STATUS_CHANGE / Vault file removed` recorded |
| 1.9 | Cleanup cleared all 7 legacy dangling refs; assets 24 -> 26 (nothing deleted); re-run is a clean no-op |
| 4.7 | Deleted asset's certificate removed from Credentials; no orphaned or broken-title entry |
| 2.2 | **Video protects cleanly**: assetType VIDEO, DNA complete, frame thumbnail extracted, no `sharp` crash. Rename-before-protect keeps asset/vault/DNA names identical. |
| 2.4a | **Cross-account duplicate block works**: `crops1.webp` refused and correctly named the owning account PINIT-6QGDDPMF. Core security property of the duplicate system holds. |

