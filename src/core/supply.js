(function initSupply(global) {
  const Tango = global.Tango = global.Tango || {};
  const SOURCES = Object.freeze({
    EXACT: 'GMGN_EXACT',
    RATIO: 'GMGN_RATIO',
    RULE: 'LAUNCHPAD_RULE',
    LEGACY: 'LEGACY_PUMP_RULE'
  });
  const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
  const clean = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function ruleSupply(chain, launchpad, launchMode) {
    const id = Tango.Chains?.get?.(chain)?.id || '';
    const platform = clean(launchpad);
    const mode = clean(launchMode);
    if (id === 'sol' && ['pump', 'pumpfun'].includes(platform)) {
      return mode.includes('mayhem') ? 2_000_000_000 : 1_000_000_000;
    }
    if (['bankr', 'bankrbot', 'clanker'].includes(platform)
      && ['base', 'robinhood'].includes(id)) return 100_000_000_000;
    const oneBillion = new Set(['fourmeme', 'flap', 'zora', 'zoracoins', 'dyor', 'bow', 'bowfun']);
    return oneBillion.has(platform) ? 1_000_000_000 : 0;
  }

  function resolve(observation = {}) {
    if (positive(observation.totalSupply)) {
      const declared = String(observation.supplySource || observation.totalSupplySource || '');
      const source = Object.values(SOURCES).includes(declared) ? declared : SOURCES.EXACT;
      const confidence = source === SOURCES.EXACT ? 'exact'
        : source === SOURCES.RATIO ? 'inferred'
          : 'fallback';
      return { totalSupply: Number(observation.totalSupply), source, confidence };
    }
    if (positive(observation.marketCapUsd) && positive(observation.priceUsd)) {
      const inferred = Number(observation.marketCapUsd) / Number(observation.priceUsd);
      if (Number.isFinite(inferred) && inferred >= 1_000 && inferred <= 1e18) {
        return { totalSupply: inferred, source: SOURCES.RATIO, confidence: 'inferred' };
      }
    }
    const fallback = ruleSupply(observation.chain, observation.launchpad, observation.launchMode);
    return fallback > 0
      ? { totalSupply: fallback, source: SOURCES.RULE, confidence: 'fallback' }
      : null;
  }

  function isTrustedSource(source) {
    return Object.values(SOURCES).includes(String(source || ''));
  }

  Tango.Supply = { SOURCES, resolve, ruleSupply, isTrustedSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Supply;
})(globalThis);
