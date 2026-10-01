locals {
  log_group_names = toset(["api", "worker", "ai"])
}

resource "aws_cloudwatch_log_group" "app" {
  for_each = local.log_group_names

  name              = "/ecs/${local.name}/${each.key}"
  retention_in_days = var.log_retention_days

  tags = {
    Name = "/ecs/${local.name}/${each.key}"
  }
}
