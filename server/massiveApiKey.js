const { GetSecretValueCommand, SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');

function parseSecretValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return String(parsed.MASSIVE_API_KEY || parsed.apiKey || '').trim();
    }
  } catch {
    return trimmed;
  }

  return '';
}

function createMassiveApiKeyResolver({
  directKey = process.env.MASSIVE_API_KEY,
  secretId = process.env.MASSIVE_API_KEY_SECRET_ID,
  client,
} = {}) {
  let pending;

  return async function resolveMassiveApiKey() {
    if (directKey) return String(directKey).trim();
    if (!secretId) return '';
    if (pending) return pending;

    pending = (async () => {
      const secretsClient = client || new SecretsManagerClient({});
      const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretId }));
      const key = parseSecretValue(response.SecretString);
      if (!key) throw new Error('The configured Massive API secret is empty.');
      return key;
    })();

    try {
      return await pending;
    } catch (error) {
      pending = null;
      throw error;
    }
  };
}

module.exports = { createMassiveApiKeyResolver, parseSecretValue };
