import React from 'react';
import { zhCN as muiZhCN } from '@mui/x-data-grid/locales';
import {
  CHINESE_LOCALE,
  DEFAULT_LOCALE,
  createTranslator,
  localeFromPathname,
  pathForLocale,
  translateMarketTerm,
  translateUniverseLabel,
} from './i18n';

const DataGrid = React.lazy(() =>
  import('@mui/x-data-grid').then((module) => ({ default: module.DataGrid }))
);

const CLIENT_CACHE_TTL_MS = 60_000;
const ZACKS_REPORT_HISTORY_KEY = 'northstar:zacks-best-history:v1';
const FAVORITE_SYMBOLS_KEY = 'northstar:favorite-symbols:v1';
const MAX_ZACKS_REPORTS = 8;
const MAX_FAVORITES = 100;
const responseCache = new Map();
const pendingRequests = new Map();

const I18nContext = React.createContext({
  locale: DEFAULT_LOCALE,
  t: createTranslator(DEFAULT_LOCALE),
});

function useI18n() {
  return React.useContext(I18nContext);
}

function useUrlLocale() {
  const [locale, setLocale] = React.useState(
    () => typeof window === 'undefined' ? DEFAULT_LOCALE : localeFromPathname(window.location.pathname)
  );

  React.useEffect(() => {
    document.documentElement.lang = locale;
    const currentPath = window.location.pathname;
    if (/^\/zh_cn(?:\/|$)/i.test(currentPath)) {
      window.history.replaceState(window.history.state, '', `${pathForLocale(CHINESE_LOCALE, currentPath)}${window.location.search}${window.location.hash}`);
    }
  }, [locale]);

  React.useEffect(() => {
    const syncLocale = () => setLocale(localeFromPathname(window.location.pathname));
    window.addEventListener('popstate', syncLocale);
    return () => window.removeEventListener('popstate', syncLocale);
  }, []);

  const changeLocale = React.useCallback((nextLocale) => {
    const nextPath = pathForLocale(nextLocale, window.location.pathname);
    window.history.pushState({ ...window.history.state, locale: nextLocale }, '', `${nextPath}${window.location.search}${window.location.hash}`);
    setLocale(nextLocale);
  }, []);

  return [locale, changeLocale];
}

const universeOptions = [
  { value: 'sp500', label: 'S&P 500', description: 'Index constituents' },
  { value: 'popularEtfs', label: 'Popular ETFs', description: 'By current fund assets' },
  { value: 'extendedMarket', label: 'Extended Market', description: 'Top 1,000 beyond S&P 500' },
  { value: 'zacksBest', label: '7 Best Stocks', description: 'Weekly 30-day picks' },
  { value: 'favorites', label: 'Favorites', description: 'Saved in this browser' },
];

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const indexLevelFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const zhDataGridLocaleText = muiZhCN.components.MuiDataGrid.defaultProps.localeText;

function formatCurrency(value) {
  return Number.isFinite(value) ? currencyFormatter.format(value) : '—';
}

function formatCompactCurrency(value) {
  return Number.isFinite(value) ? compactCurrencyFormatter.format(value) : '—';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '—';
}

function indexCardDetail(index, t) {
  return Number.isFinite(index?.price)
    ? t('summary.indexLevel', { value: indexLevelFormatter.format(index.price) })
    : t('summary.indexUnavailable');
}

function stockRank(stock, allStocks) {
  return stock.marketRank ?? stock.listRank ?? allStocks.findIndex((item) => item.symbol === stock.symbol) + 1;
}

function yearRangePosition(stock) {
  return Number.isFinite(stock.yearLow) && Number.isFinite(stock.yearHigh)
    && stock.yearHigh > stock.yearLow && Number.isFinite(stock.price)
    ? (stock.price - stock.yearLow) / (stock.yearHigh - stock.yearLow)
    : null;
}

function stockSortValue(stock, field, allStocks) {
  if (field === 'rank') return stockRank(stock, allStocks);
  if (field === 'yearRangePosition') return yearRangePosition(stock);
  return stock[field] ?? null;
}

export function sortStocksForExport(rows, sortModel, allStocks = rows) {
  if (!sortModel?.length) return [...rows];
  return rows.map((stock, index) => ({ stock, index })).sort((left, right) => {
    for (const rule of sortModel) {
      const leftValue = stockSortValue(left.stock, rule.field, allStocks);
      const rightValue = stockSortValue(right.stock, rule.field, allStocks);
      const leftMissing = leftValue === null || leftValue === '';
      const rightMissing = rightValue === null || rightValue === '';
      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) continue;
        return leftMissing ? 1 : -1;
      }
      const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), 'en-US', { numeric: true, sensitivity: 'base' });
      if (comparison) return rule.sort === 'desc' ? -comparison : comparison;
    }
    return left.index - right.index;
  }).map(({ stock }) => stock);
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function createStockCsv(rows, { isEtf = false, allStocks = rows, locale = DEFAULT_LOCALE } = {}) {
  const t = createTranslator(locale);
  const headers = [
    t('csv.rank'), isEtf ? t('csv.fund') : t('csv.ticker'), t('csv.name'), t('csv.price'), t('csv.dayChange'),
    t('csv.zacksRank'), t('csv.zacksRating'), isEtf ? t('csv.fundAssets') : t('csv.marketCap'),
    isEtf ? t('csv.category') : t('csv.sector'),
    ...(!isEtf ? [t('csv.fScore'), t('csv.pe')] : []),
    t('csv.yearLow'), t('csv.yearHigh'), t('csv.yearPosition'),
  ];
  const values = rows.map((stock) => [
    stockRank(stock, allStocks), stock.symbol, stock.name, stock.price, stock.changePercentage,
    stock.zacksRank, stock.zacksRankText, stock.marketCap, stock.sector,
    ...(!isEtf ? [stock.piotroskiScore, stock.pe] : []),
    stock.yearLow, stock.yearHigh,
    Number.isFinite(yearRangePosition(stock)) ? (yearRangePosition(stock) * 100).toFixed(2) : null,
  ]);
  return `\uFEFF${[headers, ...values].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}\r\n`;
}

function downloadCsv(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatUpdatedAt(value, locale, t) {
  if (!value) return t('panel.waiting');
  const date = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
  return t('panel.updated', { date });
}

function formatReportDate(value, locale = DEFAULT_LOCALE) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function stockDetailUrl(symbol) {
  const yahooSymbol = String(symbol || '').trim().toUpperCase().replaceAll('.', '-');
  return `https://finance.yahoo.com/quote/${encodeURIComponent(yahooSymbol)}/`;
}

function zacksDetailUrl(symbol) {
  return `https://www.zacks.com/stock/quote/${encodeURIComponent(String(symbol || '').trim().toUpperCase())}`;
}

function piotroskiDetailUrl(symbol) {
  const stockAnalysisSymbol = String(symbol || '').trim().toLowerCase();
  return `https://stockanalysis.com/stocks/${encodeURIComponent(stockAnalysisSymbol)}/statistics/`;
}

function tradingViewSymbol(stock) {
  const exchange = String(stock?.exchange || '').trim().toUpperCase();
  const exchangePrefix = exchange.includes('NASDAQ') || exchange === 'NSDQ'
    ? 'NASDAQ'
    : exchange.includes('NYSE')
      ? 'NYSE'
      : exchange.includes('AMEX') || exchange.includes('ARCA')
        ? 'AMEX'
        : '';
  const symbol = String(stock?.symbol || '').trim().toUpperCase();
  return exchangePrefix ? `${exchangePrefix}:${symbol}` : symbol;
}

function loadZacksReportHistory() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ZACKS_REPORT_HISTORY_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((report) => (
      /^\d{4}-\d{2}-\d{2}$/.test(report?.reportDate || '')
      && Array.isArray(report?.stocks)
      && report.stocks.length === 7
      && report.stocks.every((stock) => typeof stock?.symbol === 'string' && stock.symbol)
    )).slice(0, MAX_ZACKS_REPORTS);
  } catch {
    return [];
  }
}

function loadFavoriteSymbols() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FAVORITE_SYMBOLS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed
      .map((symbol) => String(symbol || '').trim().toUpperCase().replace(/[/-]/g, '.'))
      .filter((symbol) => /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)))]
      .slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

function saveFavoriteSymbols(symbols) {
  try {
    window.localStorage.setItem(FAVORITE_SYMBOLS_KEY, JSON.stringify(symbols));
  } catch {
    // The in-memory favorites still work when storage is disabled or full.
  }
}

function archiveZacksReport(payload, existingReports) {
  if (payload?.universe !== 'zacksBest' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.reportDate || '')) {
    return existingReports;
  }
  if (!Array.isArray(payload.stocks) || payload.stocks.length !== 7) return existingReports;

  const report = {
    reportDate: payload.reportDate,
    reportUrl: payload.reportUrl || '',
    resolvedReportUrl: payload.resolvedReportUrl || '',
    asOf: payload.asOf || '',
    stocks: payload.stocks.map((stock, index) => ({ ...stock, listRank: index + 1 })),
  };
  const next = [report, ...existingReports.filter((item) => item.reportDate !== report.reportDate)]
    .sort((left, right) => right.reportDate.localeCompare(left.reportDate))
    .slice(0, MAX_ZACKS_REPORTS);

  try {
    window.localStorage.setItem(ZACKS_REPORT_HISTORY_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}

async function fetchUniverse(universe, { force = false, favoriteSymbols = [] } = {}) {
  const params = new URLSearchParams({ universe });
  if (universe === 'favorites' && favoriteSymbols.length) params.set('symbols', favoriteSymbols.join(','));
  const requestUrl = `/api/stocks?${params.toString()}`;
  const cached = responseCache.get(requestUrl);
  if (!force && cached && Date.now() - cached.cachedAt < CLIENT_CACHE_TTL_MS) {
    return cached.payload;
  }
  if (pendingRequests.has(requestUrl)) return pendingRequests.get(requestUrl);

  const pending = fetch(requestUrl)
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load market data.');
      responseCache.set(requestUrl, { payload, cachedAt: Date.now() });
      return payload;
    })
    .finally(() => pendingRequests.delete(requestUrl));

  pendingRequests.set(requestUrl, pending);
  return pending;
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" role="img">
        <path d="M5 22.5 11.5 16l4.25 4.25L27 9" />
        <path d="M21 9h6v6" />
      </svg>
    </span>
  );
}

function SearchIcon() {
  return (
    <svg className="field-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg className={spinning ? 'refresh-icon is-spinning' : 'refresh-icon'} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 7v5h-5" />
      <path d="M19 12a7 7 0 1 0-2 5" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg className="export-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19h14" />
    </svg>
  );
}

function ChangeValue({ value }) {
  const tone = !Number.isFinite(value) ? 'neutral' : value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
  return <span className={`change-pill ${tone}`}>{formatPercent(value)}</span>;
}

function TickerAvatar({ symbol, logoUrl }) {
  const [imageFailed, setImageFailed] = React.useState(false);

  React.useEffect(() => setImageFailed(false), [logoUrl]);

  const showLogo = Boolean(logoUrl) && !imageFailed;
  return (
    <span className={showLogo ? 'ticker-avatar has-logo' : 'ticker-avatar'} aria-hidden="true">
      {showLogo ? (
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : symbol.slice(0, 1)}
    </span>
  );
}

function YearRange({ low, high, price }) {
  const { t } = useI18n();
  const hasRange = Number.isFinite(low) && Number.isFinite(high) && high > low;
  if (!hasRange) return <span className="year-range unavailable">—</span>;

  const rawPosition = Number.isFinite(price) ? ((price - low) / (high - low)) * 100 : null;
  const markerPosition = Number.isFinite(rawPosition) ? Math.min(97, Math.max(3, rawPosition)) : null;
  const currentPrice = Number.isFinite(price) ? t('range.current', { price: formatCurrency(price) }) : '';

  return (
    <span
      className="year-range"
      role="img"
      aria-label={t('range.label', { low: formatCurrency(low), high: formatCurrency(high), current: currentPrice })}
    >
      <span className="year-range__track">
        {markerPosition !== null && <span className="year-range__marker" style={{ left: `${markerPosition}%` }} />}
      </span>
      <span className="year-range__labels">
        <span>{formatCurrency(low)}</span>
        <span>{formatCurrency(high)}</span>
      </span>
    </span>
  );
}

function TradingViewChart({ stock }) {
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !stock?.symbol) return undefined;

    container.replaceChildren();
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: tradingViewSymbol(stock),
      interval: 'D',
      timezone: 'America/New_York',
      theme: 'light',
      backgroundColor: '#ffffff',
      gridColor: 'rgba(19, 32, 29, 0.06)',
      style: '1',
      locale: 'en',
      allow_symbol_change: false,
      calendar: false,
      details: false,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      withdateranges: true,
      support_host: 'https://www.tradingview.com',
    });
    container.append(widget, script);

    return () => container.replaceChildren();
  }, [stock]);

  return <div ref={containerRef} className="tradingview-widget-container stock-chart-widget" />;
}

function StockChartDialog({ stock, onClose }) {
  const { t } = useI18n();
  const dialogRef = React.useRef(null);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }, []);

  const requestClose = () => {
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    else onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="stock-chart-dialog"
      aria-labelledby="stock-chart-title"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="stock-chart-modal">
        <header className="stock-chart-header">
          <div className="stock-chart-company">
            <TickerAvatar symbol={stock.symbol} logoUrl={stock.logoUrl} />
            <div>
              <span className="eyebrow">{t('chart.eyebrow')}</span>
              <h2 id="stock-chart-title">{t('chart.title', { symbol: stock.symbol })}</h2>
              <p>{stock.name}</p>
            </div>
          </div>
          <div className="stock-chart-quote">
            <strong>{formatCurrency(stock.price)}</strong>
            <ChangeValue value={stock.changePercentage} />
          </div>
          <a className="stock-chart-yahoo" href={stockDetailUrl(stock.symbol)} target="_blank" rel="noreferrer">
            {t('chart.yahoo')}
          </a>
          <button className="stock-chart-close" type="button" onClick={requestClose} aria-label={t('chart.close')}>×</button>
        </header>
        <div className="stock-chart-body">
          <TradingViewChart stock={stock} />
        </div>
        <p className="stock-chart-attribution">
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">{t('chart.attribution')}</a>
        </p>
      </div>
    </dialog>
  );
}

function ZacksRank({ rank, text, symbol }) {
  const { t } = useI18n();
  const isRated = Number.isInteger(rank);
  const tone = isRated ? ['strong-buy', 'buy', 'hold', 'sell', 'strong-sell'][rank - 1] : 'unavailable';
  const rankKey = ['rank.strongBuy', 'rank.buy', 'rank.hold', 'rank.sell', 'rank.strongSell'][rank - 1];
  const localizedText = isRated ? t(rankKey) : '';
  const label = isRated ? `#${rank} ${localizedText}` : t('rank.unrated');
  return (
    <a
      className={`zacks-rank zacks-rank-link ${tone}`}
      href={zacksDetailUrl(symbol)}
      target="_blank"
      rel="noreferrer"
      aria-label={t('rank.viewDetails', { symbol, label })}
    >
      {isRated ? <><strong>#{rank}</strong>{localizedText || text}</> : t('rank.unrated')}
    </a>
  );
}

function PiotroskiScore({ score, symbol }) {
  const { t } = useI18n();
  if (!Number.isInteger(score)) {
    return <span className="f-score unavailable" aria-label={t('score.unavailable')}>—</span>;
  }

  const tone = score >= 7 ? 'strong' : score >= 4 ? 'neutral' : 'weak';
  return (
    <a
      className={`f-score f-score-link ${tone}`}
      href={piotroskiDetailUrl(symbol)}
      target="_blank"
      rel="noreferrer"
      aria-label={t('score.details', { symbol, score })}
      title={t('score.title')}
    >
      <strong>{score}</strong><span>/9</span>
    </a>
  );
}

function FavoriteButton({ symbol, isFavorite, onToggle, disabled = false }) {
  const { t } = useI18n();
  const label = t(isFavorite ? 'favorite.remove' : 'favorite.add', { symbol });
  return (
    <button
      className={isFavorite ? 'favorite-button is-favorite' : 'favorite-button'}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(symbol);
      }}
      disabled={disabled}
      aria-pressed={isFavorite}
      aria-label={label}
      title={disabled ? t('favorite.limit', { count: MAX_FAVORITES }) : label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3.7 2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.72 6.9 19.4l.97-5.68L3.75 9.7l5.7-.83L12 3.7Z" />
      </svg>
    </button>
  );
}

function StatCard({ eyebrow, value, detail, tone = 'default' }) {
  return (
    <article className={`stat-card ${tone}`}>
      <span>{eyebrow}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function StockCard({ stock, rank, isEtf, onOpenChart, isFavorite, onToggleFavorite, favoriteLimitReached }) {
  const { locale, t } = useI18n();
  return (
    <article className="stock-card">
      <button
        className="stock-card__chart-trigger"
        type="button"
        onClick={() => onOpenChart(stock)}
        aria-label={t('chart.open', { symbol: stock.symbol })}
      />
        <div className="stock-card__lead">
          <span className="rank">{rank}</span>
          <FavoriteButton
            symbol={stock.symbol}
            isFavorite={isFavorite}
            onToggle={onToggleFavorite}
            disabled={!isFavorite && favoriteLimitReached}
          />
          <TickerAvatar symbol={stock.symbol} logoUrl={stock.logoUrl} />
          <button
            className="stock-card__company-link"
            type="button"
            onClick={() => onOpenChart(stock)}
            aria-label={t('chart.openFromName', { symbol: stock.symbol })}
          >
            <strong>{stock.symbol}</strong>
            <span>{stock.name}</span>
          </button>
        </div>
        <div className="stock-card__quote">
          <strong>{formatCurrency(stock.price)}</strong>
          <div>
            <ZacksRank rank={stock.zacksRank} text={stock.zacksRankText} symbol={stock.symbol} />
            <ChangeValue value={stock.changePercentage} />
          </div>
        </div>
        <dl>
          <div><dt>{t(isEtf ? 'column.fundAssets' : 'column.marketCap')}</dt><dd>{formatCompactCurrency(stock.marketCap)}</dd></div>
          <div><dt>{t(isEtf ? 'column.category' : 'column.sector')}</dt><dd>{translateMarketTerm(stock.sector || 'Other', locale)}</dd></div>
          {!isEtf && <div><dt>{t('card.fScore')}</dt><dd><PiotroskiScore score={stock.piotroskiScore} symbol={stock.symbol} /></dd></div>}
          <div className="stock-card__range">
            <dt>{t('column.yearRange')}</dt>
            <dd><YearRange low={stock.yearLow} high={stock.yearHigh} price={stock.price} /></dd>
          </div>
        </dl>
    </article>
  );
}

function LoadingState() {
  const { t } = useI18n();
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="loading-copy">
        <span className="loading-orbit" />
        <div><strong>{t('loading.title')}</strong><span>{t('loading.detail')}</span></div>
      </div>
      <div className="skeleton-table" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
      </div>
    </div>
  );
}

function useMediaLayout(query) {
  const [matches, setMatches] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
  );

  React.useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia(query);
    const updateLayout = (event) => setMatches(event.matches);
    mediaQuery.addEventListener?.('change', updateLayout);
    return () => mediaQuery.removeEventListener?.('change', updateLayout);
  }, [query]);

  return matches;
}

function StockList() {
  const [locale, changeLocale] = useUrlLocale();
  const t = React.useMemo(() => createTranslator(locale), [locale]);
  const i18n = React.useMemo(() => ({ locale, t }), [locale, t]);
  const numberFormatter = React.useMemo(() => new Intl.NumberFormat(locale, { notation: 'compact' }), [locale]);

  React.useEffect(() => {
    document.title = t('meta.title');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));

    const setLocalizedLink = (rel, hrefLang, path) => {
      const selector = hrefLang
        ? `link[rel="${rel}"][hreflang="${hrefLang}"]`
        : `link[rel="${rel}"]:not([hreflang])`;
      let link = document.head.querySelector(selector);
      if (!link) {
        link = document.createElement('link');
        link.rel = rel;
        if (hrefLang) link.hreflang = hrefLang;
        document.head.append(link);
      }
      link.href = new URL(path, window.location.origin).href;
    };

    setLocalizedLink('canonical', '', pathForLocale(locale, window.location.pathname));
    setLocalizedLink('alternate', 'en', pathForLocale(DEFAULT_LOCALE, window.location.pathname));
    setLocalizedLink('alternate', CHINESE_LOCALE, pathForLocale(CHINESE_LOCALE, window.location.pathname));
    setLocalizedLink('alternate', 'x-default', pathForLocale(DEFAULT_LOCALE, window.location.pathname));
  }, [locale, t]);
  const [universe, setUniverse] = React.useState('sp500');
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [sector, setSector] = React.useState('all');
  const [zacksFilter, setZacksFilter] = React.useState('all');
  const [refreshVersion, setRefreshVersion] = React.useState(0);
  const [zacksReportHistory, setZacksReportHistory] = React.useState(loadZacksReportHistory);
  const [favoriteSymbols, setFavoriteSymbols] = React.useState(loadFavoriteSymbols);
  const [selectedStock, setSelectedStock] = React.useState(null);
  const [sortModel, setSortModel] = React.useState([]);
  const isMobile = useMediaLayout('(max-width: 700px)');
  const isCompactTable = useMediaLayout('(max-width: 1300px)');
  const isNarrowTable = useMediaLayout('(max-width: 1000px)');
  const isEtfUniverse = universe === 'popularEtfs';
  const isBestStocksUniverse = universe === 'zacksBest';
  const isFavoritesUniverse = universe === 'favorites';
  const favoriteSymbolsKey = favoriteSymbols.join(',');
  const activeFavoritesKey = isFavoritesUniverse ? favoriteSymbolsKey : '';
  const favoriteSet = React.useMemo(() => new Set(favoriteSymbols), [favoriteSymbols]);
  const favoriteLimitReached = favoriteSymbols.length >= MAX_FAVORITES;

  const openStockChart = React.useCallback((stock) => setSelectedStock(stock), []);
  const openRowChart = React.useCallback(({ row }, event) => {
    if (event.target?.closest?.('a, button')) return;
    setSelectedStock(row);
  }, []);
  const toggleFavorite = React.useCallback((symbol) => {
    setFavoriteSymbols((current) => {
      const normalized = String(symbol || '').trim().toUpperCase().replace(/[/-]/g, '.');
      if (!normalized) return current;
      const isSaved = current.includes(normalized);
      if (!isSaved && current.length >= MAX_FAVORITES) return current;
      const next = isSaved
        ? current.filter((item) => item !== normalized)
        : [...current, normalized];
      saveFavoriteSymbols(next);
      return next;
    });
  }, []);

  React.useEffect(() => {
    const syncFavorites = (event) => {
      if (event.key === FAVORITE_SYMBOLS_KEY) setFavoriteSymbols(loadFavoriteSymbols());
    };
    window.addEventListener('storage', syncFavorites);
    return () => window.removeEventListener('storage', syncFavorites);
  }, []);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    fetchUniverse(universe, {
      force: refreshVersion > 0,
      favoriteSymbols: isFavoritesUniverse && activeFavoritesKey ? activeFavoritesKey.split(',') : [],
    })
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [activeFavoritesKey, isFavoritesUniverse, universe, refreshVersion]);

  React.useEffect(() => {
    if (data?.universe !== 'zacksBest') return;
    setZacksReportHistory((reports) => archiveZacksReport(data, reports));
  }, [data]);

  const stocks = React.useMemo(() => data?.stocks || [], [data]);
  const sectors = React.useMemo(
    () => [...new Set(stocks.map((stock) => stock.sector).filter(Boolean))].sort(),
    [stocks]
  );

  const filteredStocks = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return stocks.filter((stock) => {
      const matchesSearch = !query || stock.symbol.toLowerCase().includes(query) || stock.name.toLowerCase().includes(query);
      const matchesSector = sector === 'all' || stock.sector === sector;
      const matchesZacks = zacksFilter === 'all'
        || (zacksFilter === 'buy-signals' && Number.isInteger(stock.zacksRank) && stock.zacksRank <= 2)
        || (zacksFilter === 'unrated' && !Number.isInteger(stock.zacksRank))
        || stock.zacksRank === Number(zacksFilter);
      return matchesSearch && matchesSector && matchesZacks;
    });
  }, [search, sector, stocks, zacksFilter]);
  const previousZacksReports = React.useMemo(
    () => zacksReportHistory.filter((report) => report.reportDate !== data?.reportDate).slice(0, MAX_ZACKS_REPORTS - 1),
    [data?.reportDate, zacksReportHistory]
  );

  const stats = React.useMemo(() => {
    const advancers = stocks.filter((stock) => Number.isFinite(stock.changePercentage) && stock.changePercentage > 0).length;
    const decliners = stocks.filter((stock) => Number.isFinite(stock.changePercentage) && stock.changePercentage < 0).length;
    const breadthTotal = advancers + decliners;
    const strongBuys = stocks.filter((stock) => stock.zacksRank === 1).length;
    const buys = stocks.filter((stock) => stock.zacksRank === 2).length;
    return {
      advancers,
      decliners,
      breadthPercentage: breadthTotal ? (advancers / breadthTotal) * 100 : null,
      strongBuys,
      buys,
    };
  }, [stocks]);
  const sp500Index = data?.marketIndexes?.sp500;
  const nasdaqIndex = data?.marketIndexes?.nasdaq;

  const columns = React.useMemo(() => [
    {
      field: 'rank',
      headerName: '#',
      width: 60,
      type: 'number',
      sortable: false,
      valueGetter: (_value, row) => stockRank(row, stocks),
    },
    {
      field: 'symbol',
      headerName: t(isEtfUniverse ? 'column.fund' : 'column.company'),
      minWidth: 180,
      flex: 1.2,
      cellClassName: 'align-center-cell',
      renderCell: ({ row }) => (
        <div className="company-cell">
          <FavoriteButton
            symbol={row.symbol}
            isFavorite={favoriteSet.has(row.symbol)}
            onToggle={toggleFavorite}
            disabled={!favoriteSet.has(row.symbol) && favoriteLimitReached}
          />
          <button
            className="company-cell__chart stock-detail-button"
            type="button"
            onClick={() => openStockChart(row)}
            aria-label={t('chart.openFromName', { symbol: row.symbol })}
          >
            <TickerAvatar symbol={row.symbol} logoUrl={row.logoUrl} />
            <span><strong>{row.symbol}</strong><small>{row.name}</small></span>
          </button>
        </div>
      ),
    },
    { field: 'price', headerName: t('column.price'), width: 100, type: 'number', valueFormatter: formatCurrency },
    {
      field: 'changePercentage',
      headerName: t('column.dayChange'),
      width: 105,
      type: 'number',
      cellClassName: 'align-center-cell',
      renderCell: ({ value }) => <ChangeValue value={value} />,
    },
    {
      field: 'zacksRank',
      headerName: t('column.zacksRank'),
      width: 154,
      type: 'number',
      cellClassName: 'align-center-cell',
      renderCell: ({ row }) => <ZacksRank rank={row.zacksRank} text={row.zacksRankText} symbol={row.symbol} />,
    },
    ...(!isEtfUniverse ? [{
      field: 'piotroskiScore',
      headerName: t('column.fScore'),
      description: t('column.fScoreDescription'),
      width: 104,
      type: 'number',
      cellClassName: 'align-center-cell',
      renderCell: ({ row, value }) => <PiotroskiScore score={value} symbol={row.symbol} />,
    }] : []),
    { field: 'marketCap', headerName: t(isEtfUniverse ? 'column.fundAssets' : 'column.marketCap'), width: 135, type: 'number', valueFormatter: formatCompactCurrency },
    { field: 'sector', headerName: t(isEtfUniverse ? 'column.category' : 'column.sector'), minWidth: 155, flex: 0.8, valueFormatter: (value) => translateMarketTerm(value, locale) },
    ...(!isEtfUniverse ? [{ field: 'pe', headerName: t('column.pe'), width: 90, type: 'number', valueFormatter: (value) => Number.isFinite(value) ? value.toFixed(1) : '—' }] : []),
    {
      field: 'yearRangePosition',
      headerName: t('column.yearRange'),
      width: 178,
      type: 'number',
      valueGetter: (_value, row) => yearRangePosition(row),
      renderCell: ({ row }) => <YearRange low={row.yearLow} high={row.yearHigh} price={row.price} />,
    },
  ], [favoriteLimitReached, favoriteSet, isEtfUniverse, locale, openStockChart, stocks, t, toggleFavorite]);

  const selectUniverse = (nextUniverse) => {
    if (nextUniverse === universe) return;
    setUniverse(nextUniverse);
    setData(null);
    setSearch('');
    setSector('all');
    setZacksFilter('all');
    setSortModel([]);
    setRefreshVersion(0);
  };

  const exportCurrentTable = () => {
    const orderedStocks = sortStocksForExport(filteredStocks, sortModel, stocks);
    const csv = createStockCsv(orderedStocks, { isEtf: isEtfUniverse, allStocks: stocks, locale });
    const universeName = universe.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    const date = String(data?.asOf || new Date().toISOString()).slice(0, 10);
    downloadCsv(csv, `northstar-${universeName}-${date}.csv`);
  };

  return (
    <I18nContext.Provider value={i18n}>
    <main className="dashboard-shell">
      <header className="site-header">
        <a className="brand" href={pathForLocale(locale)} aria-label={t('brand.home')}>
          <BrandMark />
          <span><strong>Northstar</strong><small>MARKETS</small></span>
        </a>
        <div className="header-actions">
          <div className="market-status"><span /> {t('status.connected')}</div>
          <button
            className="language-toggle"
            type="button"
            onClick={() => changeLocale(locale === CHINESE_LOCALE ? DEFAULT_LOCALE : CHINESE_LOCALE)}
            aria-label={t('language.switchLabel')}
          >
            <span aria-hidden="true">文</span>
            {t('language.switch')}
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero__copy">
          <span className="eyebrow">{t('hero.eyebrow')}</span>
          <h1>{t('hero.line1')}<br /><em>{t('hero.line2')}</em></h1>
          <p>{t('hero.description')}</p>
        </div>
        <div className="universe-picker" aria-label={t('summary.label')}>
          {universeOptions.map((option) => (
            <button
              className={universe === option.value ? 'active' : ''}
              key={option.value}
              onClick={() => selectUniverse(option.value)}
              type="button"
            >
              <strong>{t(`universe.${option.value}`)}</strong>
              <span>{option.value === 'favorites' && favoriteSymbols.length
                ? t('universe.favoritesCount', { count: favoriteSymbols.length })
                : t(`universe.${option.value}Description`)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="stats-grid" aria-label={t('summary.label')}>
        <StatCard
          eyebrow={t('summary.sp500Today')}
          value={formatPercent(sp500Index?.changePercentage)}
          detail={indexCardDetail(sp500Index, t)}
          tone={sp500Index?.changePercentage > 0 ? 'positive' : sp500Index?.changePercentage < 0 ? 'negative' : 'default'}
        />
        <StatCard
          eyebrow={t('summary.nasdaqToday')}
          value={formatPercent(nasdaqIndex?.changePercentage)}
          detail={indexCardDetail(nasdaqIndex, t)}
          tone={nasdaqIndex?.changePercentage > 0 ? 'positive' : nasdaqIndex?.changePercentage < 0 ? 'negative' : 'default'}
        />
        <StatCard
          eyebrow={t('summary.breadth')}
          value={Number.isFinite(stats.breadthPercentage) ? `${stats.breadthPercentage.toFixed(0)}%` : '—'}
          detail={t('summary.breadthDetail', {
            advancers: stats.advancers,
            decliners: stats.decliners,
            universe: translateUniverseLabel(universe, data?.label || t('common.selectedUniverse'), locale),
          })}
          tone={stats.advancers > stats.decliners ? 'positive' : stats.decliners > stats.advancers ? 'negative' : 'default'}
        />
        <StatCard
          eyebrow={t('summary.zacksSignals')}
          value={stocks.length ? numberFormatter.format(stats.strongBuys + stats.buys) : '—'}
          detail={t('summary.zacksDetail', { strongBuys: stats.strongBuys, buys: stats.buys })}
          tone="positive"
        />
      </section>

      <section className="market-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{t(isBestStocksUniverse ? 'panel.weeklyReport' : isFavoritesUniverse ? 'panel.watchlist' : 'panel.directory')}</span>
            <h2>{translateUniverseLabel(universe, data?.label || universeOptions.find((option) => option.value === universe)?.label, locale)}</h2>
            <p className="panel-metadata">
              {isBestStocksUniverse && data?.reportDate && <span className="report-date">{t('panel.reportUpdated', { date: formatReportDate(data.reportDate, locale) })}</span>}
              <span>{formatUpdatedAt(data?.asOf, locale, t)}</span>
              <span>{t(data?.cacheStatus === 'stale' ? 'panel.stale' : data?.reportCacheStatus === 'fallback' ? 'panel.reportSnapshot' : 'panel.cacheActive')}</span>
              {isFavoritesUniverse && <span>{t('panel.localSymbols')}</span>}
              <span>{t('panel.zacksRated', { count: numberFormatter.format(data?.zacksCoverage || 0) })}</span>
              {!isEtfUniverse && (
                <span>
                  {t('panel.secScores', {
                    count: numberFormatter.format(data?.piotroskiCoverage || 0),
                    year: data?.piotroskiScoreYear ? ` (${data.piotroskiScoreYear})` : '',
                  })}
                </span>
              )}
              {isBestStocksUniverse && (data?.resolvedReportUrl || data?.reportUrl) && (
                <a href={data.resolvedReportUrl || data.reportUrl} target="_blank" rel="noreferrer">{t('panel.viewSource')}</a>
              )}
            </p>
          </div>
          <div className="panel-actions">
            <button
              className="export-button"
              type="button"
              onClick={exportCurrentTable}
              disabled={loading || !filteredStocks.length}
              aria-label={t('action.exportLabel')}
            >
              <ExportIcon />
              <span>{t('action.export')}</span>
            </button>
            <button className="refresh-button" type="button" onClick={() => setRefreshVersion((version) => version + 1)} disabled={loading}>
              <RefreshIcon spinning={loading} />
              <span>{t(loading ? 'action.syncing' : 'action.refresh')}</span>
            </button>
          </div>
        </div>

        <div className="toolbar">
          <label className="search-field">
            <SearchIcon />
            <span className="sr-only">{t(isEtfUniverse ? 'filter.searchFunds' : 'filter.searchStocks')}</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t(isEtfUniverse ? 'filter.searchFunds' : 'filter.searchStocks')} />
          </label>
          <label className="sector-field">
            <span>{t(isEtfUniverse ? 'filter.category' : 'filter.sector')}</span>
            <select value={sector} onChange={(event) => setSector(event.target.value)}>
              <option value="all">{t(isEtfUniverse ? 'filter.allCategories' : 'filter.allSectors')}</option>
              {sectors.map((sectorName) => <option value={sectorName} key={sectorName}>{translateMarketTerm(sectorName, locale)}</option>)}
            </select>
          </label>
          <label className="sector-field rank-field">
            <span>{t('filter.zacksRank')}</span>
            <select value={zacksFilter} onChange={(event) => setZacksFilter(event.target.value)}>
              <option value="all">{t('filter.allZacks')}</option>
              <option value="buy-signals">{t('filter.buySignals')}</option>
              <option value="1">{t('filter.rank1')}</option>
              <option value="2">{t('filter.rank2')}</option>
              <option value="3">{t('filter.rank3')}</option>
              <option value="4">{t('filter.rank4')}</option>
              <option value="5">{t('filter.rank5')}</option>
              <option value="unrated">{t('filter.unrated')}</option>
            </select>
          </label>
          <span className="result-count">{t('filter.results', { count: numberFormatter.format(filteredStocks.length) })}</span>
        </div>

        {error ? (
          <div className="error-state" role="alert">
            <span>!</span>
            <div><strong>{t('error.title')}</strong><p>{locale === CHINESE_LOCALE ? t('error.detail') : error}</p></div>
            <button type="button" onClick={() => setRefreshVersion((version) => version + 1)}>{t('error.retry')}</button>
          </div>
        ) : loading && !data ? (
          <LoadingState />
        ) : (
          <>
            {isFavoritesUniverse && !stocks.length ? (
              <div className="empty-favorites" role="status">
                <span aria-hidden="true">☆</span>
                <strong>{t('favorite.emptyTitle')}</strong>
                <p>{t('favorite.emptyDescription')}</p>
              </div>
            ) : isMobile ? (
              <div className="mobile-list" data-testid="mobile-stock-list">
                {filteredStocks.slice(0, 50).map((stock) => (
                  <StockCard
                    key={stock.symbol}
                    stock={stock}
                    rank={stock.marketRank ?? stocks.findIndex((item) => item.symbol === stock.symbol) + 1}
                    isEtf={isEtfUniverse}
                    onOpenChart={openStockChart}
                    isFavorite={favoriteSet.has(stock.symbol)}
                    onToggleFavorite={toggleFavorite}
                    favoriteLimitReached={favoriteLimitReached}
                  />
                ))}
                {filteredStocks.length > 50 && <p className="mobile-limit">{t('mobile.limit')}</p>}
              </div>
            ) : (
              <div className="desktop-grid" data-testid="desktop-stock-grid">
                <React.Suspense fallback={<LoadingState />}>
                  <DataGrid
                    rows={filteredStocks}
                    columns={columns}
                    getRowId={(row) => row.symbol}
                    sortModel={sortModel}
                    onSortModelChange={setSortModel}
                    columnVisibilityModel={{
                      marketCap: !isNarrowTable,
                      sector: !isNarrowTable,
                      pe: !isCompactTable,
                    }}
                    onRowClick={openRowChart}
                    autoHeight
                    disableRowSelectionOnClick
                    rowHeight={68}
                    columnHeaderHeight={52}
                    initialState={{ pagination: { paginationModel: { pageSize: 100, page: 0 } } }}
                    pageSizeOptions={[10, 25, 50, 100]}
                    pagination
                    localeText={locale === CHINESE_LOCALE ? zhDataGridLocaleText : undefined}
                    sx={{ border: 0 }}
                  />
                </React.Suspense>
              </div>
            )}
          </>
        )}
      </section>

      {isBestStocksUniverse && !loading && !error && (
        <section className="report-history" aria-labelledby="report-history-title">
          <div className="report-history__heading">
            <div>
              <span className="eyebrow">{t('history.eyebrow')}</span>
              <h2 id="report-history-title">{t('history.title')}</h2>
              <p>{t('history.description')}</p>
            </div>
            <span>{t('history.savedWeeks', {
              count: numberFormatter.format(previousZacksReports.length),
              unit: t(previousZacksReports.length === 1 ? 'history.week' : 'history.weeks'),
            })}</span>
          </div>

          {previousZacksReports.length ? previousZacksReports.map((report) => (
            <article className="archived-report" key={report.reportDate}>
              <div className="archived-report__heading">
                <div>
                  <span className="eyebrow">{t('history.weekOf')}</span>
                  <h3>{formatReportDate(report.reportDate, locale)}</h3>
                </div>
                {(report.resolvedReportUrl || report.reportUrl) && (
                  <a href={report.resolvedReportUrl || report.reportUrl} target="_blank" rel="noreferrer">{t('panel.viewSource')}</a>
                )}
              </div>

              {isMobile ? (
                <div className="mobile-list archived-mobile-list">
                  {report.stocks.map((stock, index) => (
                    <StockCard
                      key={stock.symbol}
                      stock={stock}
                      rank={stock.listRank ?? index + 1}
                      isEtf={false}
                      onOpenChart={openStockChart}
                      isFavorite={favoriteSet.has(stock.symbol)}
                      onToggleFavorite={toggleFavorite}
                      favoriteLimitReached={favoriteLimitReached}
                    />
                  ))}
                </div>
              ) : (
                <div className="desktop-grid archived-grid">
                  <React.Suspense fallback={<LoadingState />}>
                    <DataGrid
                      rows={report.stocks}
                      columns={columns}
                      getRowId={(row) => row.symbol}
                      columnVisibilityModel={{
                        marketCap: !isNarrowTable,
                        sector: !isNarrowTable,
                        pe: !isCompactTable,
                      }}
                      onRowClick={openRowChart}
                      autoHeight
                      disableRowSelectionOnClick
                      rowHeight={68}
                      columnHeaderHeight={52}
                      hideFooter
                      localeText={locale === CHINESE_LOCALE ? zhDataGridLocaleText : undefined}
                      sx={{ border: 0 }}
                    />
                  </React.Suspense>
                </div>
              )}
            </article>
          )) : (
            <div className="empty-history">
              <strong>{t('history.emptyTitle')}</strong>
              <span>{t('history.emptyDescription')}</span>
            </div>
          )}
        </section>
      )}

      <footer>
        <p>{t('footer.sources', { sources: data?.sources?.join(t('common.and')) || t('common.publicSources') })}</p>
        <p>{t('footer.disclaimer')}</p>
      </footer>

      {selectedStock && <StockChartDialog stock={selectedStock} onClose={() => setSelectedStock(null)} />}
    </main>
    </I18nContext.Provider>
  );
}

export default StockList;
