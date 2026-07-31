# Subscription & Feature Entitlement

Freemium layer for PINITHub. Does not modify DNA, Vault encryption, Investigation logic, or auth JWT issue/verify.

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `SUBSCRIPTION_ENFORCEMENT` | `true` | Set `false` to allow all features (emergency) |

## Plans (constants + DB seed)

| Plan | Storage | Investigation | Tracking |
|------|---------|---------------|----------|
| FREE | 2 GB | No | No |
| PRO | 100 GB | Yes | Yes |
| ENTERPRISE | Unlimited | Yes | Yes (+ future keys) |

`SUPER_ADMIN` / `ADMIN` always resolve as ENTERPRISE.

## APIs

- `GET /api/v1/subscription/me`
- `GET /api/v1/subscription/plans` (includes Razorpay public config)
- `GET /api/v1/subscription/billing/config`
- `POST /api/v1/subscription/billing/create-order` — `{ planCode: "PRO" | "ENTERPRISE" }`
- `POST /api/v1/subscription/billing/verify` — Razorpay payment fields + planCode
- `POST /api/v1/subscription/assign` — FREE downgrade / admin / local demo
- `POST /api/v1/subscription/admin/assign` — admin assign for any user

## Razorpay setup

1. Create test keys at https://dashboard.razorpay.com/app/keys
2. Set in `.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_...
   RAZORPAY_KEY_SECRET=...
   ```
3. Restart backend
4. Open `/upgrade` → Pay with Razorpay on Pro / Enterprise

| Plan | Price (INR) | Period |
|------|-------------|--------|
| Free | ₹0 | Forever |
| Pro | ₹999 | 30 days after payment |
| Enterprise | ₹4999 | 30 days after payment |

Without keys (development only): Pro/Enterprise buttons use demo activate.

## Guards

`requireFeature(FeatureKey.FEATURE_INVESTIGATION | FEATURE_TRACKING)` on premium routes.

403:

```json
{ "success": false, "error": "Subscription Required", "requiredPlan": "PRO", "feature": "FEATURE_INVESTIGATION" }
```

## UI

- Locked menu badges (still visible)
- Upgrade panel on gated routes
- `/upgrade` plans page
