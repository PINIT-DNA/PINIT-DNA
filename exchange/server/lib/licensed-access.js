import { createLicensedShareOnHub } from '../hub-client.js';
import { runSql } from './db.js';
import { publicLicensedShareUrl } from './share-viewer-url.js';

/**
 * Persist Hub share grant on the sealed order. The browser never receives
 * Hub JWT delivery URLs — only this share URL.
 */
export async function persistLicensedShare(sealId, share) {
  if (!sealId || !share?.token) return;
  const shareUrl = publicLicensedShareUrl(share.token) || share.shareUrl;
  if (!shareUrl) return;
  await runSql(
    `UPDATE orders_sealed
        SET share_token = ?, share_url = ?, delivery_status = 'active'
      WHERE seal_id = ?`,
    [share.token, shareUrl, sealId],
  );
}

export function publicAccessFromOrder(order) {
  const token = order?.share_token || null;
  const shareUrl = token
    ? (publicLicensedShareUrl(token) || order?.share_url || null)
    : (order?.share_url || null);
  return {
    share_token: token,
    share_url: shareUrl,
    view_url: shareUrl,
    download_intent_url: shareUrl ? `${shareUrl}${shareUrl.includes('?') ? '&' : '?'}download=1` : null,
  };
}

/**
 * Create (or reuse) the Hub-controlled share for a sealed licence.
 */
export async function ensureLicensedShare(order, options = {}) {
  if (order?.share_url && order?.share_token) {
    return {
      token: order.share_token,
      shareUrl: order.share_url,
      allowDownload: true,
    };
  }
  const result = await createLicensedShareOnHub({
    assetId: order.asset_id,
    sealId: order.seal_id,
    orderId: order.order_id,
    buyerPinitId: order.buyer_pinit_id,
    licenseTier: order.license_tier,
    options: {
      allowDownload: true,
      requestLocation: true,
      requireName: false,
      expiresIn: options.expiresIn ?? null,
      ...options,
    },
  });
  await persistLicensedShare(order.seal_id, result);
  return result;
}
