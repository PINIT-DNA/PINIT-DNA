"""
Concurrent /index calls must keep FAISS vector positions and metadata rows aligned.

The endpoints are plain `def`, so FastAPI runs them in a thread pool (the tests call the
endpoint function directly from threads, which is exactly what the pool does). Each one does
`index.add(vec)` and then `metadata.append(entry)`; two racing calls can interleave
(A adds, B adds, B appends, A appends) so row N of `metadata` no longer describes
vector N — and a search then returns the WRONG document for a match. The backend
indexes 5-10 documents in parallel, so this is reachable in normal use.

Run: python -m unittest tests.test_index_concurrency   (from python-ai/)
"""
import hashlib
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import faiss
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402

DIM = main.DIMENSION


def _vec_for(text: str) -> np.ndarray:
    """Deterministic per-text vector, so we can verify which vector belongs to which doc."""
    seed = int.from_bytes(hashlib.sha256(text.encode()).digest()[:4], "big")
    return np.random.default_rng(seed).standard_normal(DIM).astype(np.float32)


def _slow_encode(text: str) -> np.ndarray:
    # A tiny delay widens the window between index.add and metadata.append, the way a
    # real model encode + contention would, so the race shows up reliably.
    time.sleep(0.002)
    return _vec_for(text)


class _SlowIndex(faiss.IndexFlatL2):
    """Flat index whose add() yields the GIL briefly, exposing unlocked add/append pairs."""

    def add(self, x):  # noqa: D401
        time.sleep(0.001)
        return super().add(x)


class IndexConcurrency(unittest.TestCase):
    def setUp(self):
        for target, value in (
            ("index", _SlowIndex(DIM)),
            ("metadata", []),
            ("save_index", lambda: None),
            ("encode_one", _slow_encode),
        ):
            p = mock.patch.object(main, target, value)
            p.start()
            self.addCleanup(p.stop)

    def _index_many(self, n: int, threads: int) -> None:
        errors: list = []

        def worker(ids):
            for i in ids:
                try:
                    main.index_document(main.IndexRequest(
                        dnaRecordId=f"doc-{i}", filename=f"doc-{i}.txt",
                        fileType="TXT", text=f"content number {i}",
                    ))
                except Exception as e:  # noqa: BLE001
                    errors.append((i, repr(e)))

        ts = [threading.Thread(target=worker, args=(range(k, n, threads),)) for k in range(threads)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(errors, [])

    def test_vector_positions_stay_aligned_with_metadata_under_parallel_indexing(self):
        n = 60
        self._index_many(n, threads=8)

        self.assertEqual(main.index.ntotal, n)
        self.assertEqual(len(main.metadata), n)

        misaligned = []
        for pos, meta in enumerate(main.metadata):
            # The service embeds: request title + author + keywords (all empty here) + filename + text.
            expected_text = f"{meta['filename']} content number {meta['dnaRecordId'].split('-')[1]}"
            stored = main.index.reconstruct(pos)
            if not np.allclose(stored, _vec_for(expected_text), atol=1e-5):
                misaligned.append(meta["dnaRecordId"])
        self.assertEqual(misaligned, [], f"{len(misaligned)} documents point at another document's vector")

    def test_reindexing_the_same_document_in_parallel_leaves_exactly_one_live_copy(self):
        errors: list = []

        def hit():
            try:
                main.index_document(main.IndexRequest(
                    dnaRecordId="same", filename="same.txt", fileType="TXT", text="same content",
                ))
            except Exception as e:  # noqa: BLE001
                errors.append(repr(e))

        ts = [threading.Thread(target=hit) for _ in range(10)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(errors, [])
        live = [m for m in main.metadata if m["dnaRecordId"] == "same" and not m.get("_deleted")]
        self.assertEqual(len(live), 1)


class IndexCompaction(unittest.TestCase):
    """Re-indexing leaves dead vectors behind; they are compacted away once they dominate."""

    def setUp(self):
        for target, value in (
            ("index", faiss.IndexFlatL2(DIM)),
            ("metadata", []),
            ("save_index", lambda: None),
            ("encode_one", _vec_for),
            ("COMPACT_MIN_VECTORS", 10),
            ("COMPACT_DEAD_RATIO", 0.5),
        ):
            p = mock.patch.object(main, target, value)
            p.start()
            self.addCleanup(p.stop)

    def _index(self, rid: str, text: str) -> None:
        main.index_document(main.IndexRequest(dnaRecordId=rid, filename=f"{rid}.txt", fileType="TXT", text=text))

    def test_reindexing_one_document_repeatedly_does_not_grow_the_index_forever(self):
        for i in range(40):
            self._index("only", f"revision {i}")
        self.assertLess(main.index.ntotal, 40)          # dead vectors were compacted away
        live = [m for m in main.metadata if not m.get("_deleted")]
        self.assertEqual([m["dnaRecordId"] for m in live], ["only"])
        self.assertEqual(main.index.ntotal, len(main.metadata))

    def test_compaction_keeps_every_live_document_aligned_with_its_own_vector(self):
        for i in range(6):
            self._index(f"doc-{i}", f"stable content {i}")
        for i in range(40):                              # churn one document to force compaction
            self._index("doc-0", f"churn {i}")
        self.assertEqual(main.index.ntotal, len(main.metadata))
        for pos, meta in enumerate(main.metadata):
            expected = f"{meta['filename']} {meta['snippet']}"   # filename + the text that was indexed
            self.assertTrue(np.allclose(main.index.reconstruct(pos), _vec_for(expected), atol=1e-5),
                            f"{meta['dnaRecordId']} points at another document's vector")
        # A few superseded rows may remain below the compaction threshold; the LIVE set must be exact.
        live_ids = sorted(m["dnaRecordId"] for m in main.metadata if not m.get("_deleted"))
        self.assertEqual(live_ids, [f"doc-{i}" for i in range(6)])

    def test_a_healthy_index_is_left_alone(self):
        for i in range(12):
            self._index(f"doc-{i}", f"content {i}")
        before = main.index.ntotal
        with main._index_lock:
            self.assertFalse(main.compact_index_if_needed())
        self.assertEqual(main.index.ntotal, before)


if __name__ == "__main__":
    unittest.main()
