/**
 * Force-replace marketing content from lib/defaults.ts.
 * Keeps users, demo requests, newsletter subscribers, and audit logs.
 *
 * Usage:
 *   DATABASE_URL=... npm run db:apply-defaults
 */
import { PrismaClient } from '@prisma/client';
import * as D from '../lib/defaults';

const prisma = new PrismaClient();

async function replaceCollection<T extends object>(
  name: string,
  clear: () => Promise<unknown>,
  rows: T[],
  createMany: (data: (T & { order: number })[]) => Promise<unknown>,
) {
  await clear();
  if (rows.length === 0) {
    console.log(`  · ${name}: cleared (0 defaults)`);
    return;
  }
  await createMany(rows.map((row, order) => ({ ...row, order })));
  console.log(`  ✓ ${name}: ${rows.length} row(s)`);
}

async function main() {
  console.log('\nApplying procurement-safe defaults to database\n');

  await prisma.heroContent.upsert({
    where: { id: 1 },
    update: { ...D.DEFAULT_HERO },
    create: { id: 1, ...D.DEFAULT_HERO },
  });
  await prisma.problemContent.upsert({
    where: { id: 1 },
    update: { ...D.DEFAULT_PROBLEM_CONTENT },
    create: { id: 1, ...D.DEFAULT_PROBLEM_CONTENT },
  });
  await prisma.aboutContent.upsert({
    where: { id: 1 },
    update: { ...D.DEFAULT_ABOUT },
    create: { id: 1, ...D.DEFAULT_ABOUT },
  });
  await prisma.ctaContent.upsert({
    where: { id: 1 },
    update: { ...D.DEFAULT_CTA },
    create: { id: 1, ...D.DEFAULT_CTA },
  });
  await prisma.siteSettings.upsert({
    where: { id: 1 },
    update: { ...D.DEFAULT_SITE_SETTINGS },
    create: { id: 1, ...D.DEFAULT_SITE_SETTINGS },
  });
  console.log('  ✓ singletons updated');

  await replaceCollection(
    'sections',
    () => prisma.sectionMeta.deleteMany(),
    D.DEFAULT_SECTIONS.map((s) => ({
      ...s,
      visible: true,
    })),
    (data) => prisma.sectionMeta.createMany({ data }),
  );

  await replaceCollection(
    'hero readouts',
    () => prisma.heroReadout.deleteMany(),
    D.DEFAULT_HERO_READOUTS,
    (data) => prisma.heroReadout.createMany({ data }),
  );
  await replaceCollection(
    'trusted logos',
    () => prisma.trustedLogo.deleteMany(),
    D.DEFAULT_TRUSTED_LOGOS.map((name) => ({ name })),
    (data) => prisma.trustedLogo.createMany({ data }),
  );
  await replaceCollection(
    'problem items',
    () => prisma.problemItem.deleteMany(),
    D.DEFAULT_PROBLEMS,
    (data) => prisma.problemItem.createMany({ data }),
  );
  await replaceCollection(
    'lifecycle stages',
    () => prisma.lifecycleStage.deleteMany(),
    D.DEFAULT_LIFECYCLE_STAGES,
    (data) => prisma.lifecycleStage.createMany({ data }),
  );
  await replaceCollection(
    'features',
    () => prisma.feature.deleteMany(),
    D.DEFAULT_FEATURES,
    (data) => prisma.feature.createMany({ data }),
  );
  await replaceCollection(
    'ecosystem products',
    () => prisma.ecosystemProduct.deleteMany(),
    D.DEFAULT_ECOSYSTEM_PRODUCTS,
    (data) => prisma.ecosystemProduct.createMany({ data }),
  );
  await replaceCollection(
    'why cards',
    () => prisma.whyCard.deleteMany(),
    D.DEFAULT_WHY_CARDS,
    (data) => prisma.whyCard.createMany({ data }),
  );
  await replaceCollection(
    'choose-us reasons',
    () => prisma.chooseUsReason.deleteMany(),
    D.DEFAULT_CHOOSE_US,
    (data) => prisma.chooseUsReason.createMany({ data }),
  );
  await replaceCollection(
    'industries',
    () => prisma.industry.deleteMany(),
    D.DEFAULT_INDUSTRIES,
    (data) => prisma.industry.createMany({ data }),
  );
  await replaceCollection(
    'about pillars',
    () => prisma.aboutPillar.deleteMany(),
    D.DEFAULT_ABOUT_PILLARS,
    (data) => prisma.aboutPillar.createMany({ data }),
  );
  await replaceCollection(
    'stats',
    () => prisma.stat.deleteMany(),
    D.DEFAULT_STATS,
    (data) => prisma.stat.createMany({ data }),
  );
  await replaceCollection(
    'testimonials',
    () => prisma.testimonial.deleteMany(),
    D.DEFAULT_TESTIMONIALS.map((t) => ({ ...t, published: true })),
    (data) => prisma.testimonial.createMany({ data }),
  );
  await replaceCollection(
    'faq items',
    () => prisma.faqItem.deleteMany(),
    D.DEFAULT_FAQ.map((f) => ({ ...f, published: true })),
    (data) => prisma.faqItem.createMany({ data }),
  );
  await replaceCollection(
    'nav links',
    () => prisma.navLink.deleteMany(),
    D.DEFAULT_NAV_LINKS,
    (data) => prisma.navLink.createMany({ data }),
  );
  await replaceCollection(
    'footer links',
    () => prisma.footerLink.deleteMany(),
    D.DEFAULT_FOOTER_LINKS,
    (data) => prisma.footerLink.createMany({ data }),
  );
  await replaceCollection(
    'social links',
    () => prisma.socialLink.deleteMany(),
    D.DEFAULT_SOCIAL_LINKS,
    (data) => prisma.socialLink.createMany({ data }),
  );

  console.log('\nDone. Redeploy or wait for cache revalidation (up to 1h / admin edit).\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
