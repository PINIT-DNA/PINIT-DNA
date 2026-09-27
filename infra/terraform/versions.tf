terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Remote state in the bucket created during Part E. Native S3 locking
  # (use_lockfile) needs Terraform >= 1.10, so no DynamoDB table is required.
  backend "s3" {
    bucket       = "pinit-tfstate-975903044119-aps1"
    key          = "phase1-foundation/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
