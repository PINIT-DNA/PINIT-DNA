# DRAFT / Phase 3 preparation. Registers ECS task definitions only — no cluster, no
# service, no load balancer. A task definition with nothing to run it is inert: this
# file changes nothing about what's live. Do not `terraform apply` this until Phase 3
# is explicitly authorized.
#
# One Node image serves both the API and the worker (src/worker.ts / dist/worker.js,
# already built alongside dist/server.js — see Dockerfile and package.json's "worker"
# script). The task definitions differ only in container command and IAM task role.

variable "api_image_tag" {
  description = <<-EOT
    Tag to deploy for pinit-api. The ECR repo uses IMMUTABLE tags (ecr.tf), so a tag
    can be pushed exactly once — "latest" cannot be overwritten on every deploy the
    way a mutable registry allows. Phase 3's CI should push a unique tag per build
    (git SHA or build number) and pass it here, registering a new task definition
    revision each time, rather than reusing one tag.
  EOT
  type        = string
  default     = "9b0522f"
}

variable "ai_image_tag" {
  description = "Tag to deploy for pinit-ai. Same IMMUTABLE-tag consideration as api_image_tag."
  type        = string
  default     = "9b0522f"
}

variable "api_task_cpu" {
  description = "Fargate task-level vCPU units for api/worker. Provisional — no load measurement has been done yet."
  type        = number
  default     = 512
}

variable "api_task_memory" {
  description = "Fargate task-level memory (MiB) for api/worker. Provisional."
  type        = number
  default     = 1024
}

variable "ai_task_cpu" {
  description = "Fargate task-level vCPU units for the AI service. Provisional — size from real inference load in Phase 3, not guessed here."
  type        = number
  default     = 1024
}

variable "ai_task_memory" {
  description = "Fargate task-level memory (MiB) for the AI service. Provisional."
  type        = number
  default     = 3072
}

locals {
  # Every app-secret key across all 4 Secrets Manager containers, shaped as the
  # {name, valueFrom} entries an ECS container definition's `secrets` list wants.
  # valueFrom pins to one JSON key within a container's secret so ECS injects a
  # single plain env var, not the whole JSON blob.
  ecs_secret_refs = flatten([
    for container_key, s in local.app_secrets : [
      for k in s.keys : {
        name      = k
        valueFrom = "${aws_secretsmanager_secret.app[container_key].arn}:${k}::"
      }
    ]
  ])

  ecs_log_options = {
    api = {
      "awslogs-group"         = aws_cloudwatch_log_group.app["api"].name
      "awslogs-region"        = var.aws_region
      "awslogs-stream-prefix" = "ecs"
    }
    worker = {
      "awslogs-group"         = aws_cloudwatch_log_group.app["worker"].name
      "awslogs-region"        = var.aws_region
      "awslogs-stream-prefix" = "ecs"
    }
    ai = {
      "awslogs-group"         = aws_cloudwatch_log_group.app["ai"].name
      "awslogs-region"        = var.aws_region
      "awslogs-stream-prefix" = "ecs"
    }
  }
}

# ---- API ------------------------------------------------------------------------------

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_task_cpu
  memory                   = var.api_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${aws_ecr_repository.repo["pinit-api"].repository_url}:${var.api_image_tag}"
      essential = true
      portMappings = [
        { containerPort = var.api_port, protocol = "tcp" }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(var.api_port) },
      ]
      secrets = local.ecs_secret_refs
      logConfiguration = {
        logDriver = "awslogs"
        options   = local.ecs_log_options.api
      }
    }
  ])

  tags = { Name = "${local.name}-api" }
}

# ---- Worker: same image, overridden command, no inbound port --------------------------

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_task_cpu
  memory                   = var.api_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.worker_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${aws_ecr_repository.repo["pinit-api"].repository_url}:${var.api_image_tag}"
      essential = true
      command   = ["node", "dist/worker.js"]
      environment = [
        { name = "NODE_ENV", value = "production" },
      ]
      secrets = local.ecs_secret_refs
      logConfiguration = {
        logDriver = "awslogs"
        options   = local.ecs_log_options.worker
      }
    }
  ])

  tags = { Name = "${local.name}-worker" }
}

# ---- AI: EFS-backed FAISS index, single writer -----------------------------------------
# The FAISS index has no concurrent-writer support, so exactly one AI task may run at a
# time (Phase 3 service config: desiredCount = 1, deployment min 0% / max 100%, never a
# rolling overlap). Not enforced here — a task definition alone can't express that; it's
# a Phase 3 service-level decision, recorded so it isn't lost before then.

resource "aws_ecs_task_definition" "ai" {
  family                   = "${local.name}-ai"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.ai_task_cpu
  memory                   = var.ai_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ai_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "ai-data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.ai.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.ai.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = "ai"
      image     = "${aws_ecr_repository.repo["pinit-ai"].repository_url}:${var.ai_image_tag}"
      essential = true
      portMappings = [
        { containerPort = var.ai_port, protocol = "tcp" }
      ]
      environment = [
        # The image's own Dockerfile defaults to 7860 (uvicorn --port ${PORT:-7860});
        # the ai security group only opens 8001, so this must be set explicitly.
        { name = "PORT", value = tostring(var.ai_port) },
      ]
      mountPoints = [
        # main.py resolves its data dir relative to its own file: BASE_DIR/"data" —
        # BASE_DIR is /app (the Dockerfile's WORKDIR + `COPY . .`), so the FAISS
        # index and metadata land at /app/data and must be the EFS mount point.
        { sourceVolume = "ai-data", containerPath = "/app/data", readOnly = false }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options   = local.ecs_log_options.ai
      }
    }
  ])

  tags = { Name = "${local.name}-ai" }
}
