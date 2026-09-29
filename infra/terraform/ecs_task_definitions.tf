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
        # vault.service.ts is the only place config.jobs.useQueue is read (its two
        # dispatch sites for pdf_protect/video_protect) — worker.ts itself never
        # checks this flag, it always polls unconditionally. So this belongs on the
        # producer (api), not the consumer (worker); setting it on worker would do
        # nothing. Confirmed by reading both files, not assumed.
        { name = "BACKGROUND_JOBS_USE_QUEUE", value = "true" },
        # Existing app-coded fallbacks (src/config/index.ts), set explicitly rather
        # than left to warn-and-fall-back. EXCHANGE_API_URL's fallback is a Render
        # URL — correct for "use the app's own existing default", but revisit once
        # this API has a real AWS-side public URL (post-ALB) that Exchange should
        # call back into instead.
        { name = "EXCHANGE_APP_URL", value = "https://www.pinitexchange.com" },
        { name = "EXCHANGE_API_URL", value = "https://pinit-dna-3fmw.onrender.com" },
        # ai-embeddings.service.ts / ai.controller.ts / python-ai-process.ts all read
        # this directly. Resolves via the Cloud Map private DNS namespace in
        # service_discovery.tf, not a hardcoded IP — Fargate reassigns the ai task's
        # IP on every restart, so nothing but a name that follows it would work here.
        { name = "AI_SERVICE_URL", value = "http://ai.${aws_service_discovery_private_dns_namespace.internal.name}:${var.ai_port}" },
        # Without JOB_QUEUE_BACKEND=sqs, job-queue.ts defaults to an in-memory queue
        # private to this process — jobs published here would never reach the
        # separate worker task.
        { name = "JOB_QUEUE_BACKEND", value = "sqs" },
        { name = "JOB_QUEUE_URL", value = aws_sqs_queue.jobs.url },
        # config.storage.backend defaults to 'supabase'; s3-storage.ts requires S3_BUCKET.
        { name = "STORAGE_BACKEND", value = "s3" },
        { name = "S3_BUCKET", value = aws_s3_bucket.vault.id },
      ]
      secrets = local.ecs_secret_refs
      logConfiguration = {
        logDriver = "awslogs"
        options   = local.ecs_log_options.api
      }
      healthCheck = {
        # /ping is the instant, no-DB liveness check (app.ts); the deeper /health
        # does an async check that can depend on downstream services (e.g. the
        # database), which would make ECS flap this container unhealthy on a
        # transient DB blip rather than an actual process failure. /ping is the
        # correct signal for container-level liveness; /health is a readiness-style
        # check, not a liveness one. No curl/wget in this image (Dockerfile only
        # installs ca-certificates), so this uses Node's own http module.
        command = [
          "CMD-SHELL",
          "node -e \"require('http').get('http://localhost:${var.api_port}/api/v1/ping',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""
        ]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
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
        # No BACKGROUND_JOBS_USE_QUEUE here: worker.ts never reads that flag — it
        # always polls the queue unconditionally whenever this process runs. The
        # flag only matters on the api container, which is where it's set.
        #
        # AI_SERVICE_URL is needed here too: handleAdvancedLayers() (worker.ts) calls
        # processAdvancedLayers() (layers-11-15.service.ts), which imports aiService
        # from ai-embeddings.service.ts — the same AI_SERVICE_URL consumer as api.
        # Matches the worker_to_ai security group rule already present in
        # security_groups.tf, which anticipated exactly this.
        { name = "AI_SERVICE_URL", value = "http://ai.${aws_service_discovery_private_dns_namespace.internal.name}:${var.ai_port}" },
        # Same queue and storage settings as api: worker.ts polls getJobQueue() and
        # reads vault files through vaultService.retrieve().
        { name = "JOB_QUEUE_BACKEND", value = "sqs" },
        { name = "JOB_QUEUE_URL", value = aws_sqs_queue.jobs.url },
        { name = "STORAGE_BACKEND", value = "s3" },
        { name = "S3_BUCKET", value = aws_s3_bucket.vault.id },
      ]
      secrets = local.ecs_secret_refs
      logConfiguration = {
        logDriver = "awslogs"
        options   = local.ecs_log_options.worker
      }
      # Deliberately no healthCheck block: worker.ts starts no HTTP server (its own
      # header comment says so explicitly), and the runtime image installs nothing
      # beyond ca-certificates — no ps/pgrep for a process-based check either. A
      # command that doesn't verify real health would be worse than none. ECS's own
      # container-exit detection is the correct signal here until/unless the worker
      # gains a real liveness mechanism.
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
      healthCheck = {
        # main.py's GET /health (confirmed live during smoke testing: returns 200
        # with module/diagnostic status, no FAISS data or EFS content required).
        # No curl/wget in this image either (Dockerfile installs tesseract/ffmpeg/
        # image libs only), so this uses Python's own urllib. Longer startPeriod
        # than the api container: the sentence-transformer model load alone took
        # ~15-20s during smoke testing, on top of dependency import time.
        command = [
          "CMD-SHELL",
          "python3 -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:${var.ai_port}/health',timeout=3).status==200 else 1)\" || exit 1"
        ]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = { Name = "${local.name}-ai" }
}
