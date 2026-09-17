import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParametersCommand, PutParameterCommand, SSMClient, Tag } from '@aws-sdk/client-ssm';
import { getTracedAWSV3Client } from '@aws-github-runner/aws-powertools-util';
import { SecretsProvider } from '@aws-lambda-powertools/parameters/secrets';
import { SSMProvider } from '@aws-lambda-powertools/parameters/ssm';

// A parameter name of the form `<secret arn>#<jsonKey>` (or just `<secret arn>`) points at
// Secrets Manager instead of SSM. ARNs cannot contain '#', so splitting on the first one is safe.
const SECRETS_MANAGER_ARN_REGEX = /^arn:[^:]*:secretsmanager:/;

// SSM PutParameter has a per-account, per-region rate limit (~40 TPS standard
// throughput). Under burst load with multiple concurrent Lambdas each writing
// JIT configs, the default retry (standard, 3 attempts, ~3s budget) is
// insufficient and throws ThrottlingException.
//
// `adaptive` retry mode adds client-side rate-sensing via a token bucket:
// when the SDK sees ThrottlingException it slows further calls to match the
// observed budget. Combined with maxAttempts=10 this gives ~30s of retry
// per call without hammering the API.
//
// The client is memoised deliberately. Adaptive retry keeps its rate-sensing
// token bucket on the client instance, so constructing a fresh SSMClient per
// call would discard what it learned and reduce `adaptive` to plain retries.
// Reusing one client per Lambda container lets the backoff carry across calls
// (and saves the per-call construction cost).
let memoisedClient: SSMClient | undefined;

export function ssmClient(): SSMClient {
  memoisedClient ??= getTracedAWSV3Client(
    new SSMClient({
      region: process.env.AWS_REGION,
      maxAttempts: 10,
      retryMode: 'adaptive',
    }),
  );
  return memoisedClient;
}

// Exposed for tests, which need a fresh client per case to assert construction.
export function resetSSMClient(): void {
  memoisedClient = undefined;
}

export async function getParameter(parameter_name: string): Promise<string> {
  if (SECRETS_MANAGER_ARN_REGEX.test(parameter_name)) {
    return getSecretsManagerParameter(parameter_name);
  }

  const client = new SSMProvider({ awsSdkV3Client: ssmClient() });
  const result = await client.get(parameter_name, {
    decrypt: true,
    maxAge: 30, // 30 seconds override default 5 seconds
  });

  // throw error if result is undefined
  if (!result) {
    throw new Error(`Parameter ${parameter_name} not found`);
  }
  return result;
}

async function getSecretsManagerParameter(reference: string): Promise<string> {
  const hashIndex = reference.indexOf('#');
  const secretArn = hashIndex === -1 ? reference : reference.substring(0, hashIndex);
  const jsonKey = hashIndex === -1 ? undefined : reference.substring(hashIndex + 1);

  const secretsManagerClient = getTracedAWSV3Client(new SecretsManagerClient({ region: process.env.AWS_REGION }));
  const client = new SecretsProvider({ awsSdkV3Client: secretsManagerClient });
  const result = await client.get(secretArn, {
    maxAge: 30, // 30 seconds override default 5 seconds
  });

  if (!result) {
    throw new Error(`Secret ${secretArn} not found`);
  }

  if (jsonKey === undefined) {
    return result as string;
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(result as string);
  } catch {
    throw new Error(`Secret ${secretArn} is not valid JSON, cannot read key "${jsonKey}"`);
  }

  if (typeof parsedValue !== 'object' || parsedValue === null) {
    throw new Error(`Secret ${secretArn} is not a JSON object, cannot read key "${jsonKey}"`);
  }

  const value = (parsedValue as Record<string, unknown>)[jsonKey];
  if (value === null || value === undefined) {
    throw new Error(`Key "${jsonKey}" not found in secret ${secretArn}`);
  }

  return String(value);
}

/**
 * Retrieves multiple parameters from AWS Systems Manager Parameter Store, transparently
 * resolving any Secrets Manager references (see {@link getParameter}) individually.
 *
 * This function uses the AWS SSM {@link GetParametersCommand} API to fetch the values
 * for the provided parameter names that are not Secrets Manager references. Requests are
 * automatically chunked into batches of up to 10 names per call to comply with the AWS
 * GetParameters API limit.
 *
 * Each successfully retrieved parameter is added to the returned {@link Map}, where:
 * - The map key is the full parameter name as stored in Parameter Store (or the original
 *   Secrets Manager reference).
 * - The map value is the decrypted string value of the parameter or secret.
 *
 * Parameter names that are not found in Parameter Store (or that cannot be returned
 * by the API) are silently omitted from the resulting map. They will not appear as
 * keys in the returned {@link Map}.
 *
 * @param parameter_names - An array of parameter names to retrieve from SSM Parameter Store
 *   or Secrets Manager. If the array is empty, an empty {@link Map} is returned without
 *   calling any AWS API.
 *
 * @returns A {@link Map} where each key is a parameter name (or Secrets Manager reference)
 *   and each value is the corresponding decrypted string value.
 *
 * @throws Error Propagates any error thrown by the underlying AWS SDK client,
 *   such as network errors, AWS service errors (e.g., access denied, throttling),
 *   or configuration issues (e.g., missing region or credentials).
 */
export async function getParameters(parameter_names: string[]): Promise<Map<string, string>> {
  if (parameter_names.length === 0) {
    return new Map();
  }

  const result = new Map<string, string>();
  const ssmNames = parameter_names.filter((name) => !SECRETS_MANAGER_ARN_REGEX.test(name));
  const secretsManagerNames = parameter_names.filter((name) => SECRETS_MANAGER_ARN_REGEX.test(name));

  await Promise.all(
    secretsManagerNames.map(async (name) => {
      result.set(name, await getSecretsManagerParameter(name));
    }),
  );

  // AWS SSM GetParameters API has a limit of 10 parameters per call
  const chunkSize = 10;
  for (let i = 0; i < ssmNames.length; i += chunkSize) {
    const chunk = ssmNames.slice(i, i + chunkSize);
    const response = await ssmClient().send(
      new GetParametersCommand({
        Names: chunk,
        WithDecryption: true,
      }),
    );

    for (const param of response.Parameters ?? []) {
      if (param.Name && param.Value) {
        result.set(param.Name, param.Value);
      }
    }
  }

  return result;
}

export const SSM_ADVANCED_TIER_THRESHOLD = 4000;

export async function putParameter(
  parameter_name: string,
  parameter_value: string,
  secure: boolean,
  options: { tags?: Tag[] } = {},
): Promise<void> {
  const client = ssmClient();

  // Determine tier based on parameter_value size
  const valueSizeBytes = Buffer.byteLength(parameter_value, 'utf8');

  await client.send(
    new PutParameterCommand({
      Name: parameter_name,
      Value: parameter_value,
      Type: secure ? 'SecureString' : 'String',
      Tags: options.tags,
      Tier: valueSizeBytes >= SSM_ADVANCED_TIER_THRESHOLD ? 'Advanced' : 'Standard',
    }),
  );
}
