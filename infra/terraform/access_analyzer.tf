# Free account-level analyzer for unintended external access. Access Analyzer is regional and an
# older analyzer already exists in eu-north-1; this one covers the region the platform runs in.
resource "aws_accessanalyzer_analyzer" "account" {
  analyzer_name = "${local.name}-external-access"
  type          = "ACCOUNT"

  tags = {
    Name = "${local.name}-external-access"
  }
}
