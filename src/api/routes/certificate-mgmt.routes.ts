import { Router } from 'express';
import {
  issueCertificate, verifyCertificate, revokeCertificate,
  listCertificates, listCertificatesByDna,
} from '../controllers/certificate-mgmt.controller';

const router = Router();

router.post('/',                    issueCertificate);
router.get('/verify/:certificateId', verifyCertificate);
router.post('/revoke/:certificateId', revokeCertificate);
router.get('/',                     listCertificates);
router.get('/dna/:dnaRecordId',     listCertificatesByDna);

export { router as certificateMgmtRouter };
