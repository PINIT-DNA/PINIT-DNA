import L from 'leaflet';

export type LeafletBasemapStyle = 'light' | 'dark';

const MAPTILER_ATTRIBUTION =
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">&copy; OpenStreetMap contributors</a>';

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

/**
 * Public MapTiler raster key (browser-safe). Vite inlines `VITE_*` at build.
 * Create at https://cloud.maptiler.com/account/keys/ — do not commit the value.
 * Configure on Vercel (Hub frontend), not Render. Restrict HTTP referrers.
 */
function maptilerApiKey(): string {
  return String(import.meta.env.VITE_MAPTILER_API_KEY ?? '').trim();
}

export function leafletBasemapUsesMapTiler(): boolean {
  return maptilerApiKey().length > 0;
}

export function leafletBasemapCredit(): string {
  return leafletBasemapUsesMapTiler() ? '© MapTiler · OSM' : '© OpenStreetMap';
}

/** Leaflet raster tiles. MapTiler when a public key is set; OSM otherwise. */
export function leafletBasemapLayer(style: LeafletBasemapStyle): L.TileLayer {
  const key = maptilerApiKey();
  if (key) {
    const mapId = style === 'dark' ? 'streets-v4-dark' : 'streets-v4';
    return L.tileLayer(
      `https://api.maptiler.com/maps/${mapId}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`,
      {
        attribution: MAPTILER_ATTRIBUTION,
        minZoom: 1,
        maxZoom: 19,
        tileSize: 256,
        crossOrigin: true,
      },
    );
  }

  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: OSM_ATTRIBUTION,
    subdomains: 'abc',
    maxZoom: 19,
  });
}
