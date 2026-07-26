const { POPULAR_ETFS } = require('./popularEtfs');

const ALPHA_VANTAGE_URL = 'https://www.alphavantage.co/query';
const DEFAULT_ETF_HOLDINGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ETF_HOLDINGS_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SUPPORTED_ETFS = new Set(POPULAR_ETFS.map(({ symbol }) => symbol));

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
  return String(symbol || '').trim().toUpperCase();
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || ['NONE', 'N/A', '-', '--'].includes(trimmed.toUpperCase())) return null;
  const parsed = Number(trimmed.replace(/[,$%]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function asPercentage(value) {
  const parsed = asNumber(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.abs(parsed) <= 1 ? Number((parsed * 100).toFixed(10)) : parsed;
}

function normalizeHolding(item, index) {
  const symbol = normalizeSymbol(item?.symbol || item?.ticker);
  const name = String(item?.description || item?.name || item?.security_description || symbol || `Holding ${index + 1}`).trim();
  const weight = asPercentage(item?.weight ?? item?.weight_percentage ?? item?.percentage);
  const assetType = String(item?.asset_type || item?.asset_class || item?.type || (symbol ? 'Equity' : 'Other')).trim();
  const sector = String(item?.sector || '').trim();
  return { symbol, name, weight, assetType, sector };
}

function normalizeSector(item) {
  return {
    name: String(item?.sector || item?.name || '').trim(),
    weight: asPercentage(item?.weight ?? item?.percentage),
  };
}

function normalizeProfile(symbol, payload, retrievedAt) {
  const holdings = Array.isArray(payload?.holdings)
    ? payload.holdings.map(normalizeHolding).filter((holding) => holding.name && Number.isFinite(holding.weight))
      .sort((left, right) => right.weight - left.weight)
    : [];
  if (!holdings.length) throw createProviderError(502, 'Alpha Vantage returned no ETF holdings.');

  const sectors = Array.isArray(payload?.sectors)
    ? payload.sectors.map(normalizeSector).filter((sector) => sector.name && Number.isFinite(sector.weight))
      .sort((left, right) => right.weight - left.weight)
    : [];

  return {
    symbol,
    name: String(payload?.name || payload?.fund_name || symbol).trim(),
    description: String(payload?.description || '').trim(),
    netAssets: asNumber(payload?.net_assets),
    expenseRatio: asPercentage(payload?.net_expense_ratio ?? payload?.expense_ratio),
    portfolioTurnover: asPercentage(payload?.portfolio_turnover),
    dividendYield: asPercentage(payload?.dividend_yield),
    leveraged: String(payload?.leveraged || '').trim(),
    inceptionDate: String(payload?.inception_date || '').trim(),
    asOf: String(payload?.as_of_date || payload?.last_updated || payload?.latest_update || '').trim(),
    retrievedAt: new Date(retrievedAt).toISOString(),
    provider: 'Alpha Vantage',
    count: holdings.length,
    sectors,
    holdings,
  };
}

function createEtfHoldingsService({
  apiKey = process.env.ALPHA_VANTAGE_API_KEY,
  fetchImpl = global.fetch,
  now = () => Date.now(),
  cacheTtlMs = cacheDuration(process.env.ETF_HOLDINGS_CACHE_MINUTES, DEFAULT_ETF_HOLDINGS_CACHE_TTL_MS),
  staleTtlMs = cacheDuration(process.env.ETF_HOLDINGS_STALE_MINUTES, DEFAULT_ETF_HOLDINGS_STALE_TTL_MS),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const cache = new Map();
  const inFlight = new Map();

  function cachedResult(symbol, cacheStatus) {
    return { ...cache.get(symbol).profile, cacheStatus };
  }

  async function requestProfile(symbol) {
    if (!apiKey) {
      throw createProviderError(503, 'ETF holdings require ALPHA_VANTAGE_API_KEY on the server.');
    }

    const url = new URL(ALPHA_VANTAGE_URL);
    url.searchParams.set('function', 'ETF_PROFILE');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('apikey', apiKey);
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; NorthstarMarkets/1.0)',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      if (response.status === 429) throw createProviderError(429, 'Alpha Vantage is rate limiting ETF holdings requests.');
      throw createProviderError(502, `Alpha Vantage returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const providerMessage = payload?.Note || payload?.Information;
    if (providerMessage) throw createProviderError(429, providerMessage);
    if (payload?.['Error Message']) throw createProviderError(502, payload['Error Message']);
    return normalizeProfile(symbol, payload, now());
  }

  async function getHoldings(rawSymbol) {
    const symbol = normalizeSymbol(rawSymbol);
    if (!SUPPORTED_ETFS.has(symbol)) throw createProviderError(400, `Unsupported ETF symbol "${symbol || rawSymbol}".`);

    const cached = cache.get(symbol);
    const age = cached ? now() - cached.fetchedAt : Infinity;
    if (age < cacheTtlMs) return cachedResult(symbol, 'fresh');
    if (inFlight.has(symbol)) return inFlight.get(symbol);

    const pending = requestProfile(symbol)
      .then((profile) => {
        cache.set(symbol, { profile, fetchedAt: now() });
        return { ...profile, cacheStatus: 'refreshed' };
      })
      .catch((error) => {
        if (cached && age < staleTtlMs) return cachedResult(symbol, 'stale');
        throw error;
      })
      .finally(() => inFlight.delete(symbol));
    inFlight.set(symbol, pending);
    return pending;
  }

  return { getHoldings };
}

module.exports = {
  ALPHA_VANTAGE_URL,
  DEFAULT_ETF_HOLDINGS_CACHE_TTL_MS,
  DEFAULT_ETF_HOLDINGS_STALE_TTL_MS,
  SUPPORTED_ETFS,
  createEtfHoldingsService,
  normalizeProfile,
};
