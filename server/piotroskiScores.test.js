const test = require('node:test');
const assert = require('node:assert/strict');
const { createPiotroskiScoresService } = require('./piotroskiScores');
const {
  buildScoreCache,
  calculatePiotroskiScore,
  createFrameRequests,
  latestAnnualYear,
} = require('../scripts/refreshPiotroskiScores');

function completeFacts(overrides = {}) {
  return {
    netIncome: { current: 14, prior: 8 },
    operatingCashFlow: { current: 18 },
    grossProfit: { current: 48, prior: 40 },
    revenue: { current: 100, prior: 90 },
    dilutedShares: { current: 9, prior: 10 },
    assets: { current: 100, prior: 100, baseline: 100 },
    currentAssets: { current: 60, prior: 50 },
    currentLiabilities: { current: 30, prior: 30 },
    longTermDebt: { current: 15, prior: 20 },
    ...overrides,
  };
}

test('calculates a complete nine-signal Piotroski score and rejects partial scores', () => {
  assert.deepEqual(calculatePiotroskiScore(completeFacts()), { score: 9, signals: 9 });
  assert.equal(calculatePiotroskiScore(completeFacts({ grossProfit: { current: null, prior: 40 } })), null);
});

test('builds ticker-keyed scores from SEC frame facts', () => {
  const scoreYear = 2025;
  const values = completeFacts();
  const frames = [];
  const add = (metric, year, value) => frames.push({ metric, year, data: [{ cik: 1234, val: value }] });

  add('netIncome', scoreYear, values.netIncome.current);
  add('netIncome', scoreYear - 1, values.netIncome.prior);
  add('operatingCashFlow', scoreYear, values.operatingCashFlow.current);
  add('grossProfit', scoreYear, values.grossProfit.current);
  add('grossProfit', scoreYear - 1, values.grossProfit.prior);
  add('revenue', scoreYear, values.revenue.current);
  add('revenue', scoreYear - 1, values.revenue.prior);
  add('dilutedShares', scoreYear, values.dilutedShares.current);
  add('dilutedShares', scoreYear - 1, values.dilutedShares.prior);
  add('assets', scoreYear, values.assets.current);
  add('assets', scoreYear - 1, values.assets.prior);
  add('assets', scoreYear - 2, values.assets.baseline);
  add('currentAssets', scoreYear, values.currentAssets.current);
  add('currentAssets', scoreYear - 1, values.currentAssets.prior);
  add('currentLiabilities', scoreYear, values.currentLiabilities.current);
  add('currentLiabilities', scoreYear - 1, values.currentLiabilities.prior);
  add('longTermDebt', scoreYear, values.longTermDebt.current);
  add('longTermDebt', scoreYear - 1, values.longTermDebt.prior);

  const cache = buildScoreCache({
    tickers: { 0: { cik_str: 1234, ticker: 'BRK-B' } },
    frames,
    scoreYear,
    generatedAt: '2026-07-26T12:00:00.000Z',
  });

  assert.deepEqual(cache.scores['BRK.B'], { score: 9, signals: 9 });
  assert.equal(cache.scoreYear, 2025);
});

test('selects the latest broadly filed annual period and bounds SEC request volume', () => {
  assert.equal(latestAnnualYear(new Date('2026-07-26T12:00:00.000Z')), 2025);
  assert.equal(latestAnnualYear(new Date('2026-02-01T12:00:00.000Z')), 2024);
  assert.ok(createFrameRequests(2025).length <= 30);
});

test('serves only valid cached scores without making requests', () => {
  const service = createPiotroskiScoresService({
    cache: {
      generatedAt: '2026-07-26T12:00:00.000Z',
      scoreYear: 2025,
      scores: { 'BRK.B': { score: 7, signals: 9 }, BAD: { score: 10, signals: 9 } },
    },
  });

  assert.deepEqual(service.getScore('brk-b'), { score: 7, signals: 9 });
  assert.equal(service.getScore('BAD'), null);
  assert.deepEqual(service.getMetadata(), {
    generatedAt: '2026-07-26T12:00:00.000Z',
    scoreYear: 2025,
    source: 'SEC company filings',
  });
});
