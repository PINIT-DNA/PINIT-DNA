import { blockDnaConfig, BLOCK_DNA_ALGORITHM, BLOCK_DNA_VERSION } from '../../config/block-dna';
import type { BlockDnaManifest, StoredBlockDnaManifest } from '../../types/block-dna.types';
import { computeBlockDnaHmac } from './hmac';
import { enumerateBlocks, extractCellRgb } from './grid';

export function generateBlockDnaTags(params: {
  rgb: Buffer;
  width: number;
  height: number;
  imageId: string;
  blockSize?: number;
  version?: number;
}): { tags: Buffer[]; geomCount: number; blockSize: number } {
  const blockSize = params.blockSize ?? blockDnaConfig.blockSize;
  const version = params.version ?? BLOCK_DNA_VERSION;
  const geoms = enumerateBlocks(params.width, params.height, blockSize);
  const tags = geoms.map((g) => {
    const blockRgb = extractCellRgb(params.rgb, params.width, params.height, g);
    return computeBlockDnaHmac({
      imageId: params.imageId,
      imageWidth: params.width,
      imageHeight: params.height,
      blockX: g.x,
      blockY: g.y,
      blockWidth: g.width,
      blockHeight: g.height,
      blockSize,
      version,
      blockRgb,
    });
  });
  return { tags, geomCount: geoms.length, blockSize };
}

export function packTags(tags: Buffer[]): Buffer {
  if (tags.length === 0) return Buffer.alloc(0);
  const width = tags[0]!.length;
  const out = Buffer.alloc(tags.length * width);
  for (let i = 0; i < tags.length; i++) {
    tags[i]!.copy(out, i * width);
  }
  return out;
}

export function unpackTags(packed: Buffer, tagBytes: number): Buffer[] {
  if (tagBytes < 1) return [];
  const n = Math.floor(packed.length / tagBytes);
  const out: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    out.push(packed.subarray(i * tagBytes, (i + 1) * tagBytes));
  }
  return out;
}

export function toStoredManifest(params: {
  imageId: string;
  width: number;
  height: number;
  blockSize: number;
  tags: Buffer[];
}): StoredBlockDnaManifest {
  const tagBytes = params.tags[0]?.length ?? 32;
  return {
    imageId: params.imageId,
    width: params.width,
    height: params.height,
    blockSize: params.blockSize,
    algorithm: BLOCK_DNA_ALGORITHM,
    version: BLOCK_DNA_VERSION,
    tagBytes,
    tagsB64: packTags(params.tags).toString('base64'),
  };
}

export function storedToJsonManifest(stored: StoredBlockDnaManifest): BlockDnaManifest {
  const packed = Buffer.from(stored.tagsB64, 'base64');
  const tags = unpackTags(packed, stored.tagBytes);
  const geoms = enumerateBlocks(stored.width, stored.height, stored.blockSize);
  return {
    image_id: stored.imageId,
    width: stored.width,
    height: stored.height,
    block_size: stored.blockSize,
    algorithm: 'HMAC-SHA256',
    version: stored.version,
    blocks: geoms.map((g, i) => ({
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      dna: (tags[i] ?? Buffer.alloc(0)).toString('hex'),
    })),
  };
}

export function generateManifestFromRgb(params: {
  rgb: Buffer;
  width: number;
  height: number;
  imageId: string;
  blockSize?: number;
}): { stored: StoredBlockDnaManifest; json: BlockDnaManifest } {
  const { tags, blockSize } = generateBlockDnaTags(params);
  const stored = toStoredManifest({
    imageId: params.imageId,
    width: params.width,
    height: params.height,
    blockSize,
    tags,
  });
  return { stored, json: storedToJsonManifest(stored) };
}
