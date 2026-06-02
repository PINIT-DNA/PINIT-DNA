/**
 * PINIT-DNA — Vault Routes
 *
 * POST   /vault/store         — Encrypt + store image in vault
 * GET    /vault/:id           — Get vault record metadata
 * POST   /vault/:id/retrieve  — Decrypt + return original image
 */

import { Router } from 'express';
import { uploadSingle } from '../middleware/upload.middleware';
import { listVaultRecords, storeInVault, getVaultRecord, retrieveFromVault } from '../controllers/vault.controller';

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
router.get('/', listVaultRecords);
router.post('/store', uploadSingle, storeInVault);

/**
 * GET /vault/:id
 * Response 200: vault record metadata (no file content)
 */
router.get('/:id', getVaultRecord);

/**
 * POST /vault/:id/retrieve
 * Response 200: binary stream of the decrypted original image
 * Headers:
 *   Content-Type: image/jpeg (original MIME)
 *   Content-Disposition: attachment; filename="original.jpg"
 *   X-Vault-Id: uuid
 */
router.post('/:id/retrieve', retrieveFromVault);

export { router as vaultRouter };
