import React from 'react';
import { combinePortfolioPositions, importFidelityFile, mergePortfolioAccounts } from './portfolio/importClient';

const PAGE_SIZE = 100;
const ACCOUNT_TYPES = ['individual-taxable', 'joint-taxable', 'roth-ira', 'traditional-ira', '401k', '403b', 'hsa', 'trust', 'other'];

function finiteSum(items, field) {
  const values = items.map((item) => item[field]).filter(Number.isFinite);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function formatMoney(value, locale, compact = false) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'USD', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 2,
  }).format(value);
}

function formatNumber(value, locale, maximumFractionDigits = 4) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
    : '—';
}

function formatDate(value, locale) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function gainClass(value) {
  return value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : '';
}

function PortfolioSummary({ label, value, detail, tone = '' }) {
  return (
    <article className={`portfolio-summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

function PrivacyList({ t }) {
  return (
    <div className="portfolio-privacy">
      <strong>{t('portfolio.privacyTitle')}</strong>
      <ul>
        <li>{t('portfolio.noUpload')}</li>
        <li>{t('portfolio.identityRemoved')}</li>
        <li>{t('portfolio.sessionOnly')}</li>
        <li>{t('portfolio.noOriginal')}</li>
      </ul>
    </div>
  );
}

function AccountEditor({ account, onChange, locale, t }) {
  return (
    <article className="portfolio-account-editor">
      <div>
        <span>{t('portfolio.fidelity')}</span>
        <small>{account.reconciliation.positionCount} {t('portfolio.positionsLower')}</small>
      </div>
      <label>
        <span>{t('portfolio.alias')}</span>
        <input value={account.alias} maxLength={48} onChange={(event) => onChange({ alias: event.target.value })} />
      </label>
      <label>
        <span>{t('portfolio.accountType')}</span>
        <select value={account.accountType} onChange={(event) => onChange({ accountType: event.target.value })}>
          {ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{t(`portfolio.type.${type}`)}</option>)}
        </select>
      </label>
      <strong>{formatMoney(account.totals.marketValue, locale)}</strong>
    </article>
  );
}

function ImportReview({ pending, setPending, onConfirm, onCancel, locale, t }) {
  const accounts = pending.accounts;
  const totalValue = finiteSum(accounts.map((account) => account.totals), 'marketValue');
  const positionCount = accounts.reduce((total, account) => total + account.positions.length, 0);
  const updateAccount = (id, change) => setPending((current) => ({
    ...current,
    accounts: current.accounts.map((account) => account.id === id ? { ...account, ...change } : account),
  }));

  return (
    <section className="portfolio-review" aria-labelledby="portfolio-review-title">
      <div className="portfolio-review__heading">
        <div>
          <span className="eyebrow">{t('portfolio.reviewEyebrow')}</span>
          <h3 id="portfolio-review-title">{t('portfolio.reviewTitle')}</h3>
          <p>{t('portfolio.reviewDescription')}</p>
        </div>
        <dl>
          <div><dt>{t('portfolio.accounts')}</dt><dd>{accounts.length}</dd></div>
          <div><dt>{t('portfolio.positions')}</dt><dd>{positionCount}</dd></div>
          <div><dt>{t('portfolio.totalValue')}</dt><dd>{formatMoney(totalValue, locale, true)}</dd></div>
          <div><dt>{t('portfolio.snapshot')}</dt><dd>{formatDate(pending.snapshotDate, locale)}</dd></div>
        </dl>
      </div>
      <div className="portfolio-account-editors">
        {accounts.map((account) => (
          <AccountEditor key={account.id} account={account} locale={locale} t={t} onChange={(change) => updateAccount(account.id, change)} />
        ))}
      </div>
      <PrivacyList t={t} />
      <div className="portfolio-review__actions">
        <button className="portfolio-secondary-button" type="button" onClick={onCancel}>{t('portfolio.cancel')}</button>
        <button className="portfolio-primary-button" type="button" onClick={onConfirm} disabled={accounts.some((account) => !account.alias.trim())}>
          {t('portfolio.addAccounts')}
        </button>
      </div>
    </section>
  );
}

function PortfolioEmpty({ importing, error, onFiles, locale, t }) {
  const inputRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);
  const chooseFiles = () => inputRef.current?.click();
  const handleFiles = (files) => {
    if (files?.length) onFiles([...files]);
    if (inputRef.current) inputRef.current.value = '';
  };
  return (
    <section className="portfolio-import-card">
      <div className="portfolio-import-copy">
        <span className="eyebrow">{t('portfolio.importEyebrow')}</span>
        <h2>{t('portfolio.importTitle')}</h2>
        <p>{t('portfolio.importDescription')}</p>
        <span className="portfolio-format-badge">CSV · {t('portfolio.fidelity')}</span>
      </div>
      <div
        className={`portfolio-drop-zone ${dragging ? 'is-dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); handleFiles(event.dataTransfer.files); }}
      >
        <input ref={inputRef} className="sr-only" type="file" accept=".csv,text/csv" multiple onChange={(event) => handleFiles(event.target.files)} />
        <span className="portfolio-upload-icon" aria-hidden="true">↑</span>
        <strong>{t('portfolio.dropTitle')}</strong>
        <span>{t('portfolio.dropDescription')}</span>
        <button className="portfolio-primary-button" type="button" onClick={chooseFiles} disabled={importing}>
          {importing ? t('portfolio.importing') : t('portfolio.chooseFiles')}
        </button>
      </div>
      {error && <p className="portfolio-import-error" role="alert">{error}</p>}
      <PrivacyList t={t} />
      <p className="portfolio-time-note">{t('portfolio.processingNote', { locale })}</p>
    </section>
  );
}

function HoldingsTable({ rows, locale, t }) {
  const [page, setPage] = React.useState(0);
  React.useEffect(() => setPage(0), [rows]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  return (
    <>
      <div className="portfolio-table-wrap">
        <table className="portfolio-table">
          <thead><tr>
            <th>{t('portfolio.symbol')}</th><th>{t('portfolio.accountsColumn')}</th><th>{t('portfolio.quantity')}</th>
            <th>{t('portfolio.lastPrice')}</th><th>{t('portfolio.value')}</th><th>{t('portfolio.weight')}</th><th>{t('portfolio.totalGain')}</th>
          </tr></thead>
          <tbody>{visible.map((position) => (
            <tr key={position.id}>
              <td><strong>{position.symbol || t('portfolio.cash')}</strong><span>{position.description}</span></td>
              <td>{position.accountAliases.join(', ')}</td>
              <td>{formatNumber(position.quantity, locale)}</td>
              <td>{formatMoney(position.lastPrice, locale)}</td>
              <td>{formatMoney(position.marketValue, locale)}</td>
              <td>{Number.isFinite(position.portfolioPercent) ? `${position.portfolioPercent.toFixed(2)}%` : '—'}</td>
              <td className={gainClass(position.totalGainLoss)}>{formatMoney(position.totalGainLoss, locale)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="portfolio-mobile-list">
        {visible.map((position) => (
          <article className="portfolio-position-card" key={position.id}>
            <div><strong>{position.symbol || t('portfolio.cash')}</strong><b>{formatMoney(position.marketValue, locale)}</b></div>
            <p>{position.description}</p>
            <dl>
              <div><dt>{t('portfolio.quantity')}</dt><dd>{formatNumber(position.quantity, locale)}</dd></div>
              <div><dt>{t('portfolio.weight')}</dt><dd>{Number.isFinite(position.portfolioPercent) ? `${position.portfolioPercent.toFixed(2)}%` : '—'}</dd></div>
              <div><dt>{t('portfolio.totalGain')}</dt><dd className={gainClass(position.totalGainLoss)}>{formatMoney(position.totalGainLoss, locale)}</dd></div>
            </dl>
            <small>{position.accountAliases.join(', ')}</small>
          </article>
        ))}
      </div>
      {pageCount > 1 && <nav className="portfolio-pagination" aria-label={t('portfolio.pagination')}>
        <button type="button" disabled={safePage === 0} onClick={() => setPage((value) => value - 1)}>{t('portfolio.previous')}</button>
        <span>{t('portfolio.page', { page: safePage + 1, pages: pageCount })}</span>
        <button type="button" disabled={safePage === pageCount - 1} onClick={() => setPage((value) => value + 1)}>{t('portfolio.next')}</button>
      </nav>}
    </>
  );
}

export default function PortfolioView({ accounts, setAccounts, locale, t }) {
  const [pending, setPending] = React.useState(null);
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [selectedAccountId, setSelectedAccountId] = React.useState('all');
  const [search, setSearch] = React.useState('');

  const importFiles = async (files) => {
    setImporting(true);
    setError('');
    try {
      const payloads = [];
      for (const file of files) payloads.push(await importFidelityFile(file));
      const importedAccounts = payloads.flatMap((payload) => payload.accounts.map((account) => ({
        ...account,
        snapshotDate: payload.snapshotDate,
      })));
      const existingById = new Map(accounts.map((account) => [account.id, account]));
      const deduped = new Map(importedAccounts.map((account) => [account.id, {
        ...account,
        alias: existingById.get(account.id)?.alias || account.suggestedAlias,
        accountType: existingById.get(account.id)?.accountType || account.accountType,
      }]));
      setPending({
        accounts: [...deduped.values()],
        snapshotDate: payloads.map((payload) => payload.snapshotDate).filter(Boolean).sort().at(-1) || null,
      });
    } catch (importError) {
      setError(locale === 'zh-CN' ? t('portfolio.importError') : importError.message);
    } finally {
      setImporting(false);
    }
  };

  const positions = React.useMemo(
    () => combinePortfolioPositions(accounts, selectedAccountId),
    [accounts, selectedAccountId]
  );
  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return !query ? positions : positions.filter((position) => position.symbol.toLowerCase().includes(query)
      || position.description.toLowerCase().includes(query)
      || position.accountAliases.some((alias) => alias.toLowerCase().includes(query)));
  }, [positions, search]);
  const totalValue = finiteSum(positions, 'marketValue');
  const totalGain = finiteSum(positions, 'totalGainLoss');
  const selectedSnapshot = selectedAccountId === 'all'
    ? accounts.map((account) => account.snapshotDate).filter(Boolean).sort().at(-1)
    : accounts.find((account) => account.id === selectedAccountId)?.snapshotDate;

  const confirmImport = () => {
    setAccounts((current) => mergePortfolioAccounts(current, pending.accounts.map((account) => ({
      ...account, alias: account.alias.trim(),
    }))));
    setPending(null);
  };

  if (pending) return <ImportReview pending={pending} setPending={setPending} onConfirm={confirmImport} onCancel={() => setPending(null)} locale={locale} t={t} />;
  if (!accounts.length) return <PortfolioEmpty importing={importing} error={error} onFiles={importFiles} locale={locale} t={t} />;

  return (
    <section className="portfolio-dashboard" aria-labelledby="portfolio-title">
      <div className="portfolio-dashboard__heading">
        <div><span className="eyebrow">{t('portfolio.eyebrow')}</span><h2 id="portfolio-title">{t('portfolio.title')}</h2><p>{t('portfolio.sessionNotice')}</p></div>
        <label className="portfolio-import-more">
          <input className="sr-only" type="file" accept=".csv,text/csv" multiple onChange={(event) => { importFiles([...event.target.files]); event.target.value = ''; }} />
          <span>{importing ? t('portfolio.importing') : t('portfolio.importAnother')}</span>
        </label>
      </div>
      {error && <p className="portfolio-import-error" role="alert">{error}</p>}
      <div className="portfolio-summary-grid">
        <PortfolioSummary label={t('portfolio.totalValue')} value={formatMoney(totalValue, locale, true)} detail={t('portfolio.asOf', { date: formatDate(selectedSnapshot, locale) })} />
        <PortfolioSummary label={t('portfolio.totalGain')} value={formatMoney(totalGain, locale, true)} tone={gainClass(totalGain)} />
        <PortfolioSummary label={t('portfolio.accounts')} value={selectedAccountId === 'all' ? accounts.length : 1} detail={t('portfolio.sessionAccounts')} />
        <PortfolioSummary label={t('portfolio.positions')} value={positions.length} detail={t('portfolio.distinctPositions')} />
      </div>
      <div className="portfolio-controls">
        <label><span>{t('portfolio.accountView')}</span><select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)}>
          <option value="all">{t('portfolio.combined')}</option>
          {accounts.map((account) => <option value={account.id} key={account.id}>{account.alias}</option>)}
        </select></label>
        <label><span className="sr-only">{t('portfolio.search')}</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('portfolio.search')} /></label>
        <span>{t('portfolio.resultCount', { count: filtered.length })}</span>
      </div>
      {filtered.length ? <HoldingsTable rows={filtered} locale={locale} t={t} /> : <div className="portfolio-no-results">{t('portfolio.noResults')}</div>}
      <div className="portfolio-account-list">
        <div><span className="eyebrow">{t('portfolio.accountsEyebrow')}</span><h3>{t('portfolio.importedAccounts')}</h3></div>
        {accounts.map((account) => <article key={account.id}>
          <div><strong>{account.alias}</strong><span>{t(`portfolio.type.${account.accountType}`)} · {formatDate(account.snapshotDate, locale)}</span></div>
          <b>{formatMoney(account.totals.marketValue, locale)}</b>
          <button type="button" onClick={() => {
            if (window.confirm(t('portfolio.removeConfirm', { alias: account.alias }))) {
              setAccounts((current) => current.filter((item) => item.id !== account.id));
              if (selectedAccountId === account.id) setSelectedAccountId('all');
            }
          }}>{t('portfolio.remove')}</button>
        </article>)}
      </div>
    </section>
  );
}
