import { describe, expect, test } from 'vitest';
import { parseEtradePortfolioCsv } from './etradeCsv';
import { parsePortfolioCsv } from './portfolioCsv';

const positionHeaders = [
  'Symbol', 'Last Price $', 'Change $', 'Change %', "Day's Gain $", 'Qty #',
  'Price Paid $', 'Total Gain $', 'Total Gain %', 'Value $',
];

function row(values) {
  return values.map((value) => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',');
}

function etradeCsv({ includeAccount = true } = {}) {
  return [
    row(['Account Summary']),
    row(['Account', 'Net Account Value', 'Total Gain $', 'Total Gain %', "Day's Gain Unrealized $", "Day's Gain Unrealized %", 'Available For Withdrawal', 'Cash Purchasing Power']),
    row([includeAccount ? 'Individual Brokerage XXXX1234' : '', '1100', '100', '10', '5', '0.5', '100', '100']),
    '',
    row(['Positions for All Accounts']),
    row(['Filters applied: All positions']),
    '',
    row(positionHeaders),
    row(['AAPL', '200', '1', '0.5', '5', '5', '180', '100', '11.11', '1000']),
    row(['CASH', '', '', '', '', '', '', '', '', '100']),
    row(['TOTAL', '', '', '', '5', '', '', '100', '10', '1100']),
    '',
    row(['Generated at Jul 26 2026 11:30 PM ET']),
  ].join('\r\n');
}

describe('E*TRADE Portfolio CSV parser', () => {
  test('normalizes securities, cash, totals, and the generated date', async () => {
    const payload = await parseEtradePortfolioCsv(etradeCsv(), { fingerprintSalt: 'test-browser-salt' });

    expect(payload).toMatchObject({
      format: 'etrade-portfolio-csv-v1',
      broker: 'etrade',
      snapshotDate: '2026-07-26',
    });
    expect(payload.accounts).toHaveLength(1);
    expect(payload.accounts[0]).toMatchObject({
      broker: 'etrade',
      suggestedAlias: 'E*TRADE account 1',
      accountType: 'individual-taxable',
      totals: { marketValue: 1100, costBasis: 900, totalGainLoss: 100, portfolioPercent: 100 },
      reconciliation: { positionCount: 2, warnings: [] },
    });
    expect(payload.accounts[0].positions[0]).toMatchObject({
      symbol: 'AAPL', quantity: 5, marketValue: 1000, costBasis: 900, portfolioPercent: 1000 / 11,
    });
    expect(payload.accounts[0].positions[1]).toMatchObject({
      symbol: 'CASH', description: 'Cash balance', marketValue: 100, isCorePosition: true,
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('XXXX1234');
    expect(serialized).not.toContain('Individual Brokerage');
    expect(serialized).not.toContain('Generated at');
  });

  test('is detected by the broker-agnostic local parser', async () => {
    const payload = await parsePortfolioCsv(etradeCsv(), { fingerprintSalt: 'salt-one' });
    const repeated = await parsePortfolioCsv(etradeCsv(), { fingerprintSalt: 'salt-one' });
    const otherBrowser = await parsePortfolioCsv(etradeCsv(), { fingerprintSalt: 'salt-two' });

    expect(payload.broker).toBe('etrade');
    expect(payload.accounts[0].id).toBe(repeated.accounts[0].id);
    expect(payload.accounts[0].id).not.toBe(otherBrowser.accounts[0].id);
  });

  test('rejects exports without their stable account identifier', async () => {
    await expect(parseEtradePortfolioCsv(etradeCsv({ includeAccount: false }), { fingerprintSalt: 'salt' }))
      .rejects.toMatchObject({ code: 'missing-account' });
  });
});
