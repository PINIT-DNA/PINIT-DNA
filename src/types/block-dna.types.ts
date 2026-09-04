export type BlockDnaClassification = 'ORIGINAL' | 'MODIFIED' | 'UNKNOWN';

export interface BlockDnaCellMeta {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlockDnaManifestBlock extends BlockDnaCellMeta {
  dna: string;
}

export interface BlockDnaManifest {
  image_id: string;
  width: number;
  height: number;
  block_size: number;
  algorithm: 'HMAC-SHA256';
  version: number;
  blocks: BlockDnaManifestBlock[];
}

/** Compact stored form (full HMAC tags, no per-block JSON). */
export interface StoredBlockDnaManifest {
  imageId: string;
  width: number;
  height: number;
  blockSize: number;
  algorithm: 'HMAC-SHA256';
  version: number;
  tagBytes: number;
  tagsB64: string;
}

export interface BlockDnaCellResult extends BlockDnaCellMeta {
  status: BlockDnaClassification;
  confidence: number;
  dnaVerified: boolean;
  pixelSimilarity: number;
  structuralSimilarity: number;
  vaultDna: string;
  calculatedDna: string;
  pixelHint?: { x: number; y: number };
}

export interface BlockDnaPackedHover {
  rows: number;
  cols: number;
  labels: string;
  vaultDnaHex16: string;
  calcDnaHex16: string;
  pixelSimPct: string;
  structSimPct: string;
  dnaOk: string;
}

export interface BlockDnaInvestigationResult {
  available: boolean;
  imageId: string;
  vaultMatchId: string;
  investigationId: string;
  overallMatch: number;
  originalBlockPercent: number;
  modifiedBlockPercent: number;
  unknownBlockPercent: number;
  totalBlocks: number;
  matchedBlocks: number;
  modifiedBlocks: number;
  unknownBlocks: number;
  algorithm: string;
  blockSize: number;
  authenticationStatus: string;
  narrative: string;
  probeWidth: number;
  probeHeight: number;
  vaultWidth: number;
  vaultHeight: number;
  blockGrid: { rows: number; cols: number; labels: string };
  packed: BlockDnaPackedHover;
  /** Included when the grid is small enough for tests / light payloads. */
  blocks?: BlockDnaCellResult[];
}
