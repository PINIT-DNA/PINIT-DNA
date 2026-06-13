import { Router } from 'express';
import {
  issueCertificate, verifyCertificate, revokeCertificate,
  listCertificates, listCertificatesByDna,
} from '../controllers/certificate-mgmt.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.post('/',                    requireAuth, issueCertificate);
router.get('/verify/:certificateId', verifyCertificate);   // public — anyone can verify a certificate
router.post('/revoke/:certificateId', requireAuth, revokeCertificate);
router.get('/',                     requireAuth, listCertificates);
router.get('/dna/:dnaRecordId',     requireAuth, listCertificatesByDna);

export { router as certificateMgmtRouter };
