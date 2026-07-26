import React from 'react';

const DataGrid = React.lazy(() =>
  import('@mui/x-data-grid').then((module) => ({ default: module.DataGrid }))
);

const CLIENT_CACHE_TTL_MS = 60_000;
const responseCache = new Map();
const pendingRequests = new Map();

const universeOptions = [
  { value: 'sp500', label: 'S&P 500', description: 'Index constituents' },
  { value: 'popularEtfs', label: 'Popular ETFs', description: 'By current fund assets' },
  { value: 'extendedMarket', label: 'Extended Market', description: 'Top 1,000 beyond S&P 500' },
  { value: 'zacksBest', label: '7 Best Stocks', description: 'Weekly 30-day picks' },
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

const numberFormatter = new Intl.NumberFormat('en-US', { notation: 'compact' });

function formatCurrency(value) {
  return Number.isFinite(value) ? currencyFormatter.format(value) : '—';
}

function formatCompactCurrency(value) {
  return Number.isFinite(value) ? compactCurrencyFormatter.format(value) : '—';
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '—';
}

function formatUpdatedAt(value) {
  if (!value) return 'Waiting for market data';
  return `Updated ${new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))}`;
}

function formatReportDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

async function fetchUniverse(universe, force = false) {
  const cached = responseCache.get(universe);
  if (!force && cached && Date.now() - cached.cachedAt < CLIENT_CACHE_TTL_MS) {
    return cached.payload;
  }
  if (pendingRequests.has(universe)) return pendingRequests.get(universe);

  const pending = fetch(`/api/stocks?universe=${universe}`)
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Unable to load market data.');
      responseCache.set(universe, { payload, cachedAt: Date.now() });
      return payload;
    })
    .finally(() => pendingRequests.delete(universe));

  pendingRequests.set(universe, pending);
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

function ChangeValue({ value }) {
  const tone = !Number.isFinite(value) ? 'neutral' : value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
  return <span className={`change-pill ${tone}`}>{formatPercent(value)}</span>;
}

function ZacksRank({ rank, text }) {
  if (!Number.isInteger(rank)) return <span className="zacks-rank unavailable">Not rated</span>;
  const tone = ['strong-buy', 'buy', 'hold', 'sell', 'strong-sell'][rank - 1];
  return (
    <span className={`zacks-rank ${tone}`}>
      <strong>#{rank}</strong>{text}
    </span>
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

function StockCard({ stock, rank, isEtf }) {
  return (
    <article className="stock-card">
      <div className="stock-card__lead">
        <span className="rank">{rank}</span>
        <span className="ticker-avatar">{stock.symbol.slice(0, 1)}</span>
        <div>
          <strong>{stock.symbol}</strong>
          <span>{stock.name}</span>
        </div>
      </div>
      <div className="stock-card__quote">
        <strong>{formatCurrency(stock.price)}</strong>
        <div>
          <ZacksRank rank={stock.zacksRank} text={stock.zacksRankText} />
          <ChangeValue value={stock.changePercentage} />
        </div>
      </div>
      <dl>
        <div><dt>{isEtf ? 'Fund assets' : 'Market cap'}</dt><dd>{formatCompactCurrency(stock.marketCap)}</dd></div>
        <div><dt>{isEtf ? 'Category' : 'Sector'}</dt><dd>{stock.sector || 'Other'}</dd></div>
        <div><dt>Volume</dt><dd>{Number.isFinite(stock.volume) ? numberFormatter.format(stock.volume) : '—'}</dd></div>
      </dl>
    </article>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <div className="loading-copy">
        <span className="loading-orbit" />
        <div><strong>Building your market view</strong><span>Fetching and ranking the latest securities…</span></div>
      </div>
      <div className="skeleton-table" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
      </div>
    </div>
  );
}

function useMobileLayout() {
  const query = '(max-width: 700px)';
  const [isMobile, setIsMobile] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false
  );

  React.useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia(query);
    const updateLayout = (event) => setIsMobile(event.matches);
    mediaQuery.addEventListener?.('change', updateLayout);
    return () => mediaQuery.removeEventListener?.('change', updateLayout);
  }, []);

  return isMobile;
}

function StockList() {
  const [universe, setUniverse] = React.useState('sp500');
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [sector, setSector] = React.useState('all');
  const [zacksFilter, setZacksFilter] = React.useState('all');
  const [refreshVersion, setRefreshVersion] = React.useState(0);
  const isMobile = useMobileLayout();
  const isEtfUniverse = universe === 'popularEtfs';
  const isBestStocksUniverse = universe === 'zacksBest';

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    fetchUniverse(universe, refreshVersion > 0)
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
  }, [universe, refreshVersion]);

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

  const stats = React.useMemo(() => {
    const moves = stocks.map((stock) => stock.changePercentage).filter(Number.isFinite).sort((a, b) => a - b);
    const middle = Math.floor(moves.length / 2);
    const median = moves.length ? (moves.length % 2 ? moves[middle] : (moves[middle - 1] + moves[middle]) / 2) : null;
    const strongBuys = stocks.filter((stock) => stock.zacksRank === 1).length;
    const buys = stocks.filter((stock) => stock.zacksRank === 2).length;
    return {
      median,
      marketCap: stocks.reduce((sum, stock) => sum + (stock.marketCap || 0), 0),
      strongBuys,
      buys,
    };
  }, [stocks]);

  const columns = React.useMemo(() => [
    {
      field: 'rank',
      headerName: '#',
      width: 64,
      sortable: false,
      valueGetter: (_value, row) => row.marketRank ?? stocks.findIndex((stock) => stock.symbol === row.symbol) + 1,
    },
    {
      field: 'symbol',
      headerName: isEtfUniverse ? 'Fund' : 'Company',
      minWidth: 220,
      flex: 1.2,
      cellClassName: 'align-center-cell',
      renderCell: ({ row }) => (
        <div className="company-cell">
          <span className="ticker-avatar">{row.symbol.slice(0, 1)}</span>
          <span><strong>{row.symbol}</strong><small>{row.name}</small></span>
        </div>
      ),
    },
    { field: 'price', headerName: 'Price', width: 118, type: 'number', valueFormatter: formatCurrency },
    {
      field: 'changePercentage',
      headerName: 'Day change',
      width: 132,
      type: 'number',
      cellClassName: 'align-center-cell',
      renderCell: ({ value }) => <ChangeValue value={value} />,
    },
    {
      field: 'zacksRank',
      headerName: 'Zacks rank',
      width: 154,
      type: 'number',
      cellClassName: 'align-center-cell',
      renderCell: ({ row }) => <ZacksRank rank={row.zacksRank} text={row.zacksRankText} />,
    },
    { field: 'marketCap', headerName: isEtfUniverse ? 'Fund assets' : 'Market cap', width: 135, type: 'number', valueFormatter: formatCompactCurrency },
    { field: 'sector', headerName: isEtfUniverse ? 'Category' : 'Sector', minWidth: 155, flex: 0.8 },
    ...(!isEtfUniverse ? [{ field: 'pe', headerName: 'P/E', width: 90, type: 'number', valueFormatter: (value) => Number.isFinite(value) ? value.toFixed(1) : '—' }] : []),
    { field: 'volume', headerName: 'Volume', width: 110, type: 'number', valueFormatter: (value) => Number.isFinite(value) ? numberFormatter.format(value) : '—' },
  ], [isEtfUniverse, stocks]);

  const selectUniverse = (nextUniverse) => {
    if (nextUniverse === universe) return;
    setUniverse(nextUniverse);
    setSearch('');
    setSector('all');
    setZacksFilter('all');
    setRefreshVersion(0);
  };

  return (
    <main className="dashboard-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Northstar Markets home">
          <BrandMark />
          <span><strong>Northstar</strong><small>MARKETS</small></span>
        </a>
        <div className="market-status"><span /> Market data connected</div>
      </header>

      <section className="hero">
        <div className="hero__copy">
          <span className="eyebrow">U.S. EQUITY EXPLORER</span>
          <h1>See the market.<br /><em>Find the signal.</em></h1>
          <p>Explore leading U.S. stocks, popular ETFs, and Zacks’ weekly picks with current prices, rankings, and research signals in one focused view.</p>
        </div>
        <div className="universe-picker" aria-label="Market universe">
          {universeOptions.map((option) => (
            <button
              className={universe === option.value ? 'active' : ''}
              key={option.value}
              onClick={() => selectUniverse(option.value)}
              type="button"
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="stats-grid" aria-label="Market summary">
        <StatCard eyebrow={isBestStocksUniverse ? 'Picks tracked' : isEtfUniverse ? 'Funds tracked' : 'Companies tracked'} value={loading && !data ? '—' : numberFormatter.format(stocks.length)} detail={data?.label || 'Selected universe'} />
        <StatCard eyebrow="Zacks buy signals" value={stocks.length ? numberFormatter.format(stats.strongBuys + stats.buys) : '—'} detail={`${stats.strongBuys} Strong Buy · ${stats.buys} Buy`} tone="positive" />
        <StatCard eyebrow="Median move" value={formatPercent(stats.median)} detail="Across available quotes" tone={stats.median >= 0 ? 'positive' : 'negative'} />
        <StatCard eyebrow={isEtfUniverse ? 'Combined fund assets' : 'Combined market cap'} value={formatCompactCurrency(stats.marketCap || null)} detail={isEtfUniverse ? 'Across available funds' : 'Current company values'} />
      </section>

      <section className="market-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{isBestStocksUniverse ? 'WEEKLY ZACKS REPORT' : 'MARKET DIRECTORY'}</span>
            <h2>{data?.label || universeOptions.find((option) => option.value === universe)?.label}</h2>
            <p className="panel-metadata">
              {isBestStocksUniverse && data?.reportDate && <span className="report-date">Report updated {formatReportDate(data.reportDate)}</span>}
              <span>{formatUpdatedAt(data?.asOf)}</span>
              <span>{data?.cacheStatus === 'stale' ? 'Showing cached data' : data?.reportCacheStatus === 'fallback' ? 'Verified report snapshot' : 'Provider cache active'}</span>
              <span>{numberFormatter.format(data?.zacksCoverage || 0)} Zacks rated</span>
              {isBestStocksUniverse && (data?.resolvedReportUrl || data?.reportUrl) && (
                <a href={data.resolvedReportUrl || data.reportUrl} target="_blank" rel="noreferrer">View source report</a>
              )}
            </p>
          </div>
          <button className="refresh-button" type="button" onClick={() => setRefreshVersion((version) => version + 1)} disabled={loading}>
            <RefreshIcon spinning={loading} />
            <span>{loading ? 'Syncing' : 'Refresh'}</span>
          </button>
        </div>

        <div className="toolbar">
          <label className="search-field">
            <SearchIcon />
            <span className="sr-only">{isEtfUniverse ? 'Search funds' : 'Search companies'}</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isEtfUniverse ? 'Search ticker or fund' : 'Search ticker or company'} />
          </label>
          <label className="sector-field">
            <span>{isEtfUniverse ? 'Category' : 'Sector'}</span>
            <select value={sector} onChange={(event) => setSector(event.target.value)}>
              <option value="all">{isEtfUniverse ? 'All categories' : 'All sectors'}</option>
              {sectors.map((sectorName) => <option value={sectorName} key={sectorName}>{sectorName}</option>)}
            </select>
          </label>
          <label className="sector-field rank-field">
            <span>Zacks rank</span>
            <select value={zacksFilter} onChange={(event) => setZacksFilter(event.target.value)}>
              <option value="all">All Zacks ranks</option>
              <option value="buy-signals">#1–2 Buys</option>
              <option value="1">#1 Strong Buy</option>
              <option value="2">#2 Buy</option>
              <option value="3">#3 Hold</option>
              <option value="4">#4 Sell</option>
              <option value="5">#5 Strong Sell</option>
              <option value="unrated">Not rated</option>
            </select>
          </label>
          <span className="result-count">{numberFormatter.format(filteredStocks.length)} results</span>
        </div>

        {error ? (
          <div className="error-state" role="alert">
            <span>!</span>
            <div><strong>Market data is unavailable</strong><p>{error}</p></div>
            <button type="button" onClick={() => setRefreshVersion((version) => version + 1)}>Try again</button>
          </div>
        ) : loading && !data ? (
          <LoadingState />
        ) : (
          <>
            {isMobile ? (
              <div className="mobile-list" data-testid="mobile-stock-list">
                {filteredStocks.slice(0, 50).map((stock) => (
                  <StockCard key={stock.symbol} stock={stock} rank={stock.marketRank ?? stocks.findIndex((item) => item.symbol === stock.symbol) + 1} isEtf={isEtfUniverse} />
                ))}
                {filteredStocks.length > 50 && <p className="mobile-limit">Showing the first 50 results. Use search or sector filters to narrow the list.</p>}
              </div>
            ) : (
              <div className="desktop-grid" data-testid="desktop-stock-grid">
                <React.Suspense fallback={<LoadingState />}>
                  <DataGrid
                    rows={filteredStocks}
                    columns={columns}
                    getRowId={(row) => row.symbol}
                    disableRowSelectionOnClick
                    rowHeight={68}
                    columnHeaderHeight={52}
                    initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                    pageSizeOptions={[10, 25, 50, 100]}
                    pagination
                    sx={{ border: 0 }}
                  />
                </React.Suspense>
              </div>
            )}
          </>
        )}
      </section>

      <footer>
        <p>Data supplied by {data?.sources?.join(' and ') || 'public market sources'} and cached to protect provider limits.</p>
        <p>Quotes may be delayed. For research only, not investment advice.</p>
      </footer>
    </main>
  );
}

export default StockList;
