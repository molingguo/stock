import { parsePortfolioCsv } from './portfolioCsv';

self.addEventListener('message', async (event) => {
  if (event.data?.type !== 'import-portfolio') return;
  let csvText = event.data.csvText;
  try {
    const payload = await parsePortfolioCsv(csvText, {
      fingerprintSalt: event.data.fingerprintSalt,
    });
    self.postMessage({ id: event.data.id, ok: true, payload });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      ok: false,
      error: {
        code: error.code || 'import-failed',
        message: error.message || 'Unable to import this portfolio file.',
      },
    });
  } finally {
    csvText = null;
  }
});
