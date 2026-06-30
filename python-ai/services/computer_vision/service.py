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


computer_vision_service = ComputerVisionService()
