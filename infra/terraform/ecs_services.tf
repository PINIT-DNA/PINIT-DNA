# DRAFT / Phase 3. ECS cluster and the 3 services that actually run the task definitions
# from ecs_task_definitions.tf. Do not `terraform apply` until Phase 3 is explicitly
# authorized AND the blockers noted in comments below are resolved (RDS existing with
# real Secrets Manager values, and the AI-service-discovery gap — see the note on
# ai_service_discovery_note below).
#
# Placement: the private subnets have no route to the internet (no NAT — see
# network.tf's own comment, a deliberate Phase 1 cost decision, D1). Fargate still needs
# outbound internet access to pull images from ECR, ship logs to CloudWatch, and read
# Secrets Manager, so every service runs in the PUBLIC subnets with a public IP assigned.
# This does not make them internet-reachable by itself — only the existing security
# groups decide that, and none of api/worker/ai accepts unsolicited inbound from the
# internet (only the ALB does, and only on 443).

resource "aws_ecs_cluster" "main" {
  name = local.name

  # Container Insights left at its default (disabled) — an ongoing CloudWatch cost this
  # phase doesn't need yet. Revisit once there's real traffic to actually observe.

  tags = {
    Name = local.name
  }
}

# ---- API ------------------------------------------------------------------------------

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true
  }

  # Standard rolling deployment: api is stateless (no local index, no exclusive-writer
  # constraint), so briefly running the old and new task together during a deploy is
  # safe and keeps it reachable through the deploy.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # The target_group_arn reference below is enough for Terraform to infer it must create
  # the listener before this service when create_public_ingress is true — no separate
  # depends_on needed (and one referencing a count=0 resource by bare name would be
  # invalid Terraform anyway).
  dynamic "load_balancer" {
    for_each = local.create_public_ingress ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.api[0].arn
      container_name   = "api"
      container_port   = var.api_port
    }
  }

  tags = { Name = "${local.name}-api" }
}

# ---- Worker: no load balancer, no public entry point -----------------------------------

resource "aws_ecs_service" "worker" {
  name            = "${local.name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = true
  }

  # Same reasoning as api: stateless queue consumer, safe to briefly run two during a
  # deploy (jobs are already idempotent — see the .upsert() calls in layers-11-15.service.ts).
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  tags = { Name = "${local.name}-worker" }
}

# ---- AI: single-writer, no load balancer -----------------------------------------------
# FAISS has no concurrent-writer support (see ecs_task_definitions.tf's own comment on
# this). min=0/max=100 means a deploy stops the running task completely before starting
# its replacement — the two are never up at once, unlike api/worker above. This is the
# actual mechanism enforcing the single-writer requirement; desired_count=1 alone only
# limits steady-state count, not what happens mid-deploy.

resource "aws_ecs_service" "ai" {
  name            = "${local.name}-ai"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ai.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ai.id]
    assign_public_ip = true
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  # Registers this service's current task into the private DNS namespace in
  # service_discovery.tf, so api/worker can reach it at a stable name
  # (ai.<namespace>) instead of its per-restart Fargate IP. See
  # ecs_task_definitions.tf for where AI_SERVICE_URL is set from this.
  service_registries {
    registry_arn = aws_service_discovery_service.ai.arn
  }

  tags = { Name = "${local.name}-ai" }
}
