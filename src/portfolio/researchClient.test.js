import { beforeEach, expect, test, vi } from 'vitest';
import {
  clearPortfolioResearchCache,
  fetchPortfolioResearch,
  portfolioResearchConfig,
} from './researchClient';

beforeEach(() => {
  clearPortfolioResearchCache();
  global.fetch = vi.fn(async (url) => {
    const symbols = new URL(url, 'https://example.test').searchParams.get('symbols').split(',');
    return {
      ok: true,
      json: async () => ({
        stocks: symbols.map((symbol) => ({
          symbol,
          zacksRank: symbol === 'AAPL' ? 2 : null,
          zacksRankText: symbol === 'AAPL' ? 'Buy' : '',
          piotroskiScore: symbol === 'AAPL' ? 8 : null,
          price: 999,
        })),
      }),
    };
  });
});

test('loads normalized symbols once and keeps only research fields', async () => {
  const first = await fetchPortfolioResearch(['msft', 'AAPL', 'AAPL']);
  const second = await fetchPortfolioResearch(['AAPL', 'MSFT']);

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith('/api/stocks?universe=favorites&symbols=AAPL%2CMSFT');
  expect(second).toEqual(first);
  expect(first.AAPL).toEqual({ symbol: 'AAPL', zacksRank: 2, zacksRankText: 'Buy', piotroskiScore: 8 });
  expect(first.AAPL).not.toHaveProperty('price');
});

test('uses sequential API-friendly batches of at most 100 symbols', async () => {
  const symbols = Array.from({ length: 205 }, (_, index) => `S${index}`);
  await fetchPortfolioResearch(symbols);

  expect(global.fetch).toHaveBeenCalledTimes(3);
  global.fetch.mock.calls.forEach(([url]) => {
    expect(new URL(url, 'https://example.test').searchParams.get('symbols').split(',').length)
      .toBeLessThanOrEqual(portfolioResearchConfig.batchSize);
  });
});
