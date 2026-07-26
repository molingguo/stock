const test = require('node:test');
const assert = require('node:assert/strict');
const { createZacksRatingsService } = require('./zacksRatings');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test('serves stale Zacks ranks when a refresh is rate limited', async () => {
  let currentTime = 0;
  let shouldFail = false;
  const service = createZacksRatingsService({
    now: () => currentTime,
    cacheTtlMs: 10,
    staleTtlMs: 100,
    fetchImpl: async () => shouldFail
      ? jsonResponse({}, 429)
      : jsonResponse({ AAPL: { zacks_rank: '1', zacks_rank_text: 'Strong Buy' } }),
  });

  const initial = await service.getRatings(['AAPL']);
  currentTime = 20;
  shouldFail = true;
  const fallback = await service.getRatings(['AAPL']);

  assert.deepEqual(initial.ratings.get('AAPL'), { rank: 1, text: 'Strong Buy' });
  assert.deepEqual(fallback.ratings.get('AAPL'), { rank: 1, text: 'Strong Buy' });
  assert.equal(fallback.cacheStatus, 'stale');
});
