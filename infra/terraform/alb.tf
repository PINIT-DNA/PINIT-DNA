# DRAFT / Phase 3. The public entry point: ALB, HTTPS listener, API target group, and the
# ACM certificate the listener needs. HTTPS only — no port 80 listener and no HTTP->HTTPS
# redirect, per the same stance Phase 1's security groups already took (alb SG only opens
# 443; see security_groups.tf's own comment on this).
#
# DNS for pinithub.com is hosted on GoDaddy (nameservers ns53/ns54.domaincontrol.com), not
# Route53 — so no public Route53 resources exist in this file or anywhere in this repo. ACM's
# DNS validation record and the eventual ALB CNAME are both manual GoDaddy DNS console steps,
# not something Terraform manages here. Keep the ACM validation CNAME in GoDaddy permanently:
# ACM's automatic renewal re-checks it.
#
# Everything below is gated behind one variable, public_domain_name. It was left empty
# through the initial draft so nothing here invented a domain; api.pinithub.com is now the
# confirmed, approved value, so it's the committed default — the same pattern already used
# for every other approved setting in this repo (image tags, DB engine version, etc.), not
# a placeholder.

variable "public_domain_name" {
  description = <<-EOT
    The public hostname the ALB serves. api.pinithub.com, confirmed. Set to "" to gate the
    ALB, target group, listener, and ACM certificate out of the plan entirely (see
    local.create_public_ingress below) — kept as an option for anyone re-drafting this
    pattern elsewhere, not because this value is in doubt.
  EOT
  type        = string
  default     = "api.pinithub.com"
}

locals {
  create_public_ingress = var.public_domain_name != ""
}

resource "aws_acm_certificate" "api" {
  count = local.create_public_ingress ? 1 : 0

  domain_name       = var.public_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${local.name}-api-cert" }
}

# Waits for the certificate to actually become ISSUED before anything downstream (the
# listener) tries to use it. It does not create the DNS record itself — whoever manages
# the GoDaddy DNS zone adds the CNAME named in the output below, and Terraform (or whoever runs the
# next apply) waits here until AWS sees it and validates. No Route53 involved.
resource "aws_acm_certificate_validation" "api" {
  count = local.create_public_ingress ? 1 : 0

  certificate_arn         = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [for o in aws_acm_certificate.api[0].domain_validation_options : o.resource_record_name]
}

resource "aws_lb" "main" {
  count = local.create_public_ingress ? 1 : 0

  name               = "${local.name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = { Name = "${local.name}-alb" }
}

resource "aws_lb_target_group" "api" {
  count = local.create_public_ingress ? 1 : 0

  name        = "${local.name}-api-tg"
  port        = var.api_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # required for awsvpc-networked Fargate tasks

  health_check {
    # Same reasoning as the container-level healthCheck in ecs_task_definitions.tf:
    # /ping is the instant, no-DB liveness check, not the deeper /health that can depend
    # on the database and would make the target group flap on a transient DB blip.
    path                = "/api/v1/ping"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${local.name}-api-tg" }
}

resource "aws_lb_listener" "https" {
  count = local.create_public_ingress ? 1 : 0

  load_balancer_arn = aws_lb.main[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[0].arn
  }
}

output "acm_certificate_validation_records" {
  description = <<-EOT
    Empty until public_domain_name is set. Once it is, add each of these as a CNAME in
    GoDaddy DNS before applying — AWS won't issue the certificate otherwise, and
    aws_acm_certificate_validation will simply wait.
  EOT
  value = local.create_public_ingress ? [
    for o in aws_acm_certificate.api[0].domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ] : []
}

output "alb_dns_name" {
  description = "Empty until public_domain_name is set. Once the ALB exists, point a GoDaddy CNAME for public_domain_name at this."
  value       = local.create_public_ingress ? aws_lb.main[0].dns_name : null
}
