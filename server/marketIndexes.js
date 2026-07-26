const ZACKS_FEED_URL = 'https://quote-feed.zacks.com/index.json';
const DEFAULT_INDEX_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_INDEX_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const INDEXES = {
  sp500: { symbol: 'SPX', name: 'S&P 500' },
  nasdaq: { symbol: 'COMPX', name: 'Nasdaq Composite' },
};

function cacheDuration(environmentValue, fallback) {
  const minutes = Number(environmentValue);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : fallback;
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.trim().replace(/[,$%]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyIndexes() {
  return Object.fromEntries(Object.entries(INDEXES).map(([key, index]) => [key, {
    ...index,
    price: null,
    change: null,
    changePercentage: null,
  }]));
}

function createMarketIndexesService({
  fetchImpl = global.fetch,
  now = () => Date.now(),
  cacheTtlMs = cacheDuration(process.env.INDEX_CACHE_MINUTES, DEFAULT_INDEX_CACHE_TTL_MS),
  staleTtlMs = cacheDuration(process.env.INDEX_STALE_MINUTES, DEFAULT_INDEX_STALE_TTL_MS),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  let cache = null;
  let inFlight = null;

  async function requestIndexes() {
    const url = new URL(ZACKS_FEED_URL);
    url.searchParams.set('t', Object.values(INDEXES).map((index) => index.symbol).join(','));
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; NorthstarMarkets/1.0)',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Index quote provider returned HTTP ${response.status}.`);

    const payload = await response.json();
    const indexes = emptyIndexes();
    for (const [key, config] of Object.entries(INDEXES)) {
      const quote = payload?.[config.symbol];
      indexes[key] = {
        symbol: config.symbol,
        name: quote?.name || config.name,
        price: asNumber(quote?.last),
        change: asNumber(quote?.net_change),
        changePercentage: asNumber(quote?.percent_net_change),
      };
    }
    if (Object.values(indexes).every((index) => index.price === null)) {
      throw new Error('Index quote provider returned no usable index data.');
    }
    return indexes;
  }

  async function getIndexes() {
    const age = cache ? now() - cache.fetchedAt : Infinity;
    if (age < cacheTtlMs) return { indexes: cache.indexes, cacheStatus: 'fresh' };
    if (inFlight) return inFlight;

    inFlight = requestIndexes()
      .then((indexes) => {
        cache = { indexes, fetchedAt: now() };
        return { indexes, cacheStatus: 'refreshed' };
      })
      .catch((error) => {
        if (cache && age < staleTtlMs) return { indexes: cache.indexes, cacheStatus: 'stale' };
        throw error;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  return { getIndexes };
}

module.exports = {
  DEFAULT_INDEX_CACHE_TTL_MS,
  INDEXES,
  createMarketIndexesService,
  emptyIndexes,
};
