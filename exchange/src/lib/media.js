/** Shared media helpers for Exchange listing previews */

const IMAGE_EXTS = /\.(jpe?g|jfif|png|webp|tiff?|gif|bmp|heic|heif|avif|svg|ico|jxl|apng)(\?|$)/i;
const VIDEO_EXTS = /\.(mp4|m4v|mov|qt|avi|mkv|webm|mpe?g|3gp|3g2|ogv|ogg|flv|wmv|ts|mts|m2ts)(\?|$)/i;

export const EXCHANGE_MEDIA_ACCEPT =
  'image/*,video/*,.jpg,.jpeg,.jfif,.png,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,.avif,.svg,.ico,.mp4,.m4v,.mov,.avi,.mkv,.webm,.mpeg,.mpg,.3gp,.3g2,.ogv,.flv,.wmv,.ts,.mts,.m2ts';

export function isVideoListing(item) {
  if (!item) return false;
  const v = String(item.vertical || item.file_type || '').toLowerCase();
  if (v === 'video' || v.startsWith('video')) return true;
  const url = String(item.preview_url || item.title || '');
  return VIDEO_EXTS.test(url);
}

export function isImageListing(item) {
  if (!item) return false;
  if (isVideoListing(item)) return false;
  const v = String(item.vertical || item.file_type || '').toLowerCase();
  if (v === 'images' || v === 'image' || v === 'photography' || v.startsWith('image')) return true;
  const url = String(item.preview_url || '');
  return IMAGE_EXTS.test(url);
}

export function previewLooksLikeVideo(url) {
  return VIDEO_EXTS.test(String(url || ''));
}

/** True when preview_url is usable for <video src> (not empty / not a bare filename label). */
export function hasPlayableVideoPreview(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (/^https?:\/\//i.test(u) || u.startsWith('/') || u.startsWith('blob:')) {
    return previewLooksLikeVideo(u);
  }
  return false;
}

export function formatMediaDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return null;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function isAllowedExchangeMediaFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/') || type.startsWith('video/')) return true;
  const name = String(file.name || '');
  return IMAGE_EXTS.test(name) || VIDEO_EXTS.test(name);
}
