import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Inter, Space_Grotesk } from 'next/font/google';
import { getSiteContent } from '@/lib/content';
import './globals.css';

export const dynamic = 'force-dynamic';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
  weight: ['400', '500', '600', '700'],
});

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plex-mono',
  weight: ['400', '500', '600'],
});

/**
 * SEO is edited from /admin/settings. This reads the same cached content the
 * page does, so changing the meta title costs one revalidation, not a deploy.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await getSiteContent();
  const site = safeUrl(settings.siteUrl);

  return {
    metadataBase: new URL(site),
    title: {
      default: settings.metaTitle,
      template: '%s — PINITHUB',
    },
    description: settings.metaDescription,
    applicationName: 'PINITHUB',
    keywords: settings.metaKeywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    authors: [{ name: 'TheCareerTech Pvt. Ltd.' }],
    creator: 'TheCareerTech Pvt. Ltd.',
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      url: site,
      siteName: 'PINITHUB',
      title: settings.metaTitle,
      description: settings.metaDescription,
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      title: settings.metaTitle,
      description: settings.metaDescription,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
    category: 'technology',
  };
}

/** `metadataBase` throws on a malformed URL, which would take the whole page down. */
function safeUrl(value: string): string {
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    return 'https://pinithub.com';
  }
}

export const viewport: Viewport = {
  themeColor: '#050816',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

function jsonLd(site: string, description: string, socials: string[]) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${site}/#organization`,
        name: 'PINITHUB',
        url: site,
        description,
        parentOrganization: { '@type': 'Organization', name: 'TheCareerTech Pvt. Ltd.' },
        sameAs: socials,
      },
      {
        '@type': 'SoftwareApplication',
        name: 'PINITHUB',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description,
        offers: {
          '@type': 'Offer',
          category: 'Enterprise',
          availability: 'https://schema.org/InStock',
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${site}/#website`,
        url: site,
        name: 'PINITHUB',
        publisher: { '@id': `${site}/#organization` },
      },
    ],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { settings, footer } = await getSiteContent();
  // Only absolute social URLs are meaningful to search engines; the seed ships
  // placeholder fragments like "#linkedin", which are dropped here.
  const socials = footer.socials.map((s) => s.href).filter((h) => /^https?:\/\//.test(h));
  const JSON_LD = jsonLd(safeUrl(settings.siteUrl), settings.metaDescription, socials);

  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <script
          type="application/ld+json"
          // Structured data is static and author-controlled.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {children}
      </body>
    </html>
  );
}
