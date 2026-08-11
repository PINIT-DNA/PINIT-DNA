import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';
import * as D from '../lib/defaults';

/**
 * Idempotent seed.
 *
 * Content tables are only populated when empty, so re-running this after you
 * have edited copy in /admin will not overwrite your work. The owner account is
 * upserted by email — running again resets nothing except the name.
 */

const prisma = new PrismaClient();

/** Insert `rows` only if the table is currently empty. */
async function seedCollection<T>(
  name: string,
  count: () => Promise<number>,
  rows: T[],
  create: (rows: T[]) => Promise<unknown>,
) {
  const existing = await count();
  if (existing > 0) {
    console.log(`  · ${name}: ${existing} row(s) already present — skipped`);
    return;
  }
  await create(rows);
  console.log(`  ✓ ${name}: ${rows.length} row(s) created`);
}

async function main() {
  console.log('\nSeeding PINITHUB content database\n');

  /* ---------------- Owner account ---------------- */

  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@pinithub.com').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';
  const name = process.env.SEED_ADMIN_NAME ?? 'PINITHUB Owner';

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    if (process.env.RESET_OWNER_PASSWORD === 'true') {
      await prisma.user.update({
        where: { email },
        data: {
          passwordHash: hashSync(password, 12),
          tokenVersion: { increment: 1 },
        },
      });
      console.log(`  ✓ owner password reset: ${email}`);
      console.log(`    new password: ${password}`);
    } else {
      console.log(`  · owner ${email} already exists — password left unchanged`);
      console.log('    to reset: RESET_OWNER_PASSWORD=true npm run db:seed');
    }
  } else {
    await prisma.user.create({
      data: { email, name, role: 'OWNER', passwordHash: hashSync(password, 12) },
    });
    console.log(`  ✓ owner created: ${email}`);
    console.log(`    password: ${password}   ← change this after first sign-in`);
  }

  /* ---------------- Singletons ---------------- */

  await prisma.heroContent.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, ...D.DEFAULT_HERO },
  });
  await prisma.problemContent.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, ...D.DEFAULT_PROBLEM_CONTENT },
  });
  await prisma.aboutContent.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, ...D.DEFAULT_ABOUT },
  });
  await prisma.ctaContent.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, ...D.DEFAULT_CTA },
  });
  await prisma.siteSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, ...D.DEFAULT_SITE_SETTINGS },
  });
  console.log('  ✓ singletons ready (hero, problem, about, cta, settings)');

  /* ---------------- Section chrome ---------------- */

  await seedCollection(
    'sections',
    () => prisma.sectionMeta.count(),
    D.DEFAULT_SECTIONS,
    (rows) =>
      prisma.sectionMeta.createMany({
        data: rows.map((s, order) => ({
          ...s,
          order,
          visible: true,
        })),
      }),
  );

  /* ---------------- Collections ---------------- */

  await seedCollection(
    'hero readouts',
    () => prisma.heroReadout.count(),
    D.DEFAULT_HERO_READOUTS,
    (rows) => prisma.heroReadout.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'trusted logos',
    () => prisma.trustedLogo.count(),
    D.DEFAULT_TRUSTED_LOGOS,
    (rows) => prisma.trustedLogo.createMany({ data: rows.map((name, order) => ({ name, order })) }),
  );

  await seedCollection(
    'problem items',
    () => prisma.problemItem.count(),
    D.DEFAULT_PROBLEMS,
    (rows) => prisma.problemItem.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'lifecycle stages',
    () => prisma.lifecycleStage.count(),
    D.DEFAULT_LIFECYCLE_STAGES,
    (rows) => prisma.lifecycleStage.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'features',
    () => prisma.feature.count(),
    D.DEFAULT_FEATURES,
    (rows) => prisma.feature.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'ecosystem products',
    () => prisma.ecosystemProduct.count(),
    D.DEFAULT_ECOSYSTEM_PRODUCTS,
    (rows) => prisma.ecosystemProduct.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'why cards',
    () => prisma.whyCard.count(),
    D.DEFAULT_WHY_CARDS,
    (rows) => prisma.whyCard.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'choose-us reasons',
    () => prisma.chooseUsReason.count(),
    D.DEFAULT_CHOOSE_US,
    (rows) => prisma.chooseUsReason.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'industries',
    () => prisma.industry.count(),
    D.DEFAULT_INDUSTRIES,
    (rows) => prisma.industry.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'about pillars',
    () => prisma.aboutPillar.count(),
    D.DEFAULT_ABOUT_PILLARS,
    (rows) => prisma.aboutPillar.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'stats',
    () => prisma.stat.count(),
    D.DEFAULT_STATS,
    (rows) => prisma.stat.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'testimonials',
    () => prisma.testimonial.count(),
    D.DEFAULT_TESTIMONIALS,
    (rows) => prisma.testimonial.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'faq items',
    () => prisma.faqItem.count(),
    D.DEFAULT_FAQ,
    (rows) => prisma.faqItem.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'nav links',
    () => prisma.navLink.count(),
    D.DEFAULT_NAV_LINKS,
    (rows) => prisma.navLink.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'footer links',
    () => prisma.footerLink.count(),
    D.DEFAULT_FOOTER_LINKS,
    (rows) => prisma.footerLink.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  await seedCollection(
    'social links',
    () => prisma.socialLink.count(),
    D.DEFAULT_SOCIAL_LINKS,
    (rows) => prisma.socialLink.createMany({ data: rows.map((r, order) => ({ ...r, order })) }),
  );

  console.log('\nDone. Sign in at http://localhost:3000/admin\n');
}

main()
  .catch((error) => {
    console.error('\nSeed failed:\n', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
