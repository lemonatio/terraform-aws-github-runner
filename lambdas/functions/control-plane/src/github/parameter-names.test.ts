import { describe, expect, it } from 'vitest';
import { splitParameterNames } from './parameter-names';

const secret = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:app-AbCdEf';

describe('splitParameterNames', () => {
  it('splits SSM names', () => {
    expect(splitParameterNames('/app/id:/app2/id')).toEqual(['/app/id', '/app2/id']);
  });

  it('keeps a Secrets Manager reference whole', () => {
    expect(splitParameterNames(`${secret}#id`)).toEqual([`${secret}#id`]);
  });

  it('splits a mix of references and SSM names', () => {
    expect(splitParameterNames(`${secret}#id:/app2/id:${secret}`)).toEqual([`${secret}#id`, '/app2/id', secret]);
  });

  it('preserves empty entries', () => {
    expect(splitParameterNames(`:${secret}#installation_id`)).toEqual(['', `${secret}#installation_id`]);
    expect(splitParameterNames('')).toEqual(['']);
  });
});
