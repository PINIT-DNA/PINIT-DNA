variable "aws_region" {
  description = "Region for all resources. ap-south-1 (Mumbai) matches the current Render backend and users."
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Environment name, used in resource names and tags."
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block of the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of Availability Zones to spread subnets across (2 or 3)."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3."
  }
}

variable "api_port" {
  description = "Port the Node API listens on (PORT in render.yaml / EXPOSE in the Dockerfile)."
  type        = number
  default     = 4000
}

variable "ai_port" {
  description = "Port the Python AI service listens on."
  type        = number
  default     = 8001
}

variable "db_port" {
  description = "PostgreSQL port."
  type        = number
  default     = 5432
}

# ---- Phase 2: S3 ----------------------------------------------------------------

variable "cors_allowed_origins" {
  description = "Browser origins allowed to upload directly to S3 with a presigned URL."
  type        = list(string)
  default = [
    "https://pinit-dna.vercel.app",
    "https://www.pinithub.com",
    "https://pinithub.com",
  ]
}

variable "incoming_expiry_days" {
  description = "Days after which an orphaned object under incoming/ is expired. Applies to incoming/ only, never to permanent assets."
  type        = number
  default     = 2
}

# ---- Phase 2: RDS ---------------------------------------------------------------

variable "db_engine_version" {
  description = "PostgreSQL engine version. The source (Supabase) runs 17.6; the target must be the same major or newer."
  type        = string
  default     = "17.11"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "pinit_dna"
}

variable "db_master_username" {
  description = "RDS master (admin) username. The password is generated and held by RDS in Secrets Manager, never in code or state."
  type        = string
  default     = "pinit_admin"
}

variable "db_allocated_storage" {
  description = "Initial gp3 storage in GiB (20 is the gp3 minimum; the source database is ~340 MB)."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Upper bound for storage autoscaling in GiB, so growth can never be unbounded."
  type        = number
  default     = 50
}

variable "db_backup_retention_days" {
  description = "Automated backup retention in days."
  type        = number
  default     = 7
}

# ---- Phase 2: SQS ---------------------------------------------------------------

variable "sqs_visibility_timeout_seconds" {
  description = "Starting value, NOT measured. Video protection can run up to 6000 frames and the app has no visibility heartbeat, so this errs long. Tune in Phase 5 from real job durations."
  type        = number
  default     = 3600
}

variable "sqs_max_receive_count" {
  description = "Deliveries before a message moves to the dead-letter queue."
  type        = number
  default     = 3

  validation {
    condition     = var.sqs_max_receive_count >= 3 && var.sqs_max_receive_count <= 5
    error_message = "sqs_max_receive_count must be between 3 and 5."
  }
}

# ---- Phase 2: logging -----------------------------------------------------------

variable "log_retention_days" {
  description = "CloudWatch log retention in days."
  type        = number
  default     = 14
}
