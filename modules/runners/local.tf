locals {
  github_app_all_credential_arns = concat(
    [for p in var.github_app_parameters.id : p.arn],
    [for p in var.github_app_parameters.key_base64 : p.arn],
    [for p in var.github_app_parameters.installation_id : p.arn if p != null],
  )
  github_app_ssm_parameter_arns  = [for arn in local.github_app_all_credential_arns : arn if !can(regex("^arn:[^:]*:secretsmanager:", arn))]
  github_app_secretsmanager_arns = [for arn in local.github_app_all_credential_arns : arn if can(regex("^arn:[^:]*:secretsmanager:", arn))]

  parameter_store_tags = jsonencode([
    for key, value in merge(var.tags, var.parameter_store_tags) : {
      Key   = key
      Value = value
    }
  ])
}
