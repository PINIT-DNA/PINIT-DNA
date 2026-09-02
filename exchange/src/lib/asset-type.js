/** Marketplace card helpers: file type is a filter, not the product identity. */

export function assetKind(item) {
  const v = String(item?.vertical || '').toLowerCase();
  const ft = String(item?.file_type || '').toLowerCase();
  if (v.includes('video') || ft.startsWith('video')) return 'video';
  if (v === 'audio' || v === 'music' || ft.startsWith('audio')) return 'audio';
  if (v === 'documents' || v === 'document' || v === 'docs' || ft.includes('pdf')) return 'document';
  if (v === '3d' || v === '3d_models') return '3d';
  if (v === 'ui_ux' || v === 'design' || v === 'graphics') return 'design';
  if (v === 'images' || v === 'image' || v === 'photography' || ft.startsWith('image')) return 'image';
  return 'other';
}

export function assetKindLabel(item) {
  const map = {
    image: 'IMAGE',
    video: 'VIDEO',
    audio: 'AUDIO',
    document: 'DOCUMENT',
    design: 'DESIGN',
    '3d': '3D',
    other: 'OTHER',
  };
  return map[assetKind(item)] || 'ASSET';
}

export function listingFromPrice(item) {
  const commercial = Number(item?.price_commercial);
  if (Number.isFinite(commercial) && commercial > 0) return commercial;
  const vals = [
    item?.price_personal,
    item?.price_exclusive,
    item?.price_enterprise,
  ].map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return vals.length ? Math.min(...vals) : 0;
}

export function licenseTeaser(item) {
  if (Number(item?.price_commercial) > 0) return 'Commercial License';
  if (Number(item?.price_personal) > 0) return 'Personal License';
  if (Number(item?.price_exclusive) > 0) return 'Exclusive License';
  if (Number(item?.price_enterprise) > 0) return 'Enterprise License';
  return 'License';
}
