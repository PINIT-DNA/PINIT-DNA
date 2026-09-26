provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "pinit-dna"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
