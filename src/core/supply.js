(function initSupply(global) {
  const Tango = global.Tango = global.Tango || {};
  const INTERNAL_UNKNOWN_FALLBACK = Symbol('TangoInternalUnknownFallback');
  const SOURCES = Object.freeze({
    EXACT: 'GMGN_EXACT',
    RATIO: 'GMGN_RATIO',
    RULE: 'LAUNCHPAD_RULE',
    LEGACY: 'LEGACY_PUMP_RULE'
  });
  const UNKNOWN_INITIAL_MARKET_CAP_USD = 3_200;
  const UNKNOWN_TOTAL_SUPPLY = 1_000_000_000;
  const LAUNCHPAD_RULES = Object.freeze([
    Object.freeze({
      chain: 'sol', aliases: Object.freeze(['pump', 'pumpfun']), launchMode: 'mayhem',
      totalSupply: 2_000_000_000, initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
      source: SOURCES.RULE, provenance: 'VERIFIED_LAUNCHPAD'
    }),
    Object.freeze({
      chain: 'sol', aliases: Object.freeze(['pump', 'pumpfun']), launchMode: '',
      totalSupply: 1_000_000_000, initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
      source: SOURCES.RULE, provenance: 'VERIFIED_LAUNCHPAD'
    }),
    Object.freeze({
      chain: 'base', aliases: Object.freeze(['bankr', 'bankrbot', 'banker']), launchMode: '',
      totalSupply: 100_000_000_000, initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
      source: SOURCES.RULE, provenance: 'VERIFIED_LAUNCHPAD'
    }),
    Object.freeze({
      chain: 'base', aliases: Object.freeze(['clanker']), launchMode: '',
      totalSupply: 100_000_000_000, initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
      source: SOURCES.RULE, provenance: 'VERIFIED_LAUNCHPAD'
    }),
    Object.freeze({
      chain: 'robinhood', aliases: Object.freeze(['bankr', 'bankrbot', 'banker']), launchMode: '',
      totalSupply: 100_000_000_000, initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
      source: SOURCES.RULE, provenance: 'VERIFIED_LAUNCHPAD'
    }),
    Object.freeze({
      chain: 'robinhood', aliases: Object.freeze(['clanker']), launchMode: '',
      totalSupply: 100_000_000_000, initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
      source: SOURCES.RULE, provenance: 'VERIFIED_LAUNCHPAD'
    }),
    Object.freeze({
      chain: 'bsc', aliases: Object.freeze(['fourmeme']), launchMode: '',
      totalSupply: 1_000_000_000, initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
      source: SOURCES.RULE, provenance: 'VERIFIED_LAUNCHPAD'
    }),
    Object.freeze({
      chain: 'bsc', aliases: Object.freeze(['flap']), launchMode: '',
      totalSupply: 1_000_000_000, initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
      source: SOURCES.RULE, provenance: 'VERIFIED_LAUNCHPAD'
    }),
    Object.freeze({
      chain: 'base', aliases: Object.freeze(['zora', 'zoracoins']), launchMode: '',
      totalSupply: 1_000_000_000, initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
      source: SOURCES.RULE, provenance: 'VERIFIED_LAUNCHPAD'
    }),
    Object.freeze({
      chain: 'xlayer', aliases: Object.freeze(['dyor']), launchMode: '',
      totalSupply: 1_000_000_000, initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
      source: SOURCES.RULE, provenance: 'VERIFIED_LAUNCHPAD'
    }),
    Object.freeze({
      chain: 'xlayer', aliases: Object.freeze(['bow', 'bowfun']), launchMode: '',
      totalSupply: 1_000_000_000, initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
      source: SOURCES.RULE, provenance: 'VERIFIED_LAUNCHPAD'
    })
  ]);
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

  function launchpadRule(chain, launchpad, launchMode) {
    const id = Tango.Chains?.get?.(chain)?.id || clean(chain);
    const platform = clean(launchpad);
    const mode = clean(launchMode);
    const matchingRules = LAUNCHPAD_RULES.filter((rule) => rule.chain === id && rule.aliases.includes(platform));
    const rule = matchingRules.find((candidate) => candidate.launchMode === mode)
      || matchingRules.find((candidate) => !candidate.launchMode);
    return rule && {
      totalSupply: rule.totalSupply,
      initialMarketCapUsd: rule.initialMarketCapUsd,
      source: rule.source
    };
  }

  function ruleSupply(chain, launchpad, launchMode) {
    return launchpadRule(chain, launchpad, launchMode)?.totalSupply || 0;
  }

  function fallbackValuation(observation = {}) {
    const rule = launchpadRule(observation.chain, observation.launchpad, observation.launchMode);
    const totalSupply = rule?.totalSupply || UNKNOWN_TOTAL_SUPPLY;
    const marketCapUsd = rule?.initialMarketCapUsd || UNKNOWN_INITIAL_MARKET_CAP_USD;
    const valuation = {
      totalSupply,
      marketCapUsd,
      priceUsd: marketCapUsd / totalSupply,
      supplySource: rule?.source || 'UNKNOWN_FALLBACK',
      valuationSource: rule ? 'LAUNCHPAD_INITIAL_MARKET_CAP' : 'UNKNOWN_INITIAL_MARKET_CAP'
    };
    if (!rule) valuation[INTERNAL_UNKNOWN_FALLBACK] = true;
    return valuation;
  }

  function isInternalUnknownFallback(value) {
    return Boolean(value?.[INTERNAL_UNKNOWN_FALLBACK]);
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
    SOURCES, LAUNCHPAD_RULES, UNKNOWN_INITIAL_MARKET_CAP_USD, UNKNOWN_TOTAL_SUPPLY,
    launchpadRule, fallbackValuation, resolve, ruleSupply,
    isTrustedSource, isInternalUnknownFallback, coherentRatioObservation, ratioSupplyMatches
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Supply;
})(globalThis);
