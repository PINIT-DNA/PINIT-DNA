/**
 * Canonical platform registry for Publish Guardian (asset-first).
 */
export const PLATFORM_REGISTRY = [
  // P0 Social
  { id: 'instagram', label: 'Instagram', group: 'social' },
  { id: 'facebook', label: 'Facebook', group: 'social' },
  { id: 'x', label: 'X (Twitter)', group: 'social' },
  { id: 'pinterest', label: 'Pinterest', group: 'social' },
  { id: 'linkedin', label: 'LinkedIn', group: 'business' },
  { id: 'telegram', label: 'Telegram Web (public)', group: 'social' },
  { id: 'github', label: 'GitHub', group: 'business' },
  // Creators / video
  { id: 'youtube', label: 'YouTube / Studio', group: 'creator' },
  { id: 'tiktok', label: 'TikTok Web', group: 'creator' },
  { id: 'threads', label: 'Threads', group: 'creator' },
  { id: 'vimeo', label: 'Vimeo', group: 'creator' },
  { id: 'twitch', label: 'Twitch', group: 'creator' },
  { id: 'reddit', label: 'Reddit', group: 'creator' },
  { id: 'tumblr', label: 'Tumblr', group: 'creator' },
  { id: 'medium', label: 'Medium', group: 'creator' },
  { id: 'substack', label: 'Substack', group: 'creator' },
  { id: 'patreon', label: 'Patreon', group: 'creator' },
  // Design / portfolio / photographers
  { id: 'behance', label: 'Behance', group: 'creator' },
  { id: 'dribbble', label: 'Dribbble', group: 'creator' },
  { id: 'artstation', label: 'ArtStation', group: 'creator' },
  { id: 'deviantart', label: 'DeviantArt', group: 'creator' },
  { id: 'flickr', label: 'Flickr', group: 'photo' },
  { id: '500px', label: '500px', group: 'photo' },
  { id: 'smugmug', label: 'SmugMug', group: 'photo' },
  { id: 'pixieset', label: 'Pixieset', group: 'photo' },
  { id: 'zenfolio', label: 'Zenfolio', group: 'photo' },
  { id: 'adobe_portfolio', label: 'Adobe Portfolio', group: 'photo' },
  { id: 'squarespace', label: 'Squarespace', group: 'photo' },
  { id: 'wix', label: 'Wix', group: 'photo' },
  // Export / design tools
  { id: 'canva', label: 'Canva (upload + export)', group: 'business' },
  { id: 'figma', label: 'Figma (upload + export)', group: 'business' },
  { id: 'adobe_express', label: 'Adobe Express (export)', group: 'business' },
  { id: 'adobe_photoshop', label: 'Photoshop Web (export)', group: 'business' },
  { id: 'adobe_illustrator', label: 'Illustrator Web (export)', group: 'business' },
  // Commerce / CMS
  { id: 'shopify', label: 'Shopify Admin', group: 'business' },
  { id: 'wordpress', label: 'WordPress Admin', group: 'business' },
];

export const PLATFORM_IDS = PLATFORM_REGISTRY.map((p) => p.id);

export function defaultPlatformFlags(enabled = true) {
  const out = {};
  for (const id of PLATFORM_IDS) out[id] = enabled;
  return out;
}
