const { parseSpyHoldings } = require('./spyHoldings');
const { createZacksRatingsService } = require('./zacksRatings');
const { POPULAR_ETFS } = require('./popularEtfs');

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const NASDAQ_SCREENER_URL = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true';
const SPY_HOLDINGS_URL = 'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx';

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const QUOTE_BATCH_SIZE = 200;

const UNIVERSES = {
  sp500: { label: 'S&P 500', sourceKey: 'sp500' },
  popularEtfs: { label: 'Popular ETFs', sourceKey: 'popularEtfs' },
  top1000: { label: 'Top 1000 U.S.', sourceKey: 'top1000', limit: 1000 },
};

function cacheDuration(environmentValue, fallback) {
  const minutes = Number(environmentValue);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : fallback;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed === 'N/A' || trimmed === '--') return null;
  const negative = trimmed.startsWith('(') && trimmed.endsWith(')');
  const parsed = Number(trimmed.replace(/[,$%()]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/[/-]/g, '.');
}

function createProviderError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeNasdaqStock(row, holding) {
  return {
    symbol: holding?.symbol || String(row.symbol || '').trim().toUpperCase(),
    name: row.name || holding?.name || row.symbol,
    sector: holding?.sector && holding.sector !== '-' ? holding.sector : row.sector || 'Other',
    industry: row.industry || '',
    exchange: '',
    price: asNumber(row.lastsale),
    change: asNumber(row.netchange),
    changePercentage: asNumber(row.pctchange),
    marketCap: asNumber(row.marketCap),
    volume: asNumber(row.volume),
    averageVolume: null,
    dayLow: null,
    dayHigh: null,
    yearLow: null,
    yearHigh: null,
    pe: null,
  };
}

function createPopularEtfRows() {
  return POPULAR_ETFS.map(({ symbol, category }) => ({
    symbol,
    name: symbol,
    sector: category,
    industry: 'Exchange-traded fund',
    exchange: '',
    price: null,
    change: null,
    changePercentage: null,
    marketCap: null,
    volume: null,
    averageVolume: null,
    dayLow: null,
    dayHigh: null,
    yearLow: null,
    yearHigh: null,
    pe: null,
  }));
}

function createMarketDataService({
  provider = process.env.MARKET_DATA_PROVIDER || 'public',
  apiKey = process.env.FMP_API_KEY,
  fetchImpl = global.fetch,
  parseHoldings = parseSpyHoldings,
  now = () => Date.now(),
  cacheTtlMs = cacheDuration(process.env.MARKET_CACHE_MINUTES, DEFAULT_CACHE_TTL_MS),
  staleTtlMs = cacheDuration(process.env.MARKET_STALE_MINUTES, DEFAULT_STALE_TTL_MS),
  ratingsService,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  if (!['public', 'fmp'].includes(provider)) {
    throw new Error('MARKET_DATA_PROVIDER must be either "public" or "fmp".');
  }

  const cache = new Map();
  const inFlight = new Map();
  const resourceCache = new Map();
  const resourceInFlight = new Map();
  const zacksRatings = ratingsService || createZacksRatingsService({ fetchImpl, now });

  async function fetchWithTimeout(url, options = {}) {
    return fetchImpl(url, { ...options, signal: AbortSignal.timeout(12_000) });
  }

  async function requestFmp(path, params = {}) {
    if (!apiKey) throw createProviderError(503, 'FMP is selected but FMP_API_KEY is not configured.');

    const url = new URL(`${FMP_BASE_URL}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const response = await fetchWithTimeout(url, { headers: { apikey: apiKey, Accept: 'application/json' } });

    if (!response.ok) {
      if (response.status === 402) {
        throw createProviderError(402, 'Your FMP plan does not include the constituent or batch-quote endpoints; use the default public provider or upgrade FMP.');
      }
      if (response.status === 429) throw createProviderError(429, 'FMP is rate limiting requests.');
      throw createProviderError(502, `FMP returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      const providerMessage = payload?.['Error Message'] || payload?.message;
      throw createProviderError(502, providerMessage || 'FMP returned an invalid response.');
    }
    return payload;
  }

  async function requestNasdaq() {
    const url = new URL(NASDAQ_SCREENER_URL);
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://www.nasdaq.com',
        Referer: 'https://www.nasdaq.com/market-activity/stocks/screener',
        'User-Agent': 'Mozilla/5.0 (compatible; NorthstarMarkets/1.0)',
      },
    });
    if (!response.ok) {
      if (response.status === 429) throw createProviderError(429, 'Nasdaq is rate limiting market data requests.');
      throw createProviderError(502, `Nasdaq returned HTTP ${response.status}.`);
    }
    const payload = await response.json();
    const rows = payload?.data?.rows || payload?.data?.table?.rows;
    if (!Array.isArray(rows)) throw createProviderError(502, 'Nasdaq returned an invalid stock screener response.');
    return rows;
  }

  async function requestSpyHoldings() {
    const response = await fetchWithTimeout(new URL(SPY_HOLDINGS_URL), {
      headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    });
    if (!response.ok) throw createProviderError(502, `State Street returned HTTP ${response.status}.`);
    try {
      return parseHoldings(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      throw createProviderError(502, `State Street returned an unreadable SPY holdings workbook: ${error.message}`);
    }
  }

  async function getResource(key, loader) {
    const cached = resourceCache.get(key);
    const age = cached ? now() - cached.fetchedAt : Infinity;
    if (age < cacheTtlMs) return cached.value;
    if (resourceInFlight.has(key)) return resourceInFlight.get(key);

    const pending = loader()
      .then((value) => {
        resourceCache.set(key, { value, fetchedAt: now() });
        return value;
      })
      .catch((error) => {
        if (cached && age < staleTtlMs) return cached.value;
        throw error;
      })
      .finally(() => resourceInFlight.delete(key));
    resourceInFlight.set(key, pending);
    return pending;
  }

  async function getFmpQuotes(symbols) {
    const quotes = [];
    for (const group of chunk(symbols, QUOTE_BATCH_SIZE)) {
      const batch = await requestFmp('/batch-quote', { symbols: group.join(',') });
      quotes.push(...batch);
    }
    return quotes;
  }

  function normalizeFmpStocks(companies, quotes) {
    const quotesBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
    return companies.map((company) => {
      const quote = quotesBySymbol.get(company.symbol) || {};
      return {
        symbol: company.symbol,
        name: quote.name || company.name || company.companyName || company.symbol,
        sector: company.sector || 'Other',
        industry: company.subSector || company.industry || '',
        exchange: quote.exchange || company.exchangeShortName || company.exchange || '',
        price: asNumber(quote.price ?? company.price),
        change: asNumber(quote.change),
        changePercentage: asNumber(quote.changePercentage ?? quote.changesPercentage),
        marketCap: asNumber(quote.marketCap ?? company.marketCap),
        volume: asNumber(quote.volume ?? company.volume),
        averageVolume: asNumber(quote.avgVolume),
        dayLow: asNumber(quote.dayLow),
        dayHigh: asNumber(quote.dayHigh),
        yearLow: asNumber(quote.yearLow),
        yearHigh: asNumber(quote.yearHigh),
        pe: asNumber(quote.pe),
      };
    }).filter((stock) => stock.symbol && stock.price !== null)
      .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
  }

  async function loadFmpUniverse(sourceKey) {
    if (sourceKey === 'popularEtfs') return createPopularEtfRows();
    if (sourceKey === 'sp500') {
      const companies = await requestFmp('/sp500-constituent');
      return normalizeFmpStocks(companies, await getFmpQuotes(companies.map((company) => company.symbol)));
    }
    const companies = await requestFmp('/company-screener', {
      country: 'US', isEtf: false, isFund: false, isActivelyTrading: true,
      includeAllShareClasses: false, limit: 1000,
    });
    const sorted = companies.filter((company) => company.symbol && asNumber(company.marketCap) !== null)
      .sort((a, b) => Number(b.marketCap) - Number(a.marketCap)).slice(0, 1000);
    return normalizeFmpStocks(sorted, await getFmpQuotes(sorted.map((company) => company.symbol)));
  }

  async function loadPublicUniverse(sourceKey) {
    if (sourceKey === 'popularEtfs') return createPopularEtfRows();
    const rows = await getResource('nasdaq', requestNasdaq);
    if (sourceKey === 'top1000') {
      return rows.filter((row) => row.country === 'United States')
        .map((row) => normalizeNasdaqStock(row))
        .filter((stock) => stock.symbol && stock.price !== null && stock.marketCap !== null)
        .sort((a, b) => b.marketCap - a.marketCap)
        .slice(0, 1000);
    }

    const holdings = await getResource('spyHoldings', requestSpyHoldings);
    const rowsBySymbol = new Map(rows.map((row) => [normalizeSymbol(row.symbol), row]));
    const stocks = holdings.map((holding) => {
      const row = rowsBySymbol.get(normalizeSymbol(holding.symbol));
      return row ? normalizeNasdaqStock(row, holding) : null;
    }).filter((stock) => stock && stock.price !== null)
      .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));

    if (holdings.length >= 400 && stocks.length < holdings.length * 0.9) {
      throw createProviderError(502, 'Too few SPY holdings matched Nasdaq quotes.');
    }
    return stocks;
  }

  function buildResponse(universe, entry, cacheStatus) {
    const config = UNIVERSES[universe];
    const stocks = config.limit ? entry.stocks.slice(0, config.limit) : entry.stocks;
    return {
      universe,
      label: config.label,
      count: stocks.length,
      asOf: new Date(entry.fetchedAt).toISOString(),
      refreshAfter: new Date(entry.fetchedAt + cacheTtlMs).toISOString(),
      cacheStatus,
      ratingsCacheStatus: entry.ratingsCacheStatus,
      zacksCoverage: stocks.filter((stock) => stock.zacksRank !== null).length,
      sources: universe === 'popularEtfs'
        ? ['Zacks']
        : provider === 'fmp'
          ? ['Financial Modeling Prep', 'Zacks']
          : universe === 'sp500' ? ['Nasdaq', 'State Street SPY holdings', 'Zacks'] : ['Nasdaq', 'Zacks'],
      stocks,
    };
  }

  async function enrichWithZacks(stocks) {
    const result = await zacksRatings.getRatings(stocks.map((stock) => stock.symbol));
    return {
      ratingsCacheStatus: result.cacheStatus,
      stocks: stocks.map((stock) => {
        const rating = result.ratings.get(normalizeSymbol(stock.symbol));
        const quote = result.quotes.get(normalizeSymbol(stock.symbol));
        return {
          ...stock,
          name: quote?.name || stock.name,
          price: stock.price ?? quote?.price ?? null,
          change: stock.change ?? quote?.change ?? null,
          changePercentage: stock.changePercentage ?? quote?.changePercentage ?? null,
          marketCap: stock.marketCap ?? quote?.marketCap ?? null,
          volume: stock.volume ?? quote?.volume ?? null,
          pe: stock.pe ?? quote?.pe ?? null,
          zacksRank: rating?.rank || null,
          zacksRankText: rating?.text || '',
        };
      }),
    };
  }

  async function refresh(sourceKey) {
    if (inFlight.has(sourceKey)) return inFlight.get(sourceKey);
    const loader = provider === 'fmp' ? loadFmpUniverse : loadPublicUniverse;
    const pending = loader(sourceKey)
      .then(enrichWithZacks)
      .then(({ stocks, ratingsCacheStatus }) => {
        const normalizedStocks = sourceKey === 'popularEtfs'
          ? stocks.filter((stock) => stock.price !== null)
            .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0) || (b.volume || 0) - (a.volume || 0))
          : stocks;
        const entry = { stocks: normalizedStocks, ratingsCacheStatus, fetchedAt: now() };
        cache.set(sourceKey, entry);
        return entry;
      })
      .finally(() => inFlight.delete(sourceKey));
    inFlight.set(sourceKey, pending);
    return pending;
  }

  async function getStocks(universe = 'sp500') {
    const config = UNIVERSES[universe];
    if (!config) throw createProviderError(400, `Unknown universe "${universe}".`);

    const cached = cache.get(config.sourceKey);
    const age = cached ? now() - cached.fetchedAt : Infinity;
    if (age < cacheTtlMs) return buildResponse(universe, cached, 'fresh');
    try {
      return buildResponse(universe, await refresh(config.sourceKey), 'refreshed');
    } catch (error) {
      if (cached && age < staleTtlMs) return buildResponse(universe, cached, 'stale');
      throw error;
    }
  }

  return { getStocks };
}

module.exports = {
  DEFAULT_CACHE_TTL_MS,
  UNIVERSES,
  createMarketDataService,
};
