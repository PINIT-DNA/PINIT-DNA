import { Router } from 'express';
import {
  issueCertificate, verifyCertificate, revokeCertificate,
  listCertificates, listCertificatesByDna,
} from '../controllers/certificate-mgmt.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { requireDnaOwnership, requireCertificateOwnership } from '../middleware/ownership.middleware';

const router = Router();

router.post('/',                    requireAuth, issueCertificate);
router.get('/verify/:certificateId', verifyCertificate);   // public — anyone can verify a certificate
router.post('/revoke/:certificateId', requireAuth, requireCertificateOwnership, revokeCertificate);
router.get('/',                     requireAuth, listCertificates);
router.get('/dna/:dnaRecordId',     requireAuth, requireDnaOwnership, listCertificatesByDna);

export { router as certificateMgmtRouter };
