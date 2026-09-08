# Merge audit — `org/vaibhavi-new` → `org/ashwitha`

Audit only. No merge was performed; the trial merge ran in a throwaway worktree
and the working tree was never touched.

Date: 2026-09-08 · base `org/ashwitha` @ `850cd0b`

---

## 1. What is being merged

| | |
|---|---|
| Branch | `org/vaibhavi-new` @ `2d62adf` |
| Author | vaibhavi, 4 days ago |
| Subject | Add pixel-source investigation: local vault pick, 1x1 composition map, and original-vs-suspect compare |
| Ahead of `ashwitha` | **1 commit** |
| Behind `ashwitha` | 168 commits |
| Diff | 45 files, **+5,403 / −112** |

**"masteradmin" is not a branch.** It is the `master-admin/` directory carried
inside this branch. The pixel-work and the master-admin changes arrive together
in this single commit.

### Principal additions (all merge clean)

- `src/services/block-dna/` — `manifest.ts`, `similarity.ts`, `store.ts` (new)
- `src/services/forensics/pixel-source-map.service.ts` (new, 255 lines)
- `src/services/forensics/investigation-composition.service.ts` (new, 414 lines)
- `src/services/forensics/local-source-vault.service.ts` (new, 125 lines)
- `src/services/forensics/fragment-splice-detector.service.ts` (+120)
- `src/services/unified-investigation.orchestrator.ts` (+161)
- `src/types/block-dna.types.ts`, `investigation-composition.types.ts` (new)
- `tests/block-dna/`, `tests/forensics/` — 3 new suites, ~590 lines

---

## 2. Result

**41 of 45 files merge clean. 4 conflicts.**

The single most important finding: **every conflicted file was last edited by
vaibhavi on _both_ branches.** This is not two people colliding — it is the same
author's older work already on `ashwitha` against their newer work on the
branch. That materially lowers the risk: "theirs" is generally the newer intent,
except where `ashwitha` has since gained Exchange-identity work that this branch
(168 commits behind) predates.

| # | File | Hunks | Difficulty | Recommendation |
|---|---|---|---|---|
| 1 | `src/lib/pinit-identity.ts` | 1 | Trivial | Keep **ours** |
| 2 | `master-admin/…/UserDetailPage.tsx` | 5 | Easy | Mostly **theirs** |
| 3 | `master-admin/…/AdminDnaPage.tsx` | 4 | Moderate | **Theirs** wholesale |
| 4 | `src/api/controllers/super-admin.controller.ts` | 5 | **Careful** | Combine both |

---

## 3. Conflict detail

### 3.1 `src/lib/pinit-identity.ts` — trivial

One hunk, a comment line.

```
ours   : // PINIT-USER-XXXXXXXX / PINIT-ORG-XXXXXXXX / PINIT-WS-XXXXXX / PINIT-EX-XXXXXXXX
theirs : // PINIT-USER-XXXXXXXX / PINIT-ORG-XXXXXXXX / PINIT-WS-XXXXXX
```

**Keep ours.** It is a strict superset — `PINIT-EX` is the Exchange identity
added on `ashwitha` after this branch diverged. No code change.

### 3.2 `master-admin/src/admin/pages/UserDetailPage.tsx` — easy

586 lines, 5 hunks. **Three of the five are pure additions** on their side (our
side is empty), so they carry no decision:

- `formatMoney(amountCents, currency)` helper — take theirs
- a small presentational `div` — take theirs
- a complete **`activity` tab**, 128 lines — take theirs

The two real decisions:

- **`Tab` union type.** Ours: `overview | vault | certificates | shares |
  logins | monitoring | …`. Theirs adds `activity | business | billing`.
  → **Union both lists.** Dropping either side removes working tabs.
- **One comment line** — theirs appends a cross-reference to "Business & Exch…".
  → Take theirs.

### 3.3 `master-admin/src/admin/pages/AdminDnaPage.tsx` — moderate

227 lines, 4 hunks, every one a both-sides edit, and theirs is substantially
larger throughout (49 lines ours vs 141 theirs).

Theirs is a **typed rewrite of the same page**: it introduces a `DnaRecordRow`
interface, types the records state, adds `useMemo`, adds a loading state, and
expands the render.

→ **Take theirs wholesale**, then diff the result against `ashwitha`'s version
to confirm nothing added on `ashwitha` in the last 9 days is lost. Both sides
are vaibhavi's; theirs is 5 days newer and strictly fuller.

### 3.4 `src/api/controllers/super-admin.controller.ts` — needs care

2,312 lines, 5 hunks. This is the only file where **each side owns something the
other lacks**, so neither "ours" nor "theirs" is correct on its own.

| Hunk | Ours | Theirs | Resolution |
|---|---|---|---|
| 1 imports | `adminAuditService`, `ADMIN_DOMAINS`, `getCapabilitiesForRole`, `getRoleCapabilityMatrix`, `isPlatformOwnerShortId` + identity imports | identity imports only | **Keep ours** — superset |
| 2 user query | *(empty)* | adds `ownedOrganization`, `organizationMemberships`, `subscription` + `billingHistory` selects | **Take theirs** — pure addition |
| 3 response | `{...user, tepPackages, identity}` | adds `activity` (platformEvent, take 100) and `exchange: { bridgeAvailable: false }` | **Take theirs, but see risk below** |
| 4 comment | explanatory block on the identity resolver | deleted | **Keep ours** |
| 5 comment | `// ─── GET /super-admin/search ───` | deleted | **Keep ours** |

---

## 4. Risks

**`exchange: { bridgeAvailable: false }` — hardcoded, and likely now wrong.**
This branch is 168 commits behind and predates the Exchange bridge work on
`ashwitha`. Merging it as-is would report the bridge unavailable to the admin UI
regardless of reality. Verify against the current bridge before accepting hunk 3.

**Comment deletions.** Hunks 4 and 5 of the controller delete documentation that
exists on `ashwitha`. Nothing breaks, but the explanation of what the identity
resolver honestly does — and does not — prove would be lost. Keep ours.

**Branch is 168 commits behind.** The merge itself is safe (ours is preserved for
everything uncontested), but vaibhavi's new services were written against a
9-day-old tree. After merging, run the new `tests/block-dna/` and
`tests/forensics/` suites against current `ashwitha` before pushing.

---

## 5. Not part of this merge

- `org/pixelwork` (lowercase) — **0 commits ahead**; already fully contained in
  `ashwitha`. Nothing to merge.
- `org/Pixcelwork` (capital) — 1 ahead but 122 behind, tip is a two-week-old
  merge of `vaibhavi-new`. Superseded by `vaibhavi-new` itself.
- `org/PinitAdmin01-patch-1` — a README edit only.

---

## 6. Verdict

**Low risk. Recommend proceeding.** 41 of 45 files merge clean; the new
forensics and block-DNA services — the substance of the work — carry no
conflicts at all. Three of the four conflicts are mechanical. Only
`super-admin.controller.ts` needs judgement, and only because both sides added
real work to the same handler.

Estimated resolution: under an hour, most of it on the controller and on
verifying the `bridgeAvailable` flag.
