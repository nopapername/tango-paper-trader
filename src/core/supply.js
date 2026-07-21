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
  const observationText = (value) => String(value || '').trim().slice(0, 128);

  function factualSource(value) {
    const source = observationText(value).toUpperCase();
    if (!source || source.includes('SYNTHETIC') || source.includes('DERIVED')) return '';
    return source === 'DEXSCREENER' || source === 'GMGN' || source.startsWith('GMGN_') ? source : '';
  }

  function coherentRatioObservation(observation = {}) {
    const chain = Tango.Chains?.get?.(observation.chain);
    const address = observation.address || observation.tokenAddress;
    if (!chain || !Tango.Chains.validateAddress(chain.id, address)
      || !positive(observation.marketCapUsd) || !positive(observation.priceUsd)) return false;
    const priceSource = factualSource(observation.priceSource || observation.source);
    const marketCapSource = factualSource(observation.marketCapSource || observation.source);
    const priceProvenance = observationText(observation.priceProvenance).toUpperCase();
    if (!priceSource || priceSource !== marketCapSource
      || priceProvenance.includes('SYNTHETIC') || priceProvenance.includes('DERIVED')) return false;
    const commonId = observationText(observation.observationId);
    const priceId = observationText(observation.priceObservationId || commonId);
    const marketCapId = observationText(observation.marketCapObservationId || commonId);
    if (priceId || marketCapId) return Boolean(priceId && priceId === marketCapId);
    const commonTime = Number(observation.originalObservedAt || observation.observedAt || 0);
    const priceTime = Number(observation.priceObservedAt || commonTime);
    const marketCapTime = Number(observation.marketCapObservedAt || commonTime);
    return Number.isSafeInteger(priceTime) && priceTime > 0 && priceTime === marketCapTime;
  }

  function ratioSupplyMatches(observation, totalSupply) {
    if (!coherentRatioObservation(observation) || !positive(totalSupply)) return false;
    const inferred = Number(observation.marketCapUsd) / Number(observation.priceUsd);
    const supply = Number(totalSupply);
    return Number.isFinite(inferred) && Math.abs(inferred - supply) <= supply * 0.001;
  }

  function ruleSupply(chain, launchpad, launchMode) {
    const id = Tango.Chains?.get?.(chain)?.id || '';
    const platform = clean(launchpad);
    const mode = clean(launchMode);
    if (id === 'sol' && ['pump', 'pumpfun'].includes(platform)) {
      return mode.includes('mayhem') ? 2_000_000_000 : 1_000_000_000;
    }
    if (['bankr', 'clanker'].includes(platform) && ['base', 'robinhood'].includes(id)) {
      return 100_000_000_000;
    }
    if (id === 'bsc' && ['fourmeme', 'flap'].includes(platform)) return 1_000_000_000;
    if (id === 'base' && ['zora', 'zoracoins'].includes(platform)) return 1_000_000_000;
    if (id === 'xlayer' && ['dyor', 'bow', 'bowfun'].includes(platform)) return 1_000_000_000;
    return 0;
  }

  function resolve(observation = {}) {
    if (positive(observation.totalSupply)) {
      const declared = String(observation.supplySource || observation.totalSupplySource || '');
      const source = Object.values(SOURCES).includes(declared) ? declared : SOURCES.EXACT;
      if (source !== SOURCES.RATIO || ratioSupplyMatches(observation, observation.totalSupply)) {
        const confidence = source === SOURCES.EXACT ? 'exact'
          : source === SOURCES.RATIO ? 'inferred'
            : 'fallback';
        return { totalSupply: Number(observation.totalSupply), source, confidence };
      }
    }
    if (coherentRatioObservation(observation)) {
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

  Tango.Supply = {
    SOURCES, resolve, ruleSupply, isTrustedSource, coherentRatioObservation, ratioSupplyMatches
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Supply;
})(globalThis);
