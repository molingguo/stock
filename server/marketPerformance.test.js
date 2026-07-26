const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMarketPerformanceService,
  performanceDate,
  percentageChange,
} = require('./marketPerformance');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test('selects prior weekdays for each performance period', () => {
  const saturday = Date.UTC(2026, 6, 25, 12);
  assert.equal(performanceDate(saturday, { days: 7 }), '2026-07-17');
  assert.equal(performanceDate(saturday, { days: 30 }), '2026-06-25');
  assert.equal(performanceDate(saturday, { years: 1 }), '2025-07-25');
});

test('calculates percentage changes defensively', () => {
  assert.equal(percentageChange(110, 100), 10);
  assert.equal(percentageChange(100, 0), null);
  assert.equal(percentageChange(null, 100), null);
});

test('loads three full-market snapshots and reuses their cache', async () => {
  const requests = [];
  const closes = {
    '2026-07-17': 100,
    '2026-06-25': 80,
    '2025-07-25': 55,
  };
  const service = createMarketPerformanceService({
    now: () => Date.UTC(2026, 6, 25, 12),
    resolveApiKey: async () => 'secret',
    fetchImpl: async (url, options) => {
      const date = url.pathname.split('/').at(-1);
      requests.push({ url: url.toString(), options });
      return jsonResponse({ results: [{ T: 'AAA', c: closes[date] }] });
    },
  });

  const first = await service.getPerformance([{ symbol: 'AAA', price: 110 }]);
  const second = await service.getPerformance([{ symbol: 'AAA', price: 110 }]);

  assert.equal(requests.length, 3);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret');
  assert.equal(requests[0].url.includes('secret'), false);
  assert.equal(first.changes.get('AAA').change7Day, 10);
  assert.equal(first.changes.get('AAA').change30Day, 37.5);
  assert.equal(first.changes.get('AAA').change1Year, 100);
  assert.equal(first.cacheStatus, 'refreshed');
  assert.equal(second.cacheStatus, 'fresh');
});

test('returns empty changes without making requests when no key is configured', async () => {
  let requests = 0;
  const service = createMarketPerformanceService({
    resolveApiKey: async () => '',
    fetchImpl: async () => { requests += 1; },
  });

  const result = await service.getPerformance([{ symbol: 'AAA', price: 110 }]);

  assert.equal(requests, 0);
  assert.equal(result.cacheStatus, 'unconfigured');
  assert.deepEqual(result.changes.get('AAA'), {
    change7Day: null,
    change30Day: null,
    change1Year: null,
  });
});
