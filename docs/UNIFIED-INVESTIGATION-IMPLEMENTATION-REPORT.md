# Unified Forensic Investigation Center — Implementation Report

## Summary

Additive enterprise module that orchestrates existing PINIT-DNA services into a single 14-step automatic investigation pipeline and 10-section forensic report. **No existing pages or APIs were removed or modified in behavior** (DNA Compare, Verify Leaked File, Vault Explorer, etc. remain unchanged).

---

## 1. New Page

| Route | Component |
|-------|-----------|
| `/unified-investigation` | `client/src/pages/UnifiedInvestigationPage.tsx` |

**Title:** Unified Forensic Investigation Center  
**Subtitle:** Upload or scan a suspected file to perform a complete forensic investigation.

**Top actions:** Upload File / Scan Document (single file, auto-runs pipeline on select).

---

## 2. Components Reused

| Source | Usage |
|--------|--------|
| `VerifyLeakedFilePage` patterns | Upload/scan UI, drop zone, camera capture |
| `ComparePage` / layer types | Layer match %, status badges |
| `dashboard.api` `api` instance | Authenticated multipart upload |
| Sidebar card / `btn` / `card` utilities | Enterprise dashboard styling |

---

## 3. Services Reused (No Logic Duplication)

| Service | Role |
|---------|------|
| `leakedFileVerifyService` | Identity extraction, recipient, access history |
| `vaultAutoMatchService` | Vault DNA search (tiers 1–3) |
| `VaultService.retrieve` | Original vault file |
| `DnaComparisonService` | 15-layer comparison |
| `certificateService` | Certificate verification |
| `shareLinkService.getTimelineEvents` | Timeline events |
| `tamperClassifierService` | Tamper vectors + score |
| `monitoringService.listMonitors` | Leak intelligence (crawler) |
| `generateLightweightDna` | Phase 2 lightweight DNA (when enabled) |

---

## 4. New Orchestration Flow

**Endpoint:** `POST /api/v1/forensics/unified-investigate`  
**Auth:** JWT required (`requireAuth`)  
**Upload field:** `image`

```
Upload file
  → leakedFileVerifyService.verify          (1. identity)
  → generateLightweightDna (optional)       (2. lightweight DNA)
  → vaultAutoMatchService.findMatch         (3–4. vault search + locate)
  → certificateService.verify               (5. certificate)
  → DnaComparisonService.compare            (6. 15-layer DNA)
  → tamperClassifierService + leak signals  (7. tamper)
  → leak verify recipient data              (8–10. recipient, access, sharing)
  → shareLinkService.getTimelineEvents      (11. timeline)
  → monitoringService.listMonitors          (12–13. crawler)
  → assemble UnifiedInvestigationReport     (14. report)
```

**Core files:**
- `src/services/forensics/unified-investigation.orchestrator.ts`
- `src/types/unified-investigation.types.ts`
- `src/api/controllers/unified-investigation.controller.ts`
- `src/api/routes/unified-investigation.routes.ts`

**Shared extraction:** `src/services/forensics/vault-auto-match.service.ts` — also used by `auto-compare.controller.ts` (refactored, same behavior).

---

## 5. UI Screenshots

Run locally and capture:

```bash
# Terminal 1 — backend
npm run dev

# Terminal 2 — frontend
cd client && npm run dev
```

Navigate to `http://localhost:3000/unified-investigation` after login.

---

## 6. Files Modified / Added

### Added
- `client/src/pages/UnifiedInvestigationPage.tsx`
- `src/services/forensics/unified-investigation.orchestrator.ts`
- `src/services/forensics/vault-auto-match.service.ts`
- `src/types/unified-investigation.types.ts`
- `src/api/controllers/unified-investigation.controller.ts`
- `src/api/routes/unified-investigation.routes.ts`
- `tests/forensics/unified-investigation.test.ts`
- `docs/UNIFIED-INVESTIGATION-IMPLEMENTATION-REPORT.md`

### Modified (additive only)
- `src/app.ts` — mount `unifiedInvestigationRouter` at `/forensics`
- `client/src/components/nav/Sidebar.tsx` — **Unified Investigation** under Forensics
- `client/src/router.tsx` — route registration
- `client/src/services/dashboard.api.ts` — `unifiedInvestigate()` helper
- `src/api/controllers/auto-compare.controller.ts` — uses `vaultAutoMatchService` (no API change)

---

## 7. Integration Points

| Layer | Integration |
|-------|-------------|
| Frontend | `unifiedInvestigate(file)` → `POST /forensics/unified-investigate` |
| Backend router | `app.use(\`${apiPrefix}/forensics\`, unifiedInvestigationRouter)` |
| Sidebar | Forensics → Unified Investigation (`/unified-investigation`) |
| Tenant scope | `ownerUserId` from JWT; vault match scoped to user |
| Phase 2 | Lightweight DNA step skipped when `DNA_PHASE2_ENABLED=false` |
| Monitoring | Leak section populated when crawler results exist on monitor records |

---

## 8. Backward Compatibility

| Module | Status |
|--------|--------|
| DNA Compare | Unchanged route + API |
| Verify Leaked File | Unchanged |
| Vault Explorer | Unchanged |
| Generate DNA | Unchanged |
| DNA Records / Timeline | Unchanged |
| Auto Compare API | Same contract; internal match logic extracted to shared service |
| Prisma schema | No changes |
| Breaking API changes | None |

---

## 9. Testing Checklist

### Local
- [ ] Login and open **Forensics → Unified Investigation**
- [ ] Upload a vault file copy → full report with DNA layers
- [ ] Upload unknown file → no-match report with identity partial data
- [ ] Scan document mode → camera/gallery triggers same pipeline
- [ ] Evidence Package JSON downloads work
- [ ] DNA Compare page still works (`/compare`)
- [ ] Verify Leaked File still works (`/verify-leaked`)

### API
- [ ] `POST /api/v1/forensics/unified-investigate` returns 401 without JWT
- [ ] Returns 400 without file
- [ ] Returns `report.pipeline` with 14 steps on success path

### Automated
```bash
npm test -- tests/forensics/unified-investigation.test.ts
```

### Production (when deploying)
- [ ] Render backend deploy
- [ ] Vercel frontend deploy
- [ ] Live URL: `https://dna-pinit-web.vercel.app/unified-investigation`

---

## Report Sections (UI)

1. Investigation Summary  
2. Original Owner  
3. Recipient Attribution  
4. 15-Layer DNA Analysis  
5. Tamper Analysis  
6. Timeline  
7. Access Intelligence  
8. Leak Intelligence  
9. Identity Proof  
10. Evidence Package (JSON downloads; Legal Bundle future)

---

*Generated for evaluation — existing forensic modules remain available until Unified Investigation is approved for production.*
