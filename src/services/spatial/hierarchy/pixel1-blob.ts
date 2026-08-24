/**
 * Phase 4E — dense enrolled 1×1 tag blob (SP1T)
 *
 * Layout:
 *   magic SP1T (4)
 *   algoLen u8 + utf8
 *   width u32 BE | height u32 BE | tagBytes u8 | pixelCount u32 BE
 *   tags: tagBytes * pixelCount  (row-major index = y * width + x)
 *
 * Phase 3F: reject trailing bytes, wrong counts, unsupported versions/sizes.
 * One Bytes column — not one DB row per pixel.
 */

export const PIXEL1_BLOB_MAGIC = Buffer.from('SP1T');

export interface Pixel1BlobDecoded {
  algorithmVersion: string;
  width: number;
  height: number;
  tagBytes: number;
  /** Dense tags; length === width * height * tagBytes */
  tags: Buffer;
}

export function encodePixel1AuthBlob(params: {
  algorithmVersion: string;
  width: number;
  height: number;
  tagBytes: number;
  /** Dense row-major tags */
  tags: Buffer;
}): Buffer {
  const { width, height, tagBytes, tags, algorithmVersion } = params;
  const pixelCount = width * height;
  const expected = pixelCount * tagBytes;
  if (tags.length !== expected) {
    throw new Error(`pixel1 tags length ${tags.length} != expected ${expected}`);
  }
  if (tagBytes !== 8 && tagBytes !== 16) {
    throw new Error(`Unsupported pixel1 tagBytes: ${tagBytes}`);
  }
  const algo = Buffer.from(algorithmVersion, 'utf8');
  if (algo.length > 255) throw new Error('algorithmVersion too long');

  const hdr = Buffer.alloc(13);
  hdr.writeUInt32BE(width, 0);
  hdr.writeUInt32BE(height, 4);
  hdr.writeUInt8(tagBytes, 8);
  hdr.writeUInt32BE(pixelCount, 9);

  return Buffer.concat([
    PIXEL1_BLOB_MAGIC,
    Buffer.from([algo.length]),
    algo,
    hdr,
    tags,
  ]);
}

export function decodePixel1AuthBlob(blob: Buffer): Pixel1BlobDecoded {
  if (!blob || blob.length < 4 || !blob.subarray(0, 4).equals(PIXEL1_BLOB_MAGIC)) {
    throw new Error('Invalid pixel1AuthBlob');
  }
  let o = 4;
  const algoLen = blob.readUInt8(o); o += 1;
  if (o + algoLen > blob.length) throw new Error('Truncated pixel1AuthBlob algorithmVersion');
  const algorithmVersion = blob.subarray(o, o + algoLen).toString('utf8'); o += algoLen;
  if (o + 13 > blob.length) throw new Error('Truncated pixel1AuthBlob header');
  const width = blob.readUInt32BE(o); o += 4;
  const height = blob.readUInt32BE(o); o += 4;
  const tagBytes = blob.readUInt8(o); o += 1;
  const pixelCount = blob.readUInt32BE(o); o += 4;

  if (tagBytes !== 8 && tagBytes !== 16) {
    throw new Error(`Unsupported pixel1 tagBytes: ${tagBytes}`);
  }
  if (width < 1 || height < 1) throw new Error('Invalid pixel1 blob dimensions');
  if (pixelCount !== width * height) {
    throw new Error(`pixel1 pixelCount ${pixelCount} != width*height ${width * height}`);
  }
  const tagsLen = pixelCount * tagBytes;
  if (o + tagsLen > blob.length) throw new Error('Truncated pixel1AuthBlob tags');
  const tags = Buffer.from(blob.subarray(o, o + tagsLen));
  o += tagsLen;
  if (o !== blob.length) {
    throw new Error(`Trailing bytes in pixel1AuthBlob (offset=${o}, length=${blob.length})`);
  }
  return { algorithmVersion, width, height, tagBytes, tags };
}

export function lookupPixel1EnrolledTag(
  decoded: Pixel1BlobDecoded,
  x: number,
  y: number,
): Buffer {
  if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) {
    throw new Error(`Pixel OOB (${x},${y}) vs ${decoded.width}x${decoded.height}`);
  }
  const idx = y * decoded.width + x;
  const off = idx * decoded.tagBytes;
  return Buffer.from(decoded.tags.subarray(off, off + decoded.tagBytes));
}
