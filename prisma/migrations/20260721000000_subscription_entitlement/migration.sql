-- Subscription & Feature Entitlement (Freemium SaaS)

CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
CREATE TYPE "BillingProvider" AS ENUM ('NONE', 'MANUAL', 'STRIPE', 'RAZORPAY', 'PAYPAL');
CREATE TYPE "BillingHistoryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');
CREATE TYPE "UsageMetric" AS ENUM ('STORAGE_BYTES', 'INVESTIGATION_RUNS', 'MONITOR_ENROLLMENTS', 'API_CALLS');

CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "storageLimitBytes" BIGINT,
    "features" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "externalCustomerId" TEXT,
    "externalSubscriptionId" TEXT,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

CREATE TABLE "feature_entitlements" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,

    CONSTRAINT "feature_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feature_entitlements_userId_featureKey_key" ON "feature_entitlements"("userId", "featureKey");
CREATE INDEX "feature_entitlements_userId_idx" ON "feature_entitlements"("userId");

CREATE TABLE "billing_history" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "provider" "BillingProvider" NOT NULL DEFAULT 'NONE',
    "externalId" TEXT,
    "status" "BillingHistoryStatus" NOT NULL DEFAULT 'PENDING',
    "rawPayload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "billing_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_history_subscriptionId_idx" ON "billing_history"("subscriptionId");
CREATE INDEX "billing_history_provider_idx" ON "billing_history"("provider");

CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "periodKey" TEXT NOT NULL,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "usage_records_subscriptionId_metric_periodKey_key" ON "usage_records"("subscriptionId", "metric", "periodKey");
CREATE INDEX "usage_records_userId_metric_idx" ON "usage_records"("userId", "metric");

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON UPDATE CASCADE;
ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed plans (placeholder limits; source of truth also in TypeScript constants)
INSERT INTO "plans" ("id", "createdAt", "updatedAt", "code", "name", "description", "storageLimitBytes", "features", "isActive", "sortOrder")
VALUES
  ('plan_free', NOW(), NOW(), 'FREE', 'Free', 'DNA, Vault, Certificates — core loop free forever', 2147483648,
   '["FEATURE_DNA","FEATURE_VAULT","FEATURE_CERTIFICATES","FEATURE_DASHBOARD","FEATURE_PROFILE"]'::jsonb, true, 0),
  ('plan_pro', NOW(), NOW(), 'PRO', 'Pro', 'Investigation + Tracking + higher storage', 107374182400,
   '["FEATURE_DNA","FEATURE_VAULT","FEATURE_CERTIFICATES","FEATURE_DASHBOARD","FEATURE_PROFILE","FEATURE_INVESTIGATION","FEATURE_TRACKING","FEATURE_ADVANCED_REPORTS"]'::jsonb, true, 1),
  ('plan_enterprise', NOW(), NOW(), 'ENTERPRISE', 'Enterprise', 'Unlimited storage and all features', NULL,
   '["FEATURE_DNA","FEATURE_VAULT","FEATURE_CERTIFICATES","FEATURE_DASHBOARD","FEATURE_PROFILE","FEATURE_INVESTIGATION","FEATURE_TRACKING","FEATURE_CHROME_EXTENSION","FEATURE_MARKETPLACE","FEATURE_ASSET_LICENSING","FEATURE_SELLING_ASSETS","FEATURE_ENTERPRISE_TEAMS","FEATURE_API_ACCESS","FEATURE_BULK_UPLOAD","FEATURE_AI_MONITORING","FEATURE_ADVANCED_REPORTS"]'::jsonb, true, 2);

-- Backfill every existing user onto FREE
INSERT INTO "subscriptions" ("id", "createdAt", "updatedAt", "userId", "planId", "status", "currentPeriodStart", "cancelAtPeriodEnd")
SELECT gen_random_uuid()::text, NOW(), NOW(), u."id", 'plan_free', 'ACTIVE', NOW(), false
FROM "users" u
WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."userId" = u."id");
