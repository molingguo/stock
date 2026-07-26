const ZACKS_FEED_URL = 'https://quote-feed.zacks.com/index.json';
const ZACKS_BATCH_SIZE = 200;
const DEFAULT_ZACKS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_ZACKS_STALE_TTL_MS = 24 * 60 * 60 * 1000;

const RANK_LABELS = {
  1: 'Strong Buy',
  2: 'Buy',
  3: 'Hold',
  4: 'Sell',
  5: 'Strong Sell',
};

function cacheDuration(environmentValue, fallback) {
  const minutes = Number(environmentValue);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : fallback;
}

function createProviderError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/[/-]/g, '.');
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'N/A' || trimmed === 'NULL') return null;
  const parsed = Number(trimmed.replace(/[,$%]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLogoUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'staticx-tuner.zacks.com' ? url.toString() : '';
  } catch {
    return '';
  }
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function createZacksRatingsService({
  fetchImpl = global.fetch,
  now = () => Date.now(),
  cacheTtlMs = cacheDuration(process.env.ZACKS_CACHE_MINUTES, DEFAULT_ZACKS_CACHE_TTL_MS),
  staleTtlMs = cacheDuration(process.env.ZACKS_STALE_MINUTES, DEFAULT_ZACKS_STALE_TTL_MS),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const cache = new Map();
  let inFlight = null;

  function cacheAge(symbol) {
    const entry = cache.get(symbol);
    return entry ? now() - entry.fetchedAt : Infinity;
  }

  function buildResult(symbols, cacheStatus) {
    return {
      cacheStatus,
      ratings: new Map(symbols.map((symbol) => [symbol, cache.get(symbol)?.rating || null])),
      quotes: new Map(symbols.map((symbol) => [symbol, cache.get(symbol)?.quote || null])),
    };
  }

  async function requestBatch(symbols) {
    const url = new URL(ZACKS_FEED_URL);
    url.searchParams.set('t', symbols.join(','));
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; NorthstarMarkets/1.0)',
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      if (response.status === 429) throw createProviderError(429, 'Zacks is rate limiting rating requests.');
      throw createProviderError(502, `Zacks returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      throw createProviderError(502, 'Zacks returned an invalid rating response.');
    }

    const bySymbol = new Map(Object.entries(payload).map(([symbol, value]) => [normalizeSymbol(symbol), value]));
    return new Map(symbols.map((symbol) => {
      const item = bySymbol.get(symbol);
      const rank = Number(item?.zacks_rank);
      const rating = Number.isInteger(rank) && rank >= 1 && rank <= 5
        ? { rank, text: item.zacks_rank_text || RANK_LABELS[rank] }
        : null;
      const quote = item ? {
        name: item.name || item.company_short_name || item.ap_short_name || '',
        logoUrl: normalizeLogoUrl(item.company_logo_url),
        exchange: String(item.source?.sungard?.exchange || '').trim(),
        price: asNumber(item.last),
        change: asNumber(item.net_change),
        changePercentage: asNumber(item.percent_net_change),
        marketCap: asNumber(item.source?.sungard?.market_cap),
        volume: asNumber(item.volume),
        pe: asNumber(item.pe_f1 || item.source?.sungard?.pe_ratio),
        yearLow: asNumber(item.source?.sungard?.yrlow),
        yearHigh: asNumber(item.source?.sungard?.yrhigh),
      } : null;
      return [symbol, { rating, quote }];
    }));
  }

  async function refresh(symbols) {
    const collected = new Map();
    for (const group of chunk(symbols, ZACKS_BATCH_SIZE)) {
      const ratings = await requestBatch(group);
      ratings.forEach((value, symbol) => collected.set(symbol, value));
    }
    const fetchedAt = now();
    collected.forEach(({ rating, quote }, symbol) => cache.set(symbol, { rating, quote, fetchedAt }));
  }

  async function getRatings(rawSymbols) {
    const symbols = [...new Set(rawSymbols.map(normalizeSymbol).filter(Boolean))];
    let missing = symbols.filter((symbol) => cacheAge(symbol) >= cacheTtlMs);
    if (!missing.length) return buildResult(symbols, 'fresh');

    if (inFlight) {
      try {
        await inFlight;
      } catch (error) {
        const canUseStale = symbols.every((symbol) => cacheAge(symbol) < staleTtlMs);
        if (canUseStale) return buildResult(symbols, 'stale');
        throw error;
      }
      missing = symbols.filter((symbol) => cacheAge(symbol) >= cacheTtlMs);
      if (!missing.length) return buildResult(symbols, 'fresh');
    }

    inFlight = refresh(missing);
    try {
      await inFlight;
      return buildResult(symbols, 'refreshed');
    } catch (error) {
      const canUseStale = symbols.every((symbol) => cacheAge(symbol) < staleTtlMs);
      if (canUseStale) return buildResult(symbols, 'stale');
      throw error;
    } finally {
      inFlight = null;
    }
  }

  return { getRatings };
}

module.exports = {
  DEFAULT_ZACKS_CACHE_TTL_MS,
  ZACKS_BATCH_SIZE,
  createZacksRatingsService,
};
