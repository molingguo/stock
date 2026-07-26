const scoreCache = require('./data/piotroskiScores.json');

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/[/-]/g, '.');
}

function createPiotroskiScoresService({ cache = scoreCache } = {}) {
  const scores = cache?.scores && typeof cache.scores === 'object' ? cache.scores : {};

  return {
    getScore(symbol) {
      const result = scores[normalizeSymbol(symbol)];
      return Number.isInteger(result?.score) && result.score >= 0 && result.score <= 9
        ? result
        : null;
    },
    getMetadata() {
      return {
        generatedAt: cache?.generatedAt || null,
        scoreYear: Number.isInteger(cache?.scoreYear) ? cache.scoreYear : null,
        source: cache?.source || 'SEC company filings',
      };
    },
  };
}

module.exports = { createPiotroskiScoresService, normalizeSymbol };
