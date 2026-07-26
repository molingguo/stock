import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App';
import { createStockCsv, sortStocksForExport } from './StockList';
import { CHINESE_LOCALE, localeFromPathname, pathForLocale } from './i18n';
import { companyNameForLocale, getChineseCompanyName } from './companyNamesZh';

const stock = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  logoUrl: 'https://staticx-tuner.zacks.com/images/stocks-thumb/AAPL.png',
  exchange: 'NASDAQ',
  price: 200,
  changePercentage: 1.25,
  marketCap: 3000000000000,
  volume: 50000000,
  sector: 'Technology',
  pe: 31,
  yearLow: 120,
  yearHigh: 220,
  zacksRank: 1,
  zacksRankText: 'Strong Buy',
  piotroskiScore: 8,
};

const unratedStock = {
  ...stock,
  symbol: 'MSFT',
  name: 'Microsoft Corporation',
  zacksRank: null,
  zacksRankText: '',
  piotroskiScore: 6,
  changePercentage: -0.75,
};

test('loads, filters, and switches stock universes', async () => {
  window.history.replaceState({}, '', '/');
  window.localStorage.removeItem('northstar:favorite-symbols:v1');
  window.localStorage.setItem('northstar:zacks-best-history:v1', JSON.stringify([{
    reportDate: '2026-07-17',
    reportUrl: 'https://www.zacks.com/previous',
    resolvedReportUrl: 'https://www.zacks.com/example?edition=20260717abc',
    asOf: '2026-07-17T16:00:00.000Z',
    stocks: Array.from({ length: 7 }, (_, index) => ({
      ...stock,
      symbol: index === 0 ? 'IBM' : `OLD${index}`,
      name: index === 0 ? 'International Business Machines' : `Previous company ${index}`,
      listRank: index + 1,
    })),
  }]));
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  global.fetch = vi.fn(async (url) => {
    const isFavorites = url.includes('universe=favorites');
    const favoriteSymbols = new URL(url, 'https://example.test').searchParams.get('symbols')?.split(',') || [];
    return {
      ok: true,
      json: async () => ({
      universe: isFavorites ? 'favorites' : url.includes('popularEtfs') ? 'popularEtfs' : url.includes('extendedMarket') ? 'extendedMarket' : url.includes('zacksBest') ? 'zacksBest' : 'sp500',
      label: isFavorites ? 'Favorites' : url.includes('popularEtfs') ? 'Popular ETFs' : url.includes('extendedMarket') ? 'U.S. Extended Market' : url.includes('zacksBest') ? 'Zacks 7 Best Stocks' : 'S&P 500',
      asOf: '2026-07-25T16:00:00.000Z',
      reportDate: url.includes('zacksBest') ? '2026-07-24' : undefined,
      resolvedReportUrl: url.includes('zacksBest') ? 'https://www.zacks.com/example?edition=20260724abc' : undefined,
      cacheStatus: 'fresh',
      zacksCoverage: 1,
      piotroskiCoverage: 2,
      piotroskiScoreYear: 2025,
      marketIndexes: {
        sp500: { symbol: 'SPX', name: 'S&P 500', price: 7411.98, changePercentage: 0.05 },
        nasdaq: { symbol: 'COMPX', name: 'Nasdaq Composite', price: 24975.824, changePercentage: -0.644 },
      },
      sources: ['Nasdaq', 'Zacks'],
      stocks: isFavorites
        ? [stock, unratedStock].filter((item) => favoriteSymbols.includes(item.symbol))
        : url.includes('extendedMarket')
        ? [{ ...stock, marketRank: 42 }, { ...unratedStock, marketRank: 57 }]
        : [stock, unratedStock],
      }),
    };
  });
  render(<App />);

  expect(await screen.findAllByText('AAPL')).not.toHaveLength(0);
  expect(screen.queryByRole('link', { name: 'View AAPL on Yahoo Finance' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View AAPL on Zacks: #1 Strong Buy' })).toHaveAttribute(
    'href', 'https://www.zacks.com/stock/quote/AAPL'
  );
  expect(document.querySelector('img[src="https://staticx-tuner.zacks.com/images/stocks-thumb/AAPL.png"]')).toBeInTheDocument();
  expect(screen.getAllByRole('img', { name: '52-week range from $120.00 to $220.00; current price $200.00' }).length).toBeGreaterThan(0);
  expect(document.querySelector('script[src*="embed-widget-advanced-chart.js"]')).not.toBeInTheDocument();
  const mobileAaplCard = screen.getAllByText('AAPL').map((element) => element.closest('article')).find(Boolean);
  expect(mobileAaplCard.querySelector('.stock-card__lead > .stock-card__price')).toHaveTextContent('$200.00');
  expect(mobileAaplCard.querySelector('.stock-card__signals').firstElementChild).toHaveClass('zacks-rank-link');
  expect(mobileAaplCard.querySelector('.stock-card__signals').lastElementChild).toHaveClass('change-pill');

  fireEvent.click(screen.getByRole('button', { name: 'Open AAPL chart from company name' }));
  expect(screen.getByRole('dialog', { name: 'AAPL chart' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View on Yahoo Finance' })).toHaveAttribute('href', 'https://finance.yahoo.com/quote/AAPL/');
  expect(document.querySelector('script[src*="embed-widget-advanced-chart.js"]')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'AAPL chart' }), { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'AAPL chart' })).not.toBeInTheDocument();
  expect(screen.getByText('Strong Buy')).toBeInTheDocument();
  expect(within(screen.getByText('S&P 500 today').closest('article')).getByText('+0.05%')).toBeInTheDocument();
  expect(within(screen.getByText('Nasdaq Composite today').closest('article')).getByText('-0.64%')).toBeInTheDocument();
  expect(within(screen.getByText('Market breadth').closest('article')).getByText('50%')).toBeInTheDocument();
  expect(screen.queryByText('Companies tracked')).not.toBeInTheDocument();
  expect(screen.queryByText('Median move')).not.toBeInTheDocument();
  expect(screen.queryByText('Combined market cap')).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'View AAPL Piotroski F-score 8 out of 9 details' })[0]).toHaveAttribute(
    'href', 'https://stockanalysis.com/stocks/aapl/statistics/'
  );
  expect(screen.getByText('2 SEC F-scores (2025)')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /see the market/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add AAPL to favorites' }));
  expect(screen.getByRole('button', { name: 'Remove AAPL from favorites' })).toHaveAttribute('aria-pressed', 'true');
  expect(JSON.parse(window.localStorage.getItem('northstar:favorite-symbols:v1'))).toEqual(['AAPL']);

  fireEvent.change(screen.getByLabelText('Zacks rank'), { target: { value: 'buy-signals' } });
  expect(screen.getByText('1 results')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export to CSV' })).toBeEnabled();

  fireEvent.change(screen.getByPlaceholderText(/search ticker/i), { target: { value: 'missing' } });
  expect(screen.getByText('0 results')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export to CSV' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: /popular etfs/i }));
  expect(await screen.findByRole('heading', { name: 'Popular ETFs' })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/stocks?universe=popularEtfs');

  fireEvent.click(screen.getByRole('button', { name: /extended market/i }));
  expect(await screen.findByRole('heading', { name: 'U.S. Extended Market' })).toBeInTheDocument();
  expect(screen.getByText('42')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/stocks?universe=extendedMarket');

  fireEvent.click(screen.getByRole('button', { name: /7 best stocks/i }));
  expect(await screen.findByRole('heading', { name: 'Zacks 7 Best Stocks' })).toBeInTheDocument();
  expect(screen.getByText('Report updated Jul 24, 2026')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Previous 7 Best Stocks' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Jul 17, 2026' })).toBeInTheDocument();
  expect(screen.getByText('IBM')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/stocks?universe=zacksBest');

  fireEvent.click(screen.getByRole('button', { name: /^Favorites/ }));
  expect(await screen.findByRole('heading', { name: 'Favorites' })).toBeInTheDocument();
  expect(screen.getByText('Symbols saved only in this browser')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/stocks?universe=favorites&symbols=AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Remove AAPL from favorites' }));
  expect(await screen.findByText('No favorite stocks yet')).toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem('northstar:favorite-symbols:v1'))).toEqual([]);
});

test('supports canonical Chinese URLs and switches language without reloading data', async () => {
  window.history.replaceState({}, '', '/zh_CN/?view=market#top');
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const callsBeforeRender = global.fetch.mock.calls.length;

  render(<App />);

  expect(await screen.findByRole('heading', { name: /洞察市场/ })).toBeInTheDocument();
  await waitFor(() => expect(window.location.pathname).toBe('/zh-CN/'));
  expect(document.documentElement).toHaveAttribute('lang', 'zh-CN');
  expect(document.title).toBe('Northstar Markets — 美国股票探索');
  expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'http://localhost:3000/zh-CN/');
  expect(document.head.querySelector('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', 'http://localhost:3000/');
  expect(window.location.search).toBe('?view=market');
  expect(window.location.hash).toBe('#top');
  expect(screen.getByText('今日标普 500')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('搜索股票代码或公司')).toBeInTheDocument();
  expect(screen.getByText('苹果公司')).toHaveAttribute('title', 'Apple Inc.');
  expect(screen.getByRole('button', { name: '切换到英文' })).toHaveTextContent('English');

  fireEvent.change(screen.getByPlaceholderText('搜索股票代码或公司'), { target: { value: '苹果' } });
  expect(screen.getByText('AAPL')).toBeInTheDocument();
  expect(screen.queryByText('MSFT')).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('搜索股票代码或公司'), { target: { value: '' } });

  fireEvent.click(screen.getByRole('button', { name: '切换到英文' }));
  expect(window.location.pathname).toBe('/');
  expect(document.documentElement).toHaveAttribute('lang', 'en');
  expect(screen.getByRole('heading', { name: /see the market/i })).toBeInTheDocument();
  expect(window.location.search).toBe('?view=market');
  expect(window.location.hash).toBe('#top');

  fireEvent.click(screen.getByRole('button', { name: 'Switch to Chinese' }));
  expect(window.location.pathname).toBe('/zh-CN/');
  expect(global.fetch).toHaveBeenCalledTimes(callsBeforeRender);
});

test('maps locale paths using the BCP 47 route', () => {
  expect(localeFromPathname('/zh-CN/')).toBe(CHINESE_LOCALE);
  expect(localeFromPathname('/zh_CN/stocks')).toBe(CHINESE_LOCALE);
  expect(localeFromPathname('/')).toBe('en');
  expect(pathForLocale(CHINESE_LOCALE, '/')).toBe('/zh-CN/');
  expect(pathForLocale('en', '/zh_CN/stocks')).toBe('/stocks');
});

test('uses curated Chinese company names and preserves unknown source names', () => {
  expect(getChineseCompanyName('BRK/B')).toBe('伯克希尔·哈撒韦公司');
  expect(companyNameForLocale(stock, CHINESE_LOCALE)).toBe('苹果公司');
  expect(companyNameForLocale({ symbol: 'UNKNOWN', name: 'Untranslated Company' }, CHINESE_LOCALE)).toBe('Untranslated Company');
  expect(companyNameForLocale(stock, 'en')).toBe('Apple Inc.');
});

test('builds CSV rows in the active table sort order', () => {
  const rows = [
    { ...stock, symbol: 'LOW', name: 'Lower Company', price: 10 },
    { ...stock, symbol: 'HIGH', name: 'Higher, Company', price: 20 },
  ];
  const sorted = sortStocksForExport(rows, [{ field: 'price', sort: 'desc' }], rows);
  const csv = createStockCsv(sorted, { allStocks: rows });
  const lines = csv.trim().replace(/^\uFEFF/, '').split('\r\n');

  expect(sorted.map((row) => row.symbol)).toEqual(['HIGH', 'LOW']);
  expect(lines[0]).toContain('52-week position (%)');
  expect(lines[0]).toContain('Piotroski F-score');
  expect(lines[1]).toContain(',8,31,');
  expect(lines[1]).toContain('HIGH,"Higher, Company",20');
  expect(lines[2]).toContain('LOW,Lower Company,10');

  const chineseCsv = createStockCsv([stock], { locale: CHINESE_LOCALE });
  expect(chineseCsv).toContain('AAPL,苹果公司,200');
});
