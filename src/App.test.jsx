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
      universe: url.includes('popularEtfs') ? 'popularEtfs' : url.includes('extendedMarket') ? 'extendedMarket' : 'sp500',
      label: url.includes('popularEtfs') ? 'Popular ETFs' : url.includes('extendedMarket') ? 'U.S. Extended Market' : 'S&P 500',
      asOf: '2026-07-25T16:00:00.000Z',
      cacheStatus: 'fresh',
      zacksCoverage: 1,
      sources: ['Nasdaq', 'Zacks'],
      stocks: [stock, unratedStock],
    }),
  }));
  render(<App />);

  expect(await screen.findAllByText('AAPL')).not.toHaveLength(0);
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
  expect(global.fetch).toHaveBeenCalledWith('/api/stocks?universe=extendedMarket');
});
