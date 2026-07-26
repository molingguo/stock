# Northstar Markets

A responsive U.S. stock explorer with live S&P 500 constituents and market-cap-ranked Top 500 and Top 1000 views.

## Data architecture

The React app calls only the local `/api/stocks` endpoint. The Node/Express server keeps the Financial Modeling Prep (FMP) key private and uses FMP's live constituent, company screener, and batch quote endpoints.

The server is intentionally conservative with provider usage:

- S&P 500 data uses one constituent request plus quote batches of at most 200 symbols.
- Top 500 and Top 1000 use one shared Top 1000 cache, so switching between them does not refetch the provider.
- Successful responses are cached in memory for 15 minutes by default.
- Concurrent requests for the same universe share one in-flight provider request.
- Quote batches run sequentially to avoid request bursts.
- Cached data can be served for up to 24 hours if FMP is unavailable or rate limiting.
- The browser also keeps each universe response for 60 seconds.

This is a good default for a single application instance. For a scaled deployment, replace the in-memory cache with Redis or another shared cache so all instances reuse the same provider response.

## Setup

Use Node.js 20.19 or newer and create an FMP API key. Endpoint availability depends on the FMP plan attached to that key.

```bash
cp .env.example .env
# Add your FMP_API_KEY to .env
npm install
npm start
```

`npm start` runs the API at `http://localhost:3001` and the React development app at `http://localhost:3000`.

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `FMP_API_KEY` | required | Server-only FMP credential |
| `MARKET_CACHE_MINUTES` | `15` | Fresh provider-response lifetime |
| `MARKET_STALE_MINUTES` | `1440` | Maximum stale fallback lifetime |
| `PORT` | `3001` | API/production server port |

Do not prefix the API key with `REACT_APP_`; doing so would expose it in the browser bundle.

## Commands

```bash
npm start          # API and React development servers
npm test           # React and server tests
npm run build      # Production Vite build
npm run serve      # Serve the API and production build
```

## API

`GET /api/stocks?universe=sp500|top500|top1000`

Responses include normalized stock rows plus `asOf`, `refreshAfter`, and `cacheStatus` metadata. Quotes may be delayed and are intended for research, not investment advice.
