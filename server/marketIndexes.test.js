const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketIndexesService } = require('./marketIndexes');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test('loads both market indexes in one request and caches the result', async () => {
  let requestCount = 0;
  const fetchImpl = async (url) => {
    requestCount += 1;
    assert.equal(url.searchParams.get('t'), 'SPX,COMPX');
    return jsonResponse({
      SPX: { name: 'S&P 500', last: '7411.98', net_change: '3.68', percent_net_change: '.05' },
      COMPX: { name: 'Nasdaq Composite', last: '24975.824', net_change: '-161.868', percent_net_change: '-.644' },
    });
  };
  const service = createMarketIndexesService({ fetchImpl, now: () => 1000 });

  const first = await service.getIndexes();
  const second = await service.getIndexes();

  assert.equal(requestCount, 1);
  assert.equal(first.indexes.sp500.changePercentage, 0.05);
  assert.equal(first.indexes.nasdaq.price, 24975.824);
  assert.equal(first.cacheStatus, 'refreshed');
  assert.equal(second.cacheStatus, 'fresh');
});

test('serves stale index quotes when a refresh is rate limited', async () => {
  let currentTime = 0;
  let shouldFail = false;
  const fetchImpl = async () => shouldFail
    ? jsonResponse({}, 429)
    : jsonResponse({ SPX: { last: '7000', percent_net_change: '1' } });
  const service = createMarketIndexesService({
    fetchImpl,
    now: () => currentTime,
    cacheTtlMs: 10,
    staleTtlMs: 100,
  });

  await service.getIndexes();
  currentTime = 20;
  shouldFail = true;
  const stale = await service.getIndexes();

  assert.equal(stale.cacheStatus, 'stale');
  assert.equal(stale.indexes.sp500.price, 7000);
});
