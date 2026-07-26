const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MAX_COMPUTE_BYTES = 220 * 1024 * 1024;
const RUNTIME_ENV_KEYS = [
  'MARKET_DATA_PROVIDER',
  'MARKET_CACHE_MINUTES',
  'MARKET_STALE_MINUTES',
  'ZACKS_CACHE_MINUTES',
  'ZACKS_STALE_MINUTES',
  'ZACKS_7_BEST_CACHE_MINUTES',
  'ZACKS_7_BEST_EDITION_URL',
];

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.amplify-hosting');
const compute = path.join(output, 'compute', 'default');
const staticOutput = path.join(output, 'static');

function directorySize(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return total + directorySize(entryPath);
    return total + fs.lstatSync(entryPath).size;
  }, 0);
}

function copyRuntimeEnvironment() {
  const lines = RUNTIME_ENV_KEYS.flatMap((key) => {
    const value = process.env[key];
    if (value === undefined || value === '') return [];
    if (/\r|\n/.test(value)) throw new Error(`${key} must not contain a newline.`);
    return [`${key}=${JSON.stringify(value)}`];
  });

  if (lines.length) {
    fs.writeFileSync(path.join(compute, '.env'), `${lines.join('\n')}\n`, { mode: 0o600 });
  }
}

if (path.basename(output) !== '.amplify-hosting') {
  throw new Error('Refusing to replace an unexpected Amplify output directory.');
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(compute, { recursive: true });
fs.mkdirSync(staticOutput, { recursive: true });

fs.cpSync(path.join(root, 'dist'), staticOutput, { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(compute, 'dist'), { recursive: true });
fs.cpSync(path.join(root, 'server'), path.join(compute, 'server'), {
  recursive: true,
  filter: (source) => !source.endsWith('.test.js'),
});

fs.copyFileSync(path.join(root, 'scripts', 'amplifyServer.js'), path.join(compute, 'server.js'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(compute, 'package.json'));
fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(compute, 'package-lock.json'));
fs.copyFileSync(path.join(root, 'deploy-manifest.json'), path.join(output, 'deploy-manifest.json'));

copyRuntimeEnvironment();

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npmCommand, ['ci', '--omit=dev', '--ignore-scripts'], {
  cwd: compute,
  stdio: 'inherit',
});

const computeBytes = directorySize(compute);
if (computeBytes > MAX_COMPUTE_BYTES) {
  throw new Error(`Amplify compute bundle is ${(computeBytes / 1024 / 1024).toFixed(1)} MB; the limit is 220 MB.`);
}

console.log(`Amplify deployment bundle created (${(computeBytes / 1024 / 1024).toFixed(1)} MB compute).`);
