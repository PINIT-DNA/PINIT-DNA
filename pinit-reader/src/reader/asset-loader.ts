import type { HubClient } from '../api/hub-client';
import type { AccessExtras, HubFailure, ReaderSession, ShareLinkView } from '../core/types';
import { readerLog } from '../log';

export type OpenedAsset = {
  ok: true;
  link: ShareLinkView;
  blob: Blob;
  mimeType: string;
};

export type OpenAssetResult = OpenedAsset | HubFailure;

/**
 * Ask the Hub to authorize this token, record the existing VIEWED event,
 * follow one forwarding hop if the Hub returns one, then load the file bytes.
 */
export async function loadProtectedAsset(
  client: HubClient,
  token: string,
  session: ReaderSession,
  extras: AccessExtras = {},
  options: { depth?: number; quiet?: boolean } = {},
): Promise<OpenAssetResult> {
  const depth = options.depth ?? 0;
  if (!options.quiet) readerLog('Connecting to Hub...');
  const info = await client.getShareInfo(token, session);
  if (!info.ok) return info;
  if (!options.quiet) readerLog('Authorization response received');

  const access = await client.recordView(token, session, extras);
  if (!access.ok) return access;
  if (access.redirectToken && depth < 1) {
    readerLog('Hub forwarded this open. Continuing on the existing share.');
    return loadProtectedAsset(client, access.redirectToken, session, extras, { depth: depth + 1, quiet: true });
  }

  readerLog('Loading protected asset...');
  const asset = await client.fetchAsset(token, session);
  if (!asset.ok) return asset;
  return { ok: true, link: info.link, blob: asset.blob, mimeType: asset.mimeType };
}
