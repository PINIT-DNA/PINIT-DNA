# PINIT-DNA — Limitations and Future Roadmap

**Document version:** 1.0  
**Purpose:** Honest assessment of current constraints and planned enhancements  
**Rule:** Limitations verified from code and deployment behaviour; future items marked Planned unless implemented

---

## 1. Current Limitations

### 1.1 Web Application Limitations

| Limitation | Detail |
|------------|--------|
| No post-download tracking | After HTTP download, server cannot monitor file on recipient device |
| No remote file deletion | Downloaded bytes cannot be revoked or erased remotely |
| No WhatsApp forward detection | Sharing via messenger does not generate server events |
| Browser-only GPS | Location requires user consent; accuracy varies; no background tracking |
| JWT session bound to browser | Token in localStorage; clearing browser data requires re-login |
| Render free-tier cold starts | First API call after idle may take 30–90 seconds |
| Investigation timeouts | Large files / heavy crops may hit timeout on free-tier (`investigation-performance.ts`) |
| Single backend instance | No horizontal scaling configuration in `render.yaml` free plan |

### 1.2 DNA Engine Limitations

| Limitation | Detail |
|------------|--------|
| L11 deepfake | Heuristic byte analysis only — not ML model |
| L12 watermark record | Hash stored; actual DCT embed depends on vault/TEP pipeline |
| L14 ZK proof | Hash commitment — not true zero-knowledge protocol |
| L15 biometric | Database face embedding hash; not embedded in file by default |
| Video engine | Binary header/chunk SimHash; ffprobe/keyframe pHash not implemented |
| Audio engine | Chunk SimHash; Chromaprint not implemented |
| Probe L11–L15 | Not generated during investigation probe (no ownerUserId on probe path) |
| L7–L15 comparison weight | Zero weight in DNA score during standard compare |

### 1.3 Investigation Limitations

| Limitation | Detail |
|------------|--------|
| Heavy crop matching | May require local patch DNA rescue; not guaranteed for all crops |
| Camera scan quality | Probe DNA quality depends on capture conditions |
| INSUFFICIENT_EVIDENCE | Returned on timeout before vault candidate locked |
| Single winner | Ranking walks candidates but reports one accepted candidate |
| image-candidate-acceptance.service.ts | Exists but not wired into live pipeline |

### 1.4 Provenance and TEP Limitations

| Limitation | Detail |
|------------|--------|
| TEP expiry not enforced | expiresAt stored; extraction does not check |
| Revoked TEP still matches | duplicate-check does not filter REVOKED status |
| No dedicated download_events table | Uses provenance payload only |
| FORWARDED / RECOVERED / CRAWLER_DETECTION | Declared but not appended at runtime |
| Share revoke provenance | No live REVOKED append on share deactivate |
| Certificate revoke provenance | Legacy synthesis only |

### 1.5 Deployment Limitations

| Limitation | Detail |
|------------|--------|
| Prisma migrate on existing DB | P3005 error on databases without migration history; workaround via `ensure-provenance-table.cjs` |
| Multiple Render services | Must ensure Vercel frontend points to backend with correct Supabase DATABASE_URL |
| Python AI sidecar | Optional; not started in production by default |
| Apache Tika | Optional; enhanced metadata when available |

---

## 2. Future Enhancements

### Phase A — Stabilise Investigation (In Progress)

| Item | Status |
|------|--------|
| Evidence pairing L6/L7–L15 | Implemented |
| Timeout tuning for Render | Implemented |
| Derivative-aware scoring | Implemented |
| Deterministic investigation runs | Ongoing |

### Phase B — Protected Download + TEP (Implemented)

| Item | Status |
|------|--------|
| TEP v3.0 multi-layer export | Implemented |
| Download custody events | Implemented |
| Tracking dashboard | Implemented |
| TEP revoke | Implemented |

### Phase C — Evidence Timeline (Partially Implemented)

| Item | Status |
|------|--------|
| Append-only provenance table | Implemented |
| Investigation timeline attachment | Implemented |
| Live SHARED/OPENED append | Not Yet Implemented |
| Visual timeline UI (react-vertical-timeline) | Planned |

### Phase D — Chain of Custody (Partially Implemented)

| Item | Status |
|------|--------|
| chain-of-custody.service.ts | Implemented |
| Event hash chaining | Planned |
| Formal legal export format | Planned |

### Phase E — Investigation Dashboard (Partially Implemented)

| Item | Status |
|------|--------|
| Unified Investigation page | Implemented |
| PDF/ZIP report export | Implemented |
| Forensic dashboard | Implemented |
| Enterprise analyst portal | Planned |

### Phase F — Native Mobile/Desktop Apps (Planned)

| Item | Description |
|------|-------------|
| PINIT Viewer | Controlled file open with licence check |
| Device-bound encryption | Stronger post-download control |
| Background custody sync | Offline event queue |
| Native GPS | Higher accuracy location at generation/download |
| Push alerts | Re-discovery and leak notifications |

### Phase G — AI Enhancements (Optional / Planned)

| Item | Description |
|------|-------------|
| ML deepfake detection | Replace L11 heuristics |
| Camera quality assessment | Pre-scan quality gate |
| Document boundary detection | Auto-crop for camera scans |
| Semantic similarity upgrade | Better difficult-case matching |
| CLIP embeddings (DNA_L11_CLIP) | Config flag exists; default off |

---

## 3. Web vs Native Comparison

| Capability | Web (current) | Native (planned) |
|------------|---------------|------------------|
| DNA generation | Yes | Yes |
| Vault encryption | Yes | Yes |
| Protected download | Yes | Yes + device binding |
| Post-download tracking | No | Partial (viewer events) |
| Offline file control | No | Yes (encrypted container) |
| GPS background | No | Possible with permission |
| Remote revocation of file open | No | Yes (licence check) |
| WhatsApp detection | No | No (platform limitation) |

---

## 4. Continuous and Offline Tracking

| Feature | Current | Future |
|---------|---------|--------|
| Continuous file location tracking | Not Yet Implemented | Native app + viewer |
| Offline event recording | Not Yet Implemented | Native queue + sync |
| GPS at DNA generation | Optional consent (web) | Native high-accuracy |
| GPS at download | Geo-IP only | Client GPS + Geo-IP |
| Monitor crawler | Implemented (enrollment required) | Enhanced providers |

---

## 5. Protected Viewer (Planned)

Not Yet Implemented. Planned capabilities:

- Open TEP exports only inside PINIT Viewer  
- Report OPENED events with session ID  
- Enforce TEP expiry and revocation before decrypt  
- Block screenshot (platform-dependent)  

---

## 6. Leak Intelligence

| Feature | Status |
|---------|--------|
| Leak attribution API | Implemented — `share-link.controller.ts` forensics/attribute-leak |
| Leak intelligence in investigation | Implemented — `buildLeakIntelligence()` |
| Monitor alerts | Implemented |
| Automatic internet-wide leak search | Not Yet Implemented |

---

## 7. Crawler

| Feature | Status |
|---------|--------|
| Monitor enrollment | Implemented |
| Filename search provider | Implemented |
| Scheduled checks | Implemented — vault-scheduler |
| CRAWLER_DETECTION provenance | Not Yet Implemented |
| Image similarity crawl | Planned |

---

## 8. Deep Learning

| Feature | Status |
|---------|--------|
| Python AI sidecar (embeddings, OCR, vision) | Implemented — `python-ai/` |
| FAISS vector index | Implemented |
| Semantic search | Implemented |
| CLIP layer (L11) | Config flag off by default |
| Neural deepfake model | Planned |
| Self-learning DNA (DNA_P2_SELF_LEARNING) | Config flag off by default |

---

## 9. Known Technical Debt

| Item | Location |
|------|----------|
| README describes "6-layer" in places | README.md, package.json |
| layers/index.ts exports L1–L6 only | src/services/layers/index.ts |
| Multiple Render backend URLs historically | api.config.ts (corrected to pinit-dna-uf5y) |
| org/main branch behind ashwitha | Git branches diverged |

---

*End of document*
