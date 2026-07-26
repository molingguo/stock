import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import App from './App';

const stock = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  price: 200,
  changePercentage: 1.25,
  marketCap: 3000000000000,
  volume: 50000000,
  sector: 'Technology',
  pe: 31,
  zacksRank: 1,
  zacksRankText: 'Strong Buy',
};

const unratedStock = {
  ...stock,
  symbol: 'MSFT',
  name: 'Microsoft Corporation',
  zacksRank: null,
  zacksRankText: '',
};

test('loads, filters, and switches stock universes', async () => {
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  global.fetch = vi.fn(async (url) => ({
    ok: true,
    json: async () => ({
      universe: url.includes('popularEtfs') ? 'popularEtfs' : url.includes('extendedMarket') ? 'extendedMarket' : url.includes('zacksBest') ? 'zacksBest' : 'sp500',
      label: url.includes('popularEtfs') ? 'Popular ETFs' : url.includes('extendedMarket') ? 'U.S. Extended Market' : url.includes('zacksBest') ? 'Zacks 7 Best Stocks' : 'S&P 500',
      asOf: '2026-07-25T16:00:00.000Z',
      reportDate: url.includes('zacksBest') ? '2026-07-24' : undefined,
      resolvedReportUrl: url.includes('zacksBest') ? 'https://www.zacks.com/example?edition=20260724abc' : undefined,
      cacheStatus: 'fresh',
      zacksCoverage: 1,
      sources: ['Nasdaq', 'Zacks'],
      stocks: url.includes('extendedMarket')
        ? [{ ...stock, marketRank: 42 }, { ...unratedStock, marketRank: 57 }]
        : [stock, unratedStock],
    }),
  }));
  render(<App />);

  expect(await screen.findAllByText('AAPL')).not.toHaveLength(0);
  expect(screen.getByRole('link', { name: 'View AAPL on Yahoo Finance' })).toHaveAttribute(
    'href',
    'https://finance.yahoo.com/quote/AAPL/'
  );
  expect(screen.getByText('Strong Buy')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /see the market/i })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Zacks rank'), { target: { value: 'buy-signals' } });
  expect(screen.getByText('1 results')).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText(/search ticker/i), { target: { value: 'missing' } });
  expect(screen.getByText('0 results')).toBeInTheDocument();

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
  expect(global.fetch).toHaveBeenCalledWith('/api/stocks?universe=zacksBest');
});
