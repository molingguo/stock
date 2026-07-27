const express = require('express');
const path = require('path');
const { loadEnvFile } = require('./env');

loadEnvFile();

const { createMarketDataService } = require('./marketData');
const { createEtfHoldingsService } = require('./etfHoldings');

function createApp({
  marketData = createMarketDataService(),
  etfHoldings = createEtfHoldingsService(),
} = {}) {
  const app = express();

  app.disable('x-powered-by');

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/stocks', async (request, response) => {
    try {
      const universe = request.query.universe;
      const rawSymbols = request.query.symbols;
      if (Array.isArray(rawSymbols)) {
        const error = new Error('Favorite symbols must use one comma-separated query value.');
        error.status = 400;
        throw error;
      }
      const symbols = typeof rawSymbols === 'string' && rawSymbols
        ? rawSymbols.split(',')
        : [];
      const data = universe === 'favorites'
        ? await marketData.getFavoriteStocks(symbols)
        : await marketData.getStocks(universe);
      response.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      response.json(data);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      response.status(status).json({
        error: status >= 500 ? 'Market data is temporarily unavailable.' : error.message,
        detail: error.message,
      });
    }
  });

  app.get('/api/etf-holdings', async (request, response) => {
    try {
      if (Array.isArray(request.query.symbol)) {
        const error = new Error('ETF holdings require one symbol.');
        error.status = 400;
        throw error;
      }
      const data = await etfHoldings.getHoldings(request.query.symbol);
      response.set('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
      response.json(data);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      response.status(status).json({
        error: status >= 500 ? 'ETF holdings are temporarily unavailable.' : error.message,
        detail: error.message,
      });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const buildPath = path.resolve(__dirname, '..', 'dist');
    app.use(express.static(buildPath));
    app.get('*', (_request, response) => response.sendFile(path.join(buildPath, 'index.html')));
  }

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3001;
  createApp().listen(port, '127.0.0.1', () => {
    console.log(`Stock dashboard server listening on http://127.0.0.1:${port}`);
  });
}

module.exports = { createApp };
