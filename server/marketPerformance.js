const { createMassiveApiKeyResolver } = require('./massiveApiKey');

const MASSIVE_BASE_URL = 'https://api.massive.com';
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PERIODS = Object.freeze([
  { field: 'change7Day', days: 7 },
  { field: 'change30Day', days: 30 },
  { field: 'change1Year', years: 1 },
]);

function cacheDuration(environmentValue, fallback) {
  const minutes = Number(environmentValue);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : fallback;
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/[/-]/g, '.');
}

function previousWeekday(date) {
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date;
}

function performanceDate(timestamp, period) {
  const date = new Date(timestamp);
  date.setUTCHours(0, 0, 0, 0);
  if (period.years) date.setUTCFullYear(date.getUTCFullYear() - period.years);
  if (period.days) date.setUTCDate(date.getUTCDate() - period.days);
  return previousWeekday(date).toISOString().slice(0, 10);
}

function percentageChange(currentPrice, previousPrice) {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(previousPrice) || previousPrice <= 0) return null;
  return ((currentPrice - previousPrice) / previousPrice) * 100;
}

function emptyChanges(symbols) {
  return new Map(symbols.map((symbol) => [symbol, {
    change7Day: null,
    change30Day: null,
    change1Year: null,
  }]));
}

function createMarketPerformanceService({
  fetchImpl = global.fetch,
  now = () => Date.now(),
  resolveApiKey = createMassiveApiKeyResolver(),
  cacheTtlMs = cacheDuration(process.env.MARKET_PERFORMANCE_CACHE_MINUTES, DEFAULT_CACHE_TTL_MS),
  staleTtlMs = cacheDuration(process.env.MARKET_PERFORMANCE_STALE_MINUTES, DEFAULT_STALE_TTL_MS),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const cache = new Map();
  const inFlight = new Map();

  async function requestSnapshot(date, apiKey) {
    const url = new URL(`/v2/aggs/grouped/locale/us/market/stocks/${date}`, MASSIVE_BASE_URL);
    url.searchParams.set('adjusted', 'true');
    url.searchParams.set('include_otc', 'false');
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Massive rejected the configured API key.');
      }
      if (response.status === 429) throw new Error('Massive is rate limiting performance requests.');
      throw new Error(`Massive returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.results)) throw new Error('Massive returned an invalid daily market summary.');
    return new Map(payload.results
      .filter((item) => item?.T && Number.isFinite(item.c))
      .map((item) => [normalizeSymbol(item.T), item.c]));
  }

  async function getSnapshot(date, apiKey) {
    const cached = cache.get(date);
    const age = cached ? now() - cached.fetchedAt : Infinity;
    if (age < cacheTtlMs) return { prices: cached.prices, cacheStatus: 'fresh' };
    if (inFlight.has(date)) return inFlight.get(date);

    const pending = requestSnapshot(date, apiKey)
      .then((prices) => {
        cache.set(date, { prices, fetchedAt: now() });
        return { prices, cacheStatus: 'refreshed' };
      })
      .catch((error) => {
        if (cached && age < staleTtlMs) return { prices: cached.prices, cacheStatus: 'stale' };
        throw error;
      })
      .finally(() => inFlight.delete(date));
    inFlight.set(date, pending);
    return pending;
  }

  async function getPerformance(stocks) {
    const symbols = [...new Set(stocks.map((stock) => normalizeSymbol(stock.symbol)).filter(Boolean))];
    const changes = emptyChanges(symbols);
    const dates = Object.fromEntries(PERIODS.map((period) => [period.field, performanceDate(now(), period)]));

    let apiKey;
    try {
      apiKey = await resolveApiKey();
    } catch {
      return { changes, dates, cacheStatus: 'unavailable' };
    }
    if (!apiKey) return { changes, dates, cacheStatus: 'unconfigured' };

    const results = await Promise.allSettled(PERIODS.map(async (period) => ({
      period,
      ...await getSnapshot(dates[period.field], apiKey),
    })));

    stocks.forEach((stock) => {
      const symbol = normalizeSymbol(stock.symbol);
      const values = changes.get(symbol);
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          values[result.value.period.field] = percentageChange(
            stock.price,
            result.value.prices.get(symbol)
          );
        }
      });
    });

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const statuses = fulfilled.map((result) => result.value.cacheStatus);
    const cacheStatus = !fulfilled.length
      ? 'unavailable'
      : fulfilled.length < PERIODS.length
        ? 'partial'
        : statuses.includes('refreshed')
          ? 'refreshed'
          : statuses.includes('stale') ? 'stale' : 'fresh';

    return { changes, dates, cacheStatus };
  }

  return { getPerformance };
}

module.exports = {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_STALE_TTL_MS,
  PERIODS,
  createMarketPerformanceService,
  performanceDate,
  percentageChange,
};
