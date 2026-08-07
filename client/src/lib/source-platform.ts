/** Human label for extension / social capture platform codes. */
export function formatSourcePlatform(platform?: string | null): string | null {
  if (!platform?.trim()) return null;
  const key = platform.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const labels: Record<string, string> = {
    youtube: 'YouTube',
    youtube_studio: 'YouTube',
    instagram: 'Instagram',
    facebook: 'Facebook',
    linkedin: 'LinkedIn',
    twitter: 'X / Twitter',
    x: 'X / Twitter',
    tiktok: 'TikTok',
    github: 'GitHub',
    wordpress: 'WordPress',
    shopify: 'Shopify',
    canva: 'Canva',
    figma: 'Figma',
    web: 'Web',
    browser: 'Browser',
    extension: 'Browser extension',
    extension_publish_guardian: 'Browser extension',
    hub: 'Pinit HUB',
    upload: 'Upload',
  };
  if (labels[key]) return labels[key];
  return platform
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function vaultSourceCaption(record: {
  sourcePlatform?: string | null;
  fromExtension?: boolean;
  capturedVia?: string | null;
}): string | null {
  const platform = formatSourcePlatform(record.sourcePlatform);
  if (platform) return `From ${platform}`;
  if (record.fromExtension || record.capturedVia?.toLowerCase().includes('extension')) {
    return 'From browser extension';
  }
  return null;
}
