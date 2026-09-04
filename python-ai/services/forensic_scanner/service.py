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
                "pixel_source_classification",
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

    def _classify_region_change(
        self,
        probe_gray: np.ndarray,
        ref_gray: np.ndarray,
        x: int, y: int, w: int, h: int,
    ) -> str:
        """
        Heuristic add/remove classification for one changed region.
        Compares local texture (Laplacian variance) inside the box between
        probe and reference: new detail appearing => "added"; detail flattened
        out (e.g. painted over / blurred / deleted) => "removed". Not a proof —
        a best-effort signal alongside the pixel-diff region itself.
        """
        import cv2

        probe_crop = probe_gray[y:y + h, x:x + w]
        ref_crop = ref_gray[y:y + h, x:x + w]
        if probe_crop.size == 0 or ref_crop.size == 0:
            return "modified"

        probe_var = float(cv2.Laplacian(probe_crop, cv2.CV_64F).var())
        ref_var = float(cv2.Laplacian(ref_crop, cv2.CV_64F).var())
        denom = max(probe_var, ref_var, 1e-6)
        delta = (probe_var - ref_var) / denom

        if delta > 0.35:
            return "added"
        if delta < -0.35:
            return "removed"
        return "modified"

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

        probe_gray_full = cv2.cvtColor(probe_rgb, cv2.COLOR_RGB2GRAY)
        ref_gray_full = cv2.cvtColor(ref_resized, cv2.COLOR_RGB2GRAY)

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        regions = []
        for cnt in contours[:8]:
            x, y, w, h = cv2.boundingRect(cnt)
            if w * h < 200:
                continue
            regions.append({
                "x": int(x), "y": int(y), "width": int(w), "height": int(h),
                "type": self._classify_region_change(probe_gray_full, ref_gray_full, x, y, w, h),
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

        # _normalize() already converts RGB→gray internally (see extract_features for the
        # same pattern) — pre-converting here as well fed it an already 1-channel image and
        # crashed with "Invalid number of channels", taking down the whole forensic-scan
        # request (crop % + tamper localization) for every investigation with a reference image.
        pg = self._normalize(probe_gray)
        rg = self._normalize(ref_gray)

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
            loc = None
            vault_loc = None
            probe_pts = None
            ref_pts = None
            if len(good) >= 4:
                probe_pts = np.float32([kp1[m.queryIdx].pt for m in good])
                ref_pts = np.float32([kp2[m.trainIdx].pt for m in good])
                ph, pw = pg.shape[:2]
                rh, rw = rg.shape[:2]
                loc = self._bbox_percents(probe_pts, pw, ph)
                vault_loc = self._bbox_percents(ref_pts, rw, rh)
            located = self._locate_protected_pixels(
                pg, rg,
                probe_pts if probe_pts is not None else np.zeros((0, 2)),
                ref_pts if ref_pts is not None else np.zeros((0, 2)),
            )
            loc = self._pick_probe_location(loc, located)
            return ServiceResult(True, {
                "homographyFound": False,
                "sharedRegionPercent": visible,
                "cropPercent": round(100 - visible, 1),
                "missingPercent": round(100 - visible, 1),
                "visiblePercent": visible,
                "matches": len(good),
                "method": loc.get("method") if loc else None,
                "probeCoveragePercent": loc["coveragePercent"] if loc else 0,
                "vaultCoveragePercent": vault_loc["coveragePercent"] if vault_loc else 0,
                "probeRegion": loc["region"] if loc else None,
                "vaultRegion": vault_loc["region"] if vault_loc else None,
            }, "Few matches", self.name)

        src_pts = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst_pts = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)

        inliers = int(mask.ravel().sum()) if mask is not None else len(good)
        inlier_ratio = inliers / max(len(good), 1)
        shared = round(min(100, inlier_ratio * 100 + (inliers / max(len(kp1), 1)) * 40), 1)
        crop = round(max(0, 100 - shared), 1)

        if mask is not None:
            inlier_probe = src_pts[mask.ravel() == 1].reshape(-1, 2)
            inlier_ref = dst_pts[mask.ravel() == 1].reshape(-1, 2)
        else:
            inlier_probe = src_pts.reshape(-1, 2)
            inlier_ref = dst_pts.reshape(-1, 2)
        ph, pw = pg.shape[:2]
        rh, rw = rg.shape[:2]
        loc = self._bbox_percents(inlier_probe, pw, ph)
        vault_loc = self._bbox_percents(inlier_ref, rw, rh)

        located = self._locate_protected_pixels(pg, rg, inlier_probe, inlier_ref)
        H_ref_to_probe = None
        if len(inlier_ref) >= 4 and len(inlier_probe) >= 4:
            H_ref_to_probe, _ = cv2.findHomography(
                inlier_ref.reshape(-1, 1, 2),
                inlier_probe.reshape(-1, 1, 2),
                cv2.RANSAC,
                5.0,
            )
        warped = self._warp_agreement_region(pg, rg, H_ref_to_probe) if H_ref_to_probe is not None else None
        loc = self._pick_probe_location(loc, located, warped)

        return ServiceResult(True, {
            "homographyFound": H is not None,
            "sharedRegionPercent": shared,
            "visiblePercent": shared,
            "cropPercent": crop,
            "missingPercent": crop,
            "matches": inliers,
            "method": loc.get("method", "orb_ransac_homography") if loc else "orb_ransac_homography",
            "probeCoveragePercent": loc["coveragePercent"] if loc else 0,
            "vaultCoveragePercent": vault_loc["coveragePercent"] if vault_loc else 0,
            "probeRegion": loc["region"] if loc else None,
            "vaultRegion": vault_loc["region"] if vault_loc else None,
        }, "OK", self.name)

    @staticmethod
    def _pick_probe_location(*cands: dict[str, Any] | None) -> dict[str, Any] | None:
        order = {"warp_ncc": 0, "tile_template": 1, "template_full": 2}
        ranked = [
            c for c in cands
            if c and 1.0 <= float(c.get("coveragePercent") or 0) <= 70
        ]
        if not ranked:
            return next((c for c in cands if c), None)
        ranked.sort(key=lambda c: (
            order.get(str(c.get("method") or ""), 9),
            -float(c.get("coveragePercent") or 0),
        ))
        return ranked[0]

    def _locate_protected_pixels(
        self,
        probe_gray: np.ndarray,
        ref_gray: np.ndarray,
        inlier_probe: np.ndarray,
        inlier_ref: np.ndarray,
    ) -> dict[str, Any] | None:
        """Find the pasted crop on the probe — not the bbox of a few distinctive keypoints."""
        tiled = self._tile_template_region(probe_gray, ref_gray)
        if tiled and tiled["coveragePercent"] >= 1.0:
            return tiled
        ph, pw = probe_gray.shape[:2]
        rh, rw = ref_gray.shape[:2]
        if inlier_probe is None or len(inlier_probe) < 4:
            return self._template_full_ref_region(probe_gray, ref_gray)
        loc = self._bbox_percents(inlier_probe, pw, ph)
        if not loc:
            return self._template_full_ref_region(probe_gray, ref_gray)
        vault_loc = (
            self._bbox_percents(inlier_ref, rw, rh, pad=0.02)
            if inlier_ref is not None and len(inlier_ref) >= 4
            else None
        )
        if vault_loc and loc["coveragePercent"] < 1.5 and vault_loc["coveragePercent"] >= 8:
            grown = self._template_full_ref_region(probe_gray, ref_gray)
            if grown and grown["coveragePercent"] >= 1.0:
                return grown
        if loc["coveragePercent"] >= 1.5:
            return loc
        return self._template_full_ref_region(probe_gray, ref_gray)

    def _warp_agreement_region(
        self,
        probe_gray: np.ndarray,
        ref_gray: np.ndarray,
        H_ref_to_probe: np.ndarray,
    ) -> dict[str, Any] | None:
        import cv2

        ph, pw = probe_gray.shape[:2]
        warped = cv2.warpPerspective(
            ref_gray, H_ref_to_probe, (pw, ph),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        )
        valid = cv2.warpPerspective(
            np.ones(ref_gray.shape[:2], np.uint8) * 255,
            H_ref_to_probe, (pw, ph),
            flags=cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        ) > 0
        if int(valid.sum()) < 256:
            return None
        pg = probe_gray.astype(np.float32)
        wg = warped.astype(np.float32)
        p_mu = cv2.GaussianBlur(pg, (0, 0), 5)
        w_mu = cv2.GaussianBlur(wg, (0, 0), 5)
        p0 = pg - p_mu
        w0 = wg - w_mu
        num = cv2.GaussianBlur(p0 * w0, (0, 0), 5)
        den = np.sqrt(
            cv2.GaussianBlur(p0 * p0, (0, 0), 5) * cv2.GaussianBlur(w0 * w0, (0, 0), 5)
        ) + 1e-3
        ncc = num / den
        agree = ((ncc > 0.22) & valid).astype(np.uint8) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
        agree = cv2.morphologyEx(agree, cv2.MORPH_CLOSE, kernel, iterations=2)
        agree = cv2.morphologyEx(agree, cv2.MORPH_OPEN, kernel)
        n_labels, _labels, stats, _ = cv2.connectedComponentsWithStats(agree, connectivity=8)
        if n_labels <= 1:
            return None
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        area = int(stats[largest, cv2.CC_STAT_AREA])
        coverage = area / float(pw * ph) * 100.0
        if coverage < 1.0 or coverage > 75:
            return None
        x = int(stats[largest, cv2.CC_STAT_LEFT])
        y = int(stats[largest, cv2.CC_STAT_TOP])
        w = int(stats[largest, cv2.CC_STAT_WIDTH])
        h = int(stats[largest, cv2.CC_STAT_HEIGHT])
        return {
            "coveragePercent": round(min(100.0, coverage), 1),
            "method": "warp_ncc",
            "region": {
                "xPercent": round(x / pw * 100, 1),
                "yPercent": round(y / ph * 100, 1),
                "widthPercent": round(w / pw * 100, 1),
                "heightPercent": round(h / ph * 100, 1),
            },
        }

    def _template_full_ref_region(self, probe_gray: np.ndarray, ref_gray: np.ndarray) -> dict[str, Any] | None:
        import cv2

        ph, pw = probe_gray.shape[:2]
        rh, rw = ref_gray.shape[:2]
        best: dict[str, Any] | None = None
        for scale in (0.12, 0.18, 0.24, 0.3, 0.38, 0.46, 0.55, 0.68, 0.82):
            tw, th = int(rw * scale), int(rh * scale)
            if tw < 28 or th < 28 or tw >= pw or th >= ph:
                continue
            templ = cv2.resize(ref_gray, (tw, th), interpolation=cv2.INTER_AREA)
            res = cv2.matchTemplate(probe_gray, templ, cv2.TM_CCOEFF_NORMED)
            _minv, maxv, _minl, maxl = cv2.minMaxLoc(res)
            if best is None or maxv > best["score"]:
                best = {"score": float(maxv), "x": int(maxl[0]), "y": int(maxl[1]), "w": tw, "h": th}
        if not best or best["score"] < 0.36:
            return None
        coverage = (best["w"] * best["h"]) / float(pw * ph) * 100.0
        if coverage < 1.0 or coverage > 75:
            return None
        return {
            "coveragePercent": round(min(100.0, coverage), 1),
            "method": "template_full",
            "region": {
                "xPercent": round(best["x"] / pw * 100, 1),
                "yPercent": round(best["y"] / ph * 100, 1),
                "widthPercent": round(best["w"] / pw * 100, 1),
                "heightPercent": round(best["h"] / ph * 100, 1),
            },
        }

    def _tile_template_region(self, probe_gray: np.ndarray, ref_gray: np.ndarray) -> dict[str, Any] | None:
        """Union of vault tiles that strongly match the probe — locates a crop even when
        the rest of the original (field, sky) is not in the collage."""
        import cv2

        ph, pw = probe_gray.shape[:2]
        rh, rw = ref_gray.shape[:2]
        tile_w = max(48, int(rw * 0.42))
        tile_h = max(48, int(rh * 0.42))
        hits: list[tuple[int, int, int, int, float]] = []
        for fy in (0.0, 0.28, 0.58):
            for fx in (0.0, 0.28, 0.58):
                x0, y0 = int(fx * rw), int(fy * rh)
                x1, y1 = min(rw, x0 + tile_w), min(rh, y0 + tile_h)
                tile = ref_gray[y0:y1, x0:x1]
                th, tw = tile.shape[:2]
                if tw < 32 or th < 32:
                    continue
                best_local: dict[str, Any] | None = None
                for scale in (0.35, 0.5, 0.7, 0.95, 1.15):
                    cw, ch = int(tw * scale), int(th * scale)
                    if cw < 24 or ch < 24 or cw >= pw or ch >= ph:
                        continue
                    templ = cv2.resize(tile, (cw, ch), interpolation=cv2.INTER_AREA)
                    res = cv2.matchTemplate(probe_gray, templ, cv2.TM_CCOEFF_NORMED)
                    _minv, maxv, _minl, maxl = cv2.minMaxLoc(res)
                    if best_local is None or maxv > best_local["score"]:
                        best_local = {
                            "score": float(maxv),
                            "x": int(maxl[0]),
                            "y": int(maxl[1]),
                            "w": cw,
                            "h": ch,
                        }
                if best_local and best_local["score"] >= 0.48:
                    hits.append((
                        best_local["x"], best_local["y"],
                        best_local["w"], best_local["h"],
                        best_local["score"],
                    ))
        if len(hits) < 2:
            return self._template_full_ref_region(probe_gray, ref_gray)
        xs0 = min(h[0] for h in hits)
        ys0 = min(h[1] for h in hits)
        xs1 = max(h[0] + h[2] for h in hits)
        ys1 = max(h[1] + h[3] for h in hits)
        w = max(1, xs1 - xs0)
        h = max(1, ys1 - ys0)
        coverage = (w * h) / float(pw * ph) * 100.0
        if coverage < 1.0 or coverage > 75:
            return self._template_full_ref_region(probe_gray, ref_gray)
        return {
            "coveragePercent": round(min(100.0, coverage), 1),
            "method": "tile_template",
            "region": {
                "xPercent": round(xs0 / pw * 100, 1),
                "yPercent": round(ys0 / ph * 100, 1),
                "widthPercent": round(w / pw * 100, 1),
                "heightPercent": round(h / ph * 100, 1),
            },
        }

    @staticmethod
    def _bbox_percents(pts: np.ndarray, width: int, height: int, pad: float = 0.04) -> dict[str, Any] | None:
        if pts is None or len(pts) < 4 or width <= 0 or height <= 0:
            return None
        xs = pts[:, 0]
        ys = pts[:, 1]
        x0 = float(max(0, xs.min() - pad * width))
        y0 = float(max(0, ys.min() - pad * height))
        x1 = float(min(width, xs.max() + pad * width))
        y1 = float(min(height, ys.max() + pad * height))
        w = max(1.0, x1 - x0)
        h = max(1.0, y1 - y0)
        coverage = round(min(100.0, (w * h) / (width * height) * 100), 1)
        return {
            "coveragePercent": coverage,
            "region": {
                "xPercent": round(x0 / width * 100, 1),
                "yPercent": round(y0 / height * 100, 1),
                "widthPercent": round(w / width * 100, 1),
                "heightPercent": round(h / height * 100, 1),
            },
        }

    def _homography_vault_to_probe(self, probe_g: np.ndarray, ref_g: np.ndarray):
        import cv2

        def try_detector(name: str):
            if name == "orb":
                det = cv2.ORB_create(nfeatures=5000)
                norm = cv2.NORM_HAMMING
            elif name == "akaze":
                det = cv2.AKAZE_create()
                norm = cv2.NORM_HAMMING
            else:
                try:
                    det = cv2.SIFT_create()
                    norm = cv2.NORM_L2
                except Exception:
                    return None, 0, 0, 0, 0
            kp_ref, des_ref = det.detectAndCompute(ref_g, None)
            kp_pr, des_pr = det.detectAndCompute(probe_g, None)
            n_ref = 0 if kp_ref is None else len(kp_ref)
            n_pr = 0 if kp_pr is None else len(kp_pr)
            if des_ref is None or des_pr is None or n_ref < 8 or n_pr < 8:
                return None, 0, n_ref, n_pr, 0
            bf = cv2.BFMatcher(norm)
            try:
                knn = bf.knnMatch(des_ref, des_pr, k=2)
            except Exception:
                return None, 0, n_ref, n_pr, 0
            good = []
            for pair in knn:
                if len(pair) < 2:
                    continue
                a, b = pair
                if a.distance < 0.75 * b.distance:
                    good.append(a)
            if len(good) < 8:
                return None, len(good), n_ref, n_pr, 0
            src = np.float32([kp_ref[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
            dst = np.float32([kp_pr[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
            H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
            inliers = int(mask.ravel().sum()) if mask is not None else 0
            if H is None or inliers < 8:
                return None, len(good), n_ref, n_pr, inliers
            return H, len(good), n_ref, n_pr, inliers

        best = (None, 0, 0, 0, 0)
        for name in ("orb", "akaze", "sift"):
            H, good, n_ref, n_pr, inliers = try_detector(name)
            if inliers > best[4]:
                best = (H, good, n_ref, n_pr, inliers)
            if H is not None and inliers >= 12:
                return H, inliers, {"detector": name, "vaultKeypoints": n_ref, "probeKeypoints": n_pr, "goodMatches": good, "inliers": inliers}
        H, good, n_ref, n_pr, inliers = best
        return H, inliers, {"detector": "best", "vaultKeypoints": n_ref, "probeKeypoints": n_pr, "goodMatches": good, "inliers": inliers}

    def _encode_png_rgba(self, rgba: np.ndarray) -> str:
        buf = io.BytesIO()
        Image.fromarray(rgba, "RGBA").save(buf, format="PNG", optimize=True)
        return base64.b64encode(buf.getvalue()).decode("ascii")

    def _encode_png_gray(self, gray: np.ndarray) -> str:
        buf = io.BytesIO()
        Image.fromarray(gray, "L").save(buf, format="PNG", optimize=True)
        return base64.b64encode(buf.getvalue()).decode("ascii")

    def _paint_paste_pixels(
        self,
        probe_rgb: np.ndarray,
        ref_rgb: np.ndarray,
        class_map: np.ndarray,
        paste: dict[str, Any],
        green_max: float = 22.0,
        orange_min: float = 48.0,
    ) -> None:
        import cv2

        x, y, w, h = int(paste["x"]), int(paste["y"]), int(paste["w"]), int(paste["h"])
        ph, pw = probe_rgb.shape[:2]
        x = max(0, min(x, pw - 1))
        y = max(0, min(y, ph - 1))
        w = max(1, min(w, pw - x))
        h = max(1, min(h, ph - y))
        vx = int(paste.get("vx", 0))
        vy = int(paste.get("vy", 0))
        vw = int(paste.get("vw", ref_rgb.shape[1]))
        vh = int(paste.get("vh", ref_rgb.shape[0]))
        rh, rw = ref_rgb.shape[:2]
        vx = max(0, min(vx, rw - 1))
        vy = max(0, min(vy, rh - 1))
        vw = max(1, min(vw, rw - vx))
        vh = max(1, min(vh, rh - vy))
        crop = ref_rgb[vy:vy + vh, vx:vx + vw]
        if crop.size == 0:
            return
        warped = cv2.resize(crop, (w, h), interpolation=cv2.INTER_LINEAR)
        region = probe_rgb[y:y + h, x:x + w]
        dist = np.mean(np.abs(region.astype(np.int16) - warped.astype(np.int16)), axis=2)
        green = dist <= green_max
        modified = dist >= orange_min
        sl = class_map[y:y + h, x:x + w]
        sl[green] = 1
        sl[modified & ~green] = 2

    def score_local_correspondence(self, probe_bytes: bytes, reference_bytes: bytes) -> ServiceResult:
        """Fast local-match score for choosing which vault image is the crop source."""
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV not available", self.name)
        import cv2

        probe_rgb = self._decode_rgb(probe_bytes, max_dim=960)
        ref_rgb = self._decode_rgb(reference_bytes, max_dim=960)
        if probe_rgb is None or ref_rgb is None:
            return ServiceResult(False, {}, "Failed to decode", self.name)
        probe_g = cv2.cvtColor(probe_rgb, cv2.COLOR_RGB2GRAY)
        ref_g = cv2.cvtColor(ref_rgb, cv2.COLOR_RGB2GRAY)
        H, inliers, diag = self._homography_vault_to_probe(probe_g, ref_g)
        paste = self._locate_vault_paste(probe_g, ref_g)
        tiled = self._tile_template_region(probe_g, ref_g)
        full = self._template_full_ref_region(probe_g, ref_g)
        template_score = 0.0
        coverage = 0.0
        method = "none"
        if paste:
            template_score = float(paste.get("score") or 0)
            ph, pw = probe_g.shape[:2]
            coverage = max(coverage, (paste["w"] * paste["h"]) / (pw * ph) * 100)
            method = "template_strip"
        for cand in (tiled, full):
            if cand and cand.get("coveragePercent"):
                coverage = max(coverage, float(cand["coveragePercent"]))
                method = str(cand.get("method") or method)
                template_score = max(template_score, 0.4)
        local_score = max(
            inliers * 2.0,
            template_score * 100,
            coverage * 3,
        )
        return ServiceResult(True, {
            **diag,
            "homographyFound": H is not None,
            "inliers": inliers,
            "templateScore": round(template_score, 4),
            "estimatedCoveragePercent": round(coverage, 2),
            "localScore": round(local_score, 2),
            "method": method,
        }, "OK", self.name)

    def classify_pixel_sources(self, probe_bytes: bytes, reference_bytes: bytes) -> ServiceResult:
        """1×1 source map: GREEN = vault-origin pixels on the upload, ORANGE = non-vault, GREY = unknown.

        Homography maps vault coordinates onto the upload. HMAC/block DNA is not used here.
        """
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV not available", self.name)

        import cv2

        probe_rgb = self._decode_rgb(probe_bytes, max_dim=1280)
        ref_rgb = self._decode_rgb(reference_bytes, max_dim=1280)
        if probe_rgb is None or ref_rgb is None:
            return ServiceResult(False, {}, "Failed to decode images", self.name)

        ph, pw = probe_rgb.shape[:2]
        rh, rw = ref_rgb.shape[:2]
        probe_g = cv2.cvtColor(probe_rgb, cv2.COLOR_RGB2GRAY)
        ref_g = cv2.cvtColor(ref_rgb, cv2.COLOR_RGB2GRAY)
        class_map = np.zeros((ph, pw), dtype=np.uint8)

        H, inliers, match_diag = self._homography_vault_to_probe(probe_g, ref_g)
        homography = None
        if H is not None:
            homography = [float(v) for v in H.reshape(-1)]
            warped = cv2.warpPerspective(
                ref_rgb, H, (pw, ph),
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=0,
            )
            valid = cv2.warpPerspective(
                np.ones((rh, rw), np.uint8) * 255,
                H, (pw, ph),
                flags=cv2.INTER_NEAREST,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=0,
            ) > 0
            dist = np.mean(np.abs(probe_rgb.astype(np.int16) - warped.astype(np.int16)), axis=2)
            class_map[valid & (dist <= 22)] = 1
            class_map[valid & (dist >= 48)] = 2

        paste = self._locate_vault_paste(probe_g, ref_g)
        tiled = self._tile_template_region(probe_g, ref_g)
        full = self._template_full_ref_region(probe_g, ref_g)
        paste_box: dict[str, Any] | None = None
        if paste:
            paste_box = {
                "x": paste["x"], "y": paste["y"], "w": paste["w"], "h": paste["h"],
                "vx": 0, "vy": 0, "vw": rw, "vh": rh,
                "score": paste.get("score", 0),
                "method": "vault_strip_template",
            }
            # Strip match used a vertical slice of the vault, not the full frame.
            # Approximate vault x from relative width.
            paste_box["vw"] = max(1, int(rw * (paste["w"] / max(pw * 0.35, paste["w"]))))
        if tiled and tiled.get("region"):
            r = tiled["region"]
            cand = {
                "x": int(r["xPercent"] / 100 * pw),
                "y": int(r["yPercent"] / 100 * ph),
                "w": int(r["widthPercent"] / 100 * pw),
                "h": int(r["heightPercent"] / 100 * ph),
                "vx": 0, "vy": 0, "vw": rw, "vh": rh,
                "score": 0.5,
                "method": tiled.get("method", "tile_template"),
            }
            if paste_box is None or cand["w"] * cand["h"] > paste_box["w"] * paste_box["h"] * 0.8:
                paste_box = cand
        if full and full.get("region") and (paste_box is None or (full.get("coveragePercent") or 0) >= 1):
            r = full["region"]
            cand = {
                "x": int(r["xPercent"] / 100 * pw),
                "y": int(r["yPercent"] / 100 * ph),
                "w": int(r["widthPercent"] / 100 * pw),
                "h": int(r["heightPercent"] / 100 * ph),
                "vx": 0, "vy": 0, "vw": rw, "vh": rh,
                "score": 0.45,
                "method": "template_full",
            }
            if paste_box is None:
                paste_box = cand

        if paste_box:
            self._paint_paste_pixels(probe_rgb, ref_rgb, class_map, paste_box)

        n_green = int((class_map == 1).sum())
        total = ph * pw
        green_pct = n_green / max(total, 1) * 100.0
        remainder = class_map == 0
        collage = green_pct >= 0.4
        identity = green_pct >= 85
        if identity:
            class_map[remainder] = 2
        elif collage:
            class_map[remainder] = 2
        else:
            class_map[:] = 0

        n_green = int((class_map == 1).sum())
        n_orange = int((class_map == 2).sum())
        n_grey = int((class_map == 0).sum())

        overlay = np.zeros((ph, pw, 4), dtype=np.uint8)
        overlay[class_map == 1] = (16, 185, 129, 118)
        overlay[class_map == 2] = (245, 158, 11, 118)
        overlay[class_map == 0] = (148, 163, 184, 70)
        mask = np.zeros((ph, pw), dtype=np.uint8)
        mask[class_map == 1] = 255
        mask[class_map == 2] = 128

        regions: list[dict[str, Any]] = []
        bin_g = (class_map == 1).astype(np.uint8) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        bin_g = cv2.morphologyEx(bin_g, cv2.MORPH_CLOSE, kernel)
        n_lab, _lab, stats, _ = cv2.connectedComponentsWithStats(bin_g, connectivity=8)
        for i in range(1, n_lab):
            area = int(stats[i, cv2.CC_STAT_AREA])
            if area < 64:
                continue
            x = int(stats[i, cv2.CC_STAT_LEFT])
            y = int(stats[i, cv2.CC_STAT_TOP])
            w = int(stats[i, cv2.CC_STAT_WIDTH])
            h = int(stats[i, cv2.CC_STAT_HEIGHT])
            regions.append({
                "type": "VAULT_MATCH",
                "uploadedBounds": {"x": x, "y": y, "width": w, "height": h},
                "vaultBounds": {
                    "x": int(paste_box["vx"]) if paste_box else 0,
                    "y": int(paste_box["vy"]) if paste_box else 0,
                    "width": int(paste_box["vw"]) if paste_box else rw,
                    "height": int(paste_box["vh"]) if paste_box else rh,
                },
                "confidence": round(min(0.99, 0.55 + green_pct / 200), 3),
                "coveragePercent": round(area / total * 100, 2),
            })
        regions.sort(key=lambda r: r["coveragePercent"], reverse=True)

        ys, xs = np.where(class_map == 1)
        probe_region = None
        if len(xs) >= 16:
            x0, x1 = int(xs.min()), int(xs.max()) + 1
            y0, y1 = int(ys.min()), int(ys.max()) + 1
            probe_region = {
                "xPercent": round(x0 / pw * 100, 1),
                "yPercent": round(y0 / ph * 100, 1),
                "widthPercent": round((x1 - x0) / pw * 100, 1),
                "heightPercent": round((y1 - y0) / ph * 100, 1),
            }

        g_pct = round(n_green / total * 100, 1)
        a_pct = round(n_orange / total * 100, 1)
        u_pct = round(max(0.0, 100.0 - g_pct - a_pct), 1)
        vault_used = round(n_green / max(rh * rw, 1) * 100, 1)

        return ServiceResult(True, {
            "width": pw,
            "height": ph,
            "vaultWidth": rw,
            "vaultHeight": rh,
            "originalPixels": n_green,
            "aiSuspectedPixels": n_orange,
            "unknownPixels": n_grey,
            "totalPixels": total,
            "protectedFromAssetPercent": g_pct,
            "aiGeneratedPercent": a_pct,
            "otherPercent": u_pct,
            "originalUsedPercent": min(100.0, vault_used),
            "homographyVaultToProbe": homography,
            "homographyInliers": inliers,
            "matchDiagnostics": match_diag,
            "regions": regions[:8],
            "probeRegion": probe_region,
            "method": "pixel_source_homography_ncc",
            "maskPngBase64": self._encode_png_gray(mask),
            "overlayPngBase64": self._encode_png_rgba(overlay),
            "grid": None,
        }, "OK", self.name)

    def classify_probe_blocks(self, probe_bytes: bytes, reference_bytes: bytes) -> ServiceResult:
        """Green = vault paste on the probe; amber = AI host. Never leave the collage all-amber if a paste exists."""
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV not available", self.name)

        import cv2

        probe_rgb = self._decode_rgb(probe_bytes, max_dim=640)
        ref_rgb = self._decode_rgb(reference_bytes, max_dim=640)
        if probe_rgb is None or ref_rgb is None:
            return ServiceResult(False, {}, "Failed to decode images", self.name)

        probe_g = cv2.cvtColor(probe_rgb, cv2.COLOR_RGB2GRAY)
        ref_g = cv2.cvtColor(ref_rgb, cv2.COLOR_RGB2GRAY)
        ph, pw = probe_g.shape[:2]
        block = 12 if min(ph, pw) >= 240 else 10
        rows = (ph + block - 1) // block
        cols = (pw + block - 1) // block

        pyramids = [ref_g]
        rh, rw = ref_g.shape[:2]
        for scale in (0.5, 0.75, 1.25, 1.6):
            tw, th = max(32, int(rw * scale)), max(32, int(rh * scale))
            pyramids.append(cv2.resize(ref_g, (tw, th), interpolation=cv2.INTER_AREA))

        scores = np.full((rows, cols), -1.0, dtype=np.float32)
        for r in range(rows):
            for c in range(cols):
                y, x = r * block, c * block
                y2, x2 = min(y + block, ph), min(x + block, pw)
                tile = probe_g[y:y2, x:x2]
                th, tw = tile.shape[:2]
                if th < 8 or tw < 8:
                    continue
                best = -1.0
                for vg in pyramids:
                    vh, vw = vg.shape[:2]
                    if th >= vh or tw >= vw:
                        continue
                    res = cv2.matchTemplate(vg, tile, cv2.TM_CCOEFF_NORMED)
                    best = max(best, float(res.max()))
                scores[r, c] = best

        located = self._locate_vault_paste(probe_g, ref_g)
        mask = np.zeros((rows, cols), dtype=bool)
        if located:
            x0, y0, bw, bh = located["x"], located["y"], located["w"], located["h"]
            for r in range(rows):
                for c in range(cols):
                    cx = c * block + block / 2
                    cy = r * block + block / 2
                    if x0 <= cx <= x0 + bw and y0 <= cy <= y0 + bh:
                        mask[r, c] = True

        for r in range(rows):
            for c in range(cols):
                if float(scores[r, c]) >= 0.40:
                    mask[r, c] = True

        for c in range(cols):
            seeds = [r for r in range(rows) if mask[r, c] or float(scores[r, c]) >= 0.38]
            if not seeds:
                continue
            r0, r1 = min(seeds), max(seeds)
            while r0 > 0 and float(scores[r0 - 1, c]) >= 0.20:
                r0 -= 1
            while r1 < rows - 1 and float(scores[r1 + 1, c]) >= 0.20:
                r1 += 1
            for r in range(r0, r1 + 1):
                if mask[r, c] or float(scores[r, c]) >= 0.20:
                    mask[r, c] = True

        chars: list[str] = []
        n_g = n_a = 0
        for r in range(rows):
            for c in range(cols):
                if mask[r, c]:
                    chars.append("G")
                    n_g += 1
                else:
                    chars.append("A")
                    n_a += 1

        total = max(n_g + n_a, 1)
        probe_region = None
        if located:
            probe_region = {
                "xPercent": round(located["x"] / pw * 100, 1),
                "yPercent": round(located["y"] / ph * 100, 1),
                "widthPercent": round(located["w"] / pw * 100, 1),
                "heightPercent": round(located["h"] / ph * 100, 1),
            }
        return ServiceResult(True, {
            "protectedFromAssetPercent": round(n_g / total * 100, 1),
            "aiGeneratedPercent": round(n_a / total * 100, 1),
            "otherPercent": 0,
            "blockSize": block,
            "matchedBlocks": n_g,
            "aiBlocks": n_a,
            "otherBlocks": 0,
            "probeRegion": probe_region,
            "grid": {"rows": rows, "cols": cols, "labels": "".join(chars)},
            "pasteScore": located["score"] if located else 0,
        }, "OK", self.name)

    def _locate_vault_paste(self, probe_g: np.ndarray, ref_g: np.ndarray) -> dict[str, Any] | None:
        """Find a tall vault slice pasted into the probe."""
        import cv2

        ph, pw = probe_g.shape[:2]
        rh, rw = ref_g.shape[:2]
        probe_e = cv2.Canny(probe_g, 40, 130)
        ref_e = cv2.Canny(ref_g, 40, 130)
        best: dict[str, Any] | None = None

        def consider(score: float, x: int, y: int, w: int, h: int) -> None:
            nonlocal best
            if w < 16 or h < 24 or w >= pw or h >= ph:
                return
            if best is None or score > best["score"]:
                best = {"score": score, "x": x, "y": y, "w": w, "h": h}

        slices = (
            (0.22, 0.58), (0.28, 0.72), (0.35, 0.78),
            (0.12, 0.48), (0.48, 0.88), (0.0, 0.42), (0.58, 1.0),
        )
        scales = (0.10, 0.14, 0.18, 0.22, 0.28, 0.34, 0.42, 0.52, 0.64, 0.78)
        for src_g, src_e in ((ref_g, ref_e),):
            rh2, rw2 = src_g.shape[:2]
            for x0f, x1f in slices:
                x0, x1 = int(rw2 * x0f), int(rw2 * x1f)
                if x1 - x0 < 20:
                    continue
                strip = src_g[:, x0:x1]
                strip_e = src_e[:, x0:x1]
                sh, sw = strip.shape[:2]
                for scale in scales:
                    tw, th = int(sw * scale), int(sh * scale)
                    if tw < 18 or th < 28 or tw >= pw or th >= ph:
                        continue
                    templ = cv2.resize(strip, (tw, th), interpolation=cv2.INTER_AREA)
                    res = cv2.matchTemplate(probe_g, templ, cv2.TM_CCOEFF_NORMED)
                    _mn, maxv, _ml, maxl = cv2.minMaxLoc(res)
                    consider(float(maxv), int(maxl[0]), int(maxl[1]), tw, th)
                    et = cv2.resize(strip_e, (tw, th), interpolation=cv2.INTER_AREA)
                    if et.std() > 4:
                        res_e = cv2.matchTemplate(probe_e, et, cv2.TM_CCOEFF_NORMED)
                        _mn2, maxe, _ml2, maxle = cv2.minMaxLoc(res_e)
                        consider(float(maxe) * 0.95, int(maxle[0]), int(maxle[1]), tw, th)

        if not best or best["score"] < 0.18:
            return None
        return best

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
        block_composition: dict[str, Any] = {}
        pixel_source: dict[str, Any] = {}
        if reference_bytes:
            try:
                crop = self.detect_crop_homography(image_bytes, reference_bytes)
                if crop.success:
                    crop_data = crop.data
            except Exception:
                pass
            try:
                loc = self.localize_tamper(image_bytes, reference_bytes)
                if loc.success:
                    tamper_localization = loc.data
            except Exception:
                pass
            try:
                pix = self.classify_pixel_sources(image_bytes, reference_bytes)
                if pix.success:
                    pixel_source = pix.data
                    block_composition = {
                        "protectedFromAssetPercent": pix.data.get("protectedFromAssetPercent"),
                        "aiGeneratedPercent": pix.data.get("aiGeneratedPercent"),
                        "otherPercent": pix.data.get("otherPercent"),
                        "overlayPngBase64": pix.data.get("overlayPngBase64"),
                        "probeRegion": pix.data.get("probeRegion"),
                        "matchedBlocks": pix.data.get("originalPixels"),
                        "aiBlocks": pix.data.get("aiSuspectedPixels"),
                        "otherBlocks": pix.data.get("unknownPixels"),
                        "blockSize": 1,
                    }
            except Exception:
                pixel_source = {}
            if not block_composition:
                try:
                    blocks = self.classify_probe_blocks(image_bytes, reference_bytes)
                    if blocks.success:
                        block_composition = blocks.data
                except Exception:
                    pass

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
            "blockComposition": block_composition or None,
            "pixelSource": pixel_source or None,
            "candidates": candidates,
            "topCandidate": top,
            "overallConfidence": overall,
            "weights": weights,
            "matchReasons": match_reasons,
        }, "OK", self.name)


forensic_scanner_service = ForensicScannerService()
