import { expect, test, vi } from 'vitest';
import {
  combinePortfolioPositions,
  getPortfolioFingerprintSalt,
  importPortfolioFile,
  mergePortfolioAccounts,
} from './importClient';

function account(overrides = {}) {
  return {
    id: 'fidelity:one',
    suggestedAlias: 'Fidelity account 1',
    accountType: 'individual-taxable',
    positions: [{
      id: 'one:AAPL:1', symbol: 'AAPL', description: 'Apple Inc.', quantity: 2, lastPrice: 200,
      marketValue: 400, costBasis: 300, totalGainLoss: 100, dayGainLoss: 4, holdingType: 'Cash',
    }],
    ...overrides,
  };
}

test('creates and reuses a non-identifying browser fingerprint salt', () => {
  window.localStorage.clear();
  const first = getPortfolioFingerprintSalt();
  const second = getPortfolioFingerprintSalt();
  expect(first).toBe(second);
  expect(first).toMatch(/^[a-f0-9]{64}$/);
});

test('replaces matching account snapshots while preserving aliases', () => {
  const current = [{ ...account(), alias: 'Long-term brokerage', importedAt: '2026-07-01' }];
  const updated = account({ positions: [{ ...account().positions[0], marketValue: 450 }] });
  const merged = mergePortfolioAccounts(current, [updated], '2026-07-26');
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ alias: 'Long-term brokerage', importedAt: '2026-07-26' });
  expect(merged[0].positions[0].marketValue).toBe(450);
});

test('combines the same holding across accounts without additional requests', () => {
  const accounts = [
    { ...account(), alias: 'Brokerage' },
    account({
      id: 'fidelity:two',
      alias: 'Roth IRA',
      positions: [{ ...account().positions[0], id: 'two:AAPL:1', quantity: 3, marketValue: 600, costBasis: 500 }],
    }),
  ];
  expect(combinePortfolioPositions(accounts)).toEqual([expect.objectContaining({
    symbol: 'AAPL',
    quantity: 5,
    marketValue: 1000,
    costBasis: 800,
    portfolioPercent: 100,
    accountAliases: ['Brokerage', 'Roth IRA'],
  })]);
});

test('passes only file contents and a random fingerprint salt to the local worker', async () => {
  window.localStorage.clear();
  const originalFetch = global.fetch;
  global.fetch = vi.fn();
  const messages = [];
  class WorkerMock {
    listeners = {};
    addEventListener(type, listener) { this.listeners[type] = listener; }
    postMessage(message) {
      messages.push(message);
      queueMicrotask(() => this.listeners.message({ data: { id: message.id, ok: true, payload: { accounts: [] } } }));
    }
    terminate = vi.fn();
  }
  const file = { name: 'Portfolio_sensitive-name.csv', size: 100, text: vi.fn(async () => 'safe csv contents') };
  await importPortfolioFile(file, { WorkerClass: WorkerMock });

  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ type: 'import-portfolio', csvText: 'safe csv contents' });
  expect(messages[0].fingerprintSalt).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(messages[0])).not.toContain(file.name);
  expect(global.fetch).not.toHaveBeenCalled();
  global.fetch = originalFetch;
});
