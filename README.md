# Northstar Markets

A responsive U.S. market explorer with live S&P 500 constituents, popular ETFs, and a market-cap-ranked U.S. Extended Market view.

## Data architecture

The React app calls only the local `/api/stocks` endpoint. By default, the Node/Express server uses Nasdaq's stock screener for current U.S. quotes and market-cap rankings, State Street's daily SPY holdings workbook for current S&P 500 membership, and Zacks for its proprietary 1–5 rank and forward P/E data. No API key is required.

The Popular ETFs view uses a curated, diversified set of widely followed U.S.-listed funds and orders the available funds by current fund assets. Live price, change, volume, fund assets, and available Zacks ranks come from one cached quote-feed batch; P/E is intentionally hidden because it is not a meaningful or consistently available fund-level metric.

The U.S. Extended Market view ranks U.S. stocks by market cap, takes the top 1,000, and removes every current S&P 500 constituent so the two stock universes do not overlap.

The server is intentionally conservative with provider usage:

- S&P 500 data uses one Nasdaq universe request and one State Street holdings request.
- Popular ETFs use one Zacks batch for the complete curated universe.
- S&P 500 and U.S. Extended Market views share the same cached Nasdaq and State Street source responses.
- Zacks ranks, forward P/E, and fallback quote fields are requested in sequential batches of at most 200 symbols and cached per ticker for 12 hours, matching the rank's slower update cadence.
- Successful responses are cached in memory for 15 minutes by default.
- Concurrent requests share in-flight universe and source requests.
- Cached data can be served for up to 24 hours if a source is unavailable or rate limiting.
- The browser also keeps each universe response for 60 seconds.

This is a good default for a single application instance. For a scaled deployment, replace the in-memory cache with Redis or another shared cache so all instances reuse the same provider response.

## Setup

Use Node.js 20.19 or newer:

```bash
cp .env.example .env
npm install
npm start
```

`npm start` runs the API at `http://localhost:3001` and the React development app at `http://localhost:3000`.

## Configuration

| Variable | Default | Purpose |
| --- | ---: | --- |
| `MARKET_DATA_PROVIDER` | `public` | Use `public`, or `fmp` for a compatible paid FMP plan |
| `FMP_API_KEY` | unset | Server-only credential required when provider is `fmp` |
| `MARKET_CACHE_MINUTES` | `15` | Fresh provider-response lifetime |
| `MARKET_STALE_MINUTES` | `1440` | Maximum stale fallback lifetime |
| `ZACKS_CACHE_MINUTES` | `720` | Fresh Zacks-rank lifetime |
| `ZACKS_STALE_MINUTES` | `1440` | Maximum stale Zacks-rank fallback lifetime |
| `PORT` | `3001` | API/production server port |

FMP's free plan currently returns HTTP 402 for the constituent and batch-quote endpoints this app needs. Keep the default public provider unless your FMP subscription includes those endpoints. If you use FMP, do not prefix its key with `REACT_APP_`; doing so would expose it in the browser bundle.

Source references: [Nasdaq Stock Screener](https://www.nasdaq.com/market-activity/stocks/screener), [State Street SPY holdings](https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-sp-500-etf-trust-spy), and [Zacks Rank methodology](https://www.zacks.com/zrank/about-zacks-rank-in-industry.php).

## Commands

```bash
npm start          # API and React development servers
npm test           # React and server tests
npm run build      # Production Vite build
npm run serve      # Serve the API and production build
```

## API

`GET /api/stocks?universe=sp500|popularEtfs|extendedMarket`

Responses include normalized stock rows with `zacksRank` and `zacksRankText`, plus `zacksCoverage`, `asOf`, `refreshAfter`, and cache-status metadata. Quotes and ratings may be delayed and are intended for research, not investment advice.
