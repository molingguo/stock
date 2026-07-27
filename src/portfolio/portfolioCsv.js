import { PortfolioImportError, parseCsvRows, parseFidelityPositionsCsv } from './fidelityCsv';
import { isEtradePortfolioRows, parseEtradePortfolioCsv } from './etradeCsv';

function normalized(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function parsePortfolioCsv(csvText, options = {}) {
  const rows = parseCsvRows(csvText);
  const firstHeaders = new Set((rows[0] || []).map(normalized));
  if (firstHeaders.has('account number') && firstHeaders.has('current value')) {
    return parseFidelityPositionsCsv(csvText, options);
  }
  if (isEtradePortfolioRows(rows)) return parseEtradePortfolioCsv(csvText, options);
  throw new PortfolioImportError(
    'unsupported-format',
    'Select an original Fidelity Portfolio Positions or E*TRADE Portfolio CSV.'
  );
}
