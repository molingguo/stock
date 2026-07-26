# Deploying Northstar Markets on AWS Amplify

The repository is configured to deploy the Vite frontend and Express market-data API together on AWS Amplify Hosting Compute. The existing Amplify application, connected `main` branch, custom domain, and same-origin `/api/stocks` requests are preserved. No separate API Gateway deployment is required.

AWS references:

- [Deploying an Express server using the deployment manifest](https://docs.aws.amazon.com/amplify/latest/userguide/deploy-express-server.html)
- [Amplify Hosting deployment specification](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html)
- [Amplify build settings](https://docs.aws.amazon.com/amplify/latest/userguide/build-settings.html)
- [Setting Amplify environment variables](https://docs.aws.amazon.com/amplify/latest/userguide/setting-env-vars.html)
- [SEC XBRL data APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)

## Repository setup completed

The following deployment automation is already implemented:

- `amplify.yml` builds the application with Node.js 22 and publishes `.amplify-hosting`.
- `deploy-manifest.json` sends static assets through Amplify's CDN and all `/api/*` requests through Hosting Compute.
- `scripts/amplifyServer.js` starts Express on Amplify's required port.
- `scripts/buildAmplify.js` assembles the static and compute artifacts, installs production-only dependencies, copies the approved runtime settings into the server-only compute bundle, and enforces Amplify's 220 MB compute limit.
- `npm run build:amplify` produces the complete deployment artifact.
- `npm run refresh:scores` refreshes a generated Piotroski F-score cache from SEC bulk XBRL frames before Amplify packages the server.
- `.amplify-hosting` is excluded from Git.

The packaged application has been verified locally:

- All application and server tests pass.
- The Vite production build passes.
- The Amplify compute artifact is approximately 44 MB by logical file size.
- `/`, `/api/health`, and `/api/stocks?universe=zacksBest` return HTTP 200 from the packaged server.

The remaining work requires access to the AWS Amplify console and permission to push the local `main` branch.

### How SEC F-scores are refreshed

Piotroski F-scores are calculated from annual SEC filing facts during an Amplify build, not during a page request. The refresh uses fewer than 30 bulk SEC frame requests for the entire market, writes only complete nine-signal scores to `server/data/piotroskiScores.json`, and then packages that generated cache with the Express server. Normal `/api/stocks` requests only read the local cache and therefore add no SEC calls per ticker or visitor.

If SEC is temporarily unavailable during a deployment, the refresh command logs a warning and packages the checked-in cache instead. No additional Amplify environment variable or paid API key is required. A score is not shown for ETFs or companies whose filing facts cannot support all nine signals.

## 1. Add the Amplify environment variables

Configure these variables before pushing the deployment commit so the first automatic deployment receives the correct settings.

1. Sign in to the [AWS Management Console](https://console.aws.amazon.com/).
2. Open **AWS Amplify**.
3. Select the existing Northstar Markets application.
4. Open **Hosting → Environment variables**.
5. Select **Manage variables**.
6. Add the following values:

| Variable | Value |
| --- | --- |
| `MARKET_DATA_PROVIDER` | `public` |
| `MARKET_CACHE_MINUTES` | `15` |
| `MARKET_STALE_MINUTES` | `1440` |
| `ZACKS_CACHE_MINUTES` | `720` |
| `ZACKS_STALE_MINUTES` | `1440` |
| `ZACKS_7_BEST_CACHE_MINUTES` | `1440` |
| `INDEX_CACHE_MINUTES` | `15` |
| `INDEX_STALE_MINUTES` | `1440` |
| `ALPHA_VANTAGE_API_KEY` | Your Alpha Vantage API key |
| `ETF_HOLDINGS_CACHE_MINUTES` | `1440` |
| `ETF_HOLDINGS_STALE_MINUTES` | `10080` |

Create a free key at [Alpha Vantage](https://www.alphavantage.co/support/#api-key) if you do not already have one. The key enables the ETF Holdings tab only; all charts and existing market tables continue working without it. Keep the variable name exactly `ALPHA_VANTAGE_API_KEY`—never prefix it with `VITE_` or `REACT_APP_`, because those prefixes are intended for browser-visible values.

7. Apply the values to all branches, or add a `main` branch override if other branches need different settings.
8. Select **Save**.

Do not add:

- `PORT`: the Amplify server entry point handles the required port automatically.
- `FMP_API_KEY`: the application uses the public provider because FMP's free plan does not include the required endpoints.
- Any value copied wholesale from the local `.env` file.

If `FMP_API_KEY` already exists in the Amplify environment settings, remove it unless another deployed component still needs it.

### Optional Zacks edition override

Normally, leave `ZACKS_7_BEST_EDITION_URL` unset. The service attempts to resolve the current report and falls back to the last verified edition when Zacks blocks the server request.

Only add this variable when manually supplying a newer resolved report URL:

```text
ZACKS_7_BEST_EDITION_URL=https://www.zacks.com/registration/ultimatetrader/welcome/eoffer/3de3?edition=YYYYMMDD...
```

Remove or replace the override when it becomes outdated; otherwise it intentionally pins the application to that edition.

## 2. Confirm the connected branch settings

In the Amplify console:

1. Open **App settings → Branch settings**.
2. Confirm that `main` is connected.
3. Confirm that automatic builds are enabled for `main`.
4. Confirm that the production domain is still associated with `main`.

Do not manually paste a different build specification into the console. The committed `amplify.yml` is the source of truth and takes precedence over console build settings.

## 3. Push the prepared commit

From the repository on the local machine, inspect the prepared commit:

```bash
git status
git log -1 --oneline
```

The worktree should be clean. Push the connected branch:

```bash
git push origin main
```

Pushing `main` should start an Amplify deployment automatically.

## 4. Monitor the build

1. Return to the Amplify application.
2. Select the `main` branch.
3. Open the newest deployment.
4. Confirm that **Provision**, **Build**, **Deploy**, and **Verify** complete successfully.
5. Inspect the build log and confirm that it runs:

```text
nvm use 22
npm ci
npm run refresh:scores
npm run build:amplify
```

Near the end of the build, expect a message similar to:

```text
Amplify deployment bundle created (44.0 MB compute).
```

The exact size may change slightly after dependency updates but must remain below 220 MB.

The artifact base directory should be:

```text
.amplify-hosting
```

Amplify should detect `.amplify-hosting/deploy-manifest.json` and provision Hosting Compute for the Express server.

## 5. Verify the production API

After deployment, open the health endpoint using the Amplify or custom domain:

```text
https://YOUR_DOMAIN/api/health
```

Expected response:

```json
{"status":"ok"}
```

Next, open:

```text
https://YOUR_DOMAIN/api/stocks?universe=zacksBest
```

The response should be JSON containing:

- `"universe": "zacksBest"`
- `"count": 7`
- `reportDate`
- `zacksCoverage`
- `piotroskiCoverage`
- `piotroskiScoreYear`
- A seven-item `stocks` array

Also verify the default universe:

```text
https://YOUR_DOMAIN/api/stocks?universe=sp500
```

The first uncached request can take longer because it retrieves and enriches the market universe. Subsequent requests should use the provider cache.

## 6. Verify the production UI

1. Open the main application URL.
2. Confirm that the S&P 500 table loads.
3. Open **Popular ETFs** and confirm that prices and available Zacks ranks appear.
4. Select an ETF name, confirm the modal chart loads, open **Holdings**, and confirm portfolio metrics and positions appear.
5. Close and reopen the same ETF Holdings tab, then confirm the browser Network panel does not make another `/api/etf-holdings` request during the 24-hour browser-cache window.
6. Open **Extended Market** and confirm that its row numbers preserve the original top-1000 ranks.
7. Open **7 Best Stocks** and confirm that the report date and seven tickers appear.
8. Confirm that available stock rows show an SEC-derived **F-score** between 0 and 9 and that ETFs show no score.
9. Test at a mobile viewport or on a phone.
10. Open the browser Network panel and confirm `/api/stocks?...` requests return HTTP 200 with JSON.

## Troubleshooting

### `/api/health` returns the application HTML

Amplify deployed the application as a static site instead of Hosting Compute. Check the build log and confirm:

- The checked-out commit contains `amplify.yml` and `deploy-manifest.json`.
- `amplify.yml` uses `.amplify-hosting` as `baseDirectory`.
- `.amplify-hosting/deploy-manifest.json` exists after `npm run build:amplify`.
- `.amplify-hosting/compute/default/server.js` exists.

### The build still publishes `dist`

The branch is probably building an older commit or ignoring the repository build specification. Confirm the deployment commit SHA matches `main` and that the build log says it loaded `amplify.yml` from the repository.

### The application shows an FMP HTTP 402 error

Confirm that `MARKET_DATA_PROVIDER` is exactly `public`, save the environment setting, and redeploy `main`.

### `/api/stocks` returns HTTP 500

Inspect the Hosting Compute logs for the request. Confirm the runtime can make outbound HTTPS requests and that no stale `MARKET_DATA_PROVIDER=fmp` branch override exists.

The Zacks report may show `Verified report snapshot`. This is expected when Zacks blocks automated report resolution; quotes and ranks are still refreshed separately.

The S&P 500 and Nasdaq Composite summary cards use one combined index request cached for 15 minutes. If that request fails, the stock table continues loading and a cached index value is used for up to 24 hours; without a cached value, only the two index cards show unavailable data.

### The ETF Holdings tab asks for an API key

Confirm `ALPHA_VANTAGE_API_KEY` exists in the Amplify `main` branch environment, then select **Redeploy this version** so the build can package the value into the server-only compute runtime. Verify the endpoint directly:

```text
https://YOUR_DOMAIN/api/etf-holdings?symbol=SPY
```

It should return JSON with `"provider":"Alpha Vantage"` and a `holdings` array. A provider limit response is served as an error only when no cache is available; a previously retrieved profile remains eligible as a stale fallback for seven days.

### The compute artifact exceeds 220 MB

The build script stops before deployment when this happens. Review newly added production dependencies and ensure frontend-only libraries have not unnecessarily expanded the server artifact.

## Security, caching, and scaling notes

The deployment packager copies only this explicit allowlist into the compute runtime:

```text
MARKET_DATA_PROVIDER
MARKET_CACHE_MINUTES
MARKET_STALE_MINUTES
ZACKS_CACHE_MINUTES
ZACKS_STALE_MINUTES
ZACKS_7_BEST_CACHE_MINUTES
ZACKS_7_BEST_EDITION_URL
INDEX_CACHE_MINUTES
INDEX_STALE_MINUTES
ALPHA_VANTAGE_API_KEY
ETF_HOLDINGS_CACHE_MINUTES
ETF_HOLDINGS_STALE_MINUTES
```

`ALPHA_VANTAGE_API_KEY` is written only inside the Hosting Compute artifact and is never copied to Vite's static files or returned by an API response. Access to Amplify settings, build logs, and deployment artifacts should still be restricted as for any server credential. The packager deliberately excludes `FMP_API_KEY` and every unrecognized environment variable.

ETF holdings are requested only after a visitor opens the Holdings tab. The browser local-storage cache, Amplify CDN response cache, per-instance 24-hour memory cache, in-flight request deduplication, and seven-day stale fallback all reduce upstream calls. Each Amplify compute instance still has a separate memory cache, but the CDN cache normally shares the successful response before another instance reaches Alpha Vantage. This is appropriate for light traffic. If usage grows substantially, move provider responses into DynamoDB so all compute instances share one cache.

Refer to [AWS Amplify pricing](https://aws.amazon.com/amplify/pricing/) for current Hosting Compute allowances and rates.

## Rollback

If the Hosting Compute deployment fails and cannot be corrected quickly:

1. Revert the deployment commit locally:

   ```bash
   git revert DEPLOYMENT_COMMIT_SHA
   ```

2. Push the revert:

   ```bash
   git push origin main
   ```

Amplify will rebuild the previously working static deployment. The non-secret environment variables can remain in the console because a static Vite build does not expose variables unless the frontend explicitly imports them.
