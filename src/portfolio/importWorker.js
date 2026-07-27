import { parseFidelityPositionsCsv } from './fidelityCsv';

self.addEventListener('message', async (event) => {
  if (event.data?.type !== 'import-fidelity') return;
  let csvText = event.data.csvText;
  try {
    const payload = await parseFidelityPositionsCsv(csvText, {
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
