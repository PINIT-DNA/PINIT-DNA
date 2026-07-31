"""
Enterprise Forensic Scanner — multi-stage image identification pipeline.

Stages: normalize → multi-scale → feature extract → tile FAISS → crop/homography.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import re
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from ..base import EnterpriseAIService, ServiceResult

try:
    from ..semantic_embeddings import semantic_embeddings_service
except ImportError:
    semantic_embeddings_service = None

try:
    from ..screenshot import screenshot_service
except ImportError:
    screenshot_service = None

try:
    from ..deepfake import deepfake_service
except ImportError:
    deepfake_service = None

try:
    from ..authenticity_ensemble import authenticity_ensemble_service
except ImportError:
    authenticity_ensemble_service = None

BASE_DIR = Path(__file__).resolve().parents[2]
TILE_INDEX_FILE = BASE_DIR / "data" / "tile_faiss_index.bin"
TILE_META_FILE = BASE_DIR / "data" / "tile_metadata.json"


def _hex_to_bits(hex_str: str) -> str:
    bits = ""
    for ch in hex_str:
        bits += format(int(ch, 16), "04b")
    return bits


def _hamming_hex(a: str, b: str) -> int:
    if not a or not b:
        return 64
    la, lb = min(len(a), len(b)), min(len(a), len(b))
    dist = 0
    for i in range(la):
        x = int(a[i], 16) ^ int(b[i], 16)
        dist += bin(x).count("1")
    return dist + abs(len(a) - len(b)) * 4


class ForensicScannerService(EnterpriseAIService):
    name = "forensic_scanner"

    def __init__(self) -> None:
        self._tile_index = None
        self._tile_meta: list[dict[str, Any]] = []
        self._tile_dim = 128
        self._load_tile_index()

    def is_available(self) -> bool:
        try:
            import cv2  # noqa: F401
            from PIL import Image  # noqa: F401
        except ImportError:
            return False
        return True

    def status(self) -> dict[str, Any]:
        return {
            "module": self.name,
            "available": self.is_available(),
            "phase": "forensic_identification",
            "capabilities": [
                "image_normalization",
                "multi_scale_generation",
                "perceptual_hashing",
                "orb_akaze_features",
                "overlapping_tile_index",
                "crop_homography_detection",
                "weighted_similarity_fusion",
                "pyramid_tile_matching",
                "tamper_localization",
                "explainable_match_reasons",
                "clip_semantic_search",
            ],
            "tileIndexSize": self._tile_index.ntotal if self._tile_index else 0,
        }

    def _load_tile_index(self) -> None:
        import faiss

        self._tile_dim = 128
        if TILE_INDEX_FILE.exists() and TILE_META_FILE.exists():
            try:
                self._tile_index = faiss.read_index(str(TILE_INDEX_FILE))
                self._tile_meta = json.loads(TILE_META_FILE.read_text())
                return
            except Exception:
                pass
        self._tile_index = faiss.IndexFlatL2(self._tile_dim)
        self._tile_meta = []

    def _save_tile_index(self) -> None:
        import faiss

        TILE_INDEX_FILE.parent.mkdir(exist_ok=True)
        faiss.write_index(self._tile_index, str(TILE_INDEX_FILE))
        TILE_META_FILE.write_text(json.dumps(self._tile_meta, indent=2))

    def _decode_rgb(self, image_bytes: bytes, max_dim: int = 2048) -> np.ndarray | None:
        try:
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            w, h = img.size
            scale = min(1.0, max_dim / max(w, h))
            if scale < 1.0:
                img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
            return np.array(img)
        except Exception:
            return None

    def _normalize(self, rgb: np.ndarray) -> np.ndarray:
        import cv2

        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        gray = cv2.fastNlMeansDenoising(gray, None, 6, 7, 21)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
        gamma = 1.05
        lut = np.array([((i / 255.0) ** (1 / gamma)) * 255 for i in range(256)]).astype("uint8")
        return cv2.LUT(gray, lut)

    def _phash_hex(self, gray: np.ndarray, size: int = 8) -> str:
        import cv2

        small = cv2.resize(gray, (size + 1, size), interpolation=cv2.INTER_AREA)
        dct = cv2.dct(np.float32(small))
        low = dct[:size, :size]
        med = np.median(low[1:, 1:])
        bits = (low > med).flatten()
        hex_str = ""
        for i in range(0, len(bits), 4):
            nibble = bits[i : i + 4]
            val = int("".join("1" if b else "0" for b in nibble), 2)
            hex_str += format(val, "x")
        return hex_str

    def _dhash_hex(self, gray: np.ndarray) -> str:
        import cv2

        small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
        diff = small[:, 1:] > small[:, :-1]
        bits = diff.flatten()
        hex_str = ""
        for i in range(0, min(64, len(bits)), 4):
            nibble = bits[i : i + 4]
            val = int("".join("1" if b else "0" for b in nibble), 2)
            hex_str += format(val, "x")
        return hex_str.zfill(16)

    def _ahash_hex(self, gray: np.ndarray) -> str:
        import cv2

        small = cv2.resize(gray, (8, 8), interpolation=cv2.INTER_AREA)
        avg = small.mean()
        bits = (small > avg).flatten()
        hex_str = ""
        for i in range(0, len(bits), 4):
            nibble = bits[i : i + 4]
            val = int("".join("1" if b else "0" for b in nibble), 2)
            hex_str += format(val, "x")
        return hex_str.zfill(16)

    def _color_histogram(self, rgb: np.ndarray) -> list[float]:
        import cv2

        hist = cv2.calcHist([rgb], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
        hist = cv2.normalize(hist, hist).flatten()
        return [round(float(v), 5) for v in hist[:32]]

    def _edge_density(self, gray: np.ndarray) -> float:
        import cv2

        edges = cv2.Canny(gray, 50, 150)
        return round(float(edges.mean()) / 255.0, 4)

    def _texture_score(self, gray: np.ndarray) -> float:
        import cv2

        lap = cv2.Laplacian(gray, cv2.CV_64F)
        return round(float(lap.var()) / 10000.0, 4)

    def _tile_vector(self, gray_tile: np.ndarray) -> np.ndarray:
        """Compact 128-dim vector from hashes + color stats for FAISS."""
        ph = self._phash_hex(gray_tile)
        dh = self._dhash_hex(gray_tile)
        ah = self._ahash_hex(gray_tile)
        bits = _hex_to_bits(ph) + _hex_to_bits(dh) + _hex_to_bits(ah)
        vec = np.zeros(self._tile_dim, dtype=np.float32)
        for i, bit in enumerate(bits[: self._tile_dim]):
            vec[i] = 1.0 if bit == "1" else 0.0
        vec[64] = gray_tile.mean() / 255.0
        vec[65] = gray_tile.std() / 128.0
        vec[66] = self._edge_density(gray_tile)
        vec[67] = self._texture_score(gray_tile)
        return vec

    def _extract_orb(self, gray: np.ndarray, max_kp: int = 500) -> tuple[list, np.ndarray | None]:
        import cv2

        orb = cv2.ORB_create(nfeatures=max_kp)
        kp, des = orb.detectAndCompute(gray, None)
        if des is None or len(kp) < 8:
            akaze = cv2.AKAZE_create()
            kp, des = akaze.detectAndCompute(gray, None)
        return kp or [], des

    def _generate_pyramid_tiles(
        self,
        gray: np.ndarray,
        sizes: list[int] | None = None,
        overlap: float = 0.5,
        max_total: int = 120,
    ) -> list[dict[str, Any]]:
        """Multi-level pyramid: 64 / 128 / 256 / 512 with 50% overlap."""
        sizes = sizes or [64, 128, 256, 512]
        tiles: list[dict[str, Any]] = []
        for tile_size in sizes:
            level_tiles = self._generate_tiles(
                gray, tile_size=tile_size, overlap=overlap,
                max_tiles=max(20, max_total // len(sizes)),
            )
            for t in level_tiles:
                t["pyramidLevel"] = tile_size
            tiles.extend(level_tiles)
            if len(tiles) >= max_total:
                break
        return tiles[:max_total]

    def _generate_tiles(
        self,
        gray: np.ndarray,
        tile_size: int = 256,
        overlap: float = 0.5,
        max_tiles: int = 80,
    ) -> list[dict[str, Any]]:
        h, w = gray.shape[:2]
        stride = max(8, int(tile_size * (1 - overlap)))
        tiles: list[dict[str, Any]] = []
        for top in range(0, h, stride):
            for left in range(0, w, stride):
                if len(tiles) >= max_tiles:
                    break
                tw = min(tile_size, w - left)
                th = min(tile_size, h - top)
                if tw < 32 or th < 32:
                    continue
                patch = gray[top : top + th, left : left + tw]
                tiles.append({
                    "left": left,
                    "top": top,
                    "width": tw,
                    "height": th,
                    "pHash": self._phash_hex(patch),
                    "dHash": self._dhash_hex(patch),
                    "aHash": self._ahash_hex(patch),
                    "vector": self._tile_vector(patch),
                })
            if len(tiles) >= max_tiles:
                break
        return tiles

    def localize_tamper(
        self,
        probe_bytes: bytes,
        reference_bytes: bytes,
    ) -> ServiceResult:
        """Generate diff heatmap + region stats for investigator overlay."""
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV not available", self.name)

        import cv2

        probe_rgb = self._decode_rgb(probe_bytes, max_dim=1024)
        ref_rgb = self._decode_rgb(reference_bytes, max_dim=1024)
        if probe_rgb is None or ref_rgb is None:
            return ServiceResult(False, {}, "Failed to decode images", self.name)

        ph, pw = probe_rgb.shape[:2]
        ref_resized = cv2.resize(ref_rgb, (pw, ph), interpolation=cv2.INTER_AREA)
        diff = cv2.absdiff(probe_rgb, ref_resized)
        gray_diff = cv2.cvtColor(diff, cv2.COLOR_RGB2GRAY)
        _, thresh = cv2.threshold(gray_diff, 28, 255, cv2.THRESH_BINARY)
        kernel = np.ones((5, 5), np.uint8)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

        modified_pixels = int((thresh > 0).sum())
        total_pixels = max(thresh.size, 1)
        modified_pct = round(modified_pixels / total_pixels * 100, 1)

        heat = cv2.applyColorMap(gray_diff, cv2.COLORMAP_JET)
        overlay = cv2.addWeighted(probe_rgb, 0.55, cv2.cvtColor(heat, cv2.COLOR_BGR2RGB), 0.45, 0)
        overlay[:, :, 2] = np.where(thresh > 0, 255, overlay[:, :, 2])

        buf = io.BytesIO()
        Image.fromarray(overlay.astype(np.uint8)).save(buf, format="PNG")
        overlay_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        regions = []
        for cnt in contours[:8]:
            x, y, w, h = cv2.boundingRect(cnt)
            if w * h < 200:
                continue
            regions.append({
                "x": int(x), "y": int(y), "width": int(w), "height": int(h),
                "type": "modified",
            })

        return ServiceResult(True, {
            "modifiedPercent": modified_pct,
            "visiblePercent": round(100 - modified_pct, 1),
            "insertedRegions": len(regions),
            "regions": regions,
            "overlayPngBase64": overlay_b64,
            "description": f"{modified_pct}% of probe pixels differ from vault original",
        }, "OK", self.name)

    def _fusion_weights(self) -> dict[str, float]:
        """Learned-style fusion weights (tunable via env in production)."""
        return {
            "pHash": 0.14,
            "tile": 0.18,
            "orb": 0.14,
            "clip": 0.22,
            "texture": 0.08,
            "watermark": 0.12,
            "dna": 0.12,
        }

    def _build_match_reasons(
        self,
        signals: dict[str, float],
    ) -> list[dict[str, Any]]:
        reasons = []
        for key, pct in sorted(signals.items(), key=lambda x: x[1], reverse=True):
            if pct < 5:
                continue
            reasons.append({
                "signal": key,
                "label": key.replace("_", " ").title(),
                "percent": round(pct, 1),
                "matched": pct >= 50,
            })
        return reasons

    def _multi_scale(self, gray: np.ndarray) -> dict[str, np.ndarray]:
        import cv2

        scales: dict[str, np.ndarray] = {}
        for dim, label in [(256, "256px"), (512, "512px"), (1024, "1024px")]:
            h, w = gray.shape[:2]
            scale = min(1.0, dim / max(w, h))
            if scale < 1.0:
                scales[label] = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
            else:
                scales[label] = gray.copy()
        return scales

    def extract_features(self, image_bytes: bytes) -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV/Pillow not available", self.name)

        rgb = self._decode_rgb(image_bytes)
        if rgb is None:
            return ServiceResult(False, {}, "Failed to decode image", self.name)

        import cv2

        gray = self._normalize(rgb)
        sha256 = hashlib.sha256(image_bytes).hexdigest()
        phash = self._phash_hex(gray)
        dhash = self._dhash_hex(gray)
        ahash = self._ahash_hex(gray)
        kp, des = self._extract_orb(gray)
        scales = self._multi_scale(gray)
        tiles = self._generate_pyramid_tiles(gray)

        return ServiceResult(True, {
            "sha256": sha256,
            "pHash": phash,
            "dHash": dhash,
            "aHash": ahash,
            "colorHistogram": self._color_histogram(rgb),
            "edgeDensity": self._edge_density(gray),
            "textureScore": self._texture_score(gray),
            "keypointCount": len(kp),
            "imageWidth": int(rgb.shape[1]),
            "imageHeight": int(rgb.shape[0]),
            "scales": list(scales.keys()),
            "tileCount": len(tiles),
            "tiles": [
                {k: v for k, v in t.items() if k != "vector"}
                for t in tiles[:20]
            ],
        }, "OK", self.name)

    def index_vault_tiles(
        self,
        image_bytes: bytes,
        vault_id: str,
        dna_record_id: str,
        filename: str = "",
    ) -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV not available", self.name)

        rgb = self._decode_rgb(image_bytes, max_dim=1600)
        if rgb is None:
            return ServiceResult(False, {}, "Failed to decode", self.name)

        gray = self._normalize(rgb)
        tiles = self._generate_pyramid_tiles(gray)
        if not tiles:
            return ServiceResult(False, {}, "No tiles generated", self.name)

        # CLIP semantic index (parallel path)
        if semantic_embeddings_service and semantic_embeddings_service.is_available():
            semantic_embeddings_service.index_vault_image(
                image_bytes, vault_id, dna_record_id, filename,
            )

        # Remove old tiles for this vault
        keep_meta = [m for m in self._tile_meta if m.get("vaultId") != vault_id]
        removed = len(self._tile_meta) - len(keep_meta)
        self._tile_meta = keep_meta

        if removed and self._tile_index and self._tile_index.ntotal > 0:
            self._rebuild_index_from_meta()
        elif removed:
            import faiss
            self._tile_index = faiss.IndexFlatL2(self._tile_dim)

        vectors = np.vstack([t["vector"] for t in tiles]).astype(np.float32)
        self._tile_index.add(vectors)

        for i, t in enumerate(tiles):
            self._tile_meta.append({
                "vaultId": vault_id,
                "dnaRecordId": dna_record_id,
                "filename": filename,
                "tileIndex": i,
                "left": t["left"],
                "top": t["top"],
                "pHash": t["pHash"],
                "dHash": t["dHash"],
                "aHash": t["aHash"],
            })

        self._save_tile_index()
        return ServiceResult(True, {
            "vaultId": vault_id,
            "tilesIndexed": len(tiles),
            "totalTileVectors": self._tile_index.ntotal if self._tile_index else 0,
        }, "OK", self.name)

    def _rebuild_index_from_meta(self) -> None:
        import faiss

        self._tile_index = faiss.IndexFlatL2(self._tile_dim)
        # Meta-only rebuild cannot restore vectors — callers should re-index from images
        self._tile_meta = []

    def search_tiles(self, image_bytes: bytes, top_k: int = 100) -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV not available", self.name)

        if not self._tile_index or self._tile_index.ntotal == 0:
            return ServiceResult(True, {"candidates": [], "tileMatches": 0}, "Empty tile index", self.name)

        rgb = self._decode_rgb(image_bytes)
        if rgb is None:
            return ServiceResult(False, {}, "Failed to decode probe", self.name)

        gray = self._normalize(rgb)
        probe_tiles = self._generate_pyramid_tiles(gray)
        if not probe_tiles:
            return ServiceResult(True, {"candidates": [], "tileMatches": 0}, "No probe tiles", self.name)

        all_hits: dict[str, dict[str, Any]] = {}
        k = min(top_k, self._tile_index.ntotal)

        for pt in probe_tiles:
            vec = pt["vector"].reshape(1, -1).astype(np.float32)
            D, I = self._tile_index.search(vec, k)
            for dist, idx in zip(D[0], I[0]):
                if idx < 0 or idx >= len(self._tile_meta):
                    continue
                meta = self._tile_meta[idx]
                vid = meta["vaultId"]
                sim = float(1.0 / (1.0 + dist))
                ph_dist = _hamming_hex(pt["pHash"], meta.get("pHash", ""))
                if ph_dist > 18 and sim < 0.55:
                    continue
                hit = all_hits.get(vid)
                if not hit:
                    all_hits[vid] = {
                        "vaultId": vid,
                        "dnaRecordId": meta.get("dnaRecordId"),
                        "filename": meta.get("filename", ""),
                        "tileMatches": 1,
                        "bestSimilarity": sim,
                        "avgPHashDist": ph_dist,
                    }
                else:
                    hit["tileMatches"] += 1
                    hit["bestSimilarity"] = max(hit["bestSimilarity"], sim)
                    hit["avgPHashDist"] = (hit["avgPHashDist"] + ph_dist) / 2

        candidates = sorted(
            all_hits.values(),
            key=lambda x: (x["tileMatches"], x["bestSimilarity"]),
            reverse=True,
        )[:20]

        for c in candidates:
            match_ratio = c["tileMatches"] / max(len(probe_tiles), 1)
            visible_pct = round(min(100, match_ratio * 100 + c["bestSimilarity"] * 30), 1)
            crop_pct = round(max(0, 100 - visible_pct), 1)
            c["visiblePercent"] = visible_pct
            c["cropPercent"] = crop_pct
            c["missingPercent"] = crop_pct
            c["confidence"] = round(
                0.20 * (1 - c["avgPHashDist"] / 64)
                + 0.20 * c["bestSimilarity"]
                + 0.20 * min(1.0, c["tileMatches"] / 10)
                + 0.20 * match_ratio
                + 0.20 * (visible_pct / 100),
                4,
            )

        return ServiceResult(True, {
            "candidates": candidates,
            "tileMatches": sum(c["tileMatches"] for c in candidates),
            "probeTileCount": len(probe_tiles),
        }, "OK", self.name)

    def detect_crop_homography(self, probe_bytes: bytes, reference_bytes: bytes) -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV not available", self.name)

        import cv2

        probe_gray = self._decode_rgb(probe_bytes, max_dim=1280)
        ref_gray = self._decode_rgb(reference_bytes, max_dim=1280)
        if probe_gray is None or ref_gray is None:
            return ServiceResult(False, {}, "Failed to decode images", self.name)

        pg = self._normalize(cv2.cvtColor(probe_gray, cv2.COLOR_RGB2GRAY))
        rg = self._normalize(cv2.cvtColor(ref_gray, cv2.COLOR_RGB2GRAY))

        orb = cv2.ORB_create(nfeatures=2500)
        kp1, des1 = orb.detectAndCompute(pg, None)
        kp2, des2 = orb.detectAndCompute(rg, None)

        if des1 is None or des2 is None or len(des1) < 8 or len(des2) < 8:
            return ServiceResult(True, {
                "homographyFound": False,
                "sharedRegionPercent": 0,
                "cropPercent": 100,
                "missingPercent": 100,
                "matches": 0,
            }, "Insufficient keypoints", self.name)

        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = sorted(bf.match(des1, des2), key=lambda m: m.distance)
        good = [m for m in matches if m.distance < 50][:80]

        if len(good) < 8:
            match_ratio = len(good) / max(len(kp1), len(kp2), 1)
            visible = round(min(100, match_ratio * 200), 1)
            return ServiceResult(True, {
                "homographyFound": False,
                "sharedRegionPercent": visible,
                "cropPercent": round(100 - visible, 1),
                "missingPercent": round(100 - visible, 1),
                "visiblePercent": visible,
                "matches": len(good),
            }, "Few matches", self.name)

        src_pts = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst_pts = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)

        inliers = int(mask.ravel().sum()) if mask is not None else len(good)
        inlier_ratio = inliers / max(len(good), 1)
        shared = round(min(100, inlier_ratio * 100 + (inliers / max(len(kp1), 1)) * 40), 1)
        crop = round(max(0, 100 - shared), 1)

        return ServiceResult(True, {
            "homographyFound": H is not None,
            "sharedRegionPercent": shared,
            "visiblePercent": shared,
            "cropPercent": crop,
            "missingPercent": crop,
            "matches": inliers,
            "method": "orb_ransac_homography",
        }, "OK", self.name)

    def forensic_scan(self, image_bytes: bytes, reference_bytes: bytes | None = None) -> ServiceResult:
        """Full enterprise scan: features + pyramid tile FAISS + CLIP + tamper + explainability."""
        feat = self.extract_features(image_bytes)
        if not feat.success:
            return feat

        tile_search = self.search_tiles(image_bytes, top_k=100)

        clip_candidates: list[dict[str, Any]] = []
        if semantic_embeddings_service and semantic_embeddings_service.is_available():
            clip_res = semantic_embeddings_service.search(image_bytes, top_k=20)
            if clip_res.success:
                clip_candidates = clip_res.data.get("candidates", [])

        screenshot_data: dict[str, Any] = {}
        if screenshot_service and screenshot_service.is_available():
            ss = screenshot_service.analyze(image_bytes)
            if ss.success:
                screenshot_data = ss.data

        ai_edit_data: dict[str, Any] = {}
        if deepfake_service and deepfake_service.is_available():
            ai = deepfake_service.analyze(image_bytes, "image/jpeg")
            if ai.success:
                ai_edit_data = ai.data

        authenticity_ensemble: dict[str, Any] | None = None
        if authenticity_ensemble_service and authenticity_ensemble_service.is_available():
            ens = authenticity_ensemble_service.analyze(image_bytes, "image/jpeg")
            if ens.success and not ens.data.get("skipped"):
                authenticity_ensemble = ens.data
                # Prefer ensemble AI signal for downstream consumers
                if ai_edit_data is not None:
                    ai_edit_data = {
                        **ai_edit_data,
                        "aiGenerated": ens.data.get("aiGenerated", ai_edit_data.get("aiGenerated")),
                        "aiGeneratedConfidence": ens.data.get("aiGeneratedConfidence"),
                        "generatedConfidencePercent": ens.data.get("generatedConfidencePercent"),
                        "ensembleVerdict": ens.data.get("verdict"),
                        "ensembleAuthenticityScore": ens.data.get("authenticityScore"),
                        "ensembleTamperScore": ens.data.get("tamperScore"),
                    }

        crop_data: dict[str, Any] = {}
        tamper_localization: dict[str, Any] = {}
        if reference_bytes:
            crop = self.detect_crop_homography(image_bytes, reference_bytes)
            if crop.success:
                crop_data = crop.data
            loc = self.localize_tamper(image_bytes, reference_bytes)
            if loc.success:
                tamper_localization = loc.data

        # Merge tile + CLIP candidates by vaultId
        merged: dict[str, dict[str, Any]] = {}
        for c in tile_search.data.get("candidates", []):
            merged[c["vaultId"]] = {**c, "clipSimilarity": 0, "clipPercent": 0}
        for c in clip_candidates:
            vid = c["vaultId"]
            if vid in merged:
                merged[vid]["clipSimilarity"] = c.get("clipSimilarity", 0)
                merged[vid]["clipPercent"] = c.get("clipPercent", 0)
            else:
                merged[vid] = {
                    "vaultId": vid,
                    "dnaRecordId": c.get("dnaRecordId"),
                    "filename": c.get("filename", ""),
                    "tileMatches": 0,
                    "bestSimilarity": 0,
                    "clipSimilarity": c.get("clipSimilarity", 0),
                    "clipPercent": c.get("clipPercent", 0),
                    "confidence": c.get("clipSimilarity", 0),
                }

        candidates = sorted(
            merged.values(),
            key=lambda x: (x.get("tileMatches", 0), x.get("clipSimilarity", 0)),
            reverse=True,
        )[:20]
        top = candidates[0] if candidates else None

        weights = self._fusion_weights()
        signal_scores: dict[str, float] = {}
        overall = 0.0
        if top:
            ph_score = (1 - (top.get("avgPHashDist", 32) / 64)) * 100
            tile_score = (top.get("confidence", 0) or 0) * 100
            orb_score = (crop_data.get("sharedRegionPercent", 50) if crop_data else 50)
            clip_score = top.get("clipPercent", 0) or 0
            texture_score = (feat.data.get("textureScore", 0) or 0) * 100

            signal_scores = {
                "pHash": ph_score,
                "tile_pyramid": tile_score,
                "ORB": orb_score,
                "CLIP": clip_score,
                "texture": texture_score,
            }

            overall = round(
                weights["pHash"] * ph_score / 100
                + weights["tile"] * tile_score / 100
                + weights["orb"] * orb_score / 100
                + weights["clip"] * clip_score / 100
                + weights["texture"] * texture_score / 100,
                4,
            )

        match_reasons = self._build_match_reasons(signal_scores)

        return ServiceResult(True, {
            "features": feat.data,
            "tileSearch": tile_search.data,
            "clipSearch": {"candidates": clip_candidates},
            "screenshotDetection": screenshot_data or None,
            "aiManipulation": ai_edit_data or None,
            "authenticityEnsemble": authenticity_ensemble,
            "cropDetection": crop_data or None,
            "tamperLocalization": tamper_localization or None,
            "candidates": candidates,
            "topCandidate": top,
            "overallConfidence": overall,
            "weights": weights,
            "matchReasons": match_reasons,
        }, "OK", self.name)


forensic_scanner_service = ForensicScannerService()
