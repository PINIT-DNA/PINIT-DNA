/**
 * Pinit Exchange bridge controller
 * Hub master APIs used by Hub UI + Exchange service callbacks.
 */

import { Request, Response, NextFunction } from 'express';
import {
  exchangeBridgeService,
  verifyServiceBridgeSecret,
} from '../../services/exchange/exchange-bridge.service';
import { config } from '../../config';
import { resolvePublicBaseUrl } from '../../lib/request-utils';
import {
  recordAssetActivityBatch,
  type AssetActivityInput,
} from '../../services/assets/asset-activity.service';
import {
  createHubGatewayOrder,
  verifyHubGatewaySignature,
  fetchHubGatewayPayment,
} from '../../services/exchange/hub-gateway-payment.service';

function userId(req: Request): string {
  return (req as any).user?.sub as string;
}

/** GET /exchange/role — Hub UI uses this to hide List on Exchange for buyers */
export async function getExchangeRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await exchangeBridgeService.getExchangeMarketplaceRole(userId(req));
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/** GET /exchange/config — public-safe URLs for Hub UI */
export async function getExchangeConfig(_req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    appUrl: config.exchange.appUrl,
    apiUrl: config.exchange.apiUrl,
  });
}

/** POST /exchange/sso — Continue with Pinit Hub → Exchange */
export async function createExchangeSso(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await exchangeBridgeService.createSsoToken(userId(req));
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/** GET /exchange/listable-assets — vault assets eligible to list */
export async function listExchangeAssets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const assets = await exchangeBridgeService.getListableAssets(userId(req));
    res.json({ success: true, assets });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /exchange/listable-assets-bridge — Exchange service fetches seller vault assets
 * Auth: X-PinIT-Bridge-Secret + ?pinitId=
 */
export async function listExchangeAssetsBridge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    verifyServiceBridgeSecret(
      (req.headers['x-pinit-bridge-secret'] as string | undefined) ||
      (req.headers['x-exchange-bridge-secret'] as string | undefined),
    );
    const pinitId = String(req.query.pinitId || req.query.pinit_id || '').trim();
    if (!pinitId) {
      res.status(400).json({ success: false, error: 'pinitId is required' });
      return;
    }
    const result = await exchangeBridgeService.getListableAssetsByPinitId(pinitId);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/** POST /exchange/list-intent — create signed Hub → Exchange list handoff */
export async function createListIntent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const vaultId = String(req.body?.vaultId || req.body?.vault_id || '').trim();
    if (!vaultId) {
      res.status(400).json({ success: false, error: 'vaultId is required' });
      return;
    }
    const result = await exchangeBridgeService.createListIntent(userId(req), vaultId);
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /exchange/listings/confirm — Exchange service callback after listing goes live
 * Auth: X-PinIT-Bridge-Secret
 */
export async function confirmExchangeListing(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    verifyServiceBridgeSecret(
      (req.headers['x-pinit-bridge-secret'] as string | undefined) ||
      (req.headers['x-exchange-bridge-secret'] as string | undefined),
    );
    const vaultId = String(req.body?.vaultId || req.body?.vault_id || req.body?.asset_id || '').trim();
    const listingId = String(req.body?.listingId || req.body?.listing_id || '').trim();
    const pinitId = String(req.body?.pinitId || req.body?.pinit_id || '').trim();
    if (!vaultId || !listingId) {
      res.status(400).json({ success: false, error: 'vaultId and listingId are required' });
      return;
    }
    const result = await exchangeBridgeService.confirmListing({
      vaultId,
      listingId,
      pinitId,
      exchangeUrl: req.body?.exchangeUrl || req.body?.exchange_url,
      status: req.body?.status,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /exchange/sales/seal — Exchange service callback after purchase
 * Auth: X-PinIT-Bridge-Secret
 */
export async function sealExchangeSale(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    verifyServiceBridgeSecret(
      (req.headers['x-pinit-bridge-secret'] as string | undefined) ||
      (req.headers['x-exchange-bridge-secret'] as string | undefined),
    );
    const vaultId = String(req.body?.vaultId || req.body?.vault_id || req.body?.asset_id || '').trim();
    const orderId = String(req.body?.orderId || req.body?.order_id || '').trim();
    if (!vaultId || !orderId) {
      res.status(400).json({ success: false, error: 'vaultId and orderId are required' });
      return;
    }
    const result = await exchangeBridgeService.confirmSale({
      vaultId,
      orderId,
      listingId: req.body?.listingId || req.body?.listing_id,
      buyerPinitId: req.body?.buyerPinitId || req.body?.buyer_pinit_id,
      licenseTier: req.body?.licenseTier || req.body?.license_tier,
      sealId: req.body?.sealId || req.body?.seal_id,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /exchange/licensed-shares — creator visibility.
 * Auth: Hub JWT. Returns shares of assets THIS owner owns, created by licensees.
 */
export async function listLicensedSharesForOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await exchangeBridgeService.getLicensedSharesForOwner(userId(req));
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /exchange/share/create — buyer shares a file they licensed on Exchange.
 * Auth: X-PinIT-Bridge-Secret. Exchange verifies the caller owns the seal before
 * calling; Hub creates the ShareLink so all access flows through Hub's existing
 * share viewer and ShareAccessLog tracking.
 */
export async function createLicensedShareBridge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    verifyServiceBridgeSecret(
      (req.headers['x-pinit-bridge-secret'] as string | undefined) ||
      (req.headers['x-exchange-bridge-secret'] as string | undefined),
    );
    const assetId = String(req.body?.assetId || req.body?.asset_id || '').trim();
    const sealId = String(req.body?.sealId || req.body?.seal_id || '').trim();
    const buyerPinitId = String(req.body?.buyerPinitId || req.body?.buyer_pinit_id || '').trim();
    if (!assetId || !sealId || !buyerPinitId) {
      res.status(400).json({ success: false, error: 'assetId, sealId and buyerPinitId are required' });
      return;
    }
    const result = await exchangeBridgeService.createLicensedShare({
      assetId,
      sealId,
      orderId: req.body?.orderId || req.body?.order_id,
      buyerPinitId,
      licenseTier: req.body?.licenseTier || req.body?.license_tier,
      baseUrl: resolvePublicBaseUrl(req),
      options: req.body?.options || {},
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /exchange/protect-upload — Workflow B silent Hub protect
 * Auth: X-PinIT-Bridge-Secret + multipart file + pinitId
 */
export async function protectUploadBridge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    verifyServiceBridgeSecret(
      (req.headers['x-pinit-bridge-secret'] as string | undefined) ||
      (req.headers['x-exchange-bridge-secret'] as string | undefined),
    );
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, error: 'No file uploaded (field name: file or image)' });
      return;
    }
    const pinitId = String(req.body?.pinitId || req.body?.pinit_id || '').trim();
    if (!pinitId) {
      res.status(400).json({ success: false, error: 'pinitId is required' });
      return;
    }
    const fs = await import('fs/promises');
    const buffer = file.buffer?.length
      ? Buffer.from(file.buffer)
      : await fs.readFile(file.path);

    const asset = await exchangeBridgeService.protectUploadForExchange({
      pinitId,
      filePath: file.path || '',
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      buffer,
    });
    res.status(201).json({ success: true, asset });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /exchange/delivery/prepare — mint licensed download token after purchase
 * Auth: X-PinIT-Bridge-Secret
 */
export async function prepareDeliveryBridge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    verifyServiceBridgeSecret(
      (req.headers['x-pinit-bridge-secret'] as string | undefined) ||
      (req.headers['x-exchange-bridge-secret'] as string | undefined),
    );
    const vaultId = String(req.body?.vaultId || req.body?.vault_id || req.body?.asset_id || '').trim();
    const orderId = String(req.body?.orderId || req.body?.order_id || '').trim();
    if (!vaultId || !orderId) {
      res.status(400).json({ success: false, error: 'vaultId and orderId are required' });
      return;
    }
    const result = await exchangeBridgeService.prepareDelivery({
      vaultId,
      orderId,
      listingId: req.body?.listingId || req.body?.listing_id,
      buyerPinitId: req.body?.buyerPinitId || req.body?.buyer_pinit_id,
      buyerEmail: req.body?.buyerEmail || req.body?.buyer_email,
      licenseTier: req.body?.licenseTier || req.body?.license_tier,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/** GET /exchange/delivery/:token — buyer downloads licensed export (no Hub UI) */
export async function redeemDeliveryBridge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) {
      res.status(400).json({ success: false, error: 'Delivery token required' });
      return;
    }
    const result = await exchangeBridgeService.redeemDelivery(token);
    res.setHeader('Content-Type', result.originalMimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.originalFileName || 'licensed-asset')}"`,
    );
    res.setHeader('X-PinIT-Order-Id', result.orderId || '');
    res.setHeader('X-PinIT-Delivery', 'licensed-export');
    res.send(result.buffer);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /exchange/profiles-bridge?pinitIds=PINIT-EX-ABC,PINIT-USER-ABC
 * Auth: X-PinIT-Bridge-Secret
 */
export async function profilesBridge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    verifyServiceBridgeSecret(
      (req.headers['x-pinit-bridge-secret'] as string | undefined) ||
      (req.headers['x-exchange-bridge-secret'] as string | undefined),
    );
    const raw = String(req.query.pinitIds || req.query.pinit_id || req.query.pinitId || '').trim();
    const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
    if (!ids.length) {
      res.status(400).json({ success: false, error: 'pinitIds is required' });
      return;
    }
    const result = await exchangeBridgeService.getPublicProfilesByPinitIds(ids);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /exchange/monitoring-summaries-bridge?pinitId=
 * Auth: X-PinIT-Bridge-Secret
 */
export async function monitoringSummariesBridge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    verifyServiceBridgeSecret(
      (req.headers['x-pinit-bridge-secret'] as string | undefined) ||
      (req.headers['x-exchange-bridge-secret'] as string | undefined),
    );
    const pinitId = String(req.query.pinitId || req.query.pinit_id || '').trim();
    if (!pinitId) {
      res.status(400).json({ success: false, error: 'pinitId is required' });
      return;
    }
    const result = await exchangeBridgeService.getMonitoringSummaries(pinitId);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /exchange/preview/:vaultId — stream marketplace preview bytes
 * Auth: X-PinIT-Bridge-Secret
 */
export async function marketplacePreviewBridge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    verifyServiceBridgeSecret(
      (req.headers['x-pinit-bridge-secret'] as string | undefined) ||
      (req.headers['x-exchange-bridge-secret'] as string | undefined),
    );
    const vaultId = String(req.params.vaultId || '').trim();
    if (!vaultId) {
      res.status(400).json({ success: false, error: 'vaultId is required' });
      return;
    }
    const result = await exchangeBridgeService.getMarketplacePreview(vaultId);
    // The body is a derived, watermarked preview — never the vault master.
    // Headers deliberately carry nothing about the underlying asset:
    //  - no X-Vault-Id, which leaked the internal VaultRecord UUID
    //  - no filename, which leaked the creator's original file name
    //  - no-store, so an expired signed URL cannot be replayed from cache
    res.set({
      'Content-Type': result.originalMimeType || 'application/octet-stream',
      'Content-Length': String(result.originalBuffer.length),
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store, max-age=0',
      'Pragma': 'no-cache',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.status(200).send(result.originalBuffer);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /exchange/activity — Exchange service callback recording asset activity.
 * Auth: X-PinIT-Bridge-Secret
 *
 * Accepts one event or a batch. Every event must carry a canonical Asset.id;
 * events whose asset cannot be resolved are counted as skipped rather than
 * failing the request, so a marketplace action is never blocked by its own
 * audit trail.
 */
export async function recordAssetActivityBridge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    verifyServiceBridgeSecret(
      (req.headers['x-pinit-bridge-secret'] as string | undefined) ||
      (req.headers['x-exchange-bridge-secret'] as string | undefined),
    );

    const raw = Array.isArray(req.body?.events) ? req.body.events : [req.body];
    const events: AssetActivityInput[] = [];

    for (const e of raw) {
      const assetId = String(e?.assetId || e?.asset_id || '').trim();
      const eventType = String(e?.eventType || e?.event_type || '').trim().toUpperCase();
      const title = String(e?.title || '').trim();
      if (!assetId || !eventType || !title) continue;
      events.push({
        assetId,
        eventType: eventType as AssetActivityInput['eventType'],
        title,
        detail: e?.detail ?? null,
        payload: e?.payload ?? null,
        platform: e?.platform ?? 'exchange',
        url: e?.url ?? null,
      });
    }

    if (events.length === 0) {
      res.status(400).json({ success: false, error: 'at least one event with assetId, eventType and title is required' });
      return;
    }
    if (events.length > 100) {
      res.status(400).json({ success: false, error: 'at most 100 events per request' });
      return;
    }

    const result = await recordAssetActivityBatch(events);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

function bridgeAuth(req: Request): void {
  verifyServiceBridgeSecret(
    (req.headers['x-pinit-bridge-secret'] as string | undefined) ||
      (req.headers['x-exchange-bridge-secret'] as string | undefined),
  );
}

/** POST /exchange/payments/create-order — Exchange uses Hub Razorpay keys */
export async function createExchangeGatewayOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    bridgeAuth(req);
    const amountPaise = Number(req.body?.amountPaise || req.body?.amount);
    const currency = String(req.body?.currency || 'INR');
    const receipt = String(req.body?.receipt || '');
    const notes = req.body?.notes && typeof req.body.notes === 'object' ? req.body.notes : {};
    const order = await createHubGatewayOrder({ amountPaise, currency, receipt, notes });
    res.json({ success: true, ...order });
  } catch (err) {
    next(err);
  }
}

/** POST /exchange/payments/verify — signature + capture check on Hub keys */
export async function verifyExchangeGatewayPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    bridgeAuth(req);
    const orderId = String(req.body?.razorpay_order_id || req.body?.orderId || '').trim();
    const paymentId = String(req.body?.razorpay_payment_id || req.body?.paymentId || '').trim();
    const signature = String(req.body?.razorpay_signature || req.body?.signature || '').trim();
    if (!orderId || !paymentId || !signature) {
      res.status(400).json({ success: false, error: 'order, payment and signature are required' });
      return;
    }
    if (!verifyHubGatewaySignature({ orderId, paymentId, signature })) {
      res.status(402).json({ success: false, error: 'PAYMENT_VERIFICATION_FAILED', verified: false });
      return;
    }
    const payment = await fetchHubGatewayPayment(paymentId);
    res.json({
      success: true,
      verified: true,
      payment: {
        id: payment.id,
        order_id: payment.order_id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        token_id: (payment as { token_id?: string }).token_id,
        card: (payment as { card?: { last4?: string; network?: string } }).card,
        vpa: (payment as { vpa?: string }).vpa,
        bank: (payment as { bank?: string }).bank,
      },
    });
  } catch (err) {
    next(err);
  }
}
