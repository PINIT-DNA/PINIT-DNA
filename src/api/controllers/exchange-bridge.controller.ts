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
    });
    res.json({ success: true, ...result });
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
    res.set({
      'Content-Type': result.originalMimeType || 'application/octet-stream',
      'Content-Length': String(result.originalBuffer.length),
      'Content-Disposition': `inline; filename="${result.originalFileName || 'preview'}"`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=120',
      'X-Vault-Id': result.vaultId,
    });
    res.status(200).send(result.originalBuffer);
  } catch (err) {
    next(err);
  }
}
