/**
 * IndexedDB store for generated forensic PDF/ZIP artifacts.
 * localStorage only keeps lightweight metadata on the investigation entry.
 */

export type ForensicPdfKind =
  | 'investigation'
  | 'dna'
  | 'timeline'
  | 'evidence_zip'
  | 'json';

export interface ForensicPdfArtifactMeta {
  kind: ForensicPdfKind;
  filename: string;
  savedAt: string;
  sizeBytes: number;
}

interface ForensicPdfArtifactRecord extends ForensicPdfArtifactMeta {
  investigationId: string;
  blob: Blob;
}

const DB_NAME = 'pinit_forensic_artifacts';
const DB_VERSION = 1;
const STORE = 'pdfs';

function artifactKey(investigationId: string, kind: ForensicPdfKind): string {
  return `${investigationId}:${kind}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('investigationId', 'investigationId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function saveForensicPdfArtifact(
  investigationId: string,
  kind: ForensicPdfKind,
  blob: Blob,
  filename: string,
): Promise<ForensicPdfArtifactMeta> {
  const meta: ForensicPdfArtifactMeta = {
    kind,
    filename,
    savedAt: new Date().toISOString(),
    sizeBytes: blob.size,
  };
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    await idbReq(store.put({
      id: artifactKey(investigationId, kind),
      investigationId,
      blob,
      ...meta,
    }));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  } finally {
    db.close();
  }
  return meta;
}

export async function listForensicPdfArtifacts(
  investigationId: string,
): Promise<ForensicPdfArtifactMeta[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const index = tx.objectStore(STORE).index('investigationId');
    const rows = await idbReq<ForensicPdfArtifactRecord[]>(index.getAll(investigationId));
    return rows
      .map(({ kind, filename, savedAt, sizeBytes }) => ({ kind, filename, savedAt, sizeBytes }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } finally {
    db.close();
  }
}

export async function getForensicPdfArtifact(
  investigationId: string,
  kind: ForensicPdfKind,
): Promise<ForensicPdfArtifactRecord | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const row = await idbReq<ForensicPdfArtifactRecord | undefined>(
      tx.objectStore(STORE).get(artifactKey(investigationId, kind)),
    );
    return row ?? null;
  } finally {
    db.close();
  }
}

export async function downloadStoredForensicPdf(
  investigationId: string,
  kind: ForensicPdfKind,
): Promise<boolean> {
  const row = await getForensicPdfArtifact(investigationId, kind);
  if (!row?.blob) return false;
  const url = URL.createObjectURL(row.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = row.filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export async function deleteForensicPdfArtifactsForInvestigation(
  investigationId: string,
): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const index = store.index('investigationId');
    const keys = await idbReq<IDBValidKey[]>(index.getAllKeys(investigationId));
    await Promise.all(keys.map((key) => idbReq(store.delete(key))));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'));
    });
  } finally {
    db.close();
  }
}

export async function clearAllForensicPdfArtifacts(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).clear());
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB clear aborted'));
    });
  } finally {
    db.close();
  }
}

export const FORENSIC_PDF_KIND_LABEL: Record<ForensicPdfKind, string> = {
  investigation: 'Investigation Report (PDF)',
  dna: 'DNA Report (PDF)',
  timeline: 'Timeline Report (PDF)',
  evidence_zip: 'Evidence Package (ZIP)',
  json: 'Advanced Export (JSON)',
};
