const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10_000;
const MAX_IMPORT_COLUMNS = 64;

const FIDELITY_COLUMNS = {
  accountNumber: 'account number',
  accountName: 'account name',
  symbol: 'symbol',
  description: 'description',
  quantity: 'quantity',
  lastPrice: 'last price',
  lastPriceChange: 'last price change',
  currentValue: 'current value',
  dayGainLoss: "today's gain/loss dollar",
  dayGainLossPercent: "today's gain/loss percent",
  totalGainLoss: 'total gain/loss dollar',
  totalGainLossPercent: 'total gain/loss percent',
  percentOfAccount: 'percent of account',
  costBasisTotal: 'cost basis total',
  averageCostBasis: 'average cost basis',
  assetType: 'type',
};

export class PortfolioImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PortfolioImportError';
    this.code = code;
  }
}

function appendRow(rows, row, field) {
  const completedRow = [...row, field];
  if (completedRow.length > MAX_IMPORT_COLUMNS) {
    throw new PortfolioImportError('too-many-columns', 'This portfolio file has too many columns.');
  }
  rows.push(completedRow);
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new PortfolioImportError('too-many-rows', 'This portfolio file has too many rows.');
  }
}

export function parseCsvRows(csvText) {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  if (!text.trim()) throw new PortfolioImportError('empty-file', 'The selected portfolio file is empty.');
  if (new Blob([text]).size > MAX_IMPORT_BYTES) {
    throw new PortfolioImportError('file-too-large', 'Portfolio files are limited to 5 MB.');
  }

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field === '') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      if (row.length >= MAX_IMPORT_COLUMNS) {
        throw new PortfolioImportError('too-many-columns', 'This portfolio file has too many columns.');
      }
      field = '';
    } else if (character === '\n' || character === '\r') {
      appendRow(rows, row, field);
      row = [];
      field = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      field += character;
    }
  }

  if (quoted) throw new PortfolioImportError('invalid-csv', 'The selected file contains an unfinished quoted value.');
  if (field || row.length) appendRow(rows, row, field);
  return rows;
}

function normalizedHeader(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function columnMap(headerRow) {
  const available = new Map(headerRow.map((header, index) => [normalizedHeader(header), index]));
  const missing = Object.values(FIDELITY_COLUMNS).filter((header) => !available.has(header));
  if (missing.length) {
    throw new PortfolioImportError('unsupported-format', 'This is not a supported Fidelity Portfolio Positions CSV.');
  }
  return Object.fromEntries(Object.entries(FIDELITY_COLUMNS).map(([field, header]) => [field, available.get(header)]));
}

export function parseFinancialNumber(value) {
  const text = String(value ?? '').trim();
  if (!text || /^(--|n\/a|na)$/i.test(text)) return null;
  const negative = text.startsWith('(') && text.endsWith(')');
  const parsed = Number(text.replace(/[,$%()+]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\*+$/, '').replaceAll('/', '.');
}

function inferAccountType(accountName) {
  const name = String(accountName || '').toLowerCase();
  if (name.includes('roth')) return 'roth-ira';
  if (name.includes('ira') || name.includes('rollover')) return 'traditional-ira';
  if (name.includes('401')) return '401k';
  if (name.includes('403')) return '403b';
  if (name.includes('hsa')) return 'hsa';
  if (name.includes('joint')) return 'joint-taxable';
  if (name.includes('trust')) return 'trust';
  if (name.includes('individual') || name.includes('brokerage') || name.includes('tod')) return 'individual-taxable';
  return 'other';
}

function snapshotDateFromRows(rows) {
  const note = rows.flatMap((row) => row.slice(0, 1)).find((value) => /^date downloaded/i.test(String(value || '').trim()));
  if (!note) return null;
  const text = String(note);
  const isoMatch = text.match(/\b(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  const usMatch = text.match(/\b([01]?\d)[/-]([0-3]?\d)[/-](20\d{2})\b/);
  if (usMatch) return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;
  const namedMatch = text.match(/\b([A-Za-z]{3,9})[- ]([0-3]?\d)[, -]+(20\d{2})\b/);
  if (!namedMatch) return null;
  const parsed = new Date(`${namedMatch[1]} ${namedMatch[2]}, ${namedMatch[3]} 00:00:00 UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

async function accountFingerprint(accountNumber, fingerprintSalt) {
  if (!globalThis.crypto?.subtle || !fingerprintSalt) {
    throw new PortfolioImportError('secure-context-required', 'Secure browser storage is required to import a portfolio.');
  }
  const bytes = new TextEncoder().encode(`${fingerprintSalt}\0fidelity\0${accountNumber}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function positionFromRow(row, columns) {
  const value = (field) => row[columns[field]];
  return {
    symbol: normalizeSymbol(value('symbol')),
    description: String(value('description') || '').trim(),
    quantity: parseFinancialNumber(value('quantity')),
    lastPrice: parseFinancialNumber(value('lastPrice')),
    lastPriceChange: parseFinancialNumber(value('lastPriceChange')),
    marketValue: parseFinancialNumber(value('currentValue')),
    dayGainLoss: parseFinancialNumber(value('dayGainLoss')),
    dayGainLossPercent: parseFinancialNumber(value('dayGainLossPercent')),
    totalGainLoss: parseFinancialNumber(value('totalGainLoss')),
    totalGainLossPercent: parseFinancialNumber(value('totalGainLossPercent')),
    portfolioPercent: parseFinancialNumber(value('percentOfAccount')),
    costBasis: parseFinancialNumber(value('costBasisTotal')),
    averageCostBasis: parseFinancialNumber(value('averageCostBasis')),
    assetType: String(value('assetType') || '').trim(),
  };
}

function sumFinite(items, field) {
  const values = items.map((item) => item[field]).filter(Number.isFinite);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

export async function parseFidelityPositionsCsv(csvText, { fingerprintSalt } = {}) {
  const rows = parseCsvRows(csvText);
  const columns = columnMap(rows[0]);
  const grouped = new Map();

  for (const row of rows.slice(1)) {
    const accountNumber = String(row[columns.accountNumber] || '').trim();
    const accountName = String(row[columns.accountName] || '').trim();
    const position = positionFromRow(row, columns);
    if (!accountNumber || !accountName || (!position.symbol && !position.description)) continue;
    const sourceKey = `${accountNumber}\0${accountName}`;
    if (!grouped.has(sourceKey)) grouped.set(sourceKey, { accountNumber, accountName, positions: [] });
    grouped.get(sourceKey).positions.push(position);
  }

  if (!grouped.size) {
    throw new PortfolioImportError('no-positions', 'No Fidelity positions were found in this file.');
  }

  const accounts = [];
  for (const source of grouped.values()) {
    const fingerprint = await accountFingerprint(source.accountNumber, fingerprintSalt);
    const positions = source.positions.map((position, index) => ({
      ...position,
      id: `${fingerprint}:${position.symbol || 'position'}:${index + 1}`,
    }));
    const marketValue = sumFinite(positions, 'marketValue');
    const portfolioPercent = sumFinite(positions, 'portfolioPercent');
    const warnings = [];
    if (Number.isFinite(portfolioPercent) && Math.abs(portfolioPercent - 100) > 0.5) {
      warnings.push('position-percentages-do-not-total-100');
    }
    accounts.push({
      id: `fidelity:${fingerprint}`,
      sourceFingerprint: fingerprint,
      broker: 'fidelity',
      suggestedAlias: `Fidelity account ${accounts.length + 1}`,
      accountType: inferAccountType(source.accountName),
      positions,
      totals: {
        marketValue,
        costBasis: sumFinite(positions, 'costBasis'),
        totalGainLoss: sumFinite(positions, 'totalGainLoss'),
        portfolioPercent,
      },
      reconciliation: {
        positionCount: positions.length,
        warnings,
      },
    });
  }

  return {
    format: 'fidelity-positions-csv-v1',
    broker: 'fidelity',
    snapshotDate: snapshotDateFromRows(rows),
    accounts,
    privacy: {
      originalFileRetained: false,
      discardedFields: ['account-number', 'account-name', 'download-notes'],
    },
  };
}

export const fidelityImportLimits = {
  maxBytes: MAX_IMPORT_BYTES,
  maxRows: MAX_IMPORT_ROWS,
  maxColumns: MAX_IMPORT_COLUMNS,
};
