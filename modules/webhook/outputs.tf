output "gateway" {
  value = var.create_api_gateway ? aws_apigatewayv2_api.webhook[0] : null
}

output "endpoint_relative_path" {
  value = local.webhook_endpoint
}

output "webhook" {
  value = !var.eventbridge.enable ? module.direct[0].webhook : module.eventbridge[0].webhook
}

output "dispatcher" {
  value = var.eventbridge.enable ? module.eventbridge[0].dispatcher : null
}

output "eventbridge" {
  value = var.eventbridge.enable ? module.eventbridge[0].eventbridge : null
}

### For backwards compatibility

output "lambda" {
  value = !var.eventbridge.enable ? module.direct[0].webhook.lambda : module.eventbridge[0].webhook.lambda
}

output "lambda_log_group" {
  value = !var.eventbridge.enable ? module.direct[0].webhook.log_group : module.eventbridge[0].webhook.log_group
}

output "role" {
  value = !var.eventbridge.enable ? module.direct[0].webhook.role : module.eventbridge[0].webhook.role
}
