const fs = require('node:fs');
const path = require('node:path');

const SEC_BASE_URL = 'https://data.sec.gov/api/xbrl/frames';
const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_HEADERS = {
  Accept: 'application/json',
  'Accept-Encoding': 'gzip, deflate',
  'User-Agent': 'NorthstarMarkets/1.0',
};
const OUTPUT_PATH = path.resolve(__dirname, '..', 'server', 'data', 'piotroskiScores.json');
const REQUESTS_PER_BATCH = 4;
const REQUEST_PAUSE_MS = 150;

const METRICS = {
  netIncome: ['NetIncomeLoss'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  grossProfit: ['GrossProfit'],
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
  ],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
  assets: ['Assets'],
  currentAssets: ['AssetsCurrent'],
  currentLiabilities: ['LiabilitiesCurrent'],
  longTermDebt: [
    'LongTermDebtNoncurrent',
    'LongTermDebtAndFinanceLeaseObligationsNoncurrent',
    'LongTermDebtAndCapitalLeaseObligations',
  ],
};

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/[/-]/g, '.');
}

function latestAnnualYear(date = new Date()) {
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= 3 ? year - 1 : year - 2;
}

function validNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeRatio(numerator, denominator) {
  return validNumber(numerator) && validNumber(denominator) && denominator > 0
    ? numerator / denominator
    : null;
}

function average(left, right) {
  return validNumber(left) && validNumber(right) ? (left + right) / 2 : null;
}

function calculatePiotroskiScore(facts) {
  const currentAverageAssets = average(facts.assets.current, facts.assets.prior);
  const priorAverageAssets = average(facts.assets.prior, facts.assets.baseline);
  const currentRoa = safeRatio(facts.netIncome.current, currentAverageAssets);
  const priorRoa = safeRatio(facts.netIncome.prior, priorAverageAssets);
  const currentLeverage = safeRatio(facts.longTermDebt.current, facts.assets.current);
  const priorLeverage = safeRatio(facts.longTermDebt.prior, facts.assets.prior);
  const currentRatio = safeRatio(facts.currentAssets.current, facts.currentLiabilities.current);
  const priorCurrentRatio = safeRatio(facts.currentAssets.prior, facts.currentLiabilities.prior);
  const currentMargin = safeRatio(facts.grossProfit.current, facts.revenue.current);
  const priorMargin = safeRatio(facts.grossProfit.prior, facts.revenue.prior);
  const currentTurnover = safeRatio(facts.revenue.current, currentAverageAssets);
  const priorTurnover = safeRatio(facts.revenue.prior, priorAverageAssets);

  const checks = {
    positiveReturnOnAssets: currentRoa !== null ? currentRoa > 0 : null,
    positiveOperatingCashFlow: validNumber(facts.operatingCashFlow.current)
      ? facts.operatingCashFlow.current > 0
      : null,
    improvingReturnOnAssets: currentRoa !== null && priorRoa !== null ? currentRoa > priorRoa : null,
    cashFlowExceedsNetIncome: validNumber(facts.operatingCashFlow.current) && validNumber(facts.netIncome.current)
      ? facts.operatingCashFlow.current > facts.netIncome.current
      : null,
    lowerLeverage: currentLeverage !== null && priorLeverage !== null
      ? currentLeverage < priorLeverage
      : null,
    improvingLiquidity: currentRatio !== null && priorCurrentRatio !== null
      ? currentRatio > priorCurrentRatio
      : null,
    noShareDilution: validNumber(facts.dilutedShares.current) && validNumber(facts.dilutedShares.prior)
      ? facts.dilutedShares.current <= facts.dilutedShares.prior
      : null,
    improvingGrossMargin: currentMargin !== null && priorMargin !== null
      ? currentMargin > priorMargin
      : null,
    improvingAssetTurnover: currentTurnover !== null && priorTurnover !== null
      ? currentTurnover > priorTurnover
      : null,
  };
  const values = Object.values(checks);
  if (values.some((value) => value === null)) return null;

  return {
    score: values.filter(Boolean).length,
    signals: values.length,
  };
}

function framePeriod(year, instant = false) {
  return instant ? `CY${year}Q4I` : `CY${year}`;
}

function createFrameRequests(scoreYear) {
  const priorYear = scoreYear - 1;
  const baselineYear = scoreYear - 2;
  const requests = [];

  for (const [metric, concepts] of Object.entries(METRICS)) {
    const instant = ['assets', 'currentAssets', 'currentLiabilities', 'longTermDebt'].includes(metric);
    const years = metric === 'assets' ? [scoreYear, priorYear, baselineYear] : [scoreYear, priorYear];
    for (const concept of concepts) {
      for (const year of years) {
        requests.push({ metric, concept, year, instant, period: framePeriod(year, instant) });
      }
    }
  }
  return requests;
}

async function requestJson(url, fetchImpl = global.fetch, allowNotFound = false) {
  const response = await fetchImpl(url, { headers: SEC_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (allowNotFound && response.status === 404) return {};
  if (!response.ok) throw new Error(`SEC returned HTTP ${response.status} for ${url}.`);
  return response.json();
}

async function fetchFrames(scoreYear, fetchImpl = global.fetch) {
  const requests = createFrameRequests(scoreYear);
  const frames = [];

  for (let index = 0; index < requests.length; index += REQUESTS_PER_BATCH) {
    const batch = requests.slice(index, index + REQUESTS_PER_BATCH);
    const results = await Promise.all(batch.map(async (request) => {
      const unit = request.metric === 'dilutedShares' ? 'shares' : 'USD';
      const url = `${SEC_BASE_URL}/us-gaap/${request.concept}/${unit}/${request.period}.json`;
      const payload = await requestJson(url, fetchImpl, true);
      return { ...request, data: Array.isArray(payload?.data) ? payload.data : [] };
    }));
    frames.push(...results);
    if (index + REQUESTS_PER_BATCH < requests.length) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_PAUSE_MS));
    }
  }
  return frames;
}

function buildFactIndex(frames) {
  const index = new Map();
  for (const frame of frames) {
    for (const fact of frame.data) {
      if (!Number.isInteger(fact.cik) || !validNumber(fact.val)) continue;
      const key = `${fact.cik}:${frame.metric}:${frame.year}`;
      if (!index.has(key)) index.set(key, fact.val);
    }
  }
  return index;
}

function factsForCik(index, cik, scoreYear) {
  const value = (metric, year) => index.get(`${cik}:${metric}:${year}`) ?? null;
  return {
    netIncome: { current: value('netIncome', scoreYear), prior: value('netIncome', scoreYear - 1) },
    operatingCashFlow: { current: value('operatingCashFlow', scoreYear) },
    grossProfit: { current: value('grossProfit', scoreYear), prior: value('grossProfit', scoreYear - 1) },
    revenue: { current: value('revenue', scoreYear), prior: value('revenue', scoreYear - 1) },
    dilutedShares: { current: value('dilutedShares', scoreYear), prior: value('dilutedShares', scoreYear - 1) },
    assets: {
      current: value('assets', scoreYear),
      prior: value('assets', scoreYear - 1),
      baseline: value('assets', scoreYear - 2),
    },
    currentAssets: { current: value('currentAssets', scoreYear), prior: value('currentAssets', scoreYear - 1) },
    currentLiabilities: { current: value('currentLiabilities', scoreYear), prior: value('currentLiabilities', scoreYear - 1) },
    longTermDebt: { current: value('longTermDebt', scoreYear), prior: value('longTermDebt', scoreYear - 1) },
  };
}

function buildScoreCache({ tickers, frames, scoreYear, generatedAt = new Date().toISOString() }) {
  const factIndex = buildFactIndex(frames);
  const scores = {};

  for (const company of Object.values(tickers || {})) {
    const symbol = normalizeSymbol(company?.ticker);
    if (!symbol || !Number.isInteger(company?.cik_str)) continue;
    const result = calculatePiotroskiScore(factsForCik(factIndex, company.cik_str, scoreYear));
    if (result) scores[symbol] = result;
  }

  return {
    version: 1,
    generatedAt,
    scoreYear,
    priorYear: scoreYear - 1,
    source: 'SEC company filings',
    methodology: 'Piotroski F-score calculated from SEC XBRL annual calendar frames; only complete nine-signal scores are published.',
    scores: Object.fromEntries(Object.entries(scores).sort(([left], [right]) => left.localeCompare(right))),
  };
}

async function refreshPiotroskiScores({ fetchImpl = global.fetch, date = new Date(), outputPath = OUTPUT_PATH } = {}) {
  const scoreYear = latestAnnualYear(date);
  const [tickers, frames] = await Promise.all([
    requestJson(SEC_TICKERS_URL, fetchImpl),
    fetchFrames(scoreYear, fetchImpl),
  ]);
  const cache = buildScoreCache({ tickers, frames, scoreYear });
  if (!Object.keys(cache.scores).length) throw new Error('SEC score refresh produced no complete scores.');
  fs.writeFileSync(outputPath, `${JSON.stringify(cache, null, 2)}\n`);
  return cache;
}

if (require.main === module) {
  refreshPiotroskiScores()
    .then((cache) => console.log(`Cached ${Object.keys(cache.scores).length} complete ${cache.scoreYear} Piotroski F-scores from SEC filings.`))
    .catch((error) => {
      if (fs.existsSync(OUTPUT_PATH)) {
        console.warn(`SEC F-score refresh failed; using the checked-in cache: ${error.message}`);
        process.exitCode = 0;
        return;
      }
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  buildScoreCache,
  calculatePiotroskiScore,
  createFrameRequests,
  latestAnnualYear,
  refreshPiotroskiScores,
};
