(function initEngine(global) {
  const Tango = global.Tango = global.Tango || {};
  const METADATA_SOURCE_RANK = Object.freeze({ GMGN_TRENCH: 20, GMGN_DETAIL: 30, GMGN_NETWORK: 40 });
  const MARKET_CAP_PROVENANCE = 'SOLANA_PUMP_TRENCH_V1';
  const CANONICAL_PUMP_SUPPLY = 1_000_000_000;
  const UNKNOWN_FALLBACK_SOURCE = 'UNKNOWN_FALLBACK';
  const UNKNOWN_FALLBACK_PROVENANCE = 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1';
  const TRUSTED_SUPPLY_SOURCES = Object.freeze([
    'GMGN_EXACT', 'GMGN_RATIO', 'LAUNCHPAD_RULE', 'LEGACY_PUMP_RULE',
    UNKNOWN_FALLBACK_SOURCE
  ]);
  const MAX_QUOTE_AGE_MS = 5 * 60_000;
  const MAX_FUTURE_SKEW_MS = 5_000;
  const LOCAL_LAUNCHPAD_RULES = Object.freeze([
    Object.freeze({ chain: 'sol', aliases: Object.freeze(['pump', 'pumpfun']), launchMode: 'mayhem', totalSupply: 2_000_000_000 }),
    Object.freeze({ chain: 'sol', aliases: Object.freeze(['pump', 'pumpfun']), launchMode: '', totalSupply: CANONICAL_PUMP_SUPPLY }),
    Object.freeze({ chain: 'bsc', aliases: Object.freeze(['fourmeme']), launchMode: '', totalSupply: CANONICAL_PUMP_SUPPLY }),
    Object.freeze({ chain: 'bsc', aliases: Object.freeze(['flap']), launchMode: '', totalSupply: CANONICAL_PUMP_SUPPLY }),
    Object.freeze({ chain: 'base', aliases: Object.freeze(['zora', 'zoracoins']), launchMode: '', totalSupply: CANONICAL_PUMP_SUPPLY }),
    Object.freeze({ chain: 'xlayer', aliases: Object.freeze(['dyor']), launchMode: '', totalSupply: CANONICAL_PUMP_SUPPLY }),
    Object.freeze({ chain: 'xlayer', aliases: Object.freeze(['bow', 'bowfun']), launchMode: '', totalSupply: CANONICAL_PUMP_SUPPLY }),
    Object.freeze({ chain: 'base', aliases: Object.freeze(['bankr', 'bankrbot', 'banker']), launchMode: '', totalSupply: 100_000_000_000 }),
    Object.freeze({ chain: 'robinhood', aliases: Object.freeze(['bankr', 'bankrbot', 'banker']), launchMode: '', totalSupply: 100_000_000_000 }),
    Object.freeze({ chain: 'base', aliases: Object.freeze(['clanker']), launchMode: '', totalSupply: 100_000_000_000 }),
    Object.freeze({ chain: 'robinhood', aliases: Object.freeze(['clanker']), launchMode: '', totalSupply: 100_000_000_000 })
  ]);
  const finite = (value) => Number.isFinite(Number(value));
  const finiteBetween = (value, minimum, maximum) => finite(value)
    && Number(value) >= minimum && Number(value) <= maximum;

  function round(value, digits = 12) {
    const numeric = Number(value);
    const precision = Number(digits);
    if (!Number.isFinite(numeric) || !Number.isInteger(precision)) throw new Error('invalidArithmetic');
    const factor = 10 ** digits;
    const rounded = Math.round((numeric + Number.EPSILON) * factor) / factor;
    if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(rounded)) {
      throw new Error('invalidArithmetic');
    }
    return rounded;
  }

  function checkedArithmetic(value, expectation = 'finite') {
    const numeric = Number(value);
    const valid = Number.isFinite(numeric)
      && (expectation !== 'positive' || numeric > 0)
      && (expectation !== 'nonnegative' || numeric >= 0);
    if (!valid) throw new Error('invalidArithmetic');
    return numeric;
  }

  function checkedRound(value, expectation = 'finite', digits = 12) {
    return checkedArithmetic(round(value, digits), expectation);
  }

  function positionKey(chain, tokenAddress) {
    const registered = Tango.Chains?.get(chain);
    if (!registered) throw new Error('unsupportedChain');
    if (!Tango.Chains.validateAddress(registered.id, tokenAddress)) throw new Error('invalidAddress');
    return `${registered.id}:${Tango.Chains.normalizeAddress(registered.id, tokenAddress)}`;
  }

  function chainAccount(state, chain) {
    const account = state.accounts?.[chain];
    if (!account) throw new Error('unsupportedChain');
    return account;
  }

  function tradeSettings(settings, chain) {
    const normalized = Tango.State?.normalizeSettings ? Tango.State.normalizeSettings(settings) : (settings || {});
    return settings?.chainSettings?.[chain] || settings?.chains?.[chain]
      || normalized.chainSettings?.[chain] || normalized.chains?.[chain] || {};
  }

  function trustedMetadataSource(token) {
    const source = String(token?.metadataSource || '').toUpperCase();
    return token?.metadataVerified === true && METADATA_SOURCE_RANK[source] ? source : '';
  }

  function callerTokenSupplyContext(token, chain, tokenAddress) {
    const metadataSource = trustedMetadataSource(token);
    return {
      chain,
      tokenAddress,
      address: tokenAddress,
      launchpad: metadataSource ? token?.launchpad : '',
      launchMode: metadataSource ? token?.launchMode : ''
    };
  }

  function verifiedLaunchContext(context, token) {
    if (!trustedMetadataSource(token)) return context;
    return {
      ...context,
      launchpad: token?.launchpad || context?.launchpad || '',
      launchMode: token?.launchMode || context?.launchMode || ''
    };
  }

  function validIdentityText(value, maxLength) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text && text.length <= maxLength && !/^(TOKEN|UNKNOWN|N\/A)$/i.test(text) ? text : '';
  }

  function coherentPumpIdentity(context) {
    const address = context?.tokenAddress || context?.address || '';
    return context?.chain === 'sol'
      && Tango.Chains?.validateAddress?.('sol', address) === true
      && /pump$/i.test(String(address));
  }

  function positiveFinite(value) {
    return finiteBetween(value, Number.EPSILON, Number.MAX_VALUE);
  }

  function isTrustedSupplySource(source) {
    return TRUSTED_SUPPLY_SOURCES.includes(String(source || ''));
  }

  function cleanRuleIdentity(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function localRuleSupply(chain, launchpad, launchMode) {
    const id = Tango.Chains?.get?.(chain)?.id || '';
    const platform = cleanRuleIdentity(launchpad);
    const mode = cleanRuleIdentity(launchMode);
    const matches = LOCAL_LAUNCHPAD_RULES.filter((rule) => rule.chain === id && rule.aliases.includes(platform));
    return (matches.find((rule) => rule.launchMode === mode)
      || matches.find((rule) => !rule.launchMode))?.totalSupply || 0;
  }

  function ruleSupply(context) {
    const resolved = typeof Tango.Supply?.ruleSupply === 'function'
      ? Number(Tango.Supply.ruleSupply(context?.chain, context?.launchpad, context?.launchMode))
      : localRuleSupply(context?.chain, context?.launchpad, context?.launchMode);
    return positiveFinite(resolved) ? resolved : 0;
  }

  function supplyObservation(context) {
    return {
      marketCapUsd: Number(context?.marketCapUsd ?? context?.lastMarketCapUsd
        ?? context?.averageEntryMarketCap ?? 0),
      priceUsd: Number(context?.priceUsd ?? context?.observedPriceUsd
        ?? context?.lastPriceUsd ?? context?.averageEntryPriceUsd ?? 0),
      observationId: context?.observationId,
      priceObservationId: context?.priceObservationId,
      marketCapObservationId: context?.marketCapObservationId,
      priceObservedAt: context?.priceObservedAt ?? context?.originalObservedAt ?? context?.observedAt,
      marketCapObservedAt: context?.marketCapObservedAt ?? context?.originalObservedAt ?? context?.observedAt,
      priceSource: context?.priceSource || context?.source,
      marketCapSource: context?.marketCapSource || context?.source,
      priceProvenance: context?.priceProvenance
    };
  }

  function coherentRatioObservation(context) {
    if (typeof Tango.Supply?.coherentRatioObservation === 'function') {
      return Tango.Supply.coherentRatioObservation(context);
    }
    const chain = Tango.Chains?.get?.(context?.chain);
    const address = context?.address || context?.tokenAddress;
    if (!chain || !Tango.Chains.validateAddress(chain.id, address)) return false;
    const observation = supplyObservation(context);
    const priceSource = String(observation.priceSource || '').toUpperCase();
    const marketCapSource = String(observation.marketCapSource || '').toUpperCase();
    const factualSource = (source) => !source.includes('SYNTHETIC') && !source.includes('DERIVED')
      && (source === 'DEXSCREENER' || source === 'GMGN' || source.startsWith('GMGN_'));
    const priceProvenance = String(observation.priceProvenance || '').toUpperCase();
    if (!factualSource(priceSource) || priceSource !== marketCapSource
      || priceProvenance.includes('SYNTHETIC') || priceProvenance.includes('DERIVED')) return false;
    const commonId = String(observation.observationId || '');
    const priceId = String(observation.priceObservationId || commonId);
    const marketCapId = String(observation.marketCapObservationId || commonId);
    if (priceId || marketCapId) return Boolean(priceId && priceId === marketCapId);
    const priceTime = Number(observation.priceObservedAt || 0);
    const marketCapTime = Number(observation.marketCapObservedAt || 0);
    return Number.isSafeInteger(priceTime) && priceTime > 0 && priceTime === marketCapTime;
  }

  function ratioSupplyMatches(context, totalSupply) {
    const { marketCapUsd, priceUsd } = supplyObservation(context);
    const supply = Number(totalSupply);
    if (![marketCapUsd, priceUsd, supply].every(positiveFinite)) return false;
    const inferred = marketCapUsd / priceUsd;
    return positiveFinite(inferred) && Math.abs(inferred - supply) <= supply * 0.001;
  }

  function coherentUnknownFallbackIdentity(context, totalSupply) {
    const supply = Number(totalSupply);
    const durableProvenance = context?.provisionalSupplyProvenance
      === UNKNOWN_FALLBACK_PROVENANCE;
    const internalCreation = Tango.Supply?.isInternalUnknownFallback?.(context) === true;
    const marketCap = Number(context?.marketCapUsd ?? context?.lastMarketCapUsd);
    const price = Number(context?.priceUsd ?? context?.observedPriceUsd ?? context?.lastPriceUsd);
    const quoteSource = String(context?.source || context?.quoteSource || '').toUpperCase();
    const marketCapSource = String(context?.marketCapSource || '').toUpperCase();
    const priceSource = String(context?.priceSource || context?.source || '').toUpperCase();
    const coherentSupplyDimension = supply === CANONICAL_PUMP_SUPPLY
      && Number(context?.marketCapDivisor) === CANONICAL_PUMP_SUPPLY
      && Number(context?.provisionalSupply) === CANONICAL_PUMP_SUPPLY;
    if (!coherentSupplyDimension) return false;
    if (durableProvenance) return true;
    const canonicalSyntheticFallback = ['TANGO_FALLBACK', 'TANGO_FALLBACK_CARD_MARKET_CAP'].includes(quoteSource)
      && context?.syntheticTokenPrice === true
      && context?.provisional === true
      && context?.paperFallback === true
      && positiveFinite(marketCap)
      && positiveFinite(price)
      && Math.abs(marketCap / price - supply) <= supply * 0.001;
    const nativeOnlyProvisional = context?.provisional === true
      && context?.syntheticTokenPrice !== true
      && context?.syntheticNativePrice === true
      && Number(context?.nativePriceUsd ?? context?.lastNativePriceUsd) === 1
      && Number(context?.nativeOriginalObservedAt || 0) === 0;
    const factualPriceWithSyntheticMarketCap = context?.syntheticTokenPrice !== true
      && (context?.provisional !== true || nativeOnlyProvisional)
      && context?.paperFallback === true
      && (quoteSource === 'GMGN' || quoteSource.startsWith('GMGN_') || quoteSource === 'DEXSCREENER')
      && priceSource === quoteSource
      && marketCapSource === 'TANGO_FALLBACK'
      && Number(context?.marketCapObservedAt || 0) === 0
      && String(context?.marketCapObservationId || '') === ''
      && positiveFinite(marketCap)
      && positiveFinite(price);
    return internalCreation && (canonicalSyntheticFallback || factualPriceWithSyntheticMarketCap);
  }

  function validSupplyForSource(context, totalSupply, source) {
    const supply = Number(totalSupply);
    if (!positiveFinite(supply) || !isTrustedSupplySource(source)) return false;
    if (source === 'GMGN_EXACT') return true;
    if (source === 'GMGN_RATIO') return ratioSupplyMatches(context, supply);
    if (source === 'LAUNCHPAD_RULE') return ruleSupply(context) === supply;
    if (source === UNKNOWN_FALLBACK_SOURCE) {
      return coherentUnknownFallbackIdentity(context, supply);
    }
    return source === 'LEGACY_PUMP_RULE'
      && coherentPumpIdentity(context)
      && context?.marketCapProvenance === MARKET_CAP_PROVENANCE
      && Number(context?.marketCapDivisor) === CANONICAL_PUMP_SUPPLY
      && supply === CANONICAL_PUMP_SUPPLY;
  }

  function fallbackResolvedSupply(context) {
    const { marketCapUsd, priceUsd } = supplyObservation(context);
    if (coherentRatioObservation(context)) {
      const inferred = marketCapUsd / priceUsd;
      if (positiveFinite(inferred) && inferred >= 1_000 && inferred <= 1e18) {
        return { totalSupply: inferred, source: 'GMGN_RATIO' };
      }
    }
    const fallback = ruleSupply(context);
    return fallback > 0 ? { totalSupply: fallback, source: 'LAUNCHPAD_RULE' } : null;
  }

  function trustedSupply(context) {
    const legacyPump = coherentPumpIdentity(context)
      && context?.marketCapProvenance === MARKET_CAP_PROVENANCE
      && Number(context?.marketCapDivisor) === CANONICAL_PUMP_SUPPLY;
    const explicitSource = String(context?.supplySource || '');
    const declaredSource = explicitSource || (legacyPump ? 'LEGACY_PUMP_RULE' : '');
    const directSupply = legacyPump && !explicitSource
      ? Number(context.marketCapDivisor)
      : (positiveFinite(context?.totalSupply)
      ? Number(context.totalSupply)
      : (positiveFinite(context?.marketCapDivisor) ? Number(context.marketCapDivisor) : 0));
    if (declaredSource && isTrustedSupplySource(declaredSource)) {
      return validSupplyForSource(context, directSupply, declaredSource)
        ? { totalSupply: directSupply, source: declaredSource }
        : null;
    }
    const observation = {
      chain: context?.chain,
      address: context?.address || context?.tokenAddress,
      ...supplyObservation(context),
      launchpad: context?.launchpad,
      launchMode: context?.launchMode
    };
    const resolved = typeof Tango.Supply?.resolve === 'function'
      ? Tango.Supply.resolve(observation)
      : fallbackResolvedSupply(observation);
    if (!resolved) return null;
    const source = String(resolved.source || '');
    return validSupplyForSource({ ...context, ...observation }, resolved.totalSupply, source)
      ? { totalSupply: Number(resolved.totalSupply), source }
      : null;
  }

  function supplyRank(source) {
    return {
      GMGN_EXACT: 40,
      GMGN_RATIO: 30,
      LAUNCHPAD_RULE: 20,
      LEGACY_PUMP_RULE: 10,
      UNKNOWN_FALLBACK: 5
    }[String(source || '')] || 0;
  }

  function quoteSupply(quote, context) {
    const declaredSource = String(quote?.supplySource || '');
    const declaredRatioCoherent = declaredSource !== 'GMGN_RATIO' || coherentRatioObservation({
      chain: context?.chain,
      address: context?.address || context?.tokenAddress,
      marketCapUsd: quote?.marketCapUsd,
      priceUsd: quote?.priceUsd,
      observationId: quote?.observationId,
      priceObservationId: quote?.priceObservationId,
      marketCapObservationId: quote?.marketCapObservationId,
      priceObservedAt: quote?.priceObservedAt ?? quote?.originalObservedAt ?? quote?.observedAt,
      marketCapObservedAt: quote?.marketCapObservedAt ?? quote?.originalObservedAt ?? quote?.observedAt,
      priceSource: quote?.priceSource || quote?.source,
      marketCapSource: quote?.marketCapSource || quote?.source,
      priceProvenance: quote?.priceProvenance
    });
    const trustedDeclaredSource = isTrustedSupplySource(declaredSource) && declaredRatioCoherent;
    const legacyPump = coherentPumpIdentity(context)
      && quote?.valuationMode === 'MARKET_CAP'
      && String(quote?.source || '').toUpperCase() === 'GMGN_TRENCH_MC'
      && Number(quote?.marketCapDivisor) === CANONICAL_PUMP_SUPPLY;
    const declaredSupply = trustedDeclaredSource && positiveFinite(quote?.totalSupply)
      ? Number(quote.totalSupply)
      : ((trustedDeclaredSource || legacyPump) && positiveFinite(quote?.marketCapDivisor)
        ? Number(quote.marketCapDivisor)
        : 0);
    return trustedSupply({
      ...quote,
      provisionalSupplyProvenance: undefined,
      chain: context?.chain,
      totalSupply: declaredSupply,
      marketCapUsd: quote?.marketCapUsd,
      priceUsd: quote?.priceUsd,
      observationId: quote?.observationId,
      priceObservationId: quote?.priceObservationId,
      marketCapObservationId: quote?.marketCapObservationId,
      priceObservedAt: quote?.priceObservedAt ?? quote?.originalObservedAt ?? quote?.observedAt,
      marketCapObservedAt: quote?.marketCapObservedAt ?? quote?.originalObservedAt ?? quote?.observedAt,
      priceSource: quote?.priceSource || quote?.source,
      marketCapSource: quote?.marketCapSource || quote?.source,
      priceProvenance: quote?.priceProvenance,
      supplySource: trustedDeclaredSource ? declaredSource : (legacyPump ? 'LEGACY_PUMP_RULE' : ''),
      marketCapDivisor: quote?.marketCapDivisor,
      provisionalSupply: quote?.provisionalSupply,
      syntheticTokenPrice: quote?.syntheticTokenPrice,
      provisional: quote?.provisional,
      paperFallback: quote?.paperFallback,
      source: quote?.source,
      quoteSource: quote?.quoteSource,
      marketCapProvenance: legacyPump ? MARKET_CAP_PROVENANCE : undefined,
      launchpad: context?.launchpad,
      launchMode: context?.launchMode,
      tokenAddress: context?.tokenAddress || context?.address,
      address: context?.address || context?.tokenAddress
    });
  }

  function preferredSupply(quote, context) {
    const observed = quoteSupply(quote, context);
    const existing = trustedSupply(context);
    if (!observed) return existing;
    if (!existing || supplyRank(observed.source) >= supplyRank(existing.source)) return observed;
    return existing;
  }

  function usesMarketCapValuation(position) {
    const coherentPump = coherentPumpIdentity(position);
    if (position?.valuationMode === 'PRICE') return false;
    if (position?.valuationMode === 'MARKET_CAP') {
      const supply = trustedSupply(position);
      return Boolean(supply && (position?.supplySource
        || (coherentPump && position?.marketCapProvenance === MARKET_CAP_PROVENANCE
          && Number(position?.marketCapDivisor) === 1_000_000_000)));
    }
    if (position?.valuationMode != null
      || ['OBSERVED_PRICE', 'MARKET_CAP_RATIO_DERIVED', 'MIXED_DERIVED'].includes(position?.priceProvenance)
      || ['OBSERVED_PRICE', 'MARKET_CAP_RATIO_DERIVED', 'MIXED_DERIVED'].includes(position?.lastPriceProvenance)
      || ['OBSERVED_PRICE', 'MARKET_CAP_RATIO_DERIVED', 'MIXED_DERIVED'].includes(position?.averageEntryPriceProvenance)) {
      return false;
    }
    const price = Number(position?.averageEntryPriceUsd || 0);
    const marketCap = Number(position?.averageEntryMarketCap || 0);
    if (!coherentPump || !(price > 0 && marketCap > 0)
      || (position?.marketCapDivisor != null && Number(position.marketCapDivisor) !== 1_000_000_000)) return false;
    const ratio = marketCap / price;
    return ratio > 900_000_000 && ratio < 1_100_000_000;
  }

  function priceProvenanceForQuote(quote, position, trustedMarketCap = trustedMarketCapQuote(quote, position)) {
    if (quote?.syntheticTokenPrice === true || quote?.priceProvenance === 'SYNTHETIC_PRICE') {
      return 'SYNTHETIC_PRICE';
    }
    if (!trustedMarketCap) return 'OBSERVED_PRICE';
    if (trustedMarketCap.source === 'GMGN_RATIO' && positiveFinite(quote?.priceUsd)) return 'OBSERVED_PRICE';
    return position && !usesMarketCapValuation(position)
      ? 'MARKET_CAP_RATIO_DERIVED'
      : 'MARKET_CAP_DERIVED';
  }

  function trustedMarketCapQuote(quote, context) {
    if (quote?.valuationMode !== 'MARKET_CAP' || !positiveFinite(quote?.marketCapUsd)) return null;
    return preferredSupply(quote, context);
  }

  function effectiveQuotePrice(quote, position, trustContext = position) {
    const marketCap = Number(quote?.marketCapUsd || 0);
    const price = Number(quote?.priceUsd || 0);
    const trustedMarketCap = trustedMarketCapQuote(quote, trustContext);
    if (!trustedMarketCap) return price > 0 ? price : 0;
    const positionUsesMarketCap = usesMarketCapValuation(position);
    const useMarketCap = position ? positionUsesMarketCap : quote?.valuationMode === 'MARKET_CAP';
    if (useMarketCap && marketCap > 0) {
      return marketCap / trustedMarketCap.totalSupply;
    }
    if (position && !positionUsesMarketCap && quote?.valuationMode === 'MARKET_CAP' && marketCap > 0) {
      const referencePrice = Number(position.lastPriceUsd || position.averageEntryPriceUsd || 0);
      const referenceMarketCap = Number(position.lastMarketCapUsd || position.averageEntryMarketCap || 0);
      if (referencePrice > 0 && referenceMarketCap > 0) return referencePrice * marketCap / referenceMarketCap;
    }
    return price > 0 ? price : marketCap / trustedMarketCap.totalSupply;
  }

  function validateQuote(quote, now = Date.now(), staleMs, context, trustContext = context) {
    const price = effectiveQuotePrice(quote, context, trustContext);
    const clock = Number(now);
    const observedAt = quote?.observedAt;
    const nativePriceObservedAt = quote?.nativePriceObservedAt;
    const maxAge = Number(staleMs ?? Tango.QUOTE_STALE_MS ?? 15_000);
    const contextChain = String(trustContext?.chain || context?.chain || '');
    const contextAddress = trustContext?.tokenAddress || trustContext?.address
      || context?.tokenAddress || context?.address;
    const quoteChain = quote?.chain == null ? '' : String(quote.chain);
    const quoteAddress = quote?.address ?? quote?.tokenAddress;
    const quoteBindsAddress = quoteAddress != null && String(quoteAddress).trim() !== '';
    const invalidIdentity = (quoteChain && quoteChain !== contextChain)
      || (quoteBindsAddress && (!contextChain || !Tango.Chains.validateAddress(contextChain, quoteAddress)
        || !Tango.Chains.validateAddress(contextChain, contextAddress)
        || Tango.Chains.normalizeAddress(contextChain, quoteAddress)
          !== Tango.Chains.normalizeAddress(contextChain, contextAddress)));
    const invalidOptional = ['priceUsd', 'marketCapUsd', 'liquidityUsd', 'totalSupply'].some((field) =>
      quote?.[field] != null && !finiteBetween(quote[field], 0, Number.MAX_VALUE));
    const resolvedQuoteSupply = quoteSupply(quote, trustContext);
    const declaredSupplySource = String(quote?.supplySource || '');
    const invalidTrustedSupplyClaim = isTrustedSupplySource(declaredSupplySource)
      && !resolvedQuoteSupply;
    const resolvedSupplySource = String(resolvedQuoteSupply?.source || '');
    const fallbackSupplyDimension = (quote?.valuationMode === 'MARKET_CAP'
      && ['LAUNCHPAD_RULE', 'LEGACY_PUMP_RULE'].includes(resolvedSupplySource))
      || (quote?.valuationMode === 'PRICE' && resolvedSupplySource === UNKNOWN_FALLBACK_SOURCE);
    const provenance = String(quote?.priceProvenance || '').toUpperCase();
    const syntheticTokenPrice = quote?.syntheticTokenPrice === true
      || quote?.provisionalTokenPrice === true
      || provenance === 'SYNTHETIC_PRICE'
      || provenance.startsWith('FALLBACK_');
    const usesFactualMarketCap = quote?.valuationMode === 'MARKET_CAP'
      && positiveFinite(quote?.marketCapUsd) && !syntheticTokenPrice;
    const usesFactualPrice = !usesFactualMarketCap
      && positiveFinite(quote?.priceUsd) && !syntheticTokenPrice;
    const factualObservedAt = usesFactualMarketCap
      ? (quote?.marketCapObservedAt ?? observedAt)
      : usesFactualPrice ? (quote?.priceObservedAt ?? observedAt) : observedAt;
    const factualMarketCapSource = String(quote?.marketCapSource || quote?.source || '').toUpperCase();
    const coherenceSupply = preferredSupply(quote, trustContext);
    const marketCapObservedAt = quote?.marketCapObservedAt ?? quote?.originalObservedAt ?? observedAt;
    const marketCapFresh = Number.isSafeInteger(marketCapObservedAt) && marketCapObservedAt > 0
      && clock - marketCapObservedAt <= maxAge && marketCapObservedAt - clock <= MAX_FUTURE_SKEW_MS;
    const exactValuationConflict = usesFactualPrice && coherenceSupply?.source === 'GMGN_EXACT'
      && marketCapFresh
      && positiveFinite(quote?.marketCapUsd)
      && (factualMarketCapSource === 'GMGN' || factualMarketCapSource.startsWith('GMGN_')
        || factualMarketCapSource === 'DEXSCREENER')
      && Math.abs(Number(quote.priceUsd) * Number(coherenceSupply.totalSupply)
        - Number(quote.marketCapUsd)) > Number(quote.marketCapUsd) * .02;
    const observationTimes = [observedAt, nativePriceObservedAt, factualObservedAt];
    const missingCalibrationDimension = quote?.provisional === true
      && quote?.syntheticTokenPrice !== true
      && quote?.syntheticNativePrice !== true
      && !fallbackSupplyDimension;
    if (!quote || !finiteBetween(price, Number.EPSILON, Number.MAX_VALUE)
      || !finiteBetween(quote.nativePriceUsd, Number.EPSILON, Number.MAX_VALUE)
      || invalidOptional
      || invalidIdentity
      || invalidTrustedSupplyClaim
      || exactValuationConflict
      || missingCalibrationDimension
      || (quote.marketCapDivisor != null && !finiteBetween(quote.marketCapDivisor, Number.EPSILON, Number.MAX_VALUE))
      || !Number.isSafeInteger(clock) || clock < 0
      || observationTimes.some((value) => (
        typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0
      ))
      || !finiteBetween(maxAge, 1, MAX_QUOTE_AGE_MS)
      || observationTimes.some((value) => value - clock > MAX_FUTURE_SKEW_MS)) {
      return { ok: false, reason: 'invalidQuote' };
    }
    if (observationTimes.some((value) => clock - value > maxAge)) {
      return { ok: false, reason: 'staleQuote' };
    }
    return { ok: true };
  }

  function safeDurableObservedAt(value, boundary) {
    return typeof value === 'number'
      && Number.isSafeInteger(value)
      && value >= 0
      && value <= boundary
      ? value
      : null;
  }

  function durableOriginalObservedAt(quote, boundary) {
    const explicit = quote?.originalObservedAt != null;
    const selected = explicit ? quote.originalObservedAt : quote?.observedAt;
    const durable = safeDurableObservedAt(selected, boundary);
    if (durable != null) return durable;
    const malformedExplicitFallback = explicit
      && safeDurableObservedAt(selected, Number.MAX_SAFE_INTEGER) == null
      && quote?.paperFallback === true
      && quote?.syntheticTokenPrice === true;
    if (malformedExplicitFallback) throw new Error('invalidQuote');
    return safeDurableObservedAt(quote?.observedAt, boundary);
  }

  function durableNativeOriginalObservedAt(quote, boundary) {
    const selected = quote?.nativeOriginalObservedAt == null
      ? quote?.nativePriceObservedAt
      : quote.nativeOriginalObservedAt;
    return safeDurableObservedAt(selected, boundary)
      ?? safeDurableObservedAt(quote?.nativePriceObservedAt, boundary);
  }

  function feeFor(amountNative, settings) {
    return Number(amountNative) * Number(settings.platformFeeBps || 0) / 10_000;
  }

  function validatedExecutionSettings(settings, chain) {
    const slippageBps = Number(settings?.slippageBps ?? 0);
    const platformFeeBps = Number(settings?.platformFeeBps ?? 0);
    const networkFeeNative = Number(tradeSettings(settings, chain).networkFeeNative ?? 0);
    if (!finiteBetween(slippageBps, 0, 9_999)
      || !finiteBetween(platformFeeBps, 0, 9_999)
      || !finiteBetween(networkFeeNative, 0, Number.MAX_VALUE)) throw new Error('invalidSettings');
    return { slippageBps, platformFeeBps, networkFeeNative };
  }

  function nativeSymbol(chain) {
    return Tango.Chains?.get(chain)?.nativeSymbol || 'NATIVE';
  }

  function supplyIdentity(quote, context) {
    const supply = preferredSupply(quote, context);
    return {
      totalSupply: Number(supply?.totalSupply || 0),
      supplySource: String(supply?.source || ''),
      launchpad: String(context?.launchpad || ''),
      launchMode: String(context?.launchMode || '')
    };
  }

  function calibrationStillNeeded(existing, quote, supply) {
    const unresolvedSupply = existing?.needsCalibration === true
      && supplyRank(supply?.supplySource) <= supplyRank('LAUNCHPAD_RULE');
    const resolvedFallbackSupply = quote?.valuationMode === 'MARKET_CAP'
      && ['LAUNCHPAD_RULE', 'LEGACY_PUMP_RULE'].includes(String(supply?.supplySource || ''));
    return Boolean(
      unresolvedSupply
      || existing?.provisionalTokenPrice
      || existing?.provisionalNativePrice
      || quote?.syntheticTokenPrice
      || quote?.syntheticNativePrice
      || supply?.supplySource === UNKNOWN_FALLBACK_SOURCE
      || resolvedFallbackSupply
    );
  }

  function initialMarketCapPlaceholder(quote) {
    return quote?.syntheticTokenPrice === true && quote?.paperFallback === true
      && String(quote.source || '').toUpperCase() === 'TANGO_FALLBACK'
      && Number(quote.marketCapUsd) === Number(Tango.Supply.UNKNOWN_INITIAL_MARKET_CAP_USD)
      && !(Number(quote.marketCapObservedAt) > 0)
      && quote.originalObservedAt === 0;
  }

  function observedTokenValuation(quote) {
    if (quote?.syntheticTokenPrice !== true && positiveFinite(quote?.priceUsd)) return true;
    return positiveFinite(quote?.marketCapUsd)
      && ['GMGN', 'GMGN_DETAIL', 'GMGN_TRENCH', 'GMGN_NETWORK'].includes(
        String(quote.marketCapSource || '').toUpperCase())
      && Number.isSafeInteger(quote.marketCapObservedAt) && quote.marketCapObservedAt > 0;
  }

  function calibrationReason(price, nativePrice, supply) {
    if (price && nativePrice && supply) return 'PRICE_NATIVE_AND_SUPPLY';
    if (price && nativePrice) return 'PRICE_AND_NATIVE';
    if (price && supply) return 'PRICE_AND_SUPPLY';
    if (nativePrice && supply) return 'NATIVE_AND_SUPPLY';
    if (price) return 'PRICE';
    if (nativePrice) return 'NATIVE';
    return supply ? 'SUPPLY' : '';
  }

  function calibratePositionResult(state, token, quote, now = Date.now()) {
    const key = positionKey(token?.chain, token?.address);
    const existing = state.positions?.[key];
    const validationContext = verifiedLaunchContext(existing, token);
    if (!existing || !positiveFinite(existing.quantity)
      || !Number.isSafeInteger(Number(now)) || Number(now) < 0
      || !validateQuote(quote, Number(now), Tango.QUOTE_STALE_MS, existing, validationContext).ok) {
      return { status: 'NOOP', state };
    }

    const newPriceUsd = effectiveQuotePrice(quote, existing, validationContext);
    const newNativePriceUsd = Number(quote.nativePriceUsd || existing.lastNativePriceUsd);
    const oldSupply = trustedSupply(existing);
    const observedLaunchpad = validationContext.launchpad;
    const observedLaunchMode = validationContext.launchMode;
    const observedSupply = quoteSupply(quote, {
      ...existing, launchpad: observedLaunchpad, launchMode: observedLaunchMode
    });
    const nativeCorrection = existing.provisionalNativePrice === true
      && quote.syntheticNativePrice !== true;
    const sameRankModeCorrection = oldSupply?.source === 'LAUNCHPAD_RULE'
      && observedSupply?.source === 'LAUNCHPAD_RULE'
      && !String(existing.launchMode || '').trim()
      && Boolean(String(observedLaunchMode || '').trim());
    const supplyCorrection = usesMarketCapValuation(existing)
      && Boolean(oldSupply)
      && Boolean(observedSupply)
      && (supplyRank(observedSupply.source) > supplyRank(oldSupply.source) || sameRankModeCorrection)
      && Math.abs(observedSupply.totalSupply - oldSupply.totalSupply)
        > oldSupply.totalSupply * Number.EPSILON;
    const marketCapMoved = positiveFinite(existing.lastMarketCapUsd)
      && positiveFinite(quote.marketCapUsd)
      && Math.abs(Number(quote.marketCapUsd) - Number(existing.lastMarketCapUsd))
        > Number(existing.lastMarketCapUsd) * Number.EPSILON;
    const priceCorrection = existing.provisionalTokenPrice === true
      && quote.syntheticTokenPrice !== true
      && (!supplyCorrection || marketCapMoved);
    const initialMarketCapCorrection = existing.initialMarketCapPending === true
      && observedTokenValuation(quote);
    const reason = calibrationReason(priceCorrection || initialMarketCapCorrection, nativeCorrection, supplyCorrection);
    if (!reason) return { status: 'NOOP', state };

    const selectedSupply = preferredSupply(quote, {
      ...existing, launchpad: observedLaunchpad, launchMode: observedLaunchMode
    });
    if (![newPriceUsd, newNativePriceUsd].every(positiveFinite)) {
      return { status: 'FAILED', state, reason: 'calibrationFailed' };
    }
    const neutralDimensionCorrection = supplyCorrection || nativeCorrection || initialMarketCapCorrection;
    const supplyRatio = supplyCorrection
      ? observedSupply.totalSupply / oldSupply.totalSupply : 1;
    const oldNativePriceUsd = Number(existing.lastNativePriceUsd || newNativePriceUsd);
    const nativeRatio = nativeCorrection ? newNativePriceUsd / oldNativePriceUsd : 1;
    // Correct the placeholder price once. Its ratio already includes any supply
    // change, so applying supplyRatio as well would count that change twice.
    const tokenRatio = initialMarketCapCorrection
      ? Number(existing.lastPriceUsd) / newPriceUsd : supplyRatio;
    const nextQuantity = Number(existing.quantity) * tokenRatio * nativeRatio;
    let roundedNextQuantity;
    try {
      roundedNextQuantity = checkedRound(nextQuantity, 'positive');
    } catch {
      return { status: 'FAILED', state, reason: 'invalidArithmetic' };
    }
    const nextAverageEntryPriceUsd = neutralDimensionCorrection
      ? Number(existing.costBasisNative) * newNativePriceUsd / roundedNextQuantity
      : Number(existing.averageEntryPriceUsd);
    const selectedTotalSupply = Number(
      selectedSupply?.totalSupply || existing.totalSupply || existing.marketCapDivisor || 0
    );
    const nextAverageEntryMarketCap = neutralDimensionCorrection && selectedTotalSupply > 0
      ? nextAverageEntryPriceUsd * selectedTotalSupply
      : Number(existing.averageEntryMarketCap || 0);
    if (![roundedNextQuantity, nextAverageEntryPriceUsd].every(positiveFinite)
      || !finiteBetween(nextAverageEntryMarketCap, 0, Number.MAX_VALUE)) {
      return { status: 'FAILED', state, reason: 'invalidArithmetic' };
    }

    const nextProvisionalTokenPrice = existing.provisionalTokenPrice === true
      && !priceCorrection && !supplyCorrection;
    const nextProvisionalNativePrice = existing.provisionalNativePrice === true && !nativeCorrection;
    const unresolvedFallbackSupply = existing.needsCalibration === true
      && Boolean(oldSupply)
      && supplyRank(oldSupply.source) <= supplyRank('LAUNCHPAD_RULE')
      && !supplyCorrection;
    const needsCalibration = nextProvisionalTokenPrice
      || nextProvisionalNativePrice
      || unresolvedFallbackSupply;
    const nextState = structuredCloneSafe(state);
    nextState.positions[key] = {
      ...nextState.positions[key],
      quantity: roundedNextQuantity,
      averageEntryPriceUsd: nextAverageEntryPriceUsd,
      averageEntryMarketCap: nextAverageEntryMarketCap,
      lastPriceUsd: newPriceUsd,
      lastMarketCapUsd: coherentPositionMarketCap(newPriceUsd,
        Number(quote.marketCapUsd || existing.lastMarketCapUsd || 0), selectedTotalSupply,
        { ...existing, supplySource: selectedSupply?.source || existing.supplySource,
          lastPriceProvenance: priceProvenanceForQuote(quote, existing) }),
      lastNativePriceUsd: newNativePriceUsd,
      quoteObservedAt: safeDurableObservedAt(quote.observedAt, Number(now)) ?? Number(now),
      updatedAt: Number(now),
      lastPriceProvenance: priceProvenanceForQuote(quote, existing),
      totalSupply: selectedTotalSupply,
      supplySource: String(selectedSupply?.source || existing.supplySource || ''),
      provisionalSupply: selectedSupply?.source === UNKNOWN_FALLBACK_SOURCE
        ? selectedTotalSupply : 0,
      ...(selectedSupply?.source === UNKNOWN_FALLBACK_SOURCE
        ? { provisionalSupplyProvenance: UNKNOWN_FALLBACK_PROVENANCE }
        : {}),
      launchpad: String(observedLaunchpad || existing.launchpad || ''),
      launchMode: String(observedLaunchMode || existing.launchMode || ''),
      marketCapDivisor: selectedTotalSupply,
      needsCalibration,
      provisional: nextProvisionalTokenPrice || nextProvisionalNativePrice,
      syntheticTokenPrice: nextProvisionalTokenPrice,
      syntheticNativePrice: nextProvisionalNativePrice,
      provisionalTokenPrice: nextProvisionalTokenPrice,
      initialMarketCapPending: existing.initialMarketCapPending === true && !initialMarketCapCorrection,
      provisionalNativePrice: nextProvisionalNativePrice,
      ...(selectedSupply?.source === 'LEGACY_PUMP_RULE'
        ? { marketCapProvenance: MARKET_CAP_PROVENANCE }
        : {})
    };
    if (selectedSupply?.source !== 'LEGACY_PUMP_RULE') {
      delete nextState.positions[key].marketCapProvenance;
    }
    if (selectedSupply?.source !== UNKNOWN_FALLBACK_SOURCE) {
      delete nextState.positions[key].provisionalSupplyProvenance;
    }
    const event = {
      id: cryptoId(Number(now)),
      chain: existing.chain,
      tokenAddress: existing.tokenAddress,
      reason,
      fromPriceUsd: Number(existing.lastPriceUsd || existing.averageEntryPriceUsd || 0),
      toPriceUsd: Number(newPriceUsd),
      fromNativePriceUsd: Number(existing.lastNativePriceUsd || 0),
      toNativePriceUsd: Number(newNativePriceUsd),
      fromSupply: Number(oldSupply?.totalSupply || existing.totalSupply || existing.marketCapDivisor || 0),
      toSupply: Number(selectedSupply?.totalSupply || oldSupply?.totalSupply || 0),
      quantityBefore: Number(existing.quantity),
      quantityAfter: roundedNextQuantity,
      costBasisNative: Number(existing.costBasisNative),
      createdAt: Number(now)
    };
    nextState.calibrations = [event, ...(state.calibrations || [])];
    return { status: 'CALIBRATED', state: nextState };
  }

  function coherentPositionMarketCap(priceUsd, marketCapUsd, totalSupply, context) {
    const derived = ['MARKET_CAP_DERIVED', 'MARKET_CAP_RATIO_DERIVED', 'MIXED_DERIVED'];
    const needsCoherence = context?.valuationMode === 'MARKET_CAP'
      || context?.supplySource === 'GMGN_RATIO'
      || derived.includes(context?.lastPriceProvenance)
      || derived.includes(context?.averageEntryPriceProvenance);
    if (!needsCoherence || context?.supplySource === UNKNOWN_FALLBACK_SOURCE
      || !(priceUsd > 0 && totalSupply > 0)) return marketCapUsd;
    if (marketCapUsd > 0 && Math.abs(marketCapUsd / priceUsd - totalSupply) <= totalSupply * .001) return marketCapUsd;
    // Preserve the observed fill price and raw trade MC. A durable position's
    // valuation coordinate must use the same units as its trusted supply.
    return checkedArithmetic(priceUsd * totalSupply, 'positive');
  }

  function calibratePosition(state, token, quote, now = Date.now()) {
    return calibratePositionResult(state, token, quote, now).state;
  }

  function preparePositionForExecution(state, token, quote, now, staleMs) {
    const chain = Tango.Chains.require(token?.chain).id;
    const key = positionKey(chain, token?.address);
    const existing = state.positions?.[key] || null;
    const caller = callerTokenSupplyContext(token, chain,
      Tango.Chains.normalizeAddress(chain, token.address));
    const baseContext = existing || caller;
    const mergedContext = verifiedLaunchContext(baseContext, token);
    const first = validateQuote(quote, now, staleMs, baseContext, mergedContext);
    if (!first.ok) throw new Error(first.reason);

    const calibration = existing
      ? calibratePositionResult(state, token, quote, now)
      : { status: 'NOOP', state };
    if (calibration.status === 'FAILED') throw new Error(calibration.reason);
    const position = calibration.state.positions?.[key] || null;
    const trustContext = verifiedLaunchContext(position || caller, token);
    const second = validateQuote(quote, now, staleMs, position || caller, trustContext);
    if (!second.ok) throw new Error(second.reason);
    return {
      state: calibration.state, key, position, trustContext,
      calibrationStatus: calibration.status
    };
  }

  function executeBuy(state, order, settings, now = Date.now()) {
    const chain = Tango.Chains.require(order?.token?.chain).id;
    const tokenAddress = Tango.Chains.normalizeAddress(chain, order?.token?.address);
    const executionSettings = validatedExecutionSettings(settings, chain);
    const amountNative = Number(order?.amountNative);
    if (!finiteBetween(amountNative, Number.EPSILON, Number.MAX_VALUE)) throw new Error('invalidAmount');
    const held = state.positions?.[positionKey(chain, tokenAddress)];
    // A missing quote must never price a new tranche at the arbitrary launch
    // placeholder once this position has an established valuation. The content
    // path supplies explicit position history for offline/no-chart additions.
    if (held && held.initialMarketCapPending !== true && initialMarketCapPlaceholder(order.quote)) {
      throw new Error('invalidQuote');
    }
    const prepared = preparePositionForExecution(
      state, order?.token, order?.quote, now, order?.staleMs
    );
    const key = prepared.key;
    const workingState = prepared.state;
    const account = chainAccount(workingState, chain);
    const existing = prepared.position;
    const trustContext = prepared.trustContext;
    const cashBalanceNative = checkedArithmetic(account.cashBalanceNative, 'nonnegative');
    if (amountNative > cashBalanceNative + 1e-12) throw new Error('insufficientBalance');

    const slippage = executionSettings.slippageBps / 10_000;
    const networkFeeNative = checkedArithmetic(executionSettings.networkFeeNative, 'nonnegative');
    const platformFeeNative = checkedArithmetic(feeFor(amountNative, executionSettings), 'nonnegative');
    const netInvestmentNative = checkedArithmetic(amountNative - platformFeeNative - networkFeeNative);
    if (netInvestmentNative <= 0) throw new Error('invalidAmount');

    const trustedMarketCap = trustedMarketCapQuote(order.quote, trustContext);
    const factualPriceOnly = order.quote?.valuationMode === 'PRICE'
      && positiveFinite(order.quote?.priceUsd)
      && order.quote?.syntheticTokenPrice !== true;
    const positionValuationMode = existing
      ? (usesMarketCapValuation(existing) ? 'MARKET_CAP' : 'PRICE')
      : (trustedMarketCap && trustedMarketCap.source !== 'GMGN_RATIO' ? 'MARKET_CAP' : 'PRICE');
    const tradeObservationMode = factualPriceOnly ? 'PRICE' : positionValuationMode;
    const provenanceContext = existing || trustContext;
    const executionSupply = supplyIdentity(order.quote, provenanceContext);
    const executionTotalSupply = checkedArithmetic(executionSupply.totalSupply, 'nonnegative');
    const marketCapDivisor = checkedArithmetic(
      executionTotalSupply || existing?.marketCapDivisor || 0, 'nonnegative'
    );
    const valuationContext = existing || (positionValuationMode === 'MARKET_CAP'
      ? {
        ...trustContext, ...executionSupply,
        valuationMode: positionValuationMode, marketCapDivisor,
        ...(executionSupply.supplySource === 'LEGACY_PUMP_RULE'
          ? { marketCapProvenance: MARKET_CAP_PROVENANCE }
          : {})
      }
      : trustContext);
    const priceProvenance = priceProvenanceForQuote(order.quote, existing || valuationContext, trustedMarketCap);
    const observedPriceUsd = checkedArithmetic(
      effectiveQuotePrice(order.quote, valuationContext, trustContext), 'positive'
    );
    const executionPriceUsd = checkedArithmetic(observedPriceUsd * (1 + slippage), 'positive');
    const nativePriceUsd = checkedArithmetic(order.quote.nativePriceUsd, 'positive');
    const quantity = checkedArithmetic(netInvestmentNative * nativePriceUsd / executionPriceUsd, 'positive');
    const existingQuantity = checkedArithmetic(existing?.quantity ?? 0, 'nonnegative');
    const existingCost = checkedArithmetic(existing?.costBasisNative ?? 0, 'nonnegative');
    const existingAveragePrice = checkedArithmetic(existing?.averageEntryPriceUsd ?? 0, 'nonnegative');
    if (existingQuantity > 0 && existingAveragePrice <= 0) throw new Error('invalidArithmetic');
    const quoteMarketCapUsd = checkedArithmetic(order.quote.marketCapUsd ?? 0, 'nonnegative');
    const quoteLiquidityUsd = checkedArithmetic(order.quote.liquidityUsd ?? 0, 'nonnegative');
    const existingAverageMarketCap = checkedArithmetic(
      existing?.averageEntryMarketCap ?? quoteMarketCapUsd, 'nonnegative'
    );
    const nextQuantity = checkedArithmetic(existingQuantity + quantity, 'positive');
    const nextCost = checkedArithmetic(existingCost + amountNative, 'positive');
    const existingPriceValue = checkedArithmetic(existingQuantity * existingAveragePrice, 'nonnegative');
    const addedPriceValue = checkedArithmetic(quantity * executionPriceUsd, 'positive');
    const averageEntryPriceUsd = checkedArithmetic(
      checkedArithmetic(existingPriceValue + addedPriceValue, 'positive') / nextQuantity,
      'positive'
    );
    const existingMarketCapValue = checkedArithmetic(existingCost * existingAverageMarketCap, 'nonnegative');
    const addedMarketCapValue = checkedArithmetic(amountNative * quoteMarketCapUsd, 'nonnegative');
    const averageEntryMarketCap = checkedArithmetic(
      checkedArithmetic(existingMarketCapValue + addedMarketCapValue, 'nonnegative') / nextCost,
      'nonnegative'
    );
    const orderMetadataSource = trustedMetadataSource(order.token);
    const positionSymbol = existing?.symbol || (orderMetadataSource && validIdentityText(order.token.symbol, 32)) || 'TOKEN';
    const positionName = existing?.name || (orderMetadataSource && validIdentityText(order.token.name, 100)) || positionSymbol || 'Token';
    const positionLogoUrl = existing?.logoUrl || (orderMetadataSource && String(order.token.logoUrl || '').trim()) || '';
    const metadataSource = existing ? (existing.metadataSource || '') : orderMetadataSource;
    const provisionalTokenPrice = existing?.provisionalTokenPrice === true
      || order.quote.syntheticTokenPrice === true;
    const provisionalNativePrice = existing?.provisionalNativePrice === true
      || order.quote.syntheticNativePrice === true;
    const needsCalibration = calibrationStillNeeded(existing, order.quote, executionSupply);
    const legacyExecutionSupply = executionSupply.supplySource === 'LEGACY_PUMP_RULE';
    const unknownFallbackSupply = executionSupply.supplySource === UNKNOWN_FALLBACK_SOURCE;
    const existingEntryProvenance = existing?.averageEntryPriceProvenance
      || (existing ? (usesMarketCapValuation(existing) ? 'MARKET_CAP_DERIVED' : 'OBSERVED_PRICE') : '');
    const averageEntryPriceProvenance = existingQuantity > 0 && existingEntryProvenance !== priceProvenance
      ? 'MIXED_DERIVED' : existingEntryProvenance || priceProvenance;
    const existingRealizedPnlNative = checkedArithmetic(existing?.realizedPnlNative ?? 0);
    const nextCashBalanceNative = checkedArithmetic(cashBalanceNative - amountNative, 'nonnegative');
    const roundedQuantity = checkedRound(quantity, 'positive');
    const roundedAmountNative = checkedRound(amountNative, 'positive');
    const roundedExecutionPriceUsd = checkedRound(executionPriceUsd, 'positive');
    const roundedPlatformFeeNative = checkedRound(platformFeeNative, 'nonnegative');
    const roundedNetworkFeeNative = checkedRound(networkFeeNative, 'nonnegative');
    const roundedNextCashBalanceNative = checkedRound(nextCashBalanceNative, 'nonnegative');
    const roundedNextQuantity = checkedRound(nextQuantity, 'positive');
    const roundedNextCost = checkedRound(nextCost, 'positive');
    const roundedAverageEntryPriceUsd = checkedRound(averageEntryPriceUsd, 'positive');
    const roundedAverageEntryMarketCap = checkedRound(averageEntryMarketCap, 'nonnegative');
    const quoteObservedAtOriginal = durableOriginalObservedAt(order.quote, now);
    const nativePriceObservedAtOriginal = durableNativeOriginalObservedAt(order.quote, now);
    const positionQuoteObservedAt = safeDurableObservedAt(order.quote.observedAt, now);

    const trade = {
      id: cryptoId(now), chain, tokenAddress, symbol: positionSymbol, name: positionName, logoUrl: positionLogoUrl,
      side: 'BUY', quantity: roundedQuantity, amountNative: roundedAmountNative,
      observedPriceUsd, executionPriceUsd: roundedExecutionPriceUsd,
      marketCapUsd: quoteMarketCapUsd, liquidityUsd: quoteLiquidityUsd, nativePriceUsd,
      nativeSymbol: nativeSymbol(chain), slippageBps: executionSettings.slippageBps,
      platformFeeNative: roundedPlatformFeeNative, networkFeeNative: roundedNetworkFeeNative,
      realizedPnlNative: 0, realizedPnlUsd: 0,
      valuationMode: tradeObservationMode, priceProvenance,
      quoteSource: String(order.quote.source || ''), paperFallback: order.quote.paperFallback === true,
      provisional: order.quote.provisional === true,
      syntheticTokenPrice: order.quote.syntheticTokenPrice === true,
      syntheticNativePrice: order.quote.syntheticNativePrice === true,
      totalSupply: executionTotalSupply,
      supplySource: String(executionSupply.supplySource),
      ...(unknownFallbackSupply ? {
        marketCapDivisor: executionTotalSupply,
        provisionalSupply: executionTotalSupply,
        provisionalSupplyProvenance: UNKNOWN_FALLBACK_PROVENANCE
      } : {}),
      launchpad: executionSupply.launchpad,
      launchMode: executionSupply.launchMode,
      ...(quoteObservedAtOriginal == null ? {} : { quoteObservedAtOriginal }),
      ...(nativePriceObservedAtOriginal == null ? {} : { nativePriceObservedAtOriginal }),
      ...(legacyExecutionSupply ? { marketCapProvenance: MARKET_CAP_PROVENANCE } : {}),
      sourceUrl: order.sourceUrl || '', executedAt: now
    };

    const nextState = structuredCloneSafe(workingState);
    nextState.accounts[chain].cashBalanceNative = roundedNextCashBalanceNative;
    nextState.accounts[chain].updatedAt = now;
    nextState.positions[key] = {
      ...(existing || {}), chain, tokenAddress, symbol: positionSymbol, name: positionName, logoUrl: positionLogoUrl,
      metadataSource, quantity: roundedNextQuantity, costBasisNative: roundedNextCost,
      averageEntryPriceUsd: roundedAverageEntryPriceUsd,
      averageEntryMarketCap: roundedAverageEntryMarketCap, realizedPnlNative: existingRealizedPnlNative,
      lastPriceUsd: observedPriceUsd, lastMarketCapUsd: coherentPositionMarketCap(
        observedPriceUsd, quoteMarketCapUsd, executionTotalSupply,
        { ...existing, valuationMode: positionValuationMode, supplySource: executionSupply.supplySource,
          lastPriceProvenance: priceProvenance, averageEntryPriceProvenance }),
      lastNativePriceUsd: nativePriceUsd, openedAt: existing?.openedAt || now,
      ...(positionQuoteObservedAt == null ? {} : { quoteObservedAt: positionQuoteObservedAt }),
      updatedAt: now, valuationMode: positionValuationMode,
      marketCapDivisor, lastPriceProvenance: priceProvenance,
      provisional: order.quote.provisional === true,
      syntheticTokenPrice: order.quote.syntheticTokenPrice === true,
      syntheticNativePrice: order.quote.syntheticNativePrice === true,
      totalSupply: executionTotalSupply, supplySource: String(executionSupply.supplySource),
      launchpad: executionSupply.launchpad, launchMode: executionSupply.launchMode,
      provisionalSupply: unknownFallbackSupply ? executionTotalSupply : 0,
      ...(unknownFallbackSupply
        ? { provisionalSupplyProvenance: UNKNOWN_FALLBACK_PROVENANCE }
        : {}),
      quoteSource: String(order.quote.source || existing?.quoteSource || ''),
      paperFallback: order.quote.paperFallback === true || existing?.paperFallback === true,
      needsCalibration, provisionalTokenPrice, provisionalNativePrice,
      initialMarketCapPending: existing ? existing.initialMarketCapPending === true
        : initialMarketCapPlaceholder(order.quote),
      averageEntryPriceProvenance,
      ...(legacyExecutionSupply ? { marketCapProvenance: MARKET_CAP_PROVENANCE } : {})
    };
    if (positionQuoteObservedAt == null) delete nextState.positions[key].quoteObservedAt;
    if (!legacyExecutionSupply) delete nextState.positions[key].marketCapProvenance;
    if (!unknownFallbackSupply) delete nextState.positions[key].provisionalSupplyProvenance;
    nextState.trades = [trade, ...(workingState.trades || [])];
    return {
      state: nextState,
      trade,
      position: nextState.positions[key],
      calibration: prepared.calibrationStatus === 'CALIBRATED'
        ? workingState.calibrations[0] : null
    };
  }

  function executeSell(state, order, settings, now = Date.now()) {
    const chain = Tango.Chains.require(order?.token?.chain).id;
    const tokenAddress = Tango.Chains.normalizeAddress(chain, order?.token?.address);
    const key = positionKey(chain, tokenAddress);
    const originalPosition = state.positions?.[key];
    if (!originalPosition || !(Number(originalPosition.quantity) > 0)) throw new Error('noPosition');
    const executionSettings = validatedExecutionSettings(settings, chain);
    const recoveringCost = order?.breakeven === true;
    let percent = Number(order?.percent || 0);
    const requestedOrderQuantity = recoveringCost || order?.quantity == null ? null : Number(order.quantity);
    if (!recoveringCost && requestedOrderQuantity == null) {
      if (!finiteBetween(percent, Number.EPSILON, 100)) throw new Error('invalidAmount');
    } else if (!recoveringCost && !finiteBetween(requestedOrderQuantity, Number.EPSILON, Number.MAX_VALUE)) {
      throw new Error('invalidAmount');
    }
    const prepared = preparePositionForExecution(
      state, order?.token, order?.quote, now, order?.staleMs
    );
    const workingState = prepared.state;
    const existing = prepared.position;
    if (!existing || !(Number(existing.quantity) > 0)) throw new Error('noPosition');
    const account = chainAccount(workingState, chain);

    if (recoveringCost) {
      if (breakevenTargetNative(existing) === 0) throw new Error('breakevenRecovered');
      percent = breakevenSellPercent(existing, order.quote, settings, now);
      if (!(percent > 0 && percent <= 100)) throw new Error('breakevenUnavailable');
    }

    const existingQuantity = checkedArithmetic(existing.quantity, 'positive');
    const fullClose = requestedOrderQuantity == null && percent === 100;
    const requestedQuantity = requestedOrderQuantity == null
      ? (fullClose ? existingQuantity : checkedArithmetic(existingQuantity * percent / 100, 'positive'))
      : requestedOrderQuantity;
    const quantity = fullClose ? existingQuantity : Math.min(existingQuantity, requestedQuantity);
    if (!finiteBetween(requestedQuantity, Number.EPSILON, Number.MAX_VALUE)
      || !finiteBetween(quantity, Number.EPSILON, Number.MAX_VALUE)) throw new Error('invalidAmount');

    const slippage = executionSettings.slippageBps / 10_000;
    const observedPriceUsd = checkedArithmetic(effectiveQuotePrice(order.quote, existing), 'positive');
    const executionPriceUsd = checkedArithmetic(observedPriceUsd * (1 - slippage), 'positive');
    const trustedMarketCap = trustedMarketCapQuote(order.quote, existing);
    const factualPriceOnly = order.quote?.valuationMode === 'PRICE'
      && positiveFinite(order.quote?.priceUsd)
      && order.quote?.syntheticTokenPrice !== true;
    const valuationMode = factualPriceOnly
      ? 'PRICE'
      : (usesMarketCapValuation(existing) ? 'MARKET_CAP' : 'PRICE');
    const priceProvenance = priceProvenanceForQuote(order.quote, existing, trustedMarketCap);
    const executionSupply = supplyIdentity(order.quote, existing);
    const legacyExecutionSupply = executionSupply.supplySource === 'LEGACY_PUMP_RULE';
    const unknownFallbackSupply = executionSupply.supplySource === UNKNOWN_FALLBACK_SOURCE;
    const executionTotalSupply = checkedArithmetic(executionSupply.totalSupply, 'nonnegative');
    const marketCapDivisor = checkedArithmetic(
      executionTotalSupply || existing.marketCapDivisor || 0, 'nonnegative'
    );
    const nativePriceUsd = checkedArithmetic(order.quote.nativePriceUsd, 'positive');
    const grossProceedsNative = checkedArithmetic(
      quantity * executionPriceUsd / nativePriceUsd, 'positive'
    );
    const platformFeeNative = checkedArithmetic(
      feeFor(grossProceedsNative, executionSettings), 'nonnegative'
    );
    const networkFeeNative = checkedArithmetic(executionSettings.networkFeeNative, 'nonnegative');
    const netBeforeFloor = checkedArithmetic(grossProceedsNative - platformFeeNative - networkFeeNative);
    const netProceedsNative = checkedArithmetic(Math.max(0, netBeforeFloor), 'nonnegative');
    const existingCostBasisNative = checkedArithmetic(existing.costBasisNative, 'nonnegative');
    const remainingQuantity = fullClose
      ? 0 : checkedArithmetic(Math.max(0, existingQuantity - quantity), 'nonnegative');
    const partialPositionWithCost = existingCostBasisNative > 0 && remainingQuantity > 0;
    const costShareNative = fullClose
      ? existingCostBasisNative
      : checkedArithmetic(
        existingCostBasisNative * quantity / existingQuantity,
        existingCostBasisNative > 0 ? 'positive' : 'nonnegative'
      );
    if (partialPositionWithCost && costShareNative >= existingCostBasisNative) {
      throw new Error('invalidArithmetic');
    }
    const remainingCost = fullClose
      ? 0
      : checkedArithmetic(
        Math.max(0, existingCostBasisNative - costShareNative),
        partialPositionWithCost ? 'positive' : 'nonnegative'
      );
    const realizedPnlNative = checkedArithmetic(netProceedsNative - costShareNative);
    const realizedPnlUsd = checkedArithmetic(realizedPnlNative * nativePriceUsd);
    const quoteMarketCapUsd = checkedArithmetic(order.quote.marketCapUsd ?? 0, 'nonnegative');
    const quoteLiquidityUsd = checkedArithmetic(order.quote.liquidityUsd ?? 0, 'nonnegative');
    const entryMarketCapUsd = checkedArithmetic(existing.averageEntryMarketCap ?? 0, 'nonnegative');
    const cashBalanceNative = checkedArithmetic(account.cashBalanceNative, 'nonnegative');
    const accountRealizedPnlNative = checkedArithmetic(account.realizedPnlNative ?? 0);
    const positionRealizedPnlNative = checkedArithmetic(existing.realizedPnlNative ?? 0);
    const nextCashBalanceNative = checkedArithmetic(cashBalanceNative + netProceedsNative, 'nonnegative');
    const nextAccountRealizedPnlNative = checkedArithmetic(accountRealizedPnlNative + realizedPnlNative);
    const nextPositionRealizedPnlNative = checkedArithmetic(positionRealizedPnlNative + realizedPnlNative);
    const heldMs = checkedArithmetic(Math.max(0, now - Number(existing.openedAt ?? now)), 'nonnegative');
    const dayKey = localDateKey(now);
    const day = workingState.dailyRealizedByChain?.[chain]?.[dayKey]
      || { native: 0, usdAtExecution: 0 };
    const dayNative = checkedArithmetic(day.native ?? 0);
    const dayUsdAtExecution = checkedArithmetic(day.usdAtExecution ?? 0);
    const nextDayNative = checkedArithmetic(dayNative + realizedPnlNative);
    const nextDayUsdAtExecution = checkedArithmetic(dayUsdAtExecution + realizedPnlUsd);

    const roundedQuantity = checkedRound(quantity, 'positive');
    const roundedNetProceedsNative = checkedRound(
      netProceedsNative, netBeforeFloor > 0 ? 'positive' : 'nonnegative'
    );
    const roundedExecutionPriceUsd = checkedRound(executionPriceUsd, 'positive');
    const roundedPlatformFeeNative = checkedRound(platformFeeNative, 'nonnegative');
    const roundedNetworkFeeNative = checkedRound(networkFeeNative, 'nonnegative');
    const roundedRealizedPnlNative = checkedRound(realizedPnlNative);
    const roundedRealizedPnlUsd = checkedRound(realizedPnlUsd);
    const roundedNextCashBalanceNative = checkedRound(nextCashBalanceNative, 'nonnegative');
    const roundedNextAccountRealizedPnlNative = checkedRound(nextAccountRealizedPnlNative);
    const roundedRemainingQuantity = checkedRound(remainingQuantity, 'nonnegative');
    const roundedRemainingCost = checkedRound(
      remainingCost, remainingCost > 0 ? 'positive' : 'nonnegative'
    );
    if (existingCostBasisNative > 0 && roundedRemainingQuantity > 0 && roundedRemainingCost <= 0) {
      throw new Error('invalidArithmetic');
    }
    if (remainingQuantity > 0 && roundedRemainingQuantity <= 0) throw new Error('invalidArithmetic');
    const roundedNextPositionRealizedPnlNative = checkedRound(nextPositionRealizedPnlNative);
    const roundedNextDayNative = checkedRound(nextDayNative);
    const roundedNextDayUsdAtExecution = checkedRound(nextDayUsdAtExecution);
    const quoteObservedAtOriginal = durableOriginalObservedAt(order.quote, now);
    const nativePriceObservedAtOriginal = durableNativeOriginalObservedAt(order.quote, now);
    const positionQuoteObservedAt = safeDurableObservedAt(order.quote.observedAt, now);

    const trade = {
      id: cryptoId(now), chain, tokenAddress, symbol: existing.symbol, name: existing.name, logoUrl: existing.logoUrl || '',
      side: 'SELL', quantity: roundedQuantity, amountNative: roundedNetProceedsNative,
      observedPriceUsd, executionPriceUsd: roundedExecutionPriceUsd,
      marketCapUsd: quoteMarketCapUsd, liquidityUsd: quoteLiquidityUsd,
      entryMarketCapUsd, nativePriceUsd, nativeSymbol: nativeSymbol(chain),
      slippageBps: executionSettings.slippageBps,
      platformFeeNative: roundedPlatformFeeNative, networkFeeNative: roundedNetworkFeeNative,
      realizedPnlNative: roundedRealizedPnlNative, realizedPnlUsd: roundedRealizedPnlUsd,
      sourceUrl: order.sourceUrl || '', heldMs, executedAt: now,
      valuationMode, priceProvenance,
      quoteSource: String(order.quote.source || ''), paperFallback: order.quote.paperFallback === true,
      provisional: order.quote.provisional === true,
      syntheticTokenPrice: order.quote.syntheticTokenPrice === true,
      syntheticNativePrice: order.quote.syntheticNativePrice === true,
      totalSupply: executionTotalSupply,
      supplySource: String(executionSupply.supplySource),
      ...(unknownFallbackSupply ? {
        marketCapDivisor: executionTotalSupply,
        provisionalSupply: executionTotalSupply,
        provisionalSupplyProvenance: UNKNOWN_FALLBACK_PROVENANCE
      } : {}),
      launchpad: executionSupply.launchpad,
      launchMode: executionSupply.launchMode,
      ...(quoteObservedAtOriginal == null ? {} : { quoteObservedAtOriginal }),
      ...(nativePriceObservedAtOriginal == null ? {} : { nativePriceObservedAtOriginal }),
      ...(legacyExecutionSupply ? { marketCapProvenance: MARKET_CAP_PROVENANCE } : {})
    };

    const nextState = structuredCloneSafe(workingState);
    nextState.accounts[chain].cashBalanceNative = roundedNextCashBalanceNative;
    nextState.accounts[chain].realizedPnlNative = roundedNextAccountRealizedPnlNative;
    nextState.accounts[chain].updatedAt = now;
    if (fullClose || remainingQuantity === 0) delete nextState.positions[key];
    else {
      nextState.positions[key] = {
        ...existing, quantity: roundedRemainingQuantity, costBasisNative: roundedRemainingCost,
        realizedPnlNative: roundedNextPositionRealizedPnlNative,
        lastPriceUsd: observedPriceUsd, lastMarketCapUsd: coherentPositionMarketCap(
          observedPriceUsd, quoteMarketCapUsd, executionTotalSupply,
          { ...existing, supplySource: executionSupply.supplySource, lastPriceProvenance: priceProvenance }),
        lastNativePriceUsd: nativePriceUsd, updatedAt: now,
        ...(positionQuoteObservedAt == null ? {} : { quoteObservedAt: positionQuoteObservedAt }),
        lastPriceProvenance: priceProvenance,
        provisional: order.quote.provisional === true,
        syntheticTokenPrice: order.quote.syntheticTokenPrice === true,
        syntheticNativePrice: order.quote.syntheticNativePrice === true,
        totalSupply: executionTotalSupply, supplySource: String(executionSupply.supplySource),
        launchpad: executionSupply.launchpad, launchMode: executionSupply.launchMode,
        marketCapDivisor,
        provisionalSupply: unknownFallbackSupply ? executionTotalSupply : 0,
        ...(unknownFallbackSupply
          ? { provisionalSupplyProvenance: UNKNOWN_FALLBACK_PROVENANCE }
          : {}),
        quoteSource: String(order.quote.source || existing.quoteSource || ''),
        paperFallback: order.quote.paperFallback === true || existing.paperFallback === true,
        needsCalibration: calibrationStillNeeded(existing, order.quote, executionSupply),
        provisionalTokenPrice: existing.provisionalTokenPrice === true || order.quote.syntheticTokenPrice === true,
        provisionalNativePrice: existing.provisionalNativePrice === true || order.quote.syntheticNativePrice === true,
        ...(legacyExecutionSupply ? { marketCapProvenance: MARKET_CAP_PROVENANCE } : {})
      };
      if (positionQuoteObservedAt == null) delete nextState.positions[key].quoteObservedAt;
      if (!legacyExecutionSupply) delete nextState.positions[key].marketCapProvenance;
      if (!unknownFallbackSupply) delete nextState.positions[key].provisionalSupplyProvenance;
    }
    nextState.trades = [trade, ...(workingState.trades || [])];
    nextState.dailyRealizedByChain[chain][dayKey] = {
      native: roundedNextDayNative, usdAtExecution: roundedNextDayUsdAtExecution
    };
    return {
      state: nextState,
      trade,
      position: nextState.positions[key] || null,
      ...(recoveringCost ? { executedPercent: percent } : {}),
      calibration: prepared.calibrationStatus === 'CALIBRATED'
        ? workingState.calibrations[0] : null
    };
  }

  function executeCloseAll(state, chain, orders, settings, now = Date.now()) {
    chainAccount(state, chain);
    let nextState = state;
    const trades = [];
    const calibrations = [];
    const failures = [];
    for (const order of orders || []) {
      if (order?.token?.chain !== chain) {
        failures.push({ order, reason: 'wrongChain' });
        continue;
      }
      try {
        const result = executeSell(nextState, { ...order, quantity: undefined, percent: 100, breakeven: false }, settings, now);
        nextState = result.state;
        trades.push(result.trade);
        if (result.calibration) calibrations.push(result.calibration);
      } catch (error) {
        failures.push({ order, reason: error?.message || 'invalidQuote' });
      }
    }
    return { state: nextState, trades, calibrations, failures };
  }

  function markPosition(position, quote, currentNativePriceUsd) {
    const priceUsd = quote ? effectiveQuotePrice(quote, position) : Number(position.lastPriceUsd || position.averageEntryPriceUsd || 0);
    const override = Number(currentNativePriceUsd);
    const nativePriceUsd = Number.isFinite(override) && override > 0
      ? override
      : Number(quote?.nativePriceUsd || position.lastNativePriceUsd || 0);
    // A live quote can render before its calibration write settles. Project the
    // same neutral unit corrections here so old quantities and new units cannot
    // manufacture a temporary gain or loss.
    let quantity = Number(position.quantity);
    const oldSupply = trustedSupply(position);
    const observedSupply = quote && quoteSupply(quote, position);
    if (position.initialMarketCapPending === true && observedTokenValuation(quote)
      && priceUsd > 0 && Number(position.lastPriceUsd) > 0) {
      quantity *= Number(position.lastPriceUsd) / priceUsd;
    } else if (usesMarketCapValuation(position) && oldSupply && observedSupply
      && supplyRank(observedSupply.source) > supplyRank(oldSupply.source)) {
      quantity *= observedSupply.totalSupply / oldSupply.totalSupply;
    }
    const oldNativePriceUsd = Number(position.lastNativePriceUsd);
    if (position.provisionalNativePrice === true && oldNativePriceUsd > 0 && nativePriceUsd > 0) {
      quantity *= nativePriceUsd / oldNativePriceUsd;
    }
    const valueNative = priceUsd > 0 && nativePriceUsd > 0
      ? quantity * priceUsd / nativePriceUsd : Number(position.costBasisNative);
    const unrealizedPnlNative = valueNative - Number(position.costBasisNative);
    const roi = Number(position.costBasisNative) > 0 ? unrealizedPnlNative / Number(position.costBasisNative) * 100 : 0;
    return { valueNative, unrealizedPnlNative, roi, priceUsd, nativePriceUsd, quantity };
  }

  function breakevenTargetNative(position) {
    if (!position) return null;
    const remainingCost = Number(position.costBasisNative);
    const realized = Number(position.realizedPnlNative || 0);
    const target = remainingCost - realized;
    if (!Number.isFinite(remainingCost) || remainingCost < 0 || !Number.isFinite(realized) || !Number.isFinite(target)) return null;
    // Ledger amounts have twelve decimal places; do not create dust recovery orders.
    const normalizedTarget = Math.abs(target) <= Number.MAX_VALUE / 1e12 ? round(target, 12) : target;
    return normalizedTarget <= 1e-12 ? 0 : normalizedTarget;
  }

  function breakevenSellPercent(position, quote, settings, now = Date.now()) {
    const target = breakevenTargetNative(position);
    if (!(target > 0) || !(Number(position.quantity) > 0) || !validateQuote(quote, now, undefined, position).ok) return null;
    const slippage = Number(settings.slippageBps || 0) / 10_000;
    const feeRate = Number(settings.platformFeeBps || 0) / 10_000;
    const projected = markPosition(position, quote, Number(quote.nativePriceUsd));
    const executionPriceUsd = projected.priceUsd * (1 - slippage);
    const grossFullValueNative = projected.quantity * executionPriceUsd / Number(quote.nativePriceUsd);
    const targetGrossNative = (target + Number(tradeSettings(settings, position.chain).networkFeeNative || 0)) / Math.max(1e-9, 1 - feeRate);
    const percent = targetGrossNative / grossFullValueNative * 100;
    return Number.isFinite(percent) && percent > 0 && percent <= 100 ? percent : null;
  }

  function portfolioSummary(state, chain, currentNativePriceUsd, quoteForPosition) {
    const account = chainAccount(state, chain);
    const positions = Object.values(state.positions || {}).filter((position) => position.chain === chain);
    const marks = positions.map((position) => markPosition(position, quoteForPosition?.(position), currentNativePriceUsd));
    const positionsValueNative = marks.reduce((sum, mark) => sum + mark.valueNative, 0);
    const unrealizedPnlNative = marks.reduce((sum, mark) => sum + mark.unrealizedPnlNative, 0);
    const equityNative = Number(account.cashBalanceNative) + positionsValueNative;
    const totalPnlNative = equityNative - Number(account.initialBalanceNative);
    let totalTrades = 0;
    let closedTrades = 0;
    let winCount = 0;
    let grossProfit = 0;
    let negativePnl = 0;
    // Preserve each category's original addition order without allocating
    // filtered copies of the retained history on every UI refresh.
    (state.trades || []).forEach((trade) => {
      if (trade.chain !== chain) return;
      totalTrades += 1;
      if (trade.side !== 'SELL') return;
      closedTrades += 1;
      const pnl = Number(trade.realizedPnlNative);
      if (pnl > 0) { winCount += 1; grossProfit += pnl; }
      else if (pnl < 0) negativePnl += pnl;
    });
    const grossLoss = Math.abs(negativePnl);
    return {
      cashBalanceNative: Number(account.cashBalanceNative), positionsValueNative, equityNative,
      realizedPnlNative: Number(account.realizedPnlNative || 0), unrealizedPnlNative, totalPnlNative,
      todayPnlNative: Number(state.dailyRealizedByChain?.[chain]?.[localDateKey(Date.now())]?.native || 0),
      positionCount: positions.length, totalTrades, closedTrades,
      winRate: closedTrades ? winCount / closedTrades * 100 : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
    };
  }

  function chainUsdSummary(state, chain, nativePriceUsd, quoteForPosition) {
    const account = chainAccount(state, chain);
    const price = Number(nativePriceUsd);
    if (!Number.isFinite(price) || !(price > 0)) throw new Error('invalidNativePrice');
    const positionsUsd = Object.values(state.positions || {})
      .filter((position) => position.chain === chain)
      .reduce((sum, position) => {
        const mark = markPosition(position, quoteForPosition?.(position), price);
        return checkedArithmetic(
          sum + checkedArithmetic(mark.quantity * mark.priceUsd, 'nonnegative'),
          'nonnegative'
        );
      }, 0);
    const cashUsd = checkedArithmetic(Number(account.cashBalanceNative) * price, 'nonnegative');
    const principalUsd = checkedArithmetic(Number(account.initialBalanceNative) * price, 'nonnegative');
    const assetsUsd = checkedArithmetic(cashUsd + positionsUsd, 'nonnegative');
    const pnlUsd = checkedArithmetic(assetsUsd - principalUsd);
    return { cashUsd, positionsUsd, assetsUsd, principalUsd, pnlUsd };
  }

  function globalUsdSummary(state, nativePricesByChain) {
    let assetsUsd = 0; let pnlUsd = 0; const missingChains = [];
    Tango.Chains.all().forEach((chain) => {
      const price = Number(nativePricesByChain?.[chain.id] || 0);
      if (!Number.isFinite(price) || !(price > 0)) { missingChains.push(chain.id); return; }
      try {
        const summary = chainUsdSummary(state, chain.id, price);
        const nextAssetsUsd = checkedArithmetic(assetsUsd + summary.assetsUsd, 'nonnegative');
        const nextPnlUsd = checkedArithmetic(pnlUsd + summary.pnlUsd);
        assetsUsd = nextAssetsUsd;
        pnlUsd = nextPnlUsd;
      } catch (error) {
        if (!['invalidArithmetic', 'invalidNativePrice', 'unsupportedChain'].includes(error?.message)) throw error;
        missingChains.push(chain.id);
      }
    });
    return { assetsUsd, pnlUsd, complete: missingChains.length === 0, missingChains };
  }

  function updatePositionQuoteResult(state, token, quote, now = Date.now()) {
    const key = positionKey(token.chain, token.address);
    const validationContext = verifiedLaunchContext(state.positions[key], token);
    if (!state.positions[key]
      || !Number.isSafeInteger(Number(now)) || Number(now) < 0
      || !validateQuote(
        quote, Number(now), Tango.QUOTE_STALE_MS, state.positions[key], validationContext
      ).ok) return { state, calibration: null };
    const calibration = calibratePositionResult(state, token, quote, now);
    if (calibration.status === 'FAILED') return { state, calibration: null };
    const nextState = structuredCloneSafe(calibration.state);
    const existing = nextState.positions[key];
    const trustedMarketCap = trustedMarketCapQuote(quote, existing);
    const executionSupply = supplyIdentity(quote, existing);
    const needsCalibration = calibrationStillNeeded(existing, quote, executionSupply);
    const provisional = needsCalibration
      && (existing.provisional === true || quote.provisional === true);
    nextState.positions[key] = {
      ...existing, lastPriceUsd: effectiveQuotePrice(quote, existing),
      lastMarketCapUsd: coherentPositionMarketCap(effectiveQuotePrice(quote, existing),
        Number(quote.marketCapUsd || existing.lastMarketCapUsd || 0), Number(executionSupply.totalSupply),
        { ...existing, supplySource: executionSupply.supplySource,
          lastPriceProvenance: priceProvenanceForQuote(quote, existing, trustedMarketCap) }),
      lastNativePriceUsd: Number(quote.nativePriceUsd || existing.lastNativePriceUsd || 0),
      quoteObservedAt: safeDurableObservedAt(quote.observedAt, Number(now)) ?? Number(now), updatedAt: Number(now),
      lastPriceProvenance: priceProvenanceForQuote(quote, existing, trustedMarketCap),
      totalSupply: Number(executionSupply.totalSupply), supplySource: String(executionSupply.supplySource),
      launchpad: executionSupply.launchpad, launchMode: executionSupply.launchMode,
      marketCapDivisor: Number(executionSupply.totalSupply || existing.marketCapDivisor || 0),
      provisionalSupply: executionSupply.supplySource === UNKNOWN_FALLBACK_SOURCE
        ? Number(executionSupply.totalSupply) : 0,
      ...(executionSupply.supplySource === UNKNOWN_FALLBACK_SOURCE
        ? { provisionalSupplyProvenance: UNKNOWN_FALLBACK_PROVENANCE }
        : {}),
      needsCalibration, provisional,
      ...(executionSupply.supplySource === 'LEGACY_PUMP_RULE'
        ? { marketCapProvenance: MARKET_CAP_PROVENANCE }
        : {})
    };
    if (executionSupply.supplySource !== 'LEGACY_PUMP_RULE') {
      delete nextState.positions[key].marketCapProvenance;
    }
    if (executionSupply.supplySource !== UNKNOWN_FALLBACK_SOURCE) {
      delete nextState.positions[key].provisionalSupplyProvenance;
    }
    return {
      state: nextState,
      calibration: calibration.status === 'CALIBRATED'
        ? calibration.state.calibrations[0] : null
    };
  }

  function updatePositionQuote(state, token, quote, now = Date.now()) {
    return updatePositionQuoteResult(state, token, quote, now).state;
  }

  function positionMetadataPatch(existing, token) {
    if (!existing) return null;
    const source = trustedMetadataSource(token);
    if (!source) return null;
    const sourceRank = METADATA_SOURCE_RANK[source];
    const existingSource = String(existing.metadataSource || '').toUpperCase();
    const existingRank = METADATA_SOURCE_RANK[existingSource] || 0;
    if (sourceRank < existingRank) return null;
    const symbol = validIdentityText(token.symbol, 32);
    const name = validIdentityText(token.name, 100);
    const logoUrl = String(token.logoUrl || '').trim();
    if (!symbol && !name && !logoUrl) return null;
    const nextSymbol = symbol || existing.symbol;
    const nextName = name || existing.name;
    const nextLogoUrl = logoUrl || existing.logoUrl || '';
    if (nextSymbol === existing.symbol && nextName === existing.name && nextLogoUrl === existing.logoUrl && source === existingSource) return null;
    return { symbol: nextSymbol, name: nextName, logoUrl: nextLogoUrl,
      metadataSource: source, metadataUpdatedAt: Date.now(), updatedAt: Date.now() };
  }

  function updatePositionMetadata(state, token) {
    const key = positionKey(token?.chain, token?.address);
    const patch = positionMetadataPatch(state.positions[key], token);
    if (!patch) return state;
    const nextState = structuredCloneSafe(state);
    nextState.positions[key] = { ...nextState.positions[key], ...patch };
    return nextState;
  }

  function updatePositionMetadataBatch(state, tokens) {
    let nextState = state;
    for (const token of tokens || []) {
      const key = positionKey(token?.chain, token?.address);
      const patch = positionMetadataPatch(nextState.positions[key], token);
      if (!patch) continue;
      if (nextState === state) nextState = structuredCloneSafe(state);
      nextState.positions[key] = { ...nextState.positions[key], ...patch };
    }
    return nextState;
  }

  function cryptoId(now) {
    const random = global.crypto?.randomUUID ? global.crypto.randomUUID() : Math.random().toString(36).slice(2);
    return `${now}-${random}`;
  }

  function localDateKey(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function structuredCloneSafe(value) {
    return typeof global.structuredClone === 'function' ? global.structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  Tango.Engine = {
    round, positionKey, validateQuote, executeBuy, executeSell, executeCloseAll, markPosition,
    portfolioSummary, chainUsdSummary, globalUsdSummary, updatePositionQuote, updatePositionQuoteResult,
    updatePositionMetadata, updatePositionMetadataBatch, breakevenSellPercent, breakevenTargetNative,
    usesMarketCapValuation, calibratePosition, ruleSupply
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Engine;
})(globalThis);
