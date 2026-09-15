import { enumerateBlocks } from '../block-dna/grid';
import { unpackTags } from '../block-dna/manifest';
import type { StoredBlockDnaManifest } from '../../types/block-dna.types';
import type { HierarchicalRegionRecord } from '../../types/dna-vnext.types';
import { hex16, regionCommit, rootCommit } from './crypto';

/** Four image quadrants of the 8×8 cell grid. Root HMAC commits to these region HMACs. */
export function buildHierarchyFromBlockDna(stored: StoredBlockDnaManifest): {
  regions: HierarchicalRegionRecord[];
  rootAuthenticationHex16: string;
} {
  const tags = unpackTags(Buffer.from(stored.tagsB64, 'base64'), stored.tagBytes);
  const geoms = enumerateBlocks(stored.width, stored.height, stored.blockSize);
  const midX = Math.floor(stored.width / 2);
  const midY = Math.floor(stored.height / 2);

  const buckets: Array<{ id: string; x: number; y: number; w: number; h: number; tags: Buffer[] }> = [
    { id: 'A', x: 0, y: 0, w: midX, h: midY, tags: [] },
    { id: 'B', x: midX, y: 0, w: stored.width - midX, h: midY, tags: [] },
    { id: 'C', x: 0, y: midY, w: midX, h: stored.height - midY, tags: [] },
    { id: 'D', x: midX, y: midY, w: stored.width - midX, h: stored.height - midY, tags: [] },
  ];

  for (let i = 0; i < geoms.length; i++) {
    const g = geoms[i]!;
    const tag = tags[i];
    if (!tag) continue;
    const cx = g.x + g.width / 2;
    const cy = g.y + g.height / 2;
    const qi = (cy < midY ? 0 : 2) + (cx < midX ? 0 : 1);
    buckets[qi]!.tags.push(tag);
  }

  const regionTags: Buffer[] = [];
  const regions: HierarchicalRegionRecord[] = buckets.map((b) => {
    const commit = regionCommit({
      imageId: stored.imageId,
      regionId: b.id,
      cellTags: b.tags,
    });
    regionTags.push(commit);
    return {
      id: b.id,
      x: b.x,
      y: b.y,
      width: Math.max(0, b.w),
      height: Math.max(0, b.h),
      cellCount: b.tags.length,
      commitHex16: hex16(commit),
    };
  });

  const root = rootCommit({
    imageId: stored.imageId,
    width: stored.width,
    height: stored.height,
    regionTags,
  });

  return { regions, rootAuthenticationHex16: hex16(root) };
}
