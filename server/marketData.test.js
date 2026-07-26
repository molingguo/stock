const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketDataService } = require('./marketData');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test('loads live S&P constituents, batches quotes, and caches the result', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.pathname.endsWith('/sp500-constituent')) {
      return jsonResponse([
        { symbol: 'AAA', name: 'Alpha', sector: 'Tech' },
        { symbol: 'BBB', name: 'Beta', sector: 'Health' },
      ]);
    }
    return jsonResponse([
      { symbol: 'AAA', name: 'Alpha Inc', price: 12, marketCap: 100, changePercentage: 2 },
      { symbol: 'BBB', name: 'Beta Inc', price: 20, marketCap: 200, changePercentage: -1 },
    ]);
  };
  const service = createMarketDataService({ apiKey: 'secret', fetchImpl, now: () => 1000 });

  const first = await service.getStocks('sp500');
  const second = await service.getStocks('sp500');

  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.apikey, 'secret');
  assert.equal(requests[0].url.toString().includes('secret'), false);
  assert.deepEqual(first.stocks.map((stock) => stock.symbol), ['BBB', 'AAA']);
  assert.equal(first.cacheStatus, 'refreshed');
  assert.equal(second.cacheStatus, 'fresh');
});

test('uses one shared top-1000 cache for top-500 and top-1000 views', async () => {
  let requestCount = 0;
  const companies = Array.from({ length: 600 }, (_, index) => ({
    symbol: `S${index}`,
    companyName: `Stock ${index}`,
    marketCap: 1000 - index,
    price: index + 1,
  }));
  const fetchImpl = async (url) => {
    requestCount += 1;
    if (url.pathname.endsWith('/company-screener')) return jsonResponse(companies);
    const symbols = url.searchParams.get('symbols').split(',');
    return jsonResponse(symbols.map((symbol) => ({ symbol, price: 1 })));
  };
  const service = createMarketDataService({ apiKey: 'secret', fetchImpl });

  const top500 = await service.getStocks('top500');
  const top1000 = await service.getStocks('top1000');

  assert.equal(top500.count, 500);
  assert.equal(top1000.count, 600);
  assert.equal(requestCount, 4);
});

test('serves stale data when a refresh fails', async () => {
  let currentTime = 0;
  let shouldFail = false;
  const fetchImpl = async (url) => {
    if (shouldFail) return jsonResponse({}, 429);
    if (url.pathname.endsWith('/sp500-constituent')) {
      return jsonResponse([{ symbol: 'AAA', name: 'Alpha' }]);
    }
    return jsonResponse([{ symbol: 'AAA', price: 12, marketCap: 100 }]);
  };
  const service = createMarketDataService({
    apiKey: 'secret',
    fetchImpl,
    now: () => currentTime,
    cacheTtlMs: 10,
    staleTtlMs: 100,
  });

  await service.getStocks('sp500');
  currentTime = 20;
  shouldFail = true;
  const fallback = await service.getStocks('sp500');

  assert.equal(fallback.cacheStatus, 'stale');
  assert.equal(fallback.count, 1);
});

test('rejects unknown universes without calling the provider', async () => {
  const service = createMarketDataService({
    apiKey: 'secret',
    fetchImpl: async () => assert.fail('fetch should not be called'),
  });

  await assert.rejects(() => service.getStocks('unknown'), { status: 400 });
});
