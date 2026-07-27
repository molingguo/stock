import { PortfolioImportError, parseCsvRows, parseFinancialNumber } from './fidelityCsv';

const ETRADE_COLUMNS = {
  symbol: 'symbol',
  lastPrice: 'last price $',
  lastPriceChange: 'change $',
  lastPriceChangePercent: 'change %',
  dayGainLoss: "day's gain $",
  quantity: 'qty #',
  averageCostBasis: 'price paid $',
  totalGainLoss: 'total gain $',
  totalGainLossPercent: 'total gain %',
  marketValue: 'value $',
};

function normalized(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function findHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const headers = new Set(row.map(normalized));
    return Object.values(ETRADE_COLUMNS).every((header) => headers.has(header));
  });
}

function columnMap(header) {
  const available = new Map(header.map((value, index) => [normalized(value), index]));
  return Object.fromEntries(Object.entries(ETRADE_COLUMNS).map(([field, label]) => [field, available.get(label)]));
}

function inferAccountType(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('roth')) return 'roth-ira';
  if (text.includes('ira') || text.includes('rollover')) return 'traditional-ira';
  if (text.includes('401')) return '401k';
  if (text.includes('403')) return '403b';
  if (text.includes('hsa')) return 'hsa';
  if (text.includes('joint')) return 'joint-taxable';
  if (text.includes('trust')) return 'trust';
  if (text.includes('individual') || text.includes('brokerage') || text.includes('tod')) return 'individual-taxable';
  return 'other';
}

async function accountFingerprint(sourceAccount, fingerprintSalt) {
  if (!globalThis.crypto?.subtle || !fingerprintSalt) {
    throw new PortfolioImportError('secure-context-required', 'Secure browser storage is required to import a portfolio.');
  }
  const bytes = new TextEncoder().encode(`${fingerprintSalt}\0etrade\0${sourceAccount}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function snapshotDate(rows) {
  const note = rows.flat().map((value) => String(value || '').trim()).find((value) => /^generated at\b/i.test(value));
  const match = note?.match(/\b([A-Za-z]{3,9})\s+([0-3]?\d)\s+(20\d{2})\b/);
  if (!match) return null;
  const parsed = new Date(`${match[1]} ${match[2]}, ${match[3]} 00:00:00 UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function sumFinite(items, field) {
  const values = items.map((item) => item[field]).filter(Number.isFinite);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

export async function parseEtradePortfolioCsv(csvText, { fingerprintSalt } = {}) {
  const rows = parseCsvRows(csvText);
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) {
    throw new PortfolioImportError('unsupported-format', 'This is not a supported E*TRADE Portfolio CSV.');
  }
  const columns = columnMap(rows[headerIndex]);
  const summaryHeaderIndex = rows.slice(0, headerIndex).findIndex((row) => normalized(row[0]) === 'account'
    && normalized(row[1]) === 'net account value');
  const sourceAccount = String(rows[summaryHeaderIndex + 1]?.[0] || '').trim();
  if (summaryHeaderIndex < 0 || !sourceAccount) {
    throw new PortfolioImportError('missing-account', 'The E*TRADE export does not contain an account identifier.');
  }

  const totalRow = rows.slice(headerIndex + 1).find((row) => normalized(row[columns.symbol]) === 'total');
  const positions = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const sourceSymbol = String(row[columns.symbol] || '').trim().toUpperCase();
    if (!sourceSymbol || sourceSymbol === 'TOTAL') continue;
    const isCash = sourceSymbol === 'CASH';
    if (!isCash && !/^[A-Z][A-Z0-9./-]{0,14}$/.test(sourceSymbol)) continue;
    const symbol = sourceSymbol.replaceAll('/', '.');
    const marketValue = parseFinancialNumber(row[columns.marketValue]);
    const totalGainLoss = parseFinancialNumber(row[columns.totalGainLoss]);
    const costBasis = Number.isFinite(marketValue) && Number.isFinite(totalGainLoss)
      ? marketValue - totalGainLoss
      : null;
    positions.push({
      symbol,
      description: isCash ? 'Cash balance' : symbol,
      quantity: parseFinancialNumber(row[columns.quantity]),
      lastPrice: parseFinancialNumber(row[columns.lastPrice]),
      lastPriceChange: parseFinancialNumber(row[columns.lastPriceChange]),
      lastPriceChangePercent: parseFinancialNumber(row[columns.lastPriceChangePercent]),
      marketValue,
      dayGainLoss: parseFinancialNumber(row[columns.dayGainLoss]),
      dayGainLossPercent: null,
      totalGainLoss,
      totalGainLossPercent: parseFinancialNumber(row[columns.totalGainLossPercent]),
      portfolioPercent: null,
      costBasis,
      averageCostBasis: parseFinancialNumber(row[columns.averageCostBasis]),
      holdingType: isCash ? 'Cash' : '',
      isCorePosition: isCash,
    });
  }
  if (!positions.length) throw new PortfolioImportError('no-positions', 'No E*TRADE positions were found in this file.');

  const marketValue = sumFinite(positions, 'marketValue');
  const sourceMarketValue = totalRow ? parseFinancialNumber(totalRow[columns.marketValue]) : null;
  const warnings = [];
  if (Number.isFinite(sourceMarketValue) && Number.isFinite(marketValue) && Math.abs(sourceMarketValue - marketValue) > 0.02) {
    warnings.push('position-values-do-not-match-total');
  }
  const fingerprint = await accountFingerprint(sourceAccount, fingerprintSalt);
  const normalizedPositions = positions.map((position, index) => ({
    ...position,
    portfolioPercent: Number.isFinite(marketValue) && marketValue !== 0 && Number.isFinite(position.marketValue)
      ? (position.marketValue / marketValue) * 100
      : null,
    id: `${fingerprint}:${position.symbol || 'position'}:${index + 1}`,
  }));
  const totalGainLoss = sumFinite(normalizedPositions, 'totalGainLoss');
  const costBasis = sumFinite(normalizedPositions, 'costBasis');

  return {
    format: 'etrade-portfolio-csv-v1',
    broker: 'etrade',
    snapshotDate: snapshotDate(rows),
    accounts: [{
      id: `etrade:${fingerprint}`,
      sourceFingerprint: fingerprint,
      broker: 'etrade',
      suggestedAlias: 'E*TRADE account 1',
      accountType: inferAccountType(sourceAccount),
      positions: normalizedPositions,
      totals: {
        marketValue,
        costBasis,
        totalGainLoss,
        portfolioPercent: Number.isFinite(marketValue) && marketValue !== 0 ? 100 : null,
      },
      reconciliation: { positionCount: normalizedPositions.length, warnings },
    }],
    privacy: {
      originalFileRetained: false,
      discardedFields: ['account-identifier', 'account-label', 'account-summary', 'download-notes'],
    },
  };
}

export function isEtradePortfolioRows(rows) {
  return findHeaderIndex(rows) >= 0;
}
