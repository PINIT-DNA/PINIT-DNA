# Persistent storage for the AI service's three FAISS indexes (faiss_index.bin,
# tile_faiss_index.bin, clip_faiss_index.bin), which the container keeps in /app/data.
# The AI service must run as a SINGLE task: FAISS is not safe for concurrent writers.

resource "aws_security_group" "efs" {
  name        = "${local.name}-efs"
  description = "EFS mount targets (NFS from the AI service only)"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name}-efs-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "efs_from_ai" {
  security_group_id            = aws_security_group.efs.id
  description                  = "NFS from the AI service only"
  ip_protocol                  = "tcp"
  from_port                    = 2049
  to_port                      = 2049
  referenced_security_group_id = aws_security_group.ai.id
}

# The matching outbound rule on the AI group (a new rule; the group itself is unchanged).
resource "aws_vpc_security_group_egress_rule" "ai_to_efs" {
  security_group_id            = aws_security_group.ai.id
  description                  = "NFS to EFS"
  ip_protocol                  = "tcp"
  from_port                    = 2049
  to_port                      = 2049
  referenced_security_group_id = aws_security_group.efs.id
}

resource "aws_efs_file_system" "ai" {
  creation_token   = "${local.name}-ai-data"
  encrypted        = true
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  tags = {
    Name = "${local.name}-ai-data"
  }

  # Holds the search indexes: never destroy by accident.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_efs_mount_target" "ai" {
  count = var.az_count

  file_system_id  = aws_efs_file_system.ai.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}

# The access point pins every file operation to one non-root identity, regardless of the
# user the container runs as (the AI image runs as root).
resource "aws_efs_access_point" "ai" {
  file_system_id = aws_efs_file_system.ai.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/ai-data"

    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "0750"
    }
  }

  tags = {
    Name = "${local.name}-ai-data-ap"
  }
}
