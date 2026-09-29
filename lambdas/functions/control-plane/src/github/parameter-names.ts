// Multi-app mode joins parameter names with ':', but a Secrets Manager reference
// (`arn:<partition>:secretsmanager:<region>:<account>:secret:<name>[#<jsonKey>]`) contains ':' itself,
// so its 7 segments are kept together. The JSON key must not contain ':', since nothing tells it apart from
// the next entry. Empty entries are preserved to keep positional alignment.
export function splitParameterNames(value: string): string[] {
  const parts = value.split(':');
  const names: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === 'arn' && parts[i + 2] === 'secretsmanager') {
      names.push(parts.slice(i, i + 7).join(':'));
      i += 6;
    } else {
      names.push(parts[i]);
    }
  }
  return names;
}
