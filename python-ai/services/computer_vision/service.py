"""Computer vision — ORB feature matching for transformation-resistant identification."""
from __future__ import annotations

import io
from typing import Any

import numpy as np
from PIL import Image

from ..base import EnterpriseAIService, ServiceResult


class ComputerVisionService(EnterpriseAIService):
    name = "computer_vision"

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
            "phase": "identification",
            "capabilities": [
                "orb_feature_matching",
                "akaze_fallback",
                "image_similarity",
                "perceptual_hash",
                "noise_residual_descriptor",
            ],
        }

    def _decode_gray(self, image_bytes: bytes, max_dim: int = 960) -> np.ndarray | None:
        try:
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            w, h = img.size
            scale = min(1.0, max_dim / max(w, h))
            if scale < 1.0:
                img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
            arr = np.array(img)
            import cv2
            return cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
        except Exception:
            return None

    def compare_images(self, a: bytes, b: bytes) -> ServiceResult:
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV/Pillow not available", self.name)

        import cv2

        gray_a = self._decode_gray(a)
        gray_b = self._decode_gray(b)
        if gray_a is None or gray_b is None:
            return ServiceResult(False, {}, "Failed to decode images", self.name)

        try:
            orb = cv2.ORB_create(nfeatures=2000, scaleFactor=1.2, nlevels=8)
            kp1, des1 = orb.detectAndCompute(gray_a, None)
            kp2, des2 = orb.detectAndCompute(gray_b, None)

            method = "opencv_orb"
            if des1 is None or des2 is None or len(kp1) < 8 or len(kp2) < 8:
                akaze = cv2.AKAZE_create()
                kp1, des1 = akaze.detectAndCompute(gray_a, None)
                kp2, des2 = akaze.detectAndCompute(gray_b, None)
                method = "opencv_akaze"

            if des1 is None or des2 is None or len(des1) < 4 or len(des2) < 4:
                return ServiceResult(True, {
                    "similarity": 0.0,
                    "method": method,
                    "keypointMatches": 0,
                    "keypointsA": len(kp1) if kp1 else 0,
                    "keypointsB": len(kp2) if kp2 else 0,
                }, "Insufficient keypoints", self.name)

            bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
            matches = bf.match(des1, des2)
            matches = sorted(matches, key=lambda m: m.distance)
            good = [m for m in matches if m.distance < 55]
            match_count = len(good)
            denom = max(len(kp1), len(kp2), 1)
            similarity = min(1.0, match_count / max(denom * 0.12, 1))

            return ServiceResult(True, {
                "similarity": round(float(similarity), 4),
                "method": method,
                "keypointMatches": match_count,
                "keypointsA": len(kp1),
                "keypointsB": len(kp2),
            }, "OK", self.name)
        except Exception as exc:
            return ServiceResult(False, {}, str(exc), self.name)

    def extract_features(self, image_bytes: bytes) -> ServiceResult:
        cmp = self.compare_images(image_bytes, image_bytes)
        if not cmp.success:
            return cmp
        return ServiceResult(True, {
            "keypoints": cmp.data.get("keypointsA", 0),
            "method": cmp.data.get("method", "orb"),
        }, "OK", self.name)

    def extract_local_index(
        self,
        image_bytes: bytes,
        patch_size: int = 32,
        max_keypoints: int = 1500,
    ) -> ServiceResult:
        """Extract global ORB/AKAZE descriptors + patch grid metadata for vault indexing."""
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV/Pillow not available", self.name)

        import cv2
        import base64

        gray = self._decode_gray(image_bytes, max_dim=1280)
        if gray is None:
            return ServiceResult(False, {}, "Failed to decode image", self.name)

        try:
            h, w = gray.shape[:2]
            orb = cv2.ORB_create(nfeatures=max_keypoints, scaleFactor=1.2, nlevels=8)
            kp, des = orb.detectAndCompute(gray, None)
            method = "opencv_orb"

            if des is None or len(kp) < 8:
                akaze = cv2.AKAZE_create()
                kp, des = akaze.detectAndCompute(gray, None)
                method = "opencv_akaze"

            keypoints: list[dict[str, Any]] = []
            if des is not None and kp:
                for i, k in enumerate(kp[:max_keypoints]):
                    desc_row = des[i].tolist() if i < len(des) else []
                    keypoints.append({
                        "x": round(float(k.pt[0]) / max(w, 1), 5),
                        "y": round(float(k.pt[1]) / max(h, 1), 5),
                        "size": round(float(k.size), 2),
                        "angle": round(float(k.angle), 2),
                        "response": round(float(k.response), 4),
                        "descriptor": base64.b64encode(bytes(desc_row)).decode("ascii") if desc_row else "",
                    })

            return ServiceResult(True, {
                "method": method,
                "imageWidth": w,
                "imageHeight": h,
                "patchSize": patch_size,
                "orbKeypoints": len(keypoints),
                "orbDescriptors": {"keypoints": keypoints, "method": method},
            }, "OK", self.name)
        except Exception as exc:
            return ServiceResult(False, {}, str(exc), self.name)

    def _descriptors_to_matrix(self, descriptor_set: dict[str, Any]) -> "np.ndarray | None":
        """Decode a stored {keypoints:[{descriptor: base64}, ...]} set into a uint8 matrix."""
        import base64
        stored = descriptor_set.get("keypoints", []) if descriptor_set else []
        rows = []
        for kp in stored:
            raw = base64.b64decode(kp.get("descriptor", ""))
            if raw:
                rows.append(np.frombuffer(raw, dtype=np.uint8))
        if not rows:
            return None
        return np.vstack(rows).astype(np.uint8)

    def match_local_descriptors(
        self,
        probe_bytes: bytes,
        reference_descriptors: dict[str, Any],
    ) -> ServiceResult:
        """Match probe ORB keypoints against stored vault descriptor set.

        Re-extracts the probe's ORB descriptors from the image on every call —
        fine for a one-off comparison, but wasteful when matching one probe
        against many candidates. Use extract_local_index() once + repeated
        match_descriptor_sets() calls for that case instead.
        """
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV/Pillow not available", self.name)

        import cv2

        gray = self._decode_gray(probe_bytes, max_dim=1280)
        if gray is None:
            return ServiceResult(False, {}, "Failed to decode probe", self.name)

        ref_mat = self._descriptors_to_matrix(reference_descriptors)
        if ref_mat is None:
            return ServiceResult(True, {"similarity": 0.0, "matches": 0, "method": "none"}, "No stored keypoints", self.name)

        try:
            orb = cv2.ORB_create(nfeatures=2000)
            probe_kp, probe_des = orb.detectAndCompute(gray, None)
            if probe_des is None or len(probe_des) < 4:
                return ServiceResult(True, {"similarity": 0.0, "matches": 0, "method": "opencv_orb"}, "Insufficient probe keypoints", self.name)

            bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
            matches = bf.match(probe_des, ref_mat)
            good = [m for m in matches if m.distance < 55]
            match_count = len(good)
            denom = max(len(probe_kp), len(ref_mat), 1)
            similarity = min(1.0, match_count / max(denom * 0.10, 1))

            return ServiceResult(True, {
                "similarity": round(float(similarity), 4),
                "matches": match_count,
                "method": reference_descriptors.get("method", "opencv_orb"),
                "probeKeypoints": len(probe_kp),
                "referenceKeypoints": len(ref_mat),
            }, "OK", self.name)
        except Exception as exc:
            return ServiceResult(False, {}, str(exc), self.name)

    def match_descriptor_sets(
        self,
        probe_descriptors: dict[str, Any],
        candidate_descriptors: dict[str, Any],
    ) -> ServiceResult:
        """Match two already-extracted descriptor sets — no image decode, no ORB
        re-extraction. For matching one probe against many stored candidates,
        extract the probe's descriptors ONCE via extract_local_index() and call
        this per candidate instead of match_local_descriptors(), which redoes
        the (expensive) probe extraction on every call.
        """
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV/Pillow not available", self.name)

        import cv2

        probe_mat = self._descriptors_to_matrix(probe_descriptors)
        cand_mat = self._descriptors_to_matrix(candidate_descriptors)
        if probe_mat is None or cand_mat is None:
            return ServiceResult(True, {"similarity": 0.0, "matches": 0, "method": "none"}, "Empty descriptors", self.name)

        try:
            bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
            matches = bf.match(probe_mat, cand_mat)
            good = [m for m in matches if m.distance < 55]
            match_count = len(good)
            denom = max(len(probe_mat), len(cand_mat), 1)
            similarity = min(1.0, match_count / max(denom * 0.10, 1))

            return ServiceResult(True, {
                "similarity": round(float(similarity), 4),
                "matches": match_count,
                "method": candidate_descriptors.get("method", "opencv_orb"),
                "probeKeypoints": len(probe_mat),
                "referenceKeypoints": len(cand_mat),
            }, "OK", self.name)
        except Exception as exc:
            return ServiceResult(False, {}, str(exc), self.name)

    def _pool_to_grid(self, arr: "np.ndarray", grid_h: int, grid_w: int) -> "np.ndarray":
        """Average-pool an arbitrary-size 2D array down to a fixed grid_h x grid_w
        grid, so the descriptor is comparable regardless of the source image's
        native resolution (same "canonicalize the frame" idea used for DNA-B's
        resize tolerance, applied here to noise instead of luma tiles)."""
        h, w = arr.shape
        ys = np.linspace(0, h, grid_h + 1).astype(int)
        xs = np.linspace(0, w, grid_w + 1).astype(int)
        out = np.zeros((grid_h, grid_w), dtype=np.float32)
        for i in range(grid_h):
            y0, y1 = ys[i], max(ys[i + 1], ys[i] + 1)
            for j in range(grid_w):
                x0, x1 = xs[j], max(xs[j + 1], xs[j] + 1)
                block = arr[y0:y1, x0:x1]
                out[i, j] = float(block.mean()) if block.size else 0.0
        return out

    def extract_noise_residual(self, image_bytes: bytes) -> ServiceResult:
        """Real, content-derived sensor-noise-style descriptor.

        NOT camera-identification PRNU (that needs a reference pattern
        averaged across many known photos from one physical camera — this
        codebase has no device-enrollment system or multi-photo-per-device
        corpus, out of scope). This is the honest, buildable version: a
        real per-image noise-residual fingerprint that two images' residuals
        can be correlated against (compare_noise_residuals) — same "does
        this derive signal from actual pixels" bar Layer 1/2/4 already meet,
        which Layer 9 previously did not (see layer9.origin.ts).

        Pipeline: grayscale -> wavelet denoise (BayesShrink) -> residual =
        original - denoised -> average-pool to a fixed 48x48 grid (resolution-
        independent, comparable across different native sizes) -> zero-mean,
        L2-normalize.
        """
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV/Pillow not available", self.name)

        gray = self._decode_gray(image_bytes, max_dim=1280)
        if gray is None:
            return ServiceResult(False, {}, "Failed to decode image", self.name)

        try:
            from skimage.restoration import denoise_wavelet
            import base64

            g = gray.astype(np.float32) / 255.0
            denoised = denoise_wavelet(g, method="BayesShrink", mode="soft", rescale_sigma=True)
            residual = g - denoised

            grid_size = 48
            grid = self._pool_to_grid(residual, grid_size, grid_size)
            grid = grid - grid.mean()
            norm = float(np.linalg.norm(grid))
            if norm > 1e-8:
                grid = grid / norm

            descriptor = base64.b64encode(grid.astype(np.float32).tobytes()).decode("ascii")
            return ServiceResult(True, {
                "descriptor": descriptor,
                "gridSize": grid_size,
                "method": "wavelet-bayes-shrink-v1",
            }, "OK", self.name)
        except Exception as exc:
            return ServiceResult(False, {}, str(exc), self.name)

    def compare_noise_residuals(self, a: dict[str, Any], b: dict[str, Any]) -> ServiceResult:
        """Cosine similarity between two already-extracted noise-residual
        descriptors — pure numpy, no image decode, mirrors match_descriptor_sets'
        operate-on-already-extracted-data pattern."""
        import base64

        try:
            a_bytes = base64.b64decode(a.get("descriptor", "") if a else "")
            b_bytes = base64.b64decode(b.get("descriptor", "") if b else "")
            if not a_bytes or not b_bytes:
                return ServiceResult(True, {"similarity": 0.0, "method": "none"}, "Empty descriptor", self.name)

            va = np.frombuffer(a_bytes, dtype=np.float32)
            vb = np.frombuffer(b_bytes, dtype=np.float32)
            if va.shape != vb.shape or va.size == 0:
                return ServiceResult(True, {"similarity": 0.0, "method": "shape-mismatch"}, "Descriptor size mismatch", self.name)

            na = float(np.linalg.norm(va))
            nb = float(np.linalg.norm(vb))
            if na < 1e-8 or nb < 1e-8:
                return ServiceResult(True, {"similarity": 0.0, "method": "degenerate"}, "Degenerate descriptor", self.name)

            similarity = float(np.dot(va, vb) / (na * nb))
            return ServiceResult(True, {
                "similarity": round(similarity, 4),
                "method": "noise-residual-cosine-v1",
            }, "OK", self.name)
        except Exception as exc:
            return ServiceResult(False, {}, str(exc), self.name)


computer_vision_service = ComputerVisionService()
