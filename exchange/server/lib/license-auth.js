import { getSql } from './db.js';
import { isLicenseDownloadable, LICENSE_STATUS } from './lifecycle.js';
import { downloadQuotaExhausted, downloadsRemaining } from './licensing.js';

/**
 * Authorize a licensed download. Never trust browser assetId alone.
 */
export async function authorizeLicenseDownload({
  sealId,
  buyerPinitId = '',
  buyerEmail = '',
  requestedAssetId = '',
}) {
  if (!sealId) {
    const err = new Error('seal_id (license id) required');
    err.status = 400;
    throw err;
  }

  const order = await getSql('SELECT * FROM orders_sealed WHERE seal_id = ?', [sealId]);
  if (!order) {
    const err = new Error('License not found');
    err.status = 404;
    throw err;
  }

  const buyerOk =
    (buyerPinitId && order.buyer_pinit_id === buyerPinitId) ||
    (buyerEmail && String(order.buyer_email || '').toLowerCase() === String(buyerEmail).toLowerCase());

  if (!buyerOk) {
    const err = new Error('Forbidden: license does not belong to this buyer');
    err.status = 403;
    throw err;
  }

  if (requestedAssetId && requestedAssetId !== order.asset_id) {
    const err = new Error('Forbidden: asset does not match license');
    err.status = 403;
    throw err;
  }

  const licenseStatus = String(order.license_status || LICENSE_STATUS.ACTIVE).toLowerCase();
  if (!isLicenseDownloadable(licenseStatus)) {
    const err = new Error(`Download blocked: license is ${licenseStatus}`);
    err.status = 403;
    throw err;
  }

  const orderStatus = String(order.status || '').toLowerCase();
  if (['refunded', 'cancelled', 'failed'].includes(orderStatus)) {
    const err = new Error(`Download blocked: order is ${orderStatus}`);
    err.status = 403;
    throw err;
  }

  if (order.license_expires_at) {
    const exp = new Date(order.license_expires_at).getTime();
    if (Number.isFinite(exp) && Date.now() > exp) {
      const err = new Error('Download blocked: license expired');
      err.status = 403;
      throw err;
    }
  }

  if (order.delivery_expires_at && !order.share_token) {
    const exp = new Date(order.delivery_expires_at).getTime();
    if (Number.isFinite(exp) && Date.now() > exp) {
      const err = new Error('This access link is no longer available.');
      err.status = 403;
      throw err;
    }
  }

  if (order.delivery_status && ['revoked', 'expired', 'refunded'].includes(String(order.delivery_status).toLowerCase())) {
    const err = new Error(`Download blocked: delivery is ${order.delivery_status}`);
    err.status = 403;
    throw err;
  }

  // Tier download entitlement. Checked last so a genuinely blocked licence
  // reports the real reason rather than a quota message.
  if (downloadQuotaExhausted(order)) {
    const err = new Error(
      `Download limit reached for this licence (${order.download_limit} of ${order.download_limit} used). ` +
      'Upgrade the licence tier for more downloads.',
    );
    err.status = 403;
    throw err;
  }

  return order;
}
