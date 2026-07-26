const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketDataService } = require('./marketData');
const { parseSpyHoldings } = require('./spyHoldings');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [name, contents] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(contents);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBuffer);
    localOffset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

test('loads S&P stocks from free public sources without an FMP key', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url.toString());
    if (url.hostname === 'api.nasdaq.com') {
      return jsonResponse({
        data: {
          rows: [
            {
              symbol: 'AAA',
              name: 'Alpha Inc.',
              lastsale: '$12.00',
              netchange: '0.24',
              pctchange: '2.00%',
              volume: '1,500',
              marketCap: '100',
              country: 'United States',
              sector: 'Technology',
              industry: 'Software',
            },
            {
              symbol: 'BBB',
              name: 'Beta Inc.',
              lastsale: '$8.00',
              netchange: '-0.08',
              pctchange: '-1.00%',
              volume: '2,000',
              marketCap: '80',
              country: 'United States',
              sector: 'Health Care',
              industry: 'Biotechnology',
            },
          ],
        },
      });
    }
    if (url.hostname === 'quote-feed.zacks.com') {
      return jsonResponse({
        AAA: { ticker: 'AAA', zacks_rank: '1', zacks_rank_text: 'Strong Buy', pe_f1: '24.5' },
        BBB: { ticker: 'BBB', zacks_rank: '3', zacks_rank_text: 'Hold', pe_f1: '18.2' },
      });
    }

    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.alloc(0),
    };
  };
  const service = createMarketDataService({ fetchImpl, parseHoldings: () => [{ symbol: 'AAA' }] });

  const result = await service.getStocks('sp500');
  const extendedResult = await service.getStocks('extendedMarket');

  assert.equal(result.count, 1);
  assert.equal(result.stocks[0].symbol, 'AAA');
  assert.equal(result.stocks[0].changePercentage, 2);
  assert.equal(result.stocks[0].zacksRank, 1);
  assert.equal(result.stocks[0].zacksRankText, 'Strong Buy');
  assert.equal(result.stocks[0].pe, 24.5);
  assert.equal(result.stocks[0].change7Day, null);
  assert.equal(result.performanceCacheStatus, 'unconfigured');
  assert.equal(result.zacksCoverage, 1);
  assert.equal(extendedResult.label, 'U.S. Extended Market');
  assert.deepEqual(extendedResult.stocks.map((stock) => stock.symbol), ['BBB']);
  assert.equal(extendedResult.stocks[0].marketRank, 2);
  assert.equal(extendedResult.stocks[0].zacksRank, 3);
  assert.equal(requests.length, 4);
  assert.equal(requests.filter((request) => request.includes('api.nasdaq.com')).length, 1);
  assert.equal(requests.filter((request) => request.includes('ssga.com')).length, 1);
  assert.equal(requests.some((request) => request.includes('financialmodelingprep.com')), false);
});

test('loads live S&P constituents, batches quotes, and caches the result', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.hostname === 'quote-feed.zacks.com') {
      return jsonResponse({
        AAA: { zacks_rank: '2', zacks_rank_text: 'Buy' },
        BBB: { zacks_rank: '3', zacks_rank_text: 'Hold' },
      });
    }
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
  const service = createMarketDataService({ provider: 'fmp', apiKey: 'secret', fetchImpl, now: () => 1000 });

  const first = await service.getStocks('sp500');
  const second = await service.getStocks('sp500');

  assert.equal(requests.length, 3);
  assert.equal(requests[0].options.headers.apikey, 'secret');
  assert.equal(requests[0].url.toString().includes('secret'), false);
  assert.deepEqual(first.stocks.map((stock) => stock.symbol), ['BBB', 'AAA']);
  assert.equal(first.stocks[1].zacksRankText, 'Buy');
  assert.equal(first.cacheStatus, 'refreshed');
  assert.equal(second.cacheStatus, 'fresh');
});

test('excludes S&P constituents from the cached top-1000 extended-market view', async () => {
  let requestCount = 0;
  let zacksRequestCount = 0;
  const companies = Array.from({ length: 600 }, (_, index) => ({
    symbol: `S${index}`,
    companyName: `Stock ${index}`,
    marketCap: 1000 - index,
    price: index + 1,
  }));
  const fetchImpl = async (url) => {
    requestCount += 1;
    if (url.hostname === 'quote-feed.zacks.com') {
      zacksRequestCount += 1;
      const symbols = url.searchParams.get('t').split(',');
      return jsonResponse(Object.fromEntries(symbols.map((symbol) => [
        symbol, { zacks_rank: '3', zacks_rank_text: 'Hold' },
      ])));
    }
    if (url.pathname.endsWith('/sp500-constituent')) {
      return jsonResponse([{ symbol: 'S0' }, { symbol: 'S1' }]);
    }
    if (url.pathname.endsWith('/company-screener')) return jsonResponse(companies);
    const symbols = url.searchParams.get('symbols').split(',');
    return jsonResponse(symbols.map((symbol) => ({ symbol, price: 1 })));
  };
  const service = createMarketDataService({ provider: 'fmp', apiKey: 'secret', fetchImpl });

  const extended = await service.getStocks('extendedMarket');
  const cached = await service.getStocks('extendedMarket');

  assert.equal(extended.count, 598);
  assert.equal(extended.label, 'U.S. Extended Market');
  assert.equal(extended.stocks.some((stock) => stock.symbol === 'S0' || stock.symbol === 'S1'), false);
  assert.equal(extended.stocks[0].marketRank, 3);
  assert.equal(extended.stocks.at(-1).marketRank, 600);
  assert.equal(cached.cacheStatus, 'fresh');
  assert.equal(requestCount, 8);
  assert.equal(zacksRequestCount, 3);
});

test('loads popular ETFs from one quote batch and orders them by live fund assets', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url.toString());
    assert.equal(url.hostname, 'quote-feed.zacks.com');
    return jsonResponse({
      SPY: {
        name: 'State Street SPDR S&P 500 ETF Trust',
        ticker_type: 'E',
        last: '700',
        volume: '40000000',
        percent_net_change: '0.5',
        zacks_rank: '2',
        zacks_rank_text: 'Buy',
        source: { sungard: { market_cap: '700000000000' } },
      },
      QQQ: {
        name: 'Invesco QQQ',
        ticker_type: 'E',
        last: '600',
        volume: '50000000',
        percent_net_change: '-0.25',
        zacks_rank: '1',
        zacks_rank_text: 'Strong Buy',
        source: { sungard: { market_cap: '400000000000' } },
      },
    });
  };
  const service = createMarketDataService({ fetchImpl });

  const result = await service.getStocks('popularEtfs');
  const cached = await service.getStocks('popularEtfs');

  assert.deepEqual(result.stocks.map((stock) => stock.symbol), ['SPY', 'QQQ']);
  assert.equal(result.label, 'Popular ETFs');
  assert.equal(result.stocks[0].sector, 'Broad market');
  assert.equal(result.stocks[0].marketCap, 700000000000);
  assert.equal(result.stocks[0].zacksRank, 2);
  assert.equal(result.sources.includes('Nasdaq'), false);
  assert.equal(cached.cacheStatus, 'fresh');
  assert.equal(requests.length, 1);
});

test('loads the weekly Zacks report picks with report-date metadata', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url.hostname, 'quote-feed.zacks.com');
    const requestedSymbols = url.searchParams.get('t').split(',');
    return jsonResponse(Object.fromEntries(requestedSymbols.map((symbol, index) => [
      symbol,
      {
        name: `Company ${symbol}`,
        last: String(100 + index),
        zacks_rank: '1',
        zacks_rank_text: 'Strong Buy',
      },
    ])));
  };
  const bestStocksService = {
    getReport: async () => ({
      symbols: ['C', 'EXPD', 'KRO', 'MTZ', 'MU', 'TSM', 'URBN'],
      reportDate: '2026-07-24',
      reportUrl: 'https://www.zacks.com/pfp/report/example',
      resolvedReportUrl: 'https://www.zacks.com/example?edition=20260724abc',
      cacheStatus: 'fresh',
    }),
  };
  const service = createMarketDataService({ fetchImpl, bestStocksService });

  const result = await service.getStocks('zacksBest');

  assert.equal(result.count, 7);
  assert.deepEqual(result.stocks.map((stock) => stock.symbol), ['C', 'EXPD', 'KRO', 'MTZ', 'MU', 'TSM', 'URBN']);
  assert.equal(result.zacksCoverage, 7);
  assert.equal(result.reportDate, '2026-07-24');
  assert.equal(result.reportCacheStatus, 'fresh');
  assert.match(result.resolvedReportUrl, /edition=20260724/);
});

test('serves stale data when a refresh fails', async () => {
  let currentTime = 0;
  let shouldFail = false;
  const fetchImpl = async (url) => {
    if (shouldFail) return jsonResponse({}, 429);
    if (url.hostname === 'quote-feed.zacks.com') {
      return jsonResponse({ AAA: { zacks_rank: '1', zacks_rank_text: 'Strong Buy' } });
    }
    if (url.pathname.endsWith('/sp500-constituent')) {
      return jsonResponse([{ symbol: 'AAA', name: 'Alpha' }]);
    }
    return jsonResponse([{ symbol: 'AAA', price: 12, marketCap: 100 }]);
  };
  const service = createMarketDataService({
    provider: 'fmp',
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

test('explains FMP free-plan endpoint restrictions', async () => {
  const service = createMarketDataService({
    provider: 'fmp',
    apiKey: 'free-plan-key',
    fetchImpl: async () => jsonResponse({ message: 'Restricted Endpoint' }, 402),
  });

  await assert.rejects(() => service.getStocks('sp500'), {
    status: 402,
    message: /plan does not include/i,
  });
});

test('parses the official SPY workbook shape without a spreadsheet dependency', () => {
  const sharedStrings = [
    'Name', 'Ticker', 'Weight', 'Sector', 'Alpha &amp; Co', 'AAA', 'Technology',
  ].map((value) => `<si><t>${value}</t></si>`).join('');
  const holdingsRows = Array.from({ length: 400 }, (_, index) =>
    `<row r="${index + 6}"><c r="A${index + 6}" t="s"><v>4</v></c><c r="B${index + 6}" t="s"><v>5</v></c><c r="E${index + 6}"><v>0.25</v></c><c r="F${index + 6}" t="s"><v>6</v></c></row>`
  ).join('');
  const workbook = storedZip({
    'xl/sharedStrings.xml': `<sst>${sharedStrings}</sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="5"><c r="A5" t="s"><v>0</v></c><c r="B5" t="s"><v>1</v></c><c r="E5" t="s"><v>2</v></c><c r="F5" t="s"><v>3</v></c></row>${holdingsRows}</sheetData></worksheet>`,
  });

  const holdings = parseSpyHoldings(workbook);

  assert.equal(holdings.length, 400);
  assert.deepEqual(holdings[0], {
    name: 'Alpha & Co', symbol: 'AAA', weight: 0.25, sector: 'Technology',
  });
});
