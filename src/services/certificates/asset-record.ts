/**
 * The asset reference shown in public: PH-ASSET-XXXXXXXX.
 *
 * Short, quotable in a takedown notice, and never the raw Asset.id — internal
 * identifiers stay server-side. It lives in its own module because both the
 * certificate service and the credential projection need it, and the projection
 * is a pure mapper that must not pull the whole certificate service in with it.
 */
export function publicAssetRecord(assetId: string | null | undefined): string | null {
  const id = String(assetId ?? '').replace(/-/g, '');
  return id ? `PH-ASSET-${id.slice(0, 8).toUpperCase()}` : null;
}
