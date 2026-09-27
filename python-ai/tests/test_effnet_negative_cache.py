"""
The EfficientNet texture engine could never load: timm.create_model("efficientnet_b7",
pretrained=True) raises "No pretrained weights exist for efficientnet_b7". The failure was
swallowed silently and RETRIED ON EVERY CALL (~0.6-0.9 s each), and the ensemble runs on every
protect (Layer 11) and inside every forensic scan. A failed load is now remembered for
EFFNET_RETRY_SECONDS, logged once with its reason, and retried afterwards.

Run: python -m unittest tests.test_effnet_negative_cache   (from python-ai/)
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.authenticity_ensemble import service as ens_module  # noqa: E402
from services.authenticity_ensemble.service import AuthenticityEnsembleService  # noqa: E402


class EffnetNegativeCache(unittest.TestCase):
    def setUp(self):
        self.svc = AuthenticityEnsembleService()
        # Pretend timm/torch are importable so the load path is exercised.
        p = mock.patch.object(AuthenticityEnsembleService, "_effnet_available", return_value=True)
        p.start()
        self.addCleanup(p.stop)

    def _failing_timm(self):
        fake = mock.MagicMock()
        fake.create_model.side_effect = RuntimeError("No pretrained weights exist for efficientnet_b7")
        return fake

    def test_a_failed_load_is_not_retried_on_every_call(self):
        fake_timm = self._failing_timm()
        with mock.patch.dict(sys.modules, {"timm": fake_timm, "torch": mock.MagicMock()}):
            self.assertFalse(self.svc._ensure_effnet())
            for _ in range(5):
                self.assertFalse(self.svc._ensure_effnet())
        self.assertEqual(fake_timm.create_model.call_count, 1, "the load was retried within the retry window")

    def test_it_is_retried_after_the_window(self):
        fake_timm = self._failing_timm()
        clock = [1_000_000.0]
        with mock.patch.dict(sys.modules, {"timm": fake_timm, "torch": mock.MagicMock()}), \
                mock.patch.object(ens_module.time, "time", lambda: clock[0]):
            self.assertFalse(self.svc._ensure_effnet())
            clock[0] += ens_module.EFFNET_RETRY_SECONDS - 1
            self.assertFalse(self.svc._ensure_effnet())
            self.assertEqual(fake_timm.create_model.call_count, 1)
            clock[0] += 2                                   # window elapsed
            self.assertFalse(self.svc._ensure_effnet())
            self.assertEqual(fake_timm.create_model.call_count, 2)

    def test_the_reason_is_logged_once_per_window_not_silently_swallowed(self):
        fake_timm = self._failing_timm()
        with mock.patch.dict(sys.modules, {"timm": fake_timm, "torch": mock.MagicMock()}), \
                self.assertLogs(ens_module.log, level="WARNING") as captured:
            self.svc._ensure_effnet()
            self.svc._ensure_effnet()
        warnings = [r for r in captured.records if r.levelname == "WARNING"]
        self.assertEqual(len(warnings), 1)
        self.assertIn("No pretrained weights exist", warnings[0].getMessage())

    def test_a_successful_load_is_cached_and_clears_the_failure_marker(self):
        model = mock.MagicMock()
        fake_timm = mock.MagicMock()
        fake_timm.create_model.return_value = model
        fake_torch = mock.MagicMock()
        fake_torch.cuda.is_available.return_value = False
        self.svc._effnet_failed_at = 123.0
        with mock.patch.dict(sys.modules, {"timm": fake_timm, "torch": fake_torch}), \
                mock.patch.object(ens_module.time, "time", lambda: 123.0 + ens_module.EFFNET_RETRY_SECONDS + 1):
            self.assertTrue(self.svc._ensure_effnet())
            self.assertTrue(self.svc._ensure_effnet())
        self.assertEqual(fake_timm.create_model.call_count, 1)
        self.assertEqual(self.svc._effnet_failed_at, 0.0)


if __name__ == "__main__":
    unittest.main()
