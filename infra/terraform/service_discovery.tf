# DRAFT / Phase 3. Private service discovery for the ai service only — the minimum needed
# so api/worker can reach it by a stable name instead of its per-restart Fargate IP.
#
# This is a Route53 PRIVATE hosted zone, scoped to this VPC only and invisible outside it —
# unrelated to the public pinithub.com domain, which stays Cloudflare-managed (see alb.tf's
# own note on this). Using Route53 privately here doesn't reopen that decision.
#
# Deliberately not used for api or worker: api is reached through the public ALB once
# public_domain_name is set (alb.tf), and nothing needs to discover worker at all — it only
# consumes the SQS queue, nothing calls it directly.

resource "aws_service_discovery_private_dns_namespace" "internal" {
  name        = "${local.name}.internal"
  description = "Private DNS for ECS-to-ECS discovery inside the VPC only."
  vpc         = aws_vpc.main.id

  tags = { Name = "${local.name}-internal-dns" }
}

resource "aws_service_discovery_service" "ai" {
  name = "ai"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id

    dns_records {
      ttl  = 10
      type = "A"
    }

    # MULTIVALUE (not the default WEIGHTED) so this still behaves correctly if desired_count
    # for ai is ever raised above 1 later — though today, with desired_count=1, only one
    # record is ever registered regardless.
    routing_policy = "MULTIVALUE"
  }

  # Empty on purpose: this block's presence is what tells ECS to manage this service's
  # Cloud Map health status itself (from the container healthCheck in
  # ecs_task_definitions.tf), rather than Cloud Map running its own checks.
  # failure_threshold used to be a field here; AWS now hardcodes it to 1 and the
  # provider deprecated the argument, so it's left out rather than set to a value
  # that's ignored.
  health_check_custom_config {}

  tags = { Name = "${local.name}-ai-discovery" }
}
