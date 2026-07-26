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
  const service = createZacksBestStocksService({
    now: () => 1_000,
    fetchImpl: async (url) => {
      requests.push(url.toString());
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
