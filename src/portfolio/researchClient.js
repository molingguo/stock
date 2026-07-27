const RESEARCH_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const RESEARCH_BATCH_SIZE = 100;
const researchCache = new Map();
const pendingBatches = new Map();

function normalizeResearchSymbols(symbols) {
  return [...new Set(symbols
    .map((symbol) => String(symbol || '').trim().toUpperCase().replace(/[/-]/g, '.'))
    .filter((symbol) => /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)))]
    .sort();
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function fetchBatch(symbols) {
  const key = symbols.join(',');
  if (pendingBatches.has(key)) return pendingBatches.get(key);
  const pending = fetch(`/api/stocks?universe=favorites&symbols=${encodeURIComponent(key)}`)
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load portfolio research ratings.');
      const cachedAt = Date.now();
      symbols.forEach((symbol) => researchCache.set(symbol, {
        cachedAt,
        value: { symbol, zacksRank: null, zacksRankText: '', piotroskiScore: null },
      }));
      payload.stocks.forEach((stock) => researchCache.set(stock.symbol, {
        cachedAt,
        value: {
          symbol: stock.symbol,
          zacksRank: Number.isInteger(stock.zacksRank) ? stock.zacksRank : null,
          zacksRankText: stock.zacksRankText || '',
          piotroskiScore: Number.isInteger(stock.piotroskiScore) ? stock.piotroskiScore : null,
        },
      }));
      return payload.stocks;
    })
    .finally(() => pendingBatches.delete(key));
  pendingBatches.set(key, pending);
  return pending;
}

export async function fetchPortfolioResearch(symbols, { force = false } = {}) {
  const normalized = normalizeResearchSymbols(symbols);
  const now = Date.now();
  const missing = normalized.filter((symbol) => {
    const cached = researchCache.get(symbol);
    return force || !cached || now - cached.cachedAt >= RESEARCH_CACHE_TTL_MS;
  });
  for (const batch of chunk(missing, RESEARCH_BATCH_SIZE)) await fetchBatch(batch);
  return Object.fromEntries(normalized.map((symbol) => [symbol, researchCache.get(symbol)?.value || {
    symbol, zacksRank: null, zacksRankText: '', piotroskiScore: null,
  }]));
}

export function clearPortfolioResearchCache() {
  researchCache.clear();
  pendingBatches.clear();
}

export const portfolioResearchConfig = {
  batchSize: RESEARCH_BATCH_SIZE,
  cacheTtlMs: RESEARCH_CACHE_TTL_MS,
};
