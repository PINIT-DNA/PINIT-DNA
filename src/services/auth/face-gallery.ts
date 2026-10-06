/**
 * Face gallery search. Brute force is the current backend.
 * A vector index replaces `searchFaceGallery` when the enrolled set is large.
 * Callers must still fail closed when two candidates are too close.
 */
import { rankFaceMatches, type FaceRankResult } from './biometric-matching.service';

export interface GalleryFace {
  userId: string;
  shortId: string;
  embedding: number[];
}

export function searchFaceGallery(probe: number[], gallery: GalleryFace[]): FaceRankResult {
  return rankFaceMatches(probe, gallery);
}
