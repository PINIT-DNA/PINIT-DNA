resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${local.name}-db-subnets"
  }
}

# Single-AZ, direct connections (no RDS Proxy): both are deliberate initial cost
# decisions, to be revisited from real connection and load measurements.
resource "aws_db_instance" "main" {
  identifier = "${local.name}-postgres"

  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class
  port           = var.db_port

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"

  # AWS-managed key (aws/rds); no customer-managed KMS key by decision.
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_master_username

  # RDS generates the master password and keeps it in Secrets Manager. No password
  # ever appears in Terraform code, plan output, or state.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "21:00-22:00"
  maintenance_window      = "sun:22:00-sun:23:00"
  copy_tags_to_snapshot   = true

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-postgres-final"

  auto_minor_version_upgrade   = true
  apply_immediately            = false
  performance_insights_enabled = false
  monitoring_interval          = 0

  tags = {
    Name = "${local.name}-postgres"
  }

  lifecycle {
    prevent_destroy = true

    # Automatic minor-version upgrades would otherwise show up as perpetual drift.
    ignore_changes = [engine_version]
  }
}
