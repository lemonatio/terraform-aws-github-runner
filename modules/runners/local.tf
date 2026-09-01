locals {
  github_app_credentials_in_secrets_manager = can(regex("^arn:[^:]*:secretsmanager:", var.github_app_parameters.id.arn))

  parameter_store_tags = jsonencode([
    for key, value in merge(var.tags, var.parameter_store_tags) : {
      Key   = key
      Value = value
    }
  ])
}
