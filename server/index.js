const express = require('express');
const path = require('path');
const { loadEnvFile } = require('./env');

loadEnvFile();

const { createMarketDataService } = require('./marketData');

function createApp({ marketData = createMarketDataService() } = {}) {
  const app = express();

  app.disable('x-powered-by');

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.get('/api/stocks', async (request, response) => {
    try {
      const data = await marketData.getStocks(request.query.universe);
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

  if (process.env.NODE_ENV === 'production') {
    const buildPath = path.resolve(__dirname, '..', 'dist');
    app.use(express.static(buildPath));
    app.get('*', (_request, response) => response.sendFile(path.join(buildPath, 'index.html')));
  }

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3001;
  createApp().listen(port, () => {
    console.log(`Stock dashboard server listening on http://localhost:${port}`);
  });
}

module.exports = { createApp };
