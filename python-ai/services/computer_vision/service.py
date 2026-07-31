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

    def match_local_descriptors(
        self,
        probe_bytes: bytes,
        reference_descriptors: dict[str, Any],
    ) -> ServiceResult:
        """Match probe ORB keypoints against stored vault descriptor set."""
        if not self.is_available():
            return ServiceResult(False, {}, "OpenCV/Pillow not available", self.name)

        import cv2
        import base64
        import numpy as np

        gray = self._decode_gray(probe_bytes, max_dim=1280)
        if gray is None:
            return ServiceResult(False, {}, "Failed to decode probe", self.name)

        stored = reference_descriptors.get("keypoints", [])
        if not stored:
            return ServiceResult(True, {"similarity": 0.0, "matches": 0, "method": "none"}, "No stored keypoints", self.name)

        try:
            ref_des = []
            for kp in stored:
                raw = base64.b64decode(kp.get("descriptor", ""))
                if raw:
                    ref_des.append(np.frombuffer(raw, dtype=np.uint8))
            if not ref_des:
                return ServiceResult(True, {"similarity": 0.0, "matches": 0, "method": "none"}, "Empty descriptors", self.name)

            orb = cv2.ORB_create(nfeatures=2000)
            probe_kp, probe_des = orb.detectAndCompute(gray, None)
            if probe_des is None or len(probe_des) < 4:
                return ServiceResult(True, {"similarity": 0.0, "matches": 0, "method": "opencv_orb"}, "Insufficient probe keypoints", self.name)

            ref_mat = np.vstack(ref_des).astype(np.uint8)
            bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
            matches = bf.match(probe_des, ref_mat)
            good = [m for m in matches if m.distance < 55]
            match_count = len(good)
            denom = max(len(probe_kp), len(ref_des), 1)
            similarity = min(1.0, match_count / max(denom * 0.10, 1))

            return ServiceResult(True, {
                "similarity": round(float(similarity), 4),
                "matches": match_count,
                "method": reference_descriptors.get("method", "opencv_orb"),
                "probeKeypoints": len(probe_kp),
                "referenceKeypoints": len(ref_des),
            }, "OK", self.name)
        except Exception as exc:
            return ServiceResult(False, {}, str(exc), self.name)


computer_vision_service = ComputerVisionService()
