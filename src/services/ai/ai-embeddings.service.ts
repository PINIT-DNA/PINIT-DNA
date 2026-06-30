/**
 * PINIT-DNA — AI Embeddings Service (Phase 2)
 *
 * Express integration layer that communicates with the Python AI microservice.
 * ALL existing functionality works if Python service is offline.
 * This service is gracefully degraded — never throws on unavailability.
 *
 * Python AI service: http://localhost:8001
 */

import axios from 'axios';
import { logger } from '../../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  embedding:    number[];
  dimension:    number;
  processingMs: number;
}

export interface IndexResult {
  success:      boolean;
  dnaRecordId:  string;
  totalIndexed: number;
  processingMs: number;
}

export interface SearchResult {
  dnaRecordId: string;
  filename:    string;
  fileType:    string;
  snippet:     string;
  similarity:  number;
  indexedAt:   string;
}

export interface SearchResponse {
  query:        string;
  results:      SearchResult[];
  count:        number;
  totalIndexed: number;
  processingMs: number;
}

export interface DuplicateResult {
  dnaRecordId:     string;
  filename:        string;
  fileType:        string;
  similarity:      number;
  classification:  'DUPLICATE' | 'NEAR_MATCH';
}

export interface DuplicateResponse {
  duplicatesFound:  number;
  nearMatchesFound: number;
  duplicates:       DuplicateResult[];
  nearMatches:      DuplicateResult[];
  thresholds:       { duplicate: number; nearMatch: number };
}

export interface AIHealthStatus {
  online:   boolean;
  indexed:  number;
  model:    string;
  latencyMs?: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

const AI_URL     = process.env['AI_SERVICE_URL'] ?? 'http://localhost:8001';
const AI_TIMEOUT = parseInt(process.env['AI_SERVICE_TIMEOUT_MS'] ?? '10000', 10);

const client = axios.create({
  baseURL: AI_URL,
  timeout: AI_TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
});

export class AIEmbeddingsService {
  private _lastHealthCheck = 0;
  private _isOnline        = false;
  private readonly HEALTH_CACHE_MS = 30_000; // re-check every 30s

  // ─── Health ────────────────────────────────────────────────────────────────

  async isOnline(): Promise<boolean> {
    const now = Date.now();
    if (now - this._lastHealthCheck < this.HEALTH_CACHE_MS) {
      return this._isOnline;
    }

    try {
      await client.get('/health', { timeout: 3000 });
      this._isOnline = true;
    } catch {
      this._isOnline = false;
    }
    this._lastHealthCheck = now;
    return this._isOnline;
  }

  async getHealth(): Promise<AIHealthStatus> {
    const start = Date.now();
    try {
      const { data } = await client.get('/health', { timeout: 3000 });
      this._isOnline = true;
      this._lastHealthCheck = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      return {
        online:    true,
        indexed:   d.indexed,
        model:     d.model,
        latencyMs: Date.now() - start,
      };
    } catch {
      this._isOnline = false;
      return { online: false, indexed: 0, model: 'unavailable' };
    }
  }

  // ─── Phase 1: Embedding ────────────────────────────────────────────────────

  /**
   * Generate semantic embedding for text.
   * Returns null if AI service is offline (non-fatal).
   */
  async embed(text: string): Promise<EmbeddingResult | null> {
    try {
      const { data } = await client.post<EmbeddingResult>('/embed', { text });
      return data;
    } catch (err) {
      this.logError('embed', err);
      return null;
    }
  }

  // ─── Phase 1: Index ────────────────────────────────────────────────────────

  /**
   * Index a document for semantic search.
   * Silently skips if AI service is offline.
   */
  async indexDocument(params: {
    dnaRecordId: string;
    filename:    string;
    fileType:    string;
    text:        string;
    title?:      string;
    author?:     string;
    keywords?:   string;
  }): Promise<IndexResult | null> {
    if (!params.text.trim()) return null;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await client.post<IndexResult>('/index', params);
      logger.debug('AI: document indexed', { dnaRecordId: params.dnaRecordId.slice(0, 8) });
      return data;
    } catch (err) {
      this.logError('index', err);
      return null;
    }
  }

  // ─── Phase 1: Search ───────────────────────────────────────────────────────

  /**
   * Semantic similarity search.
   * Returns empty results if AI service is offline.
   */
  async search(query: string, topK = 5, threshold = 0.30): Promise<SearchResponse> {
    const empty: SearchResponse = { query, results: [], count: 0, totalIndexed: 0, processingMs: 0 };

    try {
      const { data } = await client.post<SearchResponse>('/search', { query, topK, threshold });
      return data;
    } catch (err) {
      this.logError('search', err);
      return empty;
    }
  }

  // ─── Phase 4: Duplicate Detection ─────────────────────────────────────────

  async detectDuplicates(text: string, threshold = 0.92): Promise<DuplicateResponse | null> {
    try {
      const { data } = await client.post<DuplicateResponse>('/duplicates', { text, threshold });
      return data;
    } catch (err) {
      this.logError('duplicates', err);
      return null;
    }
  }

  async findSimilar(query: string, topK = 5): Promise<SearchResponse> {
    const empty: SearchResponse = { query, results: [], count: 0, totalIndexed: 0, processingMs: 0 };
    try {
      const { data } = await client.post<SearchResponse>('/similar', { query, topK });
      return data;
    } catch (err) {
      this.logError('similar', err);
      return empty;
    }
  }

  // ─── Phase 3: OCR via Python AI ───────────────────────────────────────────

  async extractTextOcr(buffer: Buffer, filename: string, mimeType: string): Promise<{
    text: string; wordCount: number; processingMs: number;
  } | null> {
    try {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('file', buffer, { filename, contentType: mimeType });

      const { data } = await client.post('/ocr', form, {
        headers: form.getHeaders(),
        timeout: 30_000, // OCR can be slow
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      return { text: d.text, wordCount: d.wordCount, processingMs: d.processingMs };
    } catch (err) {
      this.logError('ocr', err);
      return null;
    }
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  async getStats() {
    try {
      const { data } = await client.get('/stats');
      return data;
    } catch {
      return null;
    }
  }

  async removeFromIndex(dnaRecordId: string): Promise<void> {
    try {
      await client.delete(`/index/${dnaRecordId}`);
    } catch { /* non-fatal */ }
  }

  /** ORB/AKAZE image similarity via Python OpenCV (graceful offline fallback). */
  async compareImages(
    probe: Buffer,
    reference: Buffer,
  ): Promise<{ similarity: number; method: string; keypointMatches?: number } | null> {
    try {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('probe', probe, { filename: 'probe.jpg', contentType: 'image/jpeg' });
      form.append('reference', reference, { filename: 'ref.jpg', contentType: 'image/jpeg' });

      const { data } = await client.post('/cv/compare', form, {
        headers: form.getHeaders(),
        timeout: 25_000,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      if (typeof d.similarity !== 'number') return null;
      return {
        similarity: d.similarity,
        method: d.method ?? 'opencv_orb',
        keypointMatches: d.keypointMatches,
      };
    } catch (err) {
      this.logError('cv/compare', err);
      return null;
    }
  }

  // ─── Error helper ──────────────────────────────────────────────────────────

  private logError(operation: string, err: unknown): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = err as any;
    if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT') {
      logger.debug(`AI service offline — ${operation} skipped`);
    } else if (e?.response || e?.request) {
      logger.warn(`AI service error in ${operation}`, { status: e?.response?.status });
    }
    this._isOnline = false;
  }
}

export const aiService = new AIEmbeddingsService();
