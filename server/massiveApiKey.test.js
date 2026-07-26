const test = require('node:test');
const assert = require('node:assert/strict');
const { createMassiveApiKeyResolver, parseSecretValue } = require('./massiveApiKey');

test('parses plain and JSON-formatted Massive secrets', () => {
  assert.equal(parseSecretValue('plain-key'), 'plain-key');
  assert.equal(parseSecretValue('{"MASSIVE_API_KEY":"json-key"}'), 'json-key');
  assert.equal(parseSecretValue('{"apiKey":"short-key"}'), 'short-key');
});

test('resolves an AWS secret once and caches the key', async () => {
  let requests = 0;
  const resolver = createMassiveApiKeyResolver({
    directKey: '',
    secretId: 'northstar/massive',
    client: {
      send: async (command) => {
        requests += 1;
        assert.equal(command.input.SecretId, 'northstar/massive');
        return { SecretString: 'secret-key' };
      },
    },
  });

  assert.equal(await resolver(), 'secret-key');
  assert.equal(await resolver(), 'secret-key');
  assert.equal(requests, 1);
});
