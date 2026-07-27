import { fidelityImportLimits } from './fidelityCsv';

const PORTFOLIO_FINGERPRINT_SALT_KEY = 'northstar:portfolio-fingerprint-salt:v1';

function randomSalt() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure browser storage is unavailable.');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getPortfolioFingerprintSalt() {
  try {
    const existing = window.localStorage.getItem(PORTFOLIO_FINGERPRINT_SALT_KEY);
    if (existing) return existing;
    const salt = randomSalt();
    window.localStorage.setItem(PORTFOLIO_FINGERPRINT_SALT_KEY, salt);
    return salt;
  } catch {
    return randomSalt();
  }
}

function createImportWorker(WorkerClass) {
  if (WorkerClass) return new WorkerClass(new URL('./importWorker.js', import.meta.url), { type: 'module' });
  return new Worker(new URL('./importWorker.js', import.meta.url), { type: 'module' });
}

export function importPortfolioFile(file, { WorkerClass } = {}) {
  if (!file || typeof file.text !== 'function') return Promise.reject(new Error('Select a supported portfolio CSV file.'));
  if (file.size > fidelityImportLimits.maxBytes) return Promise.reject(new Error('Portfolio files are limited to 5 MB.'));
  if (typeof (WorkerClass || globalThis.Worker) !== 'function') {
    return Promise.reject(new Error('This browser cannot securely process portfolio files.'));
  }

  return new Promise((resolve, reject) => {
    const worker = createImportWorker(WorkerClass);
    const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    let csvText = null;

    const finish = () => {
      csvText = null;
      worker.terminate();
    };

    worker.addEventListener('message', (event) => {
      if (event.data?.id !== requestId) return;
      finish();
      if (event.data.ok) resolve(event.data.payload);
      else reject(Object.assign(new Error(event.data.error?.message || 'Unable to import this portfolio file.'), {
        code: event.data.error?.code || 'import-failed',
      }));
    });
    worker.addEventListener('error', () => {
      finish();
      reject(new Error('The local portfolio importer stopped unexpectedly.'));
    });

    file.text()
      .then((text) => {
        csvText = text;
        worker.postMessage({
          id: requestId,
          type: 'import-portfolio',
          csvText,
          fingerprintSalt: getPortfolioFingerprintSalt(),
        });
        csvText = null;
      })
      .catch((error) => {
        finish();
        reject(error);
      });
  });
}

export const importFidelityFile = importPortfolioFile;

export function mergePortfolioAccounts(currentAccounts, importedAccounts, importedAt = new Date().toISOString()) {
  const byId = new Map(currentAccounts.map((account) => [account.id, account]));
  importedAccounts.forEach((account) => {
    const existing = byId.get(account.id);
    byId.set(account.id, {
      ...account,
      alias: account.alias || existing?.alias || account.suggestedAlias,
      accountType: account.accountType || existing?.accountType || 'other',
      importedAt,
    });
  });
  return [...byId.values()];
}

function sumFinite(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((total, value) => total + value, 0) : null;
}

export function combinePortfolioPositions(accounts, selectedAccountId = 'all') {
  const selected = selectedAccountId === 'all'
    ? accounts
    : accounts.filter((account) => account.id === selectedAccountId);
  const combined = new Map();

  selected.forEach((account) => {
    account.positions.forEach((position) => {
      const key = position.symbol || position.description;
      const existing = combined.get(key) || {
        id: key,
        symbol: position.symbol,
        description: position.description,
        holdingType: position.holdingType,
        isCorePosition: position.isCorePosition,
        accounts: [],
        quantities: [],
        marketValues: [],
        costBases: [],
        totalGainLosses: [],
        dayGainLosses: [],
        lastPrice: position.lastPrice,
      };
      existing.accounts.push(account.alias);
      existing.quantities.push(position.quantity);
      existing.marketValues.push(position.marketValue);
      existing.costBases.push(position.costBasis);
      existing.totalGainLosses.push(position.totalGainLoss);
      existing.dayGainLosses.push(position.dayGainLoss);
      combined.set(key, existing);
    });
  });

  const rows = [...combined.values()].map((position) => ({
    id: position.id,
    symbol: position.symbol,
    description: position.description,
    holdingType: position.holdingType,
    isCorePosition: position.isCorePosition,
    accountAliases: [...new Set(position.accounts)],
    quantity: sumFinite(position.quantities),
    marketValue: sumFinite(position.marketValues),
    costBasis: sumFinite(position.costBases),
    totalGainLoss: sumFinite(position.totalGainLosses),
    dayGainLoss: sumFinite(position.dayGainLosses),
    lastPrice: position.lastPrice,
  })).sort((left, right) => (right.marketValue || 0) - (left.marketValue || 0));
  const totalValue = sumFinite(rows.map((position) => position.marketValue)) || 0;
  return rows.map((position) => ({
    ...position,
    portfolioPercent: totalValue && Number.isFinite(position.marketValue)
      ? (position.marketValue / totalValue) * 100
      : null,
  }));
}

export { PORTFOLIO_FINGERPRINT_SALT_KEY };
