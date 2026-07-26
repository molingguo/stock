const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const QUOTE_BATCH_SIZE = 200;

const UNIVERSES = {
  sp500: { label: 'S&P 500', sourceKey: 'sp500' },
  top500: { label: 'Top 500 U.S.', sourceKey: 'top1000', limit: 500 },
  top1000: { label: 'Top 1000 U.S.', sourceKey: 'top1000', limit: 1000 },
};

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createProviderError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function createMarketDataService({
  apiKey = process.env.FMP_API_KEY,
  fetchImpl = global.fetch,
  now = () => Date.now(),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  staleTtlMs = DEFAULT_STALE_TTL_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }

  const cache = new Map();
  const inFlight = new Map();

  async function request(path, params = {}) {
    if (!apiKey) {
      throw createProviderError(503, 'Market data is not configured. Set FMP_API_KEY on the server.');
    }

    const url = new URL(`${FMP_BASE_URL}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));

    const response = await fetchImpl(url, {
      headers: { apikey: apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw createProviderError(429, 'The market data provider is rate limiting requests.');
      }
      throw createProviderError(502, `The market data provider returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      const providerMessage = payload?.['Error Message'] || payload?.message;
      throw createProviderError(502, providerMessage || 'The market data provider returned an invalid response.');
    }
    return payload;
  }

  async function getQuotes(symbols) {
    const quotes = [];
    for (const group of chunk(symbols, QUOTE_BATCH_SIZE)) {
      const batch = await request('/batch-quote', { symbols: group.join(',') });
      quotes.push(...batch);
    }
    return quotes;
  }

  function normalizeStocks(companies, quotes) {
    const quotesBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));

    return companies
      .map((company) => {
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
      })
      .filter((stock) => stock.symbol && stock.price !== null)
      .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
  }

  async function loadUniverse(sourceKey) {
    if (sourceKey === 'sp500') {
      const companies = await request('/sp500-constituent');
      const quotes = await getQuotes(companies.map((company) => company.symbol));
      return normalizeStocks(companies, quotes);
    }

    const companies = await request('/company-screener', {
      country: 'US',
      isEtf: false,
      isFund: false,
      isActivelyTrading: true,
      includeAllShareClasses: false,
      limit: 1000,
    });
    const sortedCompanies = companies
      .filter((company) => company.symbol && asNumber(company.marketCap) !== null)
      .sort((a, b) => Number(b.marketCap) - Number(a.marketCap))
      .slice(0, 1000);
    const quotes = await getQuotes(sortedCompanies.map((company) => company.symbol));
    return normalizeStocks(sortedCompanies, quotes);
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
      stocks,
    };
  }

  async function refresh(sourceKey) {
    if (inFlight.has(sourceKey)) return inFlight.get(sourceKey);

    const pending = loadUniverse(sourceKey)
      .then((stocks) => {
        const entry = { stocks, fetchedAt: now() };
        cache.set(sourceKey, entry);
        return entry;
      })
      .finally(() => inFlight.delete(sourceKey));

    inFlight.set(sourceKey, pending);
    return pending;
  }

  async function getStocks(universe = 'sp500') {
    const config = UNIVERSES[universe];
    if (!config) {
      throw createProviderError(400, `Unknown universe "${universe}".`);
    }

    const cached = cache.get(config.sourceKey);
    const age = cached ? now() - cached.fetchedAt : Infinity;
    if (age < cacheTtlMs) return buildResponse(universe, cached, 'fresh');

    try {
      const entry = await refresh(config.sourceKey);
      return buildResponse(universe, entry, 'refreshed');
    } catch (error) {
      if (cached && age < staleTtlMs) {
        return buildResponse(universe, cached, 'stale');
      }
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
