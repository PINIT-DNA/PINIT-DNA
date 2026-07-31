/**
 * Client mirror of server global version contracts (Task A1).
 *
 * WHY a client copy: Vite cannot import from `src/config/dna-versions.ts` without
 * build-path changes. Values MUST stay byte-identical to
 * `src/config/dna-versions.ts` — definitions only; no behaviour change.
 *
 * Source of truth: ../../../../src/config/dna-versions.ts (server).
 */

/** Matches server SYSTEM_VERSION / DNA_GENERATOR_VERSION / DNA_SCHEMA_VERSION. */
export const SYSTEM_VERSION = '1.0.0' as const;
export const DNA_SCHEMA_VERSION = '1.0.0' as const;
export const DNA_GENERATOR_VERSION = '2.0.0-universal' as const;
