/**
 * Pinit Exchange bridge routes
 *
 * Owner auth (Hub JWT):
 *   GET  /exchange/config
 *   GET  /exchange/seller-summary
 *   GET  /exchange/listed-assets
 *   POST /exchange/sso
 *   GET  /exchange/listable-assets
 *   POST /exchange/list-intent
 *
 * Service auth (X-PinIT-Bridge-Secret):
 *   GET  /exchange/listable-assets-bridge?pinitId=
 *   POST /exchange/protect-upload
 *   POST /exchange/listings/confirm
 *   POST /exchange/sales/seal
 *   POST /exchange/delivery/prepare
 *   POST /exchange/activity
 *   GET  /exchange/profiles-bridge?pinitIds=
 *   GET  /exchange/monitoring-summaries-bridge?pinitId=
 *
 * Public (token in path):
 *   GET  /exchange/delivery/:token
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { uploadFile, uploadSingle } from '../middleware/upload.middleware';
import {
  getExchangeConfig,
  getExchangeRole,
  getExchangeSellerSummary,
  getExchangeListedAssets,
  createExchangeSso,
  listExchangeAssets,
  listExchangeAssetsBridge,
  createListIntent,
  confirmExchangeListing,
  sealExchangeSale,
  protectUploadBridge,
  prepareDeliveryBridge,
  redeemDeliveryBridge,
  monitoringSummariesBridge,
  marketplacePreviewBridge,
  createLicensedShareBridge,
  recordAssetActivityBridge,
  listLicensedSharesForOwner,
  profilesBridge,
  createExchangeGatewayOrder,
  verifyExchangeGatewayPayment,
} from '../controllers/exchange-bridge.controller';

const router = Router();

function uploadProtect(req: any, res: any, next: any) {
  uploadFile(req, res, (err: any) => {
    if (err || req.file) return next(err);
    uploadSingle(req, res, next);
  });
}

router.get('/config', requireAuth, getExchangeConfig);
router.get('/role', requireAuth, getExchangeRole);
router.get('/seller-summary', requireAuth, getExchangeSellerSummary);
router.get('/listed-assets', requireAuth, getExchangeListedAssets);
router.post('/sso', requireAuth, createExchangeSso);
router.get('/listable-assets', requireAuth, listExchangeAssets);
router.get('/listable-assets-bridge', listExchangeAssetsBridge);
router.post('/list-intent', requireAuth, createListIntent);
router.get('/licensed-shares', requireAuth, listLicensedSharesForOwner);

router.post('/protect-upload', uploadProtect, protectUploadBridge);
router.post('/listings/confirm', confirmExchangeListing);
router.post('/sales/seal', sealExchangeSale);
router.post('/share/create',      createLicensedShareBridge);
router.post('/activity',          recordAssetActivityBridge);
router.post('/payments/create-order', createExchangeGatewayOrder);
router.post('/payments/verify', verifyExchangeGatewayPayment);
router.post('/delivery/prepare', prepareDeliveryBridge);
router.get('/delivery/:token', redeemDeliveryBridge);
router.get('/profiles-bridge', profilesBridge);
router.get('/monitoring-summaries-bridge', monitoringSummariesBridge);
router.get('/preview/:vaultId', marketplacePreviewBridge);

export const exchangeRouter = router;
