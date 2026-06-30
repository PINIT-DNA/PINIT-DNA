"""
PINIT-DNA — Python AI Microservice v2.1 (Enterprise infrastructure)
FastAPI service on port 8001

Phase 1: /embed, /index, /search, /health
Phase 3: /search/hybrid (keyword + semantic)
Phase 4: Confidence thresholds — hide weak matches
Phase 5: /ocr, /duplicates, /similar
Enterprise prep: modular services/, startup diagnostics, enhanced /health
"""

import os, json, time, hashlib, re, logging

# Silence HuggingFace / tqdm progress bars in Node dev logs (stderr → [warn])
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TQDM_DISABLE", "1")

from pathlib import Path
from typing import Optional
from datetime import datetime

from config import SERVICE_NAME, SERVICE_VERSION, EMBEDDING_MODEL, EMBEDDING_DIMENSION
from diagnostics import run_startup_diagnostics, get_health_extensions
from services import enterprise_services_status

import numpy as np
import faiss
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("pinit-dna-ai")

# ── Enterprise dependency diagnostics (non-fatal for optional modules) ────────

run_startup_diagnostics()

# ── Paths ─────────────────────────────────────────────────────────────────────

BASE_DIR        = Path(__file__).parent
DATA_DIR        = BASE_DIR / "data"
MODEL_CACHE_DIR = BASE_DIR / "models"
INDEX_FILE      = DATA_DIR / "faiss_index.bin"
META_FILE       = DATA_DIR / "metadata.json"

DATA_DIR.mkdir(exist_ok=True)
MODEL_CACHE_DIR.mkdir(exist_ok=True)

# ── Model & Index ─────────────────────────────────────────────────────────────

DIMENSION = EMBEDDING_DIMENSION

log.info("Loading sentence-transformer model (%s)…", EMBEDDING_MODEL)
model = SentenceTransformer(EMBEDDING_MODEL, cache_folder=str(MODEL_CACHE_DIR))
log.info("Model loaded.")


def encode_one(text: str) -> np.ndarray:
    return model.encode([text], show_progress_bar=False)[0]

def load_or_create_index():
    if INDEX_FILE.exists() and META_FILE.exists():
        try:
            if INDEX_FILE.stat().st_size < 16:
                raise RuntimeError("FAISS index file is empty or truncated")
            log.info("Loading existing FAISS index from disk…")
            idx = faiss.read_index(str(INDEX_FILE))
            meta = json.loads(META_FILE.read_text())
            log.info(f"Index loaded: {idx.ntotal} vectors")
            return idx, meta
        except Exception as exc:
            backup = INDEX_FILE.with_suffix(".bin.corrupt")
            try:
                INDEX_FILE.rename(backup)
                log.warning("Corrupt FAISS index quarantined to %s — creating fresh index (%s)", backup.name, exc)
            except OSError:
                INDEX_FILE.unlink(missing_ok=True)
                log.warning("Corrupt FAISS index removed — creating fresh index (%s)", exc)
    log.info("Creating new FAISS index…")
    return faiss.IndexFlatL2(DIMENSION), []

index, metadata = load_or_create_index()

def save_index():
    faiss.write_index(index, str(INDEX_FILE))
    META_FILE.write_text(json.dumps(metadata, indent=2))

# ── FastAPI ───────────────────────────────────────────────────────────────────

app = FastAPI(title=SERVICE_NAME, version=SERVICE_VERSION)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Request models ────────────────────────────────────────────────────────────

class EmbedRequest(BaseModel):
    text: str

class IndexRequest(BaseModel):
    dnaRecordId: str
    filename:    str
    fileType:    Optional[str] = "UNKNOWN"
    text:        str           # real content (OCR + doc text + metadata)
    title:       Optional[str] = None
    author:      Optional[str] = None
    keywords:    Optional[str] = None

class SearchRequest(BaseModel):
    query:     str
    topK:      Optional[int]   = 10
    threshold: Optional[float] = 0.50   # Phase 5: default 50% minimum

class HybridSearchRequest(BaseModel):
    query:          str
    topK:           Optional[int]   = 10
    threshold:      Optional[float] = 0.50
    keywordWeight:  Optional[float] = 0.40  # Phase 4
    semanticWeight: Optional[float] = 0.60  # Phase 4

class DuplicateRequest(BaseModel):
    text:      str
    topK:      Optional[int]   = 10
    threshold: Optional[float] = 0.92

# ── Confidence classification (Phase 5) ───────────────────────────────────────

def confidence_label(score: float) -> dict:
    if score >= 0.85: return { "level": "HIGH_CONFIDENCE",  "label": "High Confidence",  "color": "success" }
    if score >= 0.70: return { "level": "STRONG_MATCH",     "label": "Strong Match",      "color": "success" }
    if score >= 0.50: return { "level": "POSSIBLE_MATCH",   "label": "Possible Match",    "color": "warning" }
    return              { "level": "WEAK_MATCH",             "label": "Weak Match",        "color": "muted"   }

# ── Keyword scoring (Phase 4) ─────────────────────────────────────────────────

def keyword_score(query: str, text: str) -> float:
    if not query or not text: return 0.0
    qwords = set(re.findall(r'[a-z0-9]{2,}', query.lower()))
    twords = set(re.findall(r'[a-z0-9]{2,}', text.lower()))
    if not qwords: return 0.0
    # Exact word hits
    exact = len(qwords & twords) / len(qwords)
    # Substring hits (partial match)
    text_lower = text.lower()
    partial = sum(1 for w in qwords if w in text_lower) / len(qwords)
    return max(exact, partial * 0.8)

# ── Phase 1: Health ───────────────────────────────────────────────────────────

@app.get("/health")
def health():
    diag = get_health_extensions()
    return {
        "status":    "online",
        "service":   SERVICE_NAME,
        "version":   SERVICE_VERSION,
        "model":     EMBEDDING_MODEL,
        "dimension": DIMENSION,
        "indexed":   index.ntotal,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        # Enterprise extensions (additive — existing clients ignore unknown keys)
        "pythonVersion": diag.get("pythonVersion"),
        "ocrAvailable": diag.get("ocrAvailable"),
        "opencvAvailable": diag.get("opencvAvailable"),
        "torchAvailable": diag.get("torchAvailable"),
        "gpuAvailable": diag.get("gpuAvailable"),
        "installedModules": diag.get("modules"),
        "moduleDetails": diag.get("moduleDetails"),
        "enterpriseServices": enterprise_services_status(),
        "platform": diag.get("platform"),
        "diagnosticWarnings": diag.get("warnings", []),
    }

# ── Phase 1: Embed ────────────────────────────────────────────────────────────

@app.post("/embed")
def embed(req: EmbedRequest):
    if not req.text.strip(): raise HTTPException(400, "text must not be empty")
    start = time.time()
    vec   = encode_one(req.text).tolist()
    return { "embedding": vec, "dimension": len(vec), "processingMs": round((time.time()-start)*1000,1) }

# ── Phase 1 + 3: Index (content-first) ───────────────────────────────────────

@app.post("/index")
def index_document(req: IndexRequest):
    if not req.text.strip(): raise HTTPException(400, "text must not be empty")
    start = time.time()

    # Remove old entries for this dnaRecordId
    for m in metadata:
        if m.get("dnaRecordId") == req.dnaRecordId:
            m["_deleted"] = True

    # Build searchable text: title + author + keywords + body
    parts = [
        req.title    or "",
        req.author   or "",
        req.keywords or "",
        req.filename,
        req.text[:5000],   # first 5000 chars of real content (covers CMR at pos 3626)
    ]
    full_text = " ".join(p for p in parts if p).strip()

    vec = encode_one(full_text)
    index.add(np.array([vec], dtype=np.float32))

    entry = {
        "dnaRecordId": req.dnaRecordId,
        "filename":    req.filename,
        "fileType":    req.fileType,
        "title":       req.title or req.filename,
        "author":      req.author or "",
        "snippet":     req.text[:500].replace("\n", " "),   # 500 chars for display
        "fullText":    full_text[:5000],                     # 5000 chars for verification
        "textHash":    hashlib.sha256(full_text.encode()).hexdigest()[:16],
        "indexedAt":   datetime.utcnow().isoformat() + "Z",
        "_deleted":    False,
    }
    metadata.append(entry)
    save_index()

    ms = round((time.time()-start)*1000,1)
    log.info(f"Indexed {req.dnaRecordId[:8]}… ({req.filename}) — total: {index.ntotal}")
    return { "success": True, "dnaRecordId": req.dnaRecordId, "totalIndexed": index.ntotal, "processingMs": ms }

# ── Phase 1: Semantic Search with confidence threshold ────────────────────────

@app.post("/search")
def semantic_search(req: SearchRequest):
    if not req.query.strip(): raise HTTPException(400, "query must not be empty")
    if index.ntotal == 0: return { "results": [], "query": req.query, "totalIndexed": 0, "count": 0 }

    start = time.time()
    vec   = encode_one(req.query)
    k     = min(req.topK * 4, index.ntotal)
    D, I  = index.search(np.array([vec], dtype=np.float32), k)

    results, seen = [], set()
    for dist, idx_pos in zip(D[0], I[0]):
        if idx_pos < 0 or idx_pos >= len(metadata): continue
        meta = metadata[idx_pos]
        if meta.get("_deleted"): continue
        rid = meta["dnaRecordId"]
        if rid in seen: continue
        seen.add(rid)

        similarity = float(1.0 / (1.0 + dist))

        # Phase 5: Apply confidence threshold — hide weak matches
        if similarity < req.threshold: continue

        conf = confidence_label(similarity)
        results.append({
            "dnaRecordId":     meta["dnaRecordId"],
            "filename":        meta["filename"],
            "fileType":        meta["fileType"],
            "title":           meta.get("title", meta["filename"]),
            "author":          meta.get("author", ""),
            "snippet":         meta.get("snippet", ""),
            "similarity":      round(similarity, 4),
            "similarityPercent": round(similarity * 100),
            "confidence":      conf,
            "searchType":      "semantic",
            "indexedAt":       meta["indexedAt"],
        })
        if len(results) >= req.topK: break

    results.sort(key=lambda x: x["similarity"], reverse=True)
    return {
        "query":        req.query,
        "results":      results,
        "count":        len(results),
        "totalIndexed": index.ntotal,
        "processingMs": round((time.time()-start)*1000,1),
        "threshold":    req.threshold,
    }

# ── Phase 4: Hybrid Search (keyword + semantic) ───────────────────────────────

@app.post("/search/hybrid")
def hybrid_search(req: HybridSearchRequest):
    if not req.query.strip(): raise HTTPException(400, "query must not be empty")
    if index.ntotal == 0: return { "results": [], "query": req.query, "totalIndexed": 0, "count": 0 }

    start = time.time()

    # Step 1: Get semantic results (lower threshold to get more candidates)
    vec  = encode_one(req.query)
    k    = min(req.topK * 6, index.ntotal)
    D, I = index.search(np.array([vec], dtype=np.float32), k)

    results, seen = [], set()
    for dist, idx_pos in zip(D[0], I[0]):
        if idx_pos < 0 or idx_pos >= len(metadata): continue
        meta = metadata[idx_pos]
        if meta.get("_deleted"): continue
        rid = meta["dnaRecordId"]
        if rid in seen: continue
        seen.add(rid)

        sem_score  = float(1.0 / (1.0 + dist))
        kw_score   = keyword_score(req.query, meta.get("fullText", "") + " " + meta["filename"])

        # Phase 4: Hybrid score = (keyword × weight) + (semantic × weight)
        hybrid = (kw_score * req.keywordWeight) + (sem_score * req.semanticWeight)

        # Phase 5: Apply threshold to hybrid score
        if hybrid < req.threshold: continue

        conf = confidence_label(hybrid)
        results.append({
            "dnaRecordId":      meta["dnaRecordId"],
            "filename":         meta["filename"],
            "fileType":         meta["fileType"],
            "title":            meta.get("title", meta["filename"]),
            "author":           meta.get("author", ""),
            "snippet":          meta.get("snippet", ""),
            "similarity":       round(hybrid, 4),
            "similarityPercent": round(hybrid * 100),
            "semanticScore":    round(sem_score, 4),
            "keywordScore":     round(kw_score, 4),
            "hybridScore":      round(hybrid, 4),
            "confidence":       conf,
            "searchType":       "hybrid",
            "indexedAt":        meta["indexedAt"],
        })

    results.sort(key=lambda x: x["similarity"], reverse=True)
    results = results[:req.topK]

    return {
        "query":           req.query,
        "results":         results,
        "count":           len(results),
        "totalIndexed":    index.ntotal,
        "processingMs":    round((time.time()-start)*1000,1),
        "threshold":       req.threshold,
        "keywordWeight":   req.keywordWeight,
        "semanticWeight":  req.semanticWeight,
        "searchType":      "hybrid",
    }

# ── Phase 3: OCR endpoint ─────────────────────────────────────────────────────

@app.post("/ocr")
async def ocr_extract(file: UploadFile = File(...)):
    try:
        import pytesseract
        from PIL import Image
        import io

        contents = await file.read()
        start    = time.time()
        image    = Image.open(io.BytesIO(contents)).convert("RGB")
        text     = pytesseract.image_to_string(image, lang="eng").strip()
        ms       = round((time.time()-start)*1000,1)

        return {
            "success":      True,
            "text":         text,
            "wordCount":    len(text.split()) if text else 0,
            "processingMs": ms,
            "filename":     file.filename,
        }
    except ImportError:
        raise HTTPException(503, "pytesseract not installed")
    except Exception as e:
        raise HTTPException(500, f"OCR failed: {str(e)}")

# ── Computer vision: ORB/AKAZE compare ───────────────────────────────────────

@app.post("/cv/compare")
async def cv_compare_images(
    probe: UploadFile = File(...),
    reference: UploadFile = File(...),
):
    from services.computer_vision import computer_vision_service

    start = time.time()
    probe_bytes = await probe.read()
    ref_bytes = await reference.read()
    result = computer_vision_service.compare_images(probe_bytes, ref_bytes)
    if not result.success:
        raise HTTPException(503, result.message or "CV compare failed")
    return {
        "success": True,
        **result.data,
        "processingMs": round((time.time() - start) * 1000, 1),
    }

@app.post("/cv/local-index")
async def cv_extract_local_index(
    image: UploadFile = File(...),
    patch_size: int = 32,
):
    """Extract global ORB/AKAZE descriptors for PINIT Local DNA vault index."""
    from services.computer_vision import computer_vision_service

    start = time.time()
    image_bytes = await image.read()
    result = computer_vision_service.extract_local_index(image_bytes, patch_size=patch_size)
    if not result.success:
        raise HTTPException(503, result.message or "Local index extract failed")
    return {
        "success": True,
        **result.data,
        "processingMs": round((time.time() - start) * 1000, 1),
    }

@app.post("/cv/match-descriptors")
async def cv_match_descriptors(
    probe: UploadFile = File(...),
    descriptors: str = "",
):
    """Match probe image against stored ORB descriptor JSON."""
    from services.computer_vision import computer_vision_service

    start = time.time()
    probe_bytes = await probe.read()
    try:
        ref_desc = json.loads(descriptors) if descriptors else {}
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid descriptors JSON")
    result = computer_vision_service.match_local_descriptors(probe_bytes, ref_desc)
    if not result.success:
        raise HTTPException(503, result.message or "Descriptor match failed")
    return {
        "success": True,
        **result.data,
        "processingMs": round((time.time() - start) * 1000, 1),
    }

# ── Phase 6: Duplicate detection ─────────────────────────────────────────────

@app.post("/duplicates")
def detect_duplicates(req: DuplicateRequest):
    if index.ntotal == 0: return { "duplicates": [], "nearMatches": [] }

    vec  = encode_one(req.text)
    k    = min(req.topK, index.ntotal)
    D, I = index.search(np.array([vec], dtype=np.float32), k)

    duplicates, near_matches, seen = [], [], set()
    for dist, idx_pos in zip(D[0], I[0]):
        if idx_pos < 0 or idx_pos >= len(metadata): continue
        meta = metadata[idx_pos]
        if meta.get("_deleted"): continue
        rid = meta["dnaRecordId"]
        if rid in seen: continue
        seen.add(rid)

        sim = float(1.0 / (1.0 + dist))
        entry = {
            "dnaRecordId":  meta["dnaRecordId"],
            "filename":     meta["filename"],
            "fileType":     meta["fileType"],
            "similarity":   round(sim, 4),
            "classification": "DUPLICATE" if sim >= req.threshold else "NEAR_MATCH",
        }
        if sim >= req.threshold:
            duplicates.append(entry)
        elif sim >= 0.70:
            near_matches.append(entry)

    return {
        "duplicatesFound":  len(duplicates),
        "nearMatchesFound": len(near_matches),
        "duplicates":       sorted(duplicates,   key=lambda x: x["similarity"], reverse=True),
        "nearMatches":      sorted(near_matches,  key=lambda x: x["similarity"], reverse=True),
    }

# ── Similar files ─────────────────────────────────────────────────────────────

@app.post("/similar")
def find_similar(req: SearchRequest):
    req.threshold = max(req.threshold, 0.30)
    return semantic_search(req)

# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/stats")
def get_stats():
    active   = [m for m in metadata if not m.get("_deleted")]
    ft_count: dict = {}
    for m in active:
        ft = m.get("fileType", "UNKNOWN")
        ft_count[ft] = ft_count.get(ft, 0) + 1

    return {
        "totalVectors":    index.ntotal,
        "activeDocuments": len(active),
        "fileTypeBreakdown": ft_count,
        "model":           EMBEDDING_MODEL,
        "dimension":       DIMENSION,
        "indexSizeBytes":  INDEX_FILE.stat().st_size if INDEX_FILE.exists() else 0,
    }

@app.get("/debug/index")
def debug_index():
    """Show exactly what text was indexed for each document."""
    active = [m for m in metadata if not m.get("_deleted")]
    result = []
    for m in active:
        full_text = m.get("fullText", "")
        snippet   = m.get("snippet", "")
        title     = m.get("title", "")
        author    = m.get("author", "")

        # Determine embedding source
        if len(snippet) > 100 and snippet != m.get("filename",""):
            source = "document_content"
        elif title and title != m.get("filename",""):
            source = "title_plus_filename"
        else:
            source = "filename_only"

        result.append({
            "dnaRecordId":      m["dnaRecordId"],
            "filename":         m["filename"],
            "fileType":         m["fileType"],
            "title":            title,
            "author":           author,
            "embeddingSource":  source,
            "textLength":       len(full_text),
            "snippetLength":    len(snippet),
            "first500chars":    full_text[:500] if full_text else snippet[:500],
            "hasRealContent":   len(snippet) > 50 and snippet.replace(m["filename"],"").strip() != "",
            "indexedAt":        m["indexedAt"],
        })
    return {
        "totalActive":   len(active),
        "withContent":   sum(1 for r in result if r["hasRealContent"]),
        "filenameOnly":  sum(1 for r in result if not r["hasRealContent"]),
        "documents":     sorted(result, key=lambda x: x["textLength"], reverse=True),
    }

@app.delete("/index/{dna_record_id}")
def remove_from_index(dna_record_id: str):
    count = sum(1 for m in metadata if m["dnaRecordId"] == dna_record_id and not m.get("_deleted") and m.update({"_deleted": True}) is None)
    if count: save_index()
    return { "removed": count }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True, log_level="info")
