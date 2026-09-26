output "vpc_id" {
  value = aws_vpc.main.id
}

output "availability_zones" {
  value = local.azs
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "security_group_ids" {
  value = {
    alb    = aws_security_group.alb.id
    api    = aws_security_group.api.id
    worker = aws_security_group.worker.id
    ai     = aws_security_group.ai.id
    rds    = aws_security_group.rds.id
  }
}

# ---- Phase 2 ----------------------------------------------------------------------

output "vault_bucket_name" {
  value = aws_s3_bucket.vault.id
}

output "rds_address" {
  value = aws_db_instance.main.address
}

output "rds_master_secret_arn" {
  description = "Secret RDS created and manages for the master user (not an app secret)."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "ecr_repository_urls" {
  value = { for k, r in aws_ecr_repository.repo : k => r.repository_url }
}

output "sqs_jobs_queue_url" {
  value = aws_sqs_queue.jobs.url
}

output "sqs_jobs_dlq_url" {
  value = aws_sqs_queue.jobs_dlq.url
}

output "efs_file_system_id" {
  value = aws_efs_file_system.ai.id
}

output "efs_ai_access_point_id" {
  value = aws_efs_access_point.ai.id
}

output "app_secret_arns" {
  value = { for k, s in aws_secretsmanager_secret.app : k => s.arn }
}

# Key NAMES each secret is expected to contain (never values), for a pre-flight presence check.
output "app_secret_expected_keys" {
  value = { for k, v in local.app_secrets : k => v.keys }
}

output "iam_role_arns" {
  value = {
    ecs_execution = aws_iam_role.ecs_execution.arn
    api_task      = aws_iam_role.api_task.arn
    worker_task   = aws_iam_role.worker_task.arn
    ai_task       = aws_iam_role.ai_task.arn
  }
}

output "log_group_names" {
  value = [for g in aws_cloudwatch_log_group.app : g.name]
}
