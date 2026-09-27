# ECS roles. None carries AdministratorAccess or a wildcard action. Each policy names the
# specific resources it needs and only the API calls the application code actually makes.

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

# ---- execution role: used by ECS itself to start a task -------------------------------

resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name}-ecs-execution"
  description        = "ECS agent: pull the images, write logs, read the app secrets at task start"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "ecs_execution" {
  # This one action does not support resource-level scoping.
  statement {
    sid       = "EcrAuthToken"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPullOurRepositories"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
    resources = [for r in aws_ecr_repository.repo : r.arn]
  }

  statement {
    sid       = "WriteOurLogGroups"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [for g in aws_cloudwatch_log_group.app : "${g.arn}:*"]
  }

  statement {
    sid       = "ReadOurAppSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for s in aws_secretsmanager_secret.app : s.arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution" {
  name   = "execution"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution.json
}

# ---- API task role --------------------------------------------------------------------

resource "aws_iam_role" "api_task" {
  name               = "${local.name}-api-task"
  description        = "Node API: vault objects in S3 and publishing background jobs"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "api_task" {
  statement {
    sid       = "VaultObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.vault.arn}/*"]
  }

  # HeadBucket (health check) needs ListBucket; it also makes a missing key a 404 instead of a 403.
  statement {
    sid       = "VaultBucketProbe"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.vault.arn]
  }

  statement {
    sid       = "PublishJobs"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.jobs.arn]
  }
}

resource "aws_iam_role_policy" "api_task" {
  name   = "api"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.api_task.json
}

# ---- worker task role -----------------------------------------------------------------

resource "aws_iam_role" "worker_task" {
  name               = "${local.name}-worker-task"
  description        = "Background worker: consume jobs and read/write vault objects"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "worker_task" {
  statement {
    sid       = "VaultObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.vault.arn}/*"]
  }

  statement {
    sid       = "VaultBucketProbe"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.vault.arn]
  }

  # ChangeMessageVisibility is deliberately absent: the app does not extend visibility today.
  # Add it if a visibility heartbeat is built for long video jobs.
  statement {
    sid       = "ConsumeJobs"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage"]
    resources = [aws_sqs_queue.jobs.arn]
  }
}

resource "aws_iam_role_policy" "worker_task" {
  name   = "worker"
  role   = aws_iam_role.worker_task.id
  policy = data.aws_iam_policy_document.worker_task.json
}

# ---- AI task role ---------------------------------------------------------------------

resource "aws_iam_role" "ai_task" {
  name               = "${local.name}-ai-task"
  description        = "Python AI service: mount its own EFS access point, nothing else"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# Only takes effect if the ECS volume enables IAM authorization for EFS.
data "aws_iam_policy_document" "ai_task" {
  statement {
    sid       = "MountAiDataViaItsAccessPoint"
    actions   = ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"]
    resources = [aws_efs_file_system.ai.arn]

    condition {
      test     = "StringEquals"
      variable = "elasticfilesystem:AccessPointArn"
      values   = [aws_efs_access_point.ai.arn]
    }
  }
}

resource "aws_iam_role_policy" "ai_task" {
  name   = "ai"
  role   = aws_iam_role.ai_task.id
  policy = data.aws_iam_policy_document.ai_task.json
}
