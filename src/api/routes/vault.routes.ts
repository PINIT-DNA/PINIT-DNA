/**
 * PINIT-DNA — Vault Routes
 *
 * POST   /vault/store         — Encrypt + store image in vault
 * GET    /vault/:id           — Get vault record metadata
 * POST   /vault/:id/retrieve  — Decrypt + return original image
 */

import { Router } from 'express';
import { uploadSingle } from '../middleware/upload.middleware';
import { listVaultRecords, storeInVault, getVaultRecord, retrieveFromVault, scanVaultFile, verifyFileIdentity, prepareProtectedDownload, protectedDownloadFromVault } from '../controllers/vault.controller';
import { vaultIntegrityCheck } from '../controllers/integrity.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { requireVaultOwnership } from '../middleware/ownership.middleware';

const router = Router();

/**
 * POST /vault/store
 * Body: multipart/form-data
 *   - image:        File   — the original image to encrypt
 *   - dnaRecordId:  string — the DNA record to link
 *
 * Response 201:
 * {
 *   success: true,
 *   vaultId: "uuid",
 *   dnaRecordId: "uuid",
 *   encryptionAlgorithm: "AES-256-GCM",
 *   encryptedSizeBytes: 562044,
 *   originalSizeBytes: 562016,
 *   storedAt: "ISO8601"
 * }
 */
router.get('/', requireAuth, listVaultRecords);
/** GET /vault/integrity-check — Phase 4.6: check all vault files exist on disk */
router.get('/integrity-check', requireAuth, vaultIntegrityCheck);
router.post('/store', requireAuth, uploadSingle, storeInVault);

/**
 * GET /vault/:id
 * Response 200: vault record metadata (no file content)
 */
router.get('/:id', requireAuth, requireVaultOwnership, getVaultRecord);

/**
 * POST /vault/:id/retrieve
 * Response 200: binary stream of the decrypted original image
 * Headers:
 *   Content-Type: image/jpeg (original MIME)
 *   Content-Disposition: attachment; filename="original.jpg"
 *   X-Vault-Id: uuid
 */
router.post('/:id/retrieve', requireAuth, requireVaultOwnership, retrieveFromVault);

/**
 * POST /vault/:id/protected-download/prepare
 * Verifies DNA + certificate + forensic identity — returns step manifest (no file bytes).
 */
router.post('/:id/protected-download/prepare', requireAuth, requireVaultOwnership, prepareProtectedDownload);

/**
 * POST /vault/:id/protected-download
 * Protected owner download — decrypts without stripping forensic markers.
 */
router.post('/:id/protected-download', requireAuth, requireVaultOwnership, protectedDownloadFromVault);

/**
 * POST /vault/:id/scan-sensitive
 * Decrypts the vault file, extracts text, and returns which sensitive data
 * types were detected (email / phone / aadhaar / pan / address).
 * Does NOT mask anything — read-only scan for the share modal UI.
 */
router.post('/:id/scan-sensitive', requireAuth, requireVaultOwnership, scanVaultFile);

// POST /vault/verify-identity — upload any file to extract & verify embedded PINIT-DNA owner identity
router.post('/verify-identity', uploadSingle, verifyFileIdentity);

// POST /vault/scan-verify — OCR text from camera scan → search vault files by content match
// Uses smart matching: filters out template/common words so identity docs (Aadhaar, PAN, etc.)
// don't false-match against each other based on shared headers.
router.post('/scan-verify', requireAuth, async (req, res, next) => {
  try {
    const { ocrText } = req.body;
    const userId = (req as any).user?.sub;
    if (!ocrText || typeof ocrText !== 'string' || ocrText.trim().length < 10) {
      res.status(400).json({ success: false, message: 'OCR text too short. Please scan a clearer image.' });
      return;
    }

    // ── Template/common words to IGNORE (identity docs, government forms, etc.) ──
    const TEMPLATE_WORDS = new Set([
      // Aadhaar
      'government','india','unique','identification','authority','aadhaar',
      'address','male','female','date','birth','year','enrolment','number',
      'your','help','improve','quality','resident','download','maadhaar',
      'verify','online','uidai','virtual','masked','letter',
      // PAN
      'income','department','permanent','account','card',
      // Driving License
      'transport','licence','license','driving','validity','valid','from',
      'issue','motor','vehicle','authorization','class','type',
      // Passport
      'republic','passport','nationality','indian','place','surname','given',
      'names','holder','signature','file',
      // Common doc words
      'page','copy','original','document','certificate','office','form',
      'name','phone','email','mobile','state','district','city','town',
      'village','post','pin','code','pincode','country','street','road',
      'house','flat','floor','building','block','sector','colony','nagar',
      'father','mother','husband','wife','guardian','relation','with','this',
      'that','the','and','for','from','have','been','will','shall','not',
      'are','was','were','has','had','may','can','also','other','such',
    ]);

    const allWords = ocrText.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w: string) => w.length > 2);

    // Separate into unique words (identity-bearing) vs template words
    const uniqueWords: string[] = [];
    const templateHits: string[] = [];
    for (const w of allWords) {
      if (TEMPLATE_WORDS.has(w)) templateHits.push(w);
      else uniqueWords.push(w);
    }

    // Need at least some unique words to avoid template-only matching
    if (uniqueWords.length < 2) {
      res.status(200).json({
        success: true, found: false,
        message: 'Only common/template words detected. Please scan a document with unique content (names, numbers, specific text).',
        debug: { totalWords: allWords.length, uniqueWords: uniqueWords.length, templateWords: templateHits.length },
      });
      return;
    }

    // Use top 60 unique words for matching
    const searchWords = uniqueWords.slice(0, 60);

    const { prisma: db } = await import('../../lib/prisma');

    const ocrRecords = await db.ocrRecord.findMany({
      where: { dnaRecord: { ownerUserId: userId } },
      include: {
        dnaRecord: {
          include: {
            vaultRecord: true,
            ownerUser: { select: { id: true, fullName: true, email: true, shortId: true } },
          },
        },
      },
    });

    let bestMatch: typeof ocrRecords[0] | null = null;
    let bestScore = 0;
    let bestUniqueHits = 0;

    for (const rec of ocrRecords) {
      if (!rec.extractedText) continue;

      // Also filter stored text to only unique words
      const storedWords = rec.extractedText.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length > 2 && !TEMPLATE_WORDS.has(w));
      const storedSet = new Set(storedWords);

      // Count how many of the scan's unique words appear in stored unique words
      let uniqueHits = 0;
      for (const w of searchWords) {
        if (storedSet.has(w)) uniqueHits++;
      }

      // Score based on unique word overlap only
      const score = searchWords.length > 0 ? (uniqueHits / searchWords.length) * 100 : 0;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = rec;
        bestUniqueHits = uniqueHits;
      }
    }

    // Higher threshold: 50% of UNIQUE words must match (not template words)
    if (!bestMatch || bestScore < 50) {
      res.status(200).json({
        success: true, found: false,
        message: 'No matching document found in your vault. The scanned document may not be protected by PINIT-DNA.',
        debug: {
          searchedUniqueWords: searchWords.length,
          filteredTemplateWords: templateHits.length,
          bestScore: Math.round(bestScore),
        },
      });
      return;
    }

    const dna = bestMatch.dnaRecord;
    const owner = dna?.ownerUser;
    const vault = dna?.vaultRecord;

    res.status(200).json({
      success: true,
      found: true,
      matchScore: Math.round(bestScore),
      matchMethod: `Smart OCR match (${bestUniqueHits}/${searchWords.length} unique words, template words filtered)`,
      identity: {
        dnaId: dna?.id,
        vaultId: vault?.id,
        ownerUserId: owner?.id,
        ownerName: owner?.fullName ?? null,
        ownerEmail: owner?.email ?? null,
        ownerShortId: owner?.shortId ?? null,
      },
      originalFile: {
        fileName: dna?.imageFilename,
        mimeType: dna?.imageMimeType,
        fileType: dna?.fileType,
      },
      message: `Document matched with ${Math.round(bestScore)}% unique content similarity — "${dna?.imageFilename}"`,
    });
  } catch (err) {
    next(err);
  }
});

export { router as vaultRouter };
