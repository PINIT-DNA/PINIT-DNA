/**
 * PINIT-DNA — Apache Tika Service
 *
 * Extracts metadata from 1400+ file formats via Apache Tika REST API.
 * Optional — falls back to existing metadata extraction if Tika is offline.
 *
 * To run Tika:
 *   docker run -p 9998:9998 apache/tika
 *   OR: java -jar tika-server.jar --port 9998
 *
 * Express starts Tika automatically if Docker is available.
 */

import axios from 'axios';
import { logger } from '../../lib/logger';

const TIKA_URL     = process.env['TIKA_URL'] ?? 'http://localhost:9998';
const TIKA_TIMEOUT = 15_000;

export interface TikaMetadata {
  'Content-Type'?:      string;
  'Author'?:            string;
  'creator'?:           string;
  'dc:creator'?:        string;
  'dc:title'?:          string;
  'dcterms:created'?:   string;
  'dcterms:modified'?:  string;
  'Application-Name'?:  string;
  'producer'?:          string;
  'xmpTPg:NPages'?:     string;
  'Content-Length'?:    string;
  [key: string]:        string | undefined;
}

export interface TikaResult {
  available:    boolean;
  text:         string;
  metadata:     TikaMetadata;
  contentType:  string;
  error?:       string;
}

export class TikaService {
  private _available: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available;
    try {
      await axios.get(`${TIKA_URL}/tika`, { timeout: 5000 });
      this._available = true;
      logger.info('Apache Tika 3.x is available', { url: TIKA_URL });
    } catch {
      this._available = false;
      logger.debug('Apache Tika not available — using built-in metadata extraction');
    }
    return this._available;
  }

  /**
   * Extract text content from any file via Tika.
   */
  async extractText(buffer: Buffer, mimeType: string): Promise<string> {
    if (!await this.isAvailable()) return '';
    try {
      const { data } = await axios.put(`${TIKA_URL}/tika`, buffer, {
        headers: { 'Content-Type': mimeType, 'Accept': 'text/plain' },
        timeout: TIKA_TIMEOUT,
        responseType: 'text',
      });
      return (data as string).trim();
    } catch {
      return '';
    }
  }

  /**
   * Extract metadata from any file via Tika.
   * Returns rich metadata for 1400+ file formats.
   */
  async extractMetadata(buffer: Buffer, mimeType: string): Promise<TikaMetadata> {
    if (!await this.isAvailable()) return {};
    try {
      const { data } = await axios.put(`${TIKA_URL}/meta`, buffer, {
        headers: { 'Content-Type': mimeType, 'Accept': 'application/json' },
        timeout: TIKA_TIMEOUT,
      });
      return data as TikaMetadata;
    } catch {
      return {};
    }
  }

  /**
   * Full extraction: text + metadata in one call.
   */
  async extract(buffer: Buffer, mimeType: string): Promise<TikaResult> {
    const available = await this.isAvailable();
    if (!available) {
      return { available: false, text: '', metadata: {}, contentType: mimeType,
        error: 'Tika not available — start with: docker run -p 9998:9998 apache/tika' };
    }

    try {
      const [text, metadata] = await Promise.all([
        this.extractText(buffer, mimeType),
        this.extractMetadata(buffer, mimeType),
      ]);

      return {
        available: true,
        text,
        metadata,
        contentType: metadata['Content-Type'] ?? mimeType,
      };
    } catch (err) {
      return { available: true, text: '', metadata: {}, contentType: mimeType,
        error: String(err) };
    }
  }

  /**
   * Normalize Tika metadata to our standard fields.
   */
  normalize(meta: TikaMetadata): Record<string, string | null> {
    return {
      author:        meta['Author']            ?? meta['dc:creator']      ?? null,
      title:         meta['dc:title']          ?? null,
      created:       meta['dcterms:created']   ?? null,
      modified:      meta['dcterms:modified']  ?? null,
      contentType:   meta['Content-Type']      ?? null,
      application:   meta['Application-Name'] ?? null,
      producer:      meta['producer']          ?? null,
      pageCount:     meta['xmpTPg:NPages']     ?? null,
      fileSize:      meta['Content-Length']    ?? null,
    };
  }
}

export const tikaService = new TikaService();
