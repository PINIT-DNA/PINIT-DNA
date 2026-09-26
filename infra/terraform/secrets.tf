# Secrets Manager STRUCTURE ONLY. Terraform creates the empty secret containers and never
# sets a value: no aws_secretsmanager_secret_version exists anywhere in this configuration.
# Values are entered out-of-band (console or CLI) by the person who holds them.
#
# Grouped by what breaks if the value changes, not one secret per variable:
#   data-crypto  - bound to data that already exists; changing a value orphans that data
#   auth-bridge  - sessions and the Hub<->Exchange bridge; rotatable, but Exchange must match
#   integrations - third-party credentials
#   database     - application connection strings
locals {
  app_secrets = {
    "data-crypto" = {
      description = "Secrets bound to existing data: changing any of them breaks vault files, watermarks, spatial-auth tags, share links or biometric templates. COPY from the current environment; never regenerate."
      keys = [
        "VAULT_MASTER_SECRET",
        "BIOMETRIC_ENCRYPTION_KEY",
        "LSB_SIGNATURE_SECRET",
        "SPATIAL_AUTH_SECRET",
        "BLOCK_DNA_SECRET",
        "DNA_VNEXT_SECRET",
        "TEP_SIGNING_SECRET",
        "PHASE3_SIGNING_SECRET",
        "PHASE3_ED25519_PRIVATE_KEY_PEM",
        "SHARE_HMAC_SECRET",
      ]
    }
    "auth-bridge" = {
      description = "Session signing and the Hub<->Exchange service bridge. EXCHANGE_BRIDGE_SECRET must equal the value configured on Exchange."
      keys = [
        "JWT_SECRET",
        "EXCHANGE_BRIDGE_SECRET",
        "ADMIN_BRIDGE_SECRET",
      ]
    }
    "integrations" = {
      description = "Third-party credentials. The Supabase entries are only needed until vault storage moves to S3."
      keys = [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_KEY",
        "SUPABASE_ANON_KEY",
        "RAZORPAY_KEY_ID",
        "RAZORPAY_KEY_SECRET",
        "RAZORPAY_WEBHOOK_SECRET",
        "YOUTUBE_API_KEY",
        "GITHUB_TOKEN",
        "REDDIT_CLIENT_SECRET",
        "TELEGRAM_BOT_TOKEN",
      ]
    }
    "database" = {
      description = "Application database connection strings for the RDS instance. The RDS master password is held separately by RDS itself."
      keys = [
        "DATABASE_URL",
        "DIRECT_URL",
      ]
    }
  }
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.app_secrets

  name        = "pinit/${var.environment}/${each.key}"
  description = each.value.description

  # Shortest allowed recovery window, so a mistaken deletion is recoverable but a
  # deliberate rebuild is not blocked for a month.
  recovery_window_in_days = 7

  tags = {
    Name = "pinit-${var.environment}-${each.key}"
  }
}
