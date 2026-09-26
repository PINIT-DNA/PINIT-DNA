locals {
  # Repository name -> number of images to keep. The AI image is far larger, so fewer are kept.
  ecr_repositories = {
    "pinit-api" = 10
    "pinit-ai"  = 5
  }
}

# The API and the background worker run the same image (the worker overrides the command).
resource "aws_ecr_repository" "repo" {
  for_each = local.ecr_repositories

  name = each.key

  # Tags are meant to be git SHAs; an immutable tag can never be silently repointed.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = each.key
  }
}

resource "aws_ecr_lifecycle_policy" "repo" {
  for_each = local.ecr_repositories

  repository = aws_ecr_repository.repo[each.key].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the ${each.value} most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = each.value
        }
        action = { type = "expire" }
      },
    ]
  })
}
