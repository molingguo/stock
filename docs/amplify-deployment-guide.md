# Deploying Northstar Markets on AWS Amplify

This guide deploys the existing Vite frontend and Express market-data API together on AWS Amplify Hosting Compute. It preserves the existing Amplify application, connected `main` branch, custom domain, and same-origin `/api/stocks` requests without requiring a separate API Gateway deployment.

AWS references:

- [Deploying an Express server using the deployment manifest](https://docs.aws.amazon.com/amplify/latest/userguide/deploy-express-server.html)
- [Amplify Hosting deployment specification](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html)
- [Amplify build settings](https://docs.aws.amazon.com/amplify/latest/userguide/build-settings.html)
- [Setting Amplify environment variables](https://docs.aws.amazon.com/amplify/latest/userguide/setting-env-vars.html)

## 1. Start with a clean worktree

Check the repository before adding the deployment files:

```bash
git status
```

If `package-lock.json` only contains the previously identified npm peer-metadata churn, revert it:

```bash
git restore package-lock.json
```

## 2. Add an Amplify server entry point

Create `scripts/amplifyServer.js`:

```js
process.env.NODE_ENV = 'production';
process.env.PORT = '3000';

const { createApp } = require('../server/index');

const port = 3000;

createApp().listen(port, '0.0.0.0', () => {
  console.log(`Northstar Markets is listening on port ${port}`);
});
```

Amplify Hosting Compute requires the Node server to listen on port `3000`.

## 3. Add the deployment manifest

Create `deploy-manifest.json` in the repository root:

```json
{
  "version": 1,
  "framework": {
    "name": "express",
    "version": "4.22.2"
  },
  "routes": [
    {
      "path": "/assets/*",
      "target": {
        "kind": "Static",
        "cacheControl": "public, max-age=31536000, immutable"
      }
    },
    {
      "path": "/*.*",
      "target": {
        "kind": "Static",
        "cacheControl": "public, max-age=86400"
      },
      "fallback": {
        "kind": "Compute",
        "src": "default"
      }
    },
    {
      "path": "/*",
      "target": {
        "kind": "Compute",
        "src": "default"
      }
    }
  ],
  "computeResources": [
    {
      "name": "default",
      "runtime": "nodejs22.x",
      "entrypoint": "server.js"
    }
  ]
}
```

This sends compiled assets through Amplify's CDN while routing `/api/stocks`, `/api/health`, and application fallbacks through Express.

## 4. Add the Amplify packaging script

Create `scripts/buildAmplify.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.amplify-hosting');
const compute = path.join(output, 'compute', 'default');
const staticOutput = path.join(output, 'static');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(compute, { recursive: true });
fs.mkdirSync(staticOutput, { recursive: true });

fs.cpSync(path.join(root, 'dist'), staticOutput, { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(compute, 'dist'), {
  recursive: true,
});
fs.cpSync(path.join(root, 'server'), path.join(compute, 'server'), {
  recursive: true,
});

fs.copyFileSync(
  path.join(root, 'scripts', 'amplifyServer.js'),
  path.join(compute, 'server.js')
);
fs.copyFileSync(
  path.join(root, 'package.json'),
  path.join(compute, 'package.json')
);
fs.copyFileSync(
  path.join(root, 'package-lock.json'),
  path.join(compute, 'package-lock.json')
);
fs.copyFileSync(
  path.join(root, 'deploy-manifest.json'),
  path.join(output, 'deploy-manifest.json')
);

const runtimeEnvironment = path.join(root, '.runtime.env');
if (fs.existsSync(runtimeEnvironment)) {
  fs.copyFileSync(runtimeEnvironment, path.join(compute, '.env'));
}

execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts'], {
  cwd: compute,
  stdio: 'inherit',
});
```

This generates Amplify's required directory structure and installs only production dependencies in the compute bundle.

## 5. Add the build command

Add the following entry to the existing `scripts` object in `package.json`:

```json
"build:amplify": "npm run build && node scripts/buildAmplify.js"
```

Keep all existing scripts unchanged.

## 6. Ignore generated deployment files

Add these entries to `.gitignore`:

```gitignore
.amplify-hosting/
.runtime.env
```

Neither generated artifact should be committed.

## 7. Add the Amplify build specification

Create `amplify.yml` in the repository root:

```yaml
version: 1

frontend:
  phases:
    preBuild:
      commands:
        - nvm use 22
        - npm ci
    build:
      commands:
        - env | grep -E '^(MARKET_DATA_PROVIDER|MARKET_CACHE_MINUTES|MARKET_STALE_MINUTES|ZACKS_CACHE_MINUTES|ZACKS_STALE_MINUTES|ZACKS_7_BEST_CACHE_MINUTES|ZACKS_7_BEST_EDITION_URL)=' > .runtime.env
        - npm run build:amplify

  artifacts:
    baseDirectory: .amplify-hosting
    files:
      - '**/*'

  cache:
    paths:
      - .npm/**/*
```

When `amplify.yml` exists in the repository, it takes precedence over build settings stored in the Amplify console.

## 8. Test the deployment bundle locally

Build the bundle:

```bash
npm run build:amplify
```

Confirm that the uncompressed compute bundle is below Amplify's 220 MB limit:

```bash
du -sh .amplify-hosting/compute/default
```

Start the packaged application:

```bash
cd .amplify-hosting/compute/default
node server.js
```

In another terminal, verify the health endpoint:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{"status":"ok"}
```

Verify market data:

```bash
curl "http://localhost:3000/api/stocks?universe=zacksBest"
```

Finally, open `http://localhost:3000` in a browser and confirm that every market tab loads.

## 9. Configure the existing Amplify application

1. Sign in to the AWS Management Console.
2. Open AWS Amplify.
3. Select the existing Northstar Markets application.
4. Open **Hosting → Environment variables**.
5. Select **Manage variables**.
6. Add the following variables:

```text
MARKET_DATA_PROVIDER=public
MARKET_CACHE_MINUTES=15
MARKET_STALE_MINUTES=1440
ZACKS_CACHE_MINUTES=720
ZACKS_STALE_MINUTES=1440
ZACKS_7_BEST_CACHE_MINUTES=1440
```

These values can apply to every branch, or they can be configured as `main` branch overrides.

Do not add `PORT`; the Amplify entry point sets the required port. Do not add `FMP_API_KEY`; the app should use its public provider because the FMP free plan does not include the required endpoints.

Only set `ZACKS_7_BEST_EDITION_URL` when manually supplying a newly resolved report URL. Leaving it unset allows automatic resolution and the verified fallback snapshot.

Do not copy the complete local `.env` file into Amplify.

## 10. Commit and push the deployment configuration

The deployment commit should contain:

```text
.gitignore
amplify.yml
deploy-manifest.json
package.json
scripts/amplifyServer.js
scripts/buildAmplify.js
```

Stage and commit the files:

```bash
git add .gitignore amplify.yml deploy-manifest.json package.json scripts/amplifyServer.js scripts/buildAmplify.js
git commit -m "Deploy the Express market API with Amplify Hosting Compute"
git push origin main
```

Because `main` is already connected, Amplify should automatically start a deployment.

## 11. Monitor the deployment

1. Open the application in the Amplify console.
2. Select the `main` branch.
3. Open the newest deployment.
4. Confirm that **Provision**, **Build**, **Deploy**, and **Verify** succeed.
5. Confirm in the build log that the artifact directory is `.amplify-hosting`.

Amplify should detect `deploy-manifest.json` and provision Hosting Compute for the Express server.

## 12. Verify production

Open the production health endpoint:

```text
https://YOUR_DOMAIN/api/health
```

Expected response:

```json
{"status":"ok"}
```

Then verify the weekly report endpoint:

```text
https://YOUR_DOMAIN/api/stocks?universe=zacksBest
```

Open the application and inspect its browser Network panel. A request such as the following should return HTTP 200 with JSON:

```text
/api/stocks?universe=sp500
```

If it returns `index.html`, Amplify deployed the site as static hosting instead of Hosting Compute. Check that:

- `amplify.yml` uses `.amplify-hosting` as `baseDirectory`.
- `.amplify-hosting/deploy-manifest.json` exists during the build.
- The manifest's compute entry point is `.amplify-hosting/compute/default/server.js`.

## Security and scaling notes

Do not place API keys or other credentials in `.runtime.env`. Amplify warns that build environment values can appear in deployment artifacts. If a paid provider key is added later, move the API to an Amplify Function with secret management or retrieve the key from AWS Secrets Manager at runtime.

This deployment retains the application's in-memory cache, but each Amplify compute instance has its own cache. That is appropriate for light traffic. If usage grows substantially, move the provider cache to DynamoDB so every compute instance shares the same source responses.

This approach uses Amplify Hosting Compute directly, so it does not require separate API Gateway or Lambda deployment steps. Refer to [AWS Amplify pricing](https://aws.amazon.com/amplify/pricing/) for current Hosting Compute allowances and rates.

## Rollback

If the compute deployment fails, revert the deployment commit and push `main` again. Amplify will rebuild the previously working static configuration. The non-secret environment variables can remain in the console because a static Vite build does not automatically expose variables without the `VITE_` prefix.
