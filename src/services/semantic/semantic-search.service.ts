/**
 * PINIT-DNA — Semantic Search Service (Phase 5.2)
 *
 * Provides "find similar documents" across the DNA record corpus.
 * Uses TF-IDF weighted vectors + cosine similarity (pure JS, no native deps).
 * Vectra provides a local JSON-based vector index — FAISS equivalent.
 *
 * How it works:
 *   1. When a DNA record is created with OCR text, we compute a TF-IDF vector
 *   2. Store the vector in Vectra (local JSON file index)
 *   3. When searching, compute query vector and find top-K nearest neighbours
 *
 * This replaces FAISS/Pinecone for local operation.
 */

import path from 'path';
import crypto from 'crypto';
import { LocalIndex } from 'vectra';
import { logger } from '../../lib/logger';

// ─── TF-IDF Vector Engine ─────────────────────────────────────────────────────

const VECTOR_DIM = 256; // Fixed embedding dimension

/**
 * Convert text to a fixed-dimension TF-IDF-like vector.
 * Uses character n-grams hashed into buckets → deterministic, no model needed.
 */
function textToVector(text: string): number[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  const words      = normalized.split(/\s+/).filter(Boolean);
  const vector     = new Array<number>(VECTOR_DIM).fill(0);

  // Word frequency (TF component)
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1;

  // Hash each word into a vector bucket and add TF weight
  for (const [word, count] of Object.entries(freq)) {
    const hash   = crypto.createHash('sha256').update(word).digest();
    const bucket = hash.readUInt32BE(0) % VECTOR_DIM;
    vector[bucket] += count / words.length; // TF normalised
  }

  // Also add character bi-gram features for sub-word matching
  for (let i = 0; i < Math.min(normalized.length - 1, 2000); i++) {
    const bigram = normalized.slice(i, i + 2);
    const hash   = crypto.createHash('md5').update(bigram).digest();
    const bucket = hash.readUInt32BE(0) % VECTOR_DIM;
    vector[bucket] += 0.1;
  }

  // L2 normalise
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? vector.map(v => v / norm) : vector;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  dnaRecordId: string;
  filename:    string;
  fileType:    string;
  similarity:  number;   // 0–1 cosine similarity
  snippet:     string;   // first 150 chars of indexed text
}

export class SemanticSearchService {
  private index: LocalIndex;
  private readonly indexPath: string;

  constructor() {
    this.indexPath = path.resolve('./data/semantic-index');
    this.index = new LocalIndex(this.indexPath);
  }

  async ensureIndex(): Promise<void> {
    if (!await this.index.isIndexCreated()) {
      await this.index.createIndex();
      logger.info('Semantic search index created', { path: this.indexPath });
    }
  }

  /**
   * Index a document's OCR/extracted text for future similarity search.
   */
  async indexDocument(params: {
    dnaRecordId: string;
    filename:    string;
    fileType:    string;
    text:        string;
  }): Promise<void> {
    await this.ensureIndex();

    if (!params.text.trim()) return; // Nothing to index

    const vector  = textToVector(params.text);
    const snippet = params.text.slice(0, 150).replace(/\s+/g, ' ').trim();

    try {
      // Delete existing entry for this record if re-indexing
      const existing = await this.index.listItemsByMetadata({ dnaRecordId: params.dnaRecordId });
      for (const item of existing) {
        await this.index.deleteItem(item.id);
      }

      await this.index.insertItem({
        vector,
        metadata: {
          dnaRecordId: params.dnaRecordId,
          filename:    params.filename,
          fileType:    params.fileType,
          snippet,
          indexedAt:   new Date().toISOString(),
        },
      });

      logger.debug('Document indexed for semantic search', {
        dnaRecordId: params.dnaRecordId,
        textLength: params.text.length,
      });
    } catch (err) {
      logger.error('Failed to index document', { error: String(err) });
    }
  }

  /**
   * Find top-K documents most similar to the query text.
   */
  async search(query: string, topK = 5): Promise<SearchResult[]> {
    await this.ensureIndex();

    if (!query.trim()) return [];

    try {
      const queryVector = textToVector(query);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results     = await (this.index as any).queryItems(queryVector, topK) as Array<{score: number; item: {metadata: Record<string,unknown>}}>;

      return results
        .filter(r => r.score > 0.05) // minimum similarity threshold
        .map(r => ({
          dnaRecordId: r.item.metadata['dnaRecordId'] as string,
          filename:    r.item.metadata['filename']    as string,
          fileType:    r.item.metadata['fileType']    as string,
          similarity:  Math.round(r.score * 1000) / 1000,
          snippet:     r.item.metadata['snippet']    as string,
        }));
    } catch (err) {
      logger.error('Semantic search failed', { error: String(err) });
      return [];
    }
  }

  /**
   * Get total number of indexed documents.
   */
  async getIndexSize(): Promise<number> {
    await this.ensureIndex();
    const stats = await this.index.getIndexStats();
    return stats.items;
  }
}
