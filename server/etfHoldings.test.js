const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createEtfHoldingsService,
  normalizeProfile,
} = require('./etfHoldings');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

const profilePayload = {
  name: 'Invesco QQQ Trust',
  net_assets: '250000000000',
  net_expense_ratio: '0.0020',
  portfolio_turnover: '0.0800',
  dividend_yield: '0.0055',
  leveraged: 'NO',
  inception_date: '1999-03-10',
  sectors: [
    { sector: 'Technology', weight: '0.52' },
    { sector: 'Communication Services', weight: '0.16' },
  ],
  holdings: [
    { symbol: 'MSFT', description: 'Microsoft Corporation', weight: '0.0825' },
    { symbol: 'NVDA', description: 'NVIDIA Corporation', weight: '0.0910' },
    { symbol: '', description: 'USD Cash', weight: '0.0030', asset_type: 'Cash' },
  ],
};

test('normalizes ETF metrics and holdings percentages', () => {
  const normalized = normalizeProfile('QQQ', profilePayload, Date.parse('2026-07-26T12:00:00.000Z'));

  assert.equal(normalized.symbol, 'QQQ');
  assert.equal(normalized.expenseRatio, 0.2);
  assert.equal(normalized.portfolioTurnover, 8);
  assert.equal(normalized.dividendYield, 0.55);
  assert.equal(normalized.netAssets, 250000000000);
  assert.deepEqual(normalized.holdings.map(({ symbol, weight }) => ({ symbol, weight })), [
    { symbol: 'NVDA', weight: 9.1 },
    { symbol: 'MSFT', weight: 8.25 },
    { symbol: '', weight: 0.3 },
  ]);
  assert.equal(normalized.sectors[0].weight, 52);
});

test('loads one ETF profile and reuses the 24-hour cache', async () => {
  let requestCount = 0;
  let currentTime = 1000;
  const service = createEtfHoldingsService({
    apiKey: 'test-key',
    now: () => currentTime,
    fetchImpl: async (url) => {
      requestCount += 1;
      assert.equal(url.searchParams.get('function'), 'ETF_PROFILE');
      assert.equal(url.searchParams.get('symbol'), 'QQQ');
      assert.equal(url.searchParams.get('apikey'), 'test-key');
      return jsonResponse(profilePayload);
    },
  });

  const first = await service.getHoldings('qqq');
  currentTime += 23 * 60 * 60 * 1000;
  const second = await service.getHoldings('QQQ');

  assert.equal(requestCount, 1);
  assert.equal(first.cacheStatus, 'refreshed');
  assert.equal(second.cacheStatus, 'fresh');
  assert.deepEqual(second.holdings, first.holdings);
});

test('deduplicates concurrent requests for the same ETF', async () => {
  let requestCount = 0;
  let releaseRequest;
  const responseReady = new Promise((resolve) => { releaseRequest = resolve; });
  const service = createEtfHoldingsService({
    apiKey: 'test-key',
    fetchImpl: async () => {
      requestCount += 1;
      await responseReady;
      return jsonResponse(profilePayload);
    },
  });

  const first = service.getHoldings('SPY');
  const second = service.getHoldings('SPY');
  releaseRequest();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(requestCount, 1);
  assert.deepEqual(secondResult, firstResult);
});

test('serves a seven-day stale profile when refresh fails', async () => {
  let currentTime = 1000;
  let shouldFail = false;
  const service = createEtfHoldingsService({
    apiKey: 'test-key',
    now: () => currentTime,
    fetchImpl: async () => shouldFail
      ? jsonResponse({ Note: 'Daily API request limit reached.' })
      : jsonResponse(profilePayload),
  });

  await service.getHoldings('SPY');
  currentTime += 25 * 60 * 60 * 1000;
  shouldFail = true;
  const stale = await service.getHoldings('SPY');

  assert.equal(stale.cacheStatus, 'stale');
  assert.equal(stale.holdings[0].symbol, 'NVDA');
});

test('rejects unsupported symbols and explains missing configuration', async () => {
  const service = createEtfHoldingsService({ apiKey: '', fetchImpl: async () => jsonResponse(profilePayload) });

  await assert.rejects(() => service.getHoldings('AAPL'), (error) => error.status === 400);
  await assert.rejects(
    () => service.getHoldings('SPY'),
    (error) => error.status === 503 && error.message.includes('ALPHA_VANTAGE_API_KEY')
  );
});
