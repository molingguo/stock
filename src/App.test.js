import { render, screen } from '@testing-library/react';
import App from './App';

test('renders stocks returned by the dashboard API', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ stocks: [{ symbol: 'AAPL', name: 'Apple', price: 200 }] }),
  }));
  render(<App />);
  expect(await screen.findByText('AAPL')).toBeInTheDocument();
});
