# GitHub Actions OIDC — DESIGN ONLY, NOT APPLIED.
#
# Lets a GitHub Actions workflow push images to ECR without any long-lived AWS
# access key stored as a GitHub secret. The workflow authenticates by minting
# a short-lived OIDC token that GitHub itself signs; AWS trusts it only for
# the exact repo+branch this trust policy names, and only to push to the two
# ECR repos already created in Phase 2 — nothing else.
#
# Review and apply this on its own, then fill the resulting role ARN into
# .github/workflows/ecr-build-push.yml's `role-to-assume` before that
# workflow can run. Until both are done, no workflow can use this role.

resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # GitHub's own OIDC root CA thumbprint. AWS has stated it validates the
  # token against its own trusted CA bundle regardless of this field's exact
  # value for token.actions.githubusercontent.com, but the provider resource
  # still requires one. Re-verify this against AWS's current documentation
  # at apply time rather than trusting it blindly — I could not fetch live
  # AWS docs from this environment to independently confirm it today.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = {
    Name = "${local.name}-github-actions"
  }
}

# Only workflow runs FROM the main branch of this exact repository may assume
# this role — not pull requests, not forks, not other branches. Deliberately
# tight, since this role can push images that (eventually) run in production.
data "aws_iam_policy_document" "github_actions_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:PINIT-DNA/PINIT-DNA:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_actions_ecr_push" {
  name        = "${local.name}-github-actions-ecr-push"
  description = "CI-only: build and push images to pinit-api/pinit-ai from GitHub Actions on main. No other AWS access — cannot touch ECS, RDS, S3, SQS, EFS, or Secrets Manager."

  assume_role_policy = data.aws_iam_policy_document.github_actions_assume.json
}

data "aws_iam_policy_document" "github_actions_ecr_push" {
  # Same as the ECS execution role's own equivalent statement: this one action
  # does not support resource-level scoping.
  statement {
    sid       = "EcrAuthToken"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PushToOurRepositoriesOnly"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
    ]
    resources = [for r in aws_ecr_repository.repo : r.arn]
  }
}

resource "aws_iam_role_policy" "github_actions_ecr_push" {
  name   = "ecr-push"
  role   = aws_iam_role.github_actions_ecr_push.id
  policy = data.aws_iam_policy_document.github_actions_ecr_push.json
}

output "github_actions_ecr_push_role_arn" {
  description = "Fill this into the GitHub Actions workflow's role-to-assume once this file is reviewed and applied."
  value       = aws_iam_role.github_actions_ecr_push.arn
}
