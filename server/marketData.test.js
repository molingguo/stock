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
          ],
        },
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
  const topResult = await service.getStocks('top1000');

  assert.equal(result.count, 1);
  assert.equal(result.stocks[0].symbol, 'AAA');
  assert.equal(result.stocks[0].changePercentage, 2);
  assert.equal(topResult.count, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests.some((request) => request.includes('financialmodelingprep.com')), false);
});

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
  const service = createMarketDataService({ provider: 'fmp', apiKey: 'secret', fetchImpl, now: () => 1000 });

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
  const service = createMarketDataService({ provider: 'fmp', apiKey: 'secret', fetchImpl });

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
