const DEFAULT_REPORT_URL = 'https://www.zacks.com/pfp/report/FD764D21A742A0BDC23DAEC9ECCBD81A/?adid=ZCOM_IYFHOME_7BEST_CHERRY&alert=IYF_HOME_555_A382';
const EDITION_SCRIPT_BASE_URL = 'https://staticx-tuner.zacks.com/woas/adv/services/reports/weekly/best';
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_FALLBACK_SNAPSHOT = Object.freeze({
  edition: '20260724CqKVs2BDXDw30',
  reportDate: '2026-07-24',
  reportUrl: DEFAULT_REPORT_URL,
  resolvedReportUrl: 'https://www.zacks.com/registration/ultimatetrader/welcome/eoffer/3de3?edition=20260724CqKVs2BDXDw30&cid=ec-pfp_conf-pfp_reg_conf-7best-ID01-report_link&',
  symbols: Object.freeze(['C', 'EXPD', 'KRO', 'MTZ', 'MU', 'TSM', 'URBN']),
});

function cacheDuration(environmentValue, fallback) {
  const minutes = Number(environmentValue);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : fallback;
}

function parseEditionUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The Zacks report did not resolve to a valid edition URL.');
  }

  const edition = url.searchParams.get('edition') || '';
  const match = edition.match(/^(\d{4})(\d{2})(\d{2})[A-Za-z0-9]+$/);
  if (!match) throw new Error('The Zacks report URL did not include a dated edition.');

  const [, year, month, day] = match;
  const reportDate = `${year}-${month}-${day}`;
  const parsedDate = new Date(`${reportDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getUTCFullYear() !== Number(year)
    || parsedDate.getUTCMonth() + 1 !== Number(month)
    || parsedDate.getUTCDate() !== Number(day)
  ) {
    throw new Error('The Zacks report URL included an invalid edition date.');
  }

  return { edition, reportDate };
}

function parseReportScript(script) {
  const symbols = [];
  const seen = new Set();
  const tickerPattern = /['"]ticker['"]\s*:\s*['"]([A-Z][A-Z0-9./-]{0,9})['"]/g;
  let match;
  while ((match = tickerPattern.exec(String(script))) !== null) {
    const symbol = match[1].replace(/[/-]/g, '.');
    if (!seen.has(symbol)) {
      seen.add(symbol);
      symbols.push(symbol);
    }
  }
  if (symbols.length !== 7) {
    throw new Error(`The Zacks edition script must contain exactly seven unique tickers; found ${symbols.length}.`);
  }
  return symbols;
}

function findEditionUrl(responseUrl, html) {
  try {
    parseEditionUrl(responseUrl);
    return responseUrl;
  } catch {
    const decoded = String(html || '').replaceAll('&amp;', '&');
    const linkedUrl = decoded.match(/https:\/\/[^\s"'<>]+[?&]edition=[A-Za-z0-9]+[^\s"'<>]*/i)?.[0];
    if (linkedUrl) return linkedUrl;

    const edition = decoded.match(/[?&]edition=([A-Za-z0-9]+)/i)?.[1];
    if (edition) return `https://www.zacks.com/?edition=${edition}`;
    throw new Error('The Zacks report response did not identify its current edition.');
  }
}

function createZacksBestStocksService({
  fetchImpl = global.fetch,
  now = () => Date.now(),
  cacheTtlMs = cacheDuration(process.env.ZACKS_7_BEST_CACHE_MINUTES, DEFAULT_CACHE_TTL_MS),
  reportUrl = process.env.ZACKS_7_BEST_REPORT_URL || DEFAULT_REPORT_URL,
  editionUrl = process.env.ZACKS_7_BEST_EDITION_URL,
  fallbackSnapshot = DEFAULT_FALLBACK_SNAPSHOT,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  let cache = null;
  let inFlight = null;

  async function fetchText(url, options = {}) {
    const response = await fetchImpl(new URL(url), {
      ...options,
      signal: AbortSignal.timeout(12_000),
      headers: {
        Accept: 'text/html,application/javascript;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; NorthstarMarkets/1.0)',
        ...options.headers,
      },
    });
    if (!response.ok) throw new Error(`Zacks returned HTTP ${response.status}.`);
    return { response, text: await response.text() };
  }

  async function loadReport() {
    let resolvedReportUrl = editionUrl;
    if (!resolvedReportUrl) {
      const { response, text } = await fetchText(reportUrl, { redirect: 'follow' });
      resolvedReportUrl = findEditionUrl(response.url, text);
    }

    const { edition, reportDate } = parseEditionUrl(resolvedReportUrl);
    const scriptUrl = `${EDITION_SCRIPT_BASE_URL}/${edition}.js`;
    const { text: script } = await fetchText(scriptUrl, {
      headers: { Referer: resolvedReportUrl },
    });

    return {
      edition,
      reportDate,
      reportUrl,
      resolvedReportUrl,
      symbols: parseReportScript(script),
    };
  }

  async function refresh() {
    try {
      const report = await loadReport();
      cache = { report, fetchedAt: now(), sourceStatus: 'refreshed' };
      return { ...report, symbols: [...report.symbols], cacheStatus: 'refreshed' };
    } catch (error) {
      if (!fallbackSnapshot) throw error;
      const report = {
        ...DEFAULT_FALLBACK_SNAPSHOT,
        ...fallbackSnapshot,
        reportUrl: fallbackSnapshot.reportUrl || reportUrl,
        symbols: [...fallbackSnapshot.symbols],
      };
      parseEditionUrl(report.resolvedReportUrl);
      parseReportScript(report.symbols.map((symbol) => `{'ticker':'${symbol}'}`).join(','));
      cache = { report, fetchedAt: now(), sourceStatus: 'fallback' };
      return { ...report, symbols: [...report.symbols], cacheStatus: 'fallback' };
    }
  }

  async function getReport() {
    if (cache && now() - cache.fetchedAt < cacheTtlMs) {
      return {
        ...cache.report,
        symbols: [...cache.report.symbols],
        cacheStatus: cache.sourceStatus === 'fallback' ? 'fallback' : 'fresh',
      };
    }
    if (inFlight) return inFlight;
    inFlight = refresh().finally(() => { inFlight = null; });
    return inFlight;
  }

  return { getReport };
}

module.exports = {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_FALLBACK_SNAPSHOT,
  DEFAULT_REPORT_URL,
  createZacksBestStocksService,
  parseEditionUrl,
  parseReportScript,
};
