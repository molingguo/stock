const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createZacksBestStocksService,
  parseEditionUrl,
  parseReportScript,
} = require('./zacksBestStocks');

const resolvedUrl = 'https://www.zacks.com/registration/ultimatetrader/welcome/eoffer/3de3?edition=20260724CqKVs2BDXDw30&cid=report';
const symbols = ['C', 'EXPD', 'KRO', 'MTZ', 'MU', 'TSM', 'URBN'];

function textResponse(body, { status = 200, url = resolvedUrl } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: async () => body,
  };
}

test('parses the report date from a resolved edition URL', () => {
  assert.deepEqual(parseEditionUrl(resolvedUrl), {
    edition: '20260724CqKVs2BDXDw30',
    reportDate: '2026-07-24',
  });
});

test('extracts exactly seven unique ticker symbols from an edition script', () => {
  const script = `var best = { 'date':'20260724', 'content':[
    ${symbols.map((symbol) => `{ 'ticker':'${symbol}' }`).join(',')}
  ]};`;

  assert.deepEqual(parseReportScript(script), symbols);
  assert.throws(() => parseReportScript("var best = {'content':[{'ticker':'C'}]};"), /exactly seven/i);
});

test('resolves, parses, and caches the current weekly report', async () => {
  const requests = [];
  const requestOptions = [];
  const service = createZacksBestStocksService({
    now: () => 1_000,
    fetchImpl: async (url, options) => {
      requests.push(url.toString());
      requestOptions.push(options);
      if (requests.length === 1) return textResponse('<html>report</html>');
      return textResponse(symbols.map((symbol) => `{'ticker':'${symbol}'}`).join(','), { url: url.toString() });
    },
  });

  const first = await service.getReport();
  const second = await service.getReport();

  assert.deepEqual(first.symbols, symbols);
  assert.equal(first.reportDate, '2026-07-24');
  assert.equal(first.resolvedReportUrl, resolvedUrl);
  assert.equal(first.cacheStatus, 'refreshed');
  assert.equal(second.cacheStatus, 'fresh');
  assert.equal(requests.length, 2);
  assert.equal(requestOptions[0].headers['User-Agent'], 'Mozilla/5.0');
  assert.equal(requestOptions[0].headers.Accept, undefined);
  assert.match(requests[1], /20260724CqKVs2BDXDw30\.js$/);
});

test('serves the verified snapshot when Zacks blocks report resolution', async () => {
  const fallbackSnapshot = {
    edition: '20260724CqKVs2BDXDw30',
    reportDate: '2026-07-24',
    resolvedReportUrl: resolvedUrl,
    symbols,
  };
  const service = createZacksBestStocksService({
    fallbackSnapshot,
    fetchImpl: async () => textResponse('<title>Pardon Our Interruption</title>', {
      url: 'https://www.zacks.com/pfp/report/example',
    }),
  });

  const result = await service.getReport();

  assert.deepEqual(result.symbols, symbols);
  assert.equal(result.reportDate, '2026-07-24');
  assert.equal(result.cacheStatus, 'fallback');
});

test('does not silently return an embedded old edition when the rolling report cannot refresh', async () => {
  const service = createZacksBestStocksService({
    fetchImpl: async () => textResponse('<title>Pardon Our Interruption</title>', {
      url: 'https://www.zacks.com/pfp/report/rolling',
    }),
  });

  await assert.rejects(service.getReport(), /current edition|exactly seven/i);
});

test('marks the last successful report stale during a later refresh failure', async () => {
  let currentTime = 0;
  let blocked = false;
  const service = createZacksBestStocksService({
    now: () => currentTime,
    cacheTtlMs: 1_000,
    fetchImpl: async (url) => {
      if (blocked) throw new Error('temporary Zacks failure');
      if (url.toString().includes('.js')) {
        return textResponse(symbols.map((symbol) => `{'ticker':'${symbol}'}`).join(','), { url: url.toString() });
      }
      return textResponse('<html>report</html>');
    },
  });

  const first = await service.getReport();
  currentTime = 2_000;
  blocked = true;
  const stale = await service.getReport();

  assert.equal(first.reportDate, '2026-07-24');
  assert.equal(stale.reportDate, first.reportDate);
  assert.equal(stale.cacheStatus, 'stale');
});
