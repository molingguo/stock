import { describe, expect, test } from 'vitest';
import {
  PortfolioImportError,
  parseCsvRows,
  parseFidelityPositionsCsv,
  parseFinancialNumber,
} from './fidelityCsv';

const headers = [
  'Account number', 'Account name', 'Symbol', 'Description', 'Quantity', 'Last price',
  'Last price change', 'Current value', "Today's gain/loss dollar", "Today's gain/loss percent",
  'Total gain/loss dollar', 'Total gain/loss percent', 'Percent of account', 'Cost basis total',
  'Average cost basis', 'Type',
];

function csvRow(values) {
  return values.map((value) => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',');
}

function fidelityCsv() {
  return [
    csvRow(headers),
    csvRow(['Z12345678', 'Individual - TOD', 'SPAXX**', 'Fidelity Government Money Market', '', '', '', '$1,000.00', '', '', '', '', '10.00%', '', '', 'Cash']),
    csvRow(['Z12345678', 'Individual - TOD', 'AAPL', 'Apple Inc.', '5', '$200.00', '+$1.00', '$1,000.00', '+$5.00', '+0.50%', '+$100.00', '+11.11%', '10.00%', '$900.00', '$180.00', 'Cash']),
    csvRow(['Z12345678', 'Individual - TOD', 'VOO', 'Vanguard 500 Index Fund ETF Shares', '10', '$800.00', '-$2.00', '$8,000.00', '-$20.00', '-0.25%', '+$1,000.00', '+14.29%', '80.00%', '$7,000.00', '$700.00', 'Margin']),
    csvRow(['R87654321', 'Roth IRA', 'MSFT', 'Microsoft Corporation', '4', '$500.00', '+$2.00', '$2,000.00', '+$8.00', '+0.40%', '($200.00)', '-9.09%', '100.00%', '$2,200.00', '$550.00', 'Cash']),
    '',
    'Date downloaded Jul-26-2026',
    'The information in this file is provided for informational purposes only.',
  ].join('\r\n');
}

describe('Fidelity Portfolio Positions CSV parser', () => {
  test('normalizes multiple accounts and strips source identity', async () => {
    const payload = await parseFidelityPositionsCsv(fidelityCsv(), { fingerprintSalt: 'test-browser-salt' });

    expect(payload.accounts).toHaveLength(2);
    expect(payload.snapshotDate).toBe('2026-07-26');
    expect(payload.accounts[0]).toMatchObject({
      broker: 'fidelity',
      suggestedAlias: 'Fidelity account 1',
      accountType: 'individual-taxable',
      totals: { marketValue: 10000, costBasis: 7900, portfolioPercent: 100 },
      reconciliation: { positionCount: 3, warnings: [] },
    });
    expect(payload.accounts[0].positions[0]).toMatchObject({
      symbol: 'SPAXX',
      quantity: null,
      marketValue: 1000,
      holdingType: 'Cash',
      isCorePosition: true,
    });
    expect(payload.accounts[1]).toMatchObject({
      accountType: 'roth-ira',
      totals: { totalGainLoss: -200 },
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('Z12345678');
    expect(serialized).not.toContain('R87654321');
    expect(serialized).not.toContain('Individual - TOD');
    expect(serialized).not.toContain('Roth IRA');
    expect(serialized).not.toContain('Date downloaded');
    expect(payload.privacy.discardedFields).toEqual(['account-number', 'account-name', 'download-notes']);
  });

  test('creates stable browser-specific account fingerprints', async () => {
    const first = await parseFidelityPositionsCsv(fidelityCsv(), { fingerprintSalt: 'salt-one' });
    const repeated = await parseFidelityPositionsCsv(fidelityCsv(), { fingerprintSalt: 'salt-one' });
    const otherBrowser = await parseFidelityPositionsCsv(fidelityCsv(), { fingerprintSalt: 'salt-two' });

    expect(first.accounts[0].id).toBe(repeated.accounts[0].id);
    expect(first.accounts[0].id).not.toBe(otherBrowser.accounts[0].id);
  });

  test('handles quoted fields, embedded newlines, and accounting numbers', () => {
    expect(parseCsvRows('A,B\r\n"one, two","line 1\nline 2"')).toEqual([
      ['A', 'B'],
      ['one, two', 'line 1\nline 2'],
    ]);
    expect(parseFinancialNumber('($1,234.56)')).toBe(-1234.56);
    expect(parseFinancialNumber('+2.50%')).toBe(2.5);
    expect(parseFinancialNumber('--')).toBeNull();
  });

  test('rejects malformed and unsupported files without returning their contents', async () => {
    expect(() => parseCsvRows('A,B\n"unfinished')).toThrow(PortfolioImportError);
    await expect(parseFidelityPositionsCsv('Symbol,Value\nAAPL,100', { fingerprintSalt: 'salt' }))
      .rejects.toMatchObject({ code: 'unsupported-format' });
    await expect(parseFidelityPositionsCsv(csvRow(headers), { fingerprintSalt: 'salt' }))
      .rejects.toMatchObject({ code: 'no-positions' });
  });
});
