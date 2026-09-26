"""
Owner-scoped search.

The Node backend used to filter results by owner AFTER the service returned a
global top-K, so with many tenants' documents in one index a user's own hits
were usually dropped. `allowedIds` moves that filter inside the search. These
tests swap in a tiny in-memory index and a deterministic encoder, so they need
no model download and never touch python-ai/data.
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

import faiss
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

DIM = main.DIMENSION


def _vec(seed: float) -> np.ndarray:
    v = np.zeros(DIM, dtype=np.float32)
    v[0] = seed
    return v


class OwnerScopedSearch(unittest.TestCase):
    def setUp(self):
        for target, value in (
            ("index", faiss.IndexFlatL2(DIM)),
            ("metadata", []),
            ("save_index", lambda: None),
            # The query always encodes to the origin, so smaller seed == closer.
            ("encode_one", lambda text: _vec(0.0)),
        ):
            p = mock.patch.object(main, target, value)
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(main.app)

    def _add(self, rid: str, seed: float, deleted: bool = False) -> None:
        main.index.add(np.array([_vec(seed)], dtype=np.float32))
        main.metadata.append({
            "dnaRecordId": rid, "filename": f"{rid}.pdf", "fileType": "PDF",
            "snippet": "s", "fullText": "invoice payment",
            "indexedAt": "2026-01-01T00:00:00Z", "_deleted": deleted,
        })

    def _ids(self, resp) -> list:
        self.assertEqual(resp.status_code, 200, resp.text)
        return [r["dnaRecordId"] for r in resp.json()["results"]]

    def test_other_tenants_cannot_crowd_out_the_callers_documents(self):
        for i in range(80):           # 80 documents that are all CLOSER to the query
            self._add(f"theirs-{i}", 0.01 * (i + 1))
        self._add("mine-1", 5.0)      # the caller's only document is far away

        unscoped = self._ids(self.client.post(
            "/search", json={"query": "q", "topK": 5, "threshold": 0.0}))
        self.assertNotIn("mine-1", unscoped, "precondition: unscoped, the hit is crowded out")

        scoped = self._ids(self.client.post("/search", json={
            "query": "q", "topK": 5, "threshold": 0.0, "allowedIds": ["mine-1"]}))
        self.assertEqual(scoped, ["mine-1"])

    def test_scoped_search_never_returns_ids_outside_the_allow_list(self):
        self._add("mine-1", 0.5)
        self._add("theirs-1", 0.1)
        for path in ("/search", "/search/hybrid"):
            ids = self._ids(self.client.post(path, json={
                "query": "invoice", "topK": 10, "threshold": 0.0, "allowedIds": ["mine-1"]}))
            self.assertEqual(ids, ["mine-1"], path)

    def test_empty_allow_list_returns_nothing(self):
        self._add("theirs-1", 0.1)
        for path in ("/search", "/search/hybrid"):
            self.assertEqual(self._ids(self.client.post(path, json={
                "query": "invoice", "threshold": 0.0, "allowedIds": []})), [], path)

    def test_legacy_callers_without_allowed_ids_are_unchanged(self):
        self._add("a", 0.1)
        self._add("b", 0.2)
        ids = self._ids(self.client.post(
            "/search", json={"query": "q", "topK": 5, "threshold": 0.0}))
        self.assertEqual(ids, ["a", "b"])

    def test_deleted_entries_are_not_returned_even_when_allowed(self):
        self._add("mine-1", 0.1, deleted=True)
        self.assertEqual(self._ids(self.client.post("/search", json={
            "query": "q", "threshold": 0.0, "allowedIds": ["mine-1"]})), [])

    def test_health_reports_unique_live_documents_not_raw_vectors(self):
        self._add("doc-1", 0.1, deleted=True)   # superseded vector
        self._add("doc-1", 0.1)                 # its replacement
        self._add("doc-2", 0.2)
        body = self.client.get("/health").json()
        self.assertEqual(body["indexed"], 3)        # raw vectors incl. the superseded one
        self.assertEqual(body["liveDocuments"], 2)  # what a re-index should compare against

    def test_index_ids_lists_only_unique_live_documents(self):
        self._add("doc-1", 0.1, deleted=True)
        self._add("doc-1", 0.1)
        self._add("doc-2", 0.2)
        self._add("doc-3", 0.3, deleted=True)
        self.assertEqual(self.client.get("/index/ids").json(), {"ids": ["doc-1", "doc-2"]})


if __name__ == "__main__":
    unittest.main()
