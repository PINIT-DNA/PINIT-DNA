/**
 * Reset a test user's account type + subscription for onboarding flow testing.
 *
 * Usage:
 *   npx ts-node scripts/reset-test-user-onboarding.ts [shortId] [--account-type BUSINESS|INDIVIDUAL] [--plan FREE|PRO|ENTERPRISE]
 *
 * Examples:
 *   npx ts-node scripts/reset-test-user-onboarding.ts PINIT-324BMMSL
 *   npx ts-node scripts/reset-test-user-onboarding.ts PINIT-324BMMSL --account-type BUSINESS --plan FREE
 *   npx ts-node scripts/reset-test-user-onboarding.ts PINIT-324BMMSL --account-type INDIVIDUAL --plan PRO
 *
 * After running, clear browser localStorage key:
 *   pinit_account_type_done_<userId>
 * (userId is printed in the script output)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type AccountType = 'INDIVIDUAL' | 'BUSINESS';
type PlanCode = 'FREE' | 'PRO' | 'ENTERPRISE';

const ALLOWED: Record<AccountType, PlanCode[]> = {
  INDIVIDUAL: ['FREE', 'PRO'],
  BUSINESS: ['FREE', 'PRO', 'ENTERPRISE'],
};

function parseArgs() {
  const argv = process.argv.slice(2);
  let shortId = '';
  let accountType: AccountType = 'BUSINESS';
  let planCode: PlanCode = 'FREE';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--account-type' && argv[i + 1]) {
      accountType = argv[++i]!.toUpperCase() as AccountType;
    } else if (arg === '--plan' && argv[i + 1]) {
      planCode = argv[++i]!.toUpperCase() as PlanCode;
    } else if (!arg.startsWith('--') && !shortId) {
      shortId = arg.toUpperCase();
    }
  }

  return { shortId, accountType, planCode };
}

async function resolvePlanId(planCode: PlanCode): Promise<string> {
  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!plan) {
    throw new Error(`Plan ${planCode} not found in database. Run the app once to seed plans.`);
  }
  return plan.id;
}

async function main() {
  const { shortId, accountType, planCode } = parseArgs();

  if (accountType !== 'INDIVIDUAL' && accountType !== 'BUSINESS') {
    throw new Error('--account-type must be INDIVIDUAL or BUSINESS');
  }
  if (!ALLOWED[accountType].includes(planCode)) {
    throw new Error(
      `Invalid combination: ${accountType} + ${planCode}. Allowed: ${ALLOWED[accountType].join(', ')}`,
    );
  }

  if (!shortId) {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        shortId: true,
        fullName: true,
        accountType: true,
        subscription: { include: { plan: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    console.log('\nRecent users (pass shortId as first argument):\n');
    for (const u of users) {
      console.log(
        `  ${u.shortId}  account=${u.accountType}  plan=${u.subscription?.plan.code ?? 'none'}  ${u.fullName ?? ''}`,
      );
    }
    console.log('\nExample: npx ts-node scripts/reset-test-user-onboarding.ts PINIT-XXXXXXXX\n');
    return;
  }

  const user = await prisma.user.findUnique({
    where: { shortId },
    select: { id: true, shortId: true, fullName: true },
  });
  if (!user) {
    throw new Error(`User not found: ${shortId}`);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      accountType,
      organization: null,
      organizationIndustry: null,
      organizationSize: null,
      workspaceName: null,
      businessSetupCompletedAt: null,
    },
  });

  const planId = await resolvePlanId(planCode);
  const existing = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (existing) {
    await prisma.subscription.update({
      where: { userId: user.id },
      data: {
        planId,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        cancelAtPeriodEnd: false,
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
      },
    });
  }

  console.log('\n✓ Test user reset complete\n');
  console.log({
    shortId: user.shortId,
    userId: user.id,
    accountType,
    planCode,
  });
  console.log('\nClear browser localStorage before retesting onboarding:');
  console.log(`  pinit_account_type_done_${user.id}`);
  console.log(`  pinit_chosen_account_type_${user.id}`);
  console.log('\nThen log out and log in again to walk through the flow.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
