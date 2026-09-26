locals {
  vault_bucket_name = "pinit-vault-${data.aws_caller_identity.current.account_id}-aps1"
}

# Application bucket for encrypted vault blobs ({ownerUserId}/{vaultId}.enc) and
# presigned browser uploads (incoming/{ownerUserId}/{uploadId}).
resource "aws_s3_bucket" "vault" {
  bucket = local.vault_bucket_name

  tags = {
    Name = local.vault_bucket_name
  }

  # Holds permanent user assets: it must never be destroyed by accident.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "vault" {
  bucket = aws_s3_bucket.vault.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "vault" {
  bucket = aws_s3_bucket.vault.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "vault" {
  bucket = aws_s3_bucket.vault.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 (AWS-managed) on purpose: no customer-managed KMS key. The vault blobs are
# already AES-256-GCM encrypted by the application before they reach S3.
resource "aws_s3_bucket_server_side_encryption_configuration" "vault" {
  bucket = aws_s3_bucket.vault.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Browser -> S3 presigned PUT. The presigned URL signs Content-Type, so the browser
# must be allowed to send it.
resource "aws_s3_bucket_cors_configuration" "vault" {
  bucket = aws_s3_bucket.vault.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["Content-Type", "Content-MD5", "x-amz-*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Lifecycle applies ONLY to the incoming/ prefix (uploads that were presigned but never
# completed) plus unfinished multipart uploads. Permanent assets are never expired.
resource "aws_s3_bucket_lifecycle_configuration" "vault" {
  bucket = aws_s3_bucket.vault.id

  # Versioning is on, so an expired object becomes a noncurrent version plus a delete
  # marker. These rules remove both, otherwise incoming/ would grow forever.
  rule {
    id     = "expire-orphaned-incoming-uploads"
    status = "Enabled"

    filter {
      prefix = "incoming/"
    }

    expiration {
      days = var.incoming_expiry_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    id     = "clean-incoming-delete-markers"
    status = "Enabled"

    filter {
      prefix = "incoming/"
    }

    expiration {
      expired_object_delete_marker = true
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.vault]
}

data "aws_iam_policy_document" "vault_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      aws_s3_bucket.vault.arn,
      "${aws_s3_bucket.vault.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "vault" {
  bucket = aws_s3_bucket.vault.id
  policy = data.aws_iam_policy_document.vault_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.vault]
}
