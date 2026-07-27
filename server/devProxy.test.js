const test = require('node:test');
const assert = require('node:assert/strict');

test('the development proxy cannot fall through onto its own API target port', async () => {
  const { default: viteConfig } = await import('../vite.config.js');

  assert.equal(viteConfig.server.port, 3000);
  assert.equal(viteConfig.server.strictPort, true);
  assert.equal(viteConfig.server.proxy['/api'], 'http://127.0.0.1:3001');
});
