"""
Real, measured proof for Layer 9's noise-residual descriptor
(services/computer_vision/service.py::extract_noise_residual /
compare_noise_residuals) — not camera-identification PRNU (that needs a
reference pattern averaged across many known photos from one physical
camera; this repo has no device-enrollment corpus for that, out of scope).

No real multi-photo-per-camera dataset is available in this environment, so
this proves the PIPELINE is mechanically sound via a SYNTHETIC sensor-
pattern simulation: one fixed pseudo-random "sensor noise" pattern is added
to two different synthetic scenes (simulating two photos from the "same
camera"), and a second, different pattern is added to a third scene
(simulating a different camera). The two same-pattern images' residuals
must correlate meaningfully higher than either does against the
different-pattern image.

This is a real test of the math and code — extraction, pooling, cosine
comparison — using ground truth this script controls. It is explicitly NOT
proof of real-world camera-discrimination power on actual photos, which
would need a genuine multi-camera dataset.

Run from the python-ai/ directory: python tests/test_noise_residual.py
"""
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
from PIL import Image

from services.computer_vision.service import ComputerVisionService


def make_scene(rng: np.random.Generator, size: int) -> np.ndarray:
    """A synthetic photo-like scene — smooth gradients + shapes, no noise yet."""
    x, y = np.meshgrid(np.linspace(0, 6, size), np.linspace(0, 6, size))
    base = 128 + 60 * np.sin(x) * np.cos(y) + 30 * np.sin(x * 0.3 + y * 0.7)
    # A few blob "objects" so the scene isn't a pure gradient.
    for _ in range(15):
        cx, cy = rng.uniform(0, size, 2)
        r = rng.uniform(20, 80)
        yy, xx = np.ogrid[:size, :size]
        mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= r ** 2
        base[mask] += rng.uniform(-40, 40)
    return np.clip(base, 0, 255)


def make_sensor_pattern(rng: np.random.Generator, size: int, strength: float = 6.0) -> np.ndarray:
    """A fixed per-pixel pattern simulating one sensor's PRNU — added identically
    to every "photo" from that "camera", the way real PRNU is present in every
    shot from the same physical sensor."""
    return rng.normal(0, strength, (size, size))


def to_png_bytes(arr: np.ndarray) -> bytes:
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="L").convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def main() -> None:
    size = 512
    svc = ComputerVisionService()
    if not svc.is_available():
        print("SKIP: OpenCV/Pillow not available in this environment")
        return

    scene_rng = np.random.default_rng(1)
    pattern_rng_a = np.random.default_rng(42)
    pattern_rng_b = np.random.default_rng(99)

    scene1 = make_scene(scene_rng, size)
    scene2 = make_scene(scene_rng, size)
    scene3 = make_scene(scene_rng, size)

    pattern_a = make_sensor_pattern(pattern_rng_a, size)
    pattern_b = make_sensor_pattern(pattern_rng_b, size)

    photo1_camera_a = to_png_bytes(scene1 + pattern_a)
    photo2_camera_a = to_png_bytes(scene2 + pattern_a)
    photo_camera_b = to_png_bytes(scene3 + pattern_b)

    r1 = svc.extract_noise_residual(photo1_camera_a)
    r2 = svc.extract_noise_residual(photo2_camera_a)
    r3 = svc.extract_noise_residual(photo_camera_b)
    assert r1.success and r2.success and r3.success, f"extraction failed: {r1.message} {r2.message} {r3.message}"

    same_camera = svc.compare_noise_residuals(r1.data, r2.data)
    diff_camera_1 = svc.compare_noise_residuals(r1.data, r3.data)
    diff_camera_2 = svc.compare_noise_residuals(r2.data, r3.data)
    assert same_camera.success and diff_camera_1.success and diff_camera_2.success

    sim_same = same_camera.data["similarity"]
    sim_diff_1 = diff_camera_1.data["similarity"]
    sim_diff_2 = diff_camera_2.data["similarity"]

    print(f"same-camera-pattern similarity:      {sim_same:.4f}")
    print(f"different-camera-pattern similarity: {sim_diff_1:.4f}")
    print(f"different-camera-pattern similarity: {sim_diff_2:.4f}")

    # Pinned to what's actually measured, not an assumed threshold — if this
    # ever fails, the real numbers printed above show whether the scheme
    # stopped discriminating or the margin just shifted.
    assert sim_same > sim_diff_1, "same-sensor-pattern pair did not correlate higher than a different-pattern pair"
    assert sim_same > sim_diff_2, "same-sensor-pattern pair did not correlate higher than a different-pattern pair"
    margin_1 = sim_same - sim_diff_1
    margin_2 = sim_same - sim_diff_2
    print(f"margin over different-pattern comparisons: {margin_1:.4f}, {margin_2:.4f}")
    assert margin_1 > 0.05 and margin_2 > 0.05, "margin too small to be a meaningful signal, not just noise"

    print("PASS — noise-residual descriptor discriminates the synthetic sensor pattern")


if __name__ == "__main__":
    main()
