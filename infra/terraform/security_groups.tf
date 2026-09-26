# Intended traffic relationships: internet -> alb -> api -> (ai, rds); worker -> (ai, rds).
# These groups are prepared for later phases. Nothing that uses them (load balancer, services,
# database) is created in this phase.
# Groups reference each other instead of CIDR ranges wherever the peer is inside the VPC.
# Terraform removes the AWS default allow-all egress rule, so every outbound path
# below is explicit.

# The VPC's default security group is locked to zero rules so nothing can
# accidentally rely on it.
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name}-default-locked"
  }
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Reserved for a future application load balancer"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-alb-sg"
  }
}

resource "aws_security_group" "api" {
  name        = "${local.name}-api"
  description = "API service"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-api-sg"
  }
}

resource "aws_security_group" "worker" {
  name        = "${local.name}-worker"
  description = "Background worker service (no inbound traffic)"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-worker-sg"
  }
}

resource "aws_security_group" "ai" {
  name        = "${local.name}-ai"
  description = "AI service (internal only)"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-ai-sg"
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "RDS PostgreSQL (internal only)"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-rds-sg"
  }
}

# ---- alb ----------------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "alb_https_from_internet" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS (443) from the internet, prepared for a future HTTPS listener"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To the API service only"
  ip_protocol                  = "tcp"
  from_port                    = var.api_port
  to_port                      = var.api_port
  referenced_security_group_id = aws_security_group.api.id
}

# ---- api ----------------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "API traffic from the load balancer group only"
  ip_protocol                  = "tcp"
  from_port                    = var.api_port
  to_port                      = var.api_port
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "api_to_ai" {
  security_group_id            = aws_security_group.api.id
  description                  = "Call the AI service"
  ip_protocol                  = "tcp"
  from_port                    = var.ai_port
  to_port                      = var.ai_port
  referenced_security_group_id = aws_security_group.ai.id
}

resource "aws_vpc_security_group_egress_rule" "api_to_rds" {
  security_group_id            = aws_security_group.api.id
  description                  = "Connect to PostgreSQL"
  ip_protocol                  = "tcp"
  from_port                    = var.db_port
  to_port                      = var.db_port
  referenced_security_group_id = aws_security_group.rds.id
}

# Outbound HTTPS is permitted here. How outbound traffic actually leaves the VPC is not
# decided in this phase, so this rule alone provides no connectivity.
resource "aws_vpc_security_group_egress_rule" "api_https_out" {
  security_group_id = aws_security_group.api.id
  description       = "Outbound HTTPS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# ---- worker -------------------------------------------------------------------

resource "aws_vpc_security_group_egress_rule" "worker_to_ai" {
  security_group_id            = aws_security_group.worker.id
  description                  = "Call the AI service"
  ip_protocol                  = "tcp"
  from_port                    = var.ai_port
  to_port                      = var.ai_port
  referenced_security_group_id = aws_security_group.ai.id
}

resource "aws_vpc_security_group_egress_rule" "worker_to_rds" {
  security_group_id            = aws_security_group.worker.id
  description                  = "Connect to PostgreSQL"
  ip_protocol                  = "tcp"
  from_port                    = var.db_port
  to_port                      = var.db_port
  referenced_security_group_id = aws_security_group.rds.id
}

resource "aws_vpc_security_group_egress_rule" "worker_https_out" {
  security_group_id = aws_security_group.worker.id
  description       = "Outbound HTTPS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# ---- ai -----------------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "ai_from_api" {
  security_group_id            = aws_security_group.ai.id
  description                  = "AI requests from the API service"
  ip_protocol                  = "tcp"
  from_port                    = var.ai_port
  to_port                      = var.ai_port
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "ai_from_worker" {
  security_group_id            = aws_security_group.ai.id
  description                  = "AI requests from the worker service"
  ip_protocol                  = "tcp"
  from_port                    = var.ai_port
  to_port                      = var.ai_port
  referenced_security_group_id = aws_security_group.worker.id
}

resource "aws_vpc_security_group_egress_rule" "ai_https_out" {
  security_group_id = aws_security_group.ai.id
  description       = "Outbound HTTPS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# ---- rds ----------------------------------------------------------------------
# No egress rules: the database never initiates outbound connections.

resource "aws_vpc_security_group_ingress_rule" "rds_from_api" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL from the API service"
  ip_protocol                  = "tcp"
  from_port                    = var.db_port
  to_port                      = var.db_port
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_worker" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL from the worker service"
  ip_protocol                  = "tcp"
  from_port                    = var.db_port
  to_port                      = var.db_port
  referenced_security_group_id = aws_security_group.worker.id
}
