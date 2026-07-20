(function initEngine(global) {
  const Tango = global.Tango = global.Tango || {};
  const METADATA_SOURCE_RANK = Object.freeze({ GMGN_TRENCH: 20, GMGN_DETAIL: 30, GMGN_NETWORK: 40 });
  const MARKET_CAP_PROVENANCE = 'SOLANA_PUMP_TRENCH_V1';
  const CANONICAL_PUMP_SUPPLY = 1_000_000_000;
  const TRUSTED_SUPPLY_SOURCES = Object.freeze([
    'GMGN_EXACT', 'GMGN_RATIO', 'LAUNCHPAD_RULE', 'LEGACY_PUMP_RULE'
  ]);
  const MAX_QUOTE_AGE_MS = 5 * 60_000;
  const MAX_FUTURE_SKEW_MS = 5_000;
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
    return {
      chain,
      tokenAddress,
      address: tokenAddress,
      launchpad: token?.launchpad,
      launchMode: token?.launchMode
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
    if (id === 'sol' && ['pump', 'pumpfun'].includes(platform)) {
      return mode.includes('mayhem') ? 2_000_000_000 : CANONICAL_PUMP_SUPPLY;
    }
    if (['bankr', 'clanker'].includes(platform) && ['base', 'robinhood'].includes(id)) {
      return 100_000_000_000;
    }
    if (id === 'bsc' && ['fourmeme', 'flap'].includes(platform)) return CANONICAL_PUMP_SUPPLY;
    if (id === 'base' && ['zora', 'zoracoins'].includes(platform)) return CANONICAL_PUMP_SUPPLY;
    if (id === 'xlayer' && ['dyor', 'bow', 'bowfun'].includes(platform)) return CANONICAL_PUMP_SUPPLY;
    return 0;
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
        ?? context?.lastPriceUsd ?? context?.averageEntryPriceUsd ?? 0)
    };
  }

  function ratioSupplyMatches(context, totalSupply) {
    const { marketCapUsd, priceUsd } = supplyObservation(context);
    const supply = Number(totalSupply);
    if (![marketCapUsd, priceUsd, supply].every(positiveFinite)) return false;
    const inferred = marketCapUsd / priceUsd;
    return positiveFinite(inferred) && Math.abs(inferred - supply) <= supply * 0.001;
  }

  function validSupplyForSource(context, totalSupply, source) {
    const supply = Number(totalSupply);
    if (!positiveFinite(supply) || !isTrustedSupplySource(source)) return false;
    if (source === 'GMGN_EXACT') return true;
    if (source === 'GMGN_RATIO') return ratioSupplyMatches(context, supply);
    if (source === 'LAUNCHPAD_RULE') return ruleSupply(context) === supply;
    return source === 'LEGACY_PUMP_RULE'
      && coherentPumpIdentity(context)
      && context?.marketCapProvenance === MARKET_CAP_PROVENANCE
      && Number(context?.marketCapDivisor) === CANONICAL_PUMP_SUPPLY
      && supply === CANONICAL_PUMP_SUPPLY;
  }

  function fallbackResolvedSupply(context) {
    const { marketCapUsd, priceUsd } = supplyObservation(context);
    if (positiveFinite(marketCapUsd) && positiveFinite(priceUsd)) {
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
      marketCapUsd: supplyObservation(context).marketCapUsd,
      priceUsd: supplyObservation(context).priceUsd,
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
      LEGACY_PUMP_RULE: 10
    }[String(source || '')] || 0;
  }

  function quoteSupply(quote, context) {
    const declaredSource = String(quote?.supplySource || '');
    const trustedDeclaredSource = isTrustedSupplySource(declaredSource);
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
      chain: context?.chain,
      totalSupply: declaredSupply,
      marketCapUsd: quote?.marketCapUsd,
      priceUsd: quote?.priceUsd,
      supplySource: trustedDeclaredSource ? declaredSource : (legacyPump ? 'LEGACY_PUMP_RULE' : ''),
      marketCapDivisor: quote?.marketCapDivisor,
      marketCapProvenance: legacyPump ? MARKET_CAP_PROVENANCE : undefined,
      launchpad: quote?.launchpad || context?.launchpad,
      launchMode: quote?.launchMode || context?.launchMode,
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
    const invalidOptional = ['priceUsd', 'marketCapUsd', 'liquidityUsd', 'totalSupply'].some((field) =>
      quote?.[field] != null && !finiteBetween(quote[field], 0, Number.MAX_VALUE));
    const resolvedQuoteSupply = quoteSupply(quote, trustContext);
    const declaredSupplySource = String(quote?.supplySource || '');
    const invalidTrustedSupplyClaim = isTrustedSupplySource(declaredSupplySource)
      && !resolvedQuoteSupply;
    const fallbackSupplyDimension = quote?.valuationMode === 'MARKET_CAP'
      && ['LAUNCHPAD_RULE', 'LEGACY_PUMP_RULE'].includes(String(resolvedQuoteSupply?.source || ''));
    const missingCalibrationDimension = quote?.provisional === true
      && quote?.syntheticTokenPrice !== true
      && quote?.syntheticNativePrice !== true
      && !fallbackSupplyDimension;
    if (!quote || !finiteBetween(price, Number.EPSILON, Number.MAX_VALUE)
      || !finiteBetween(quote.nativePriceUsd, Number.EPSILON, Number.MAX_VALUE)
      || invalidOptional
      || invalidTrustedSupplyClaim
      || missingCalibrationDimension
      || (quote.marketCapDivisor != null && !finiteBetween(quote.marketCapDivisor, Number.EPSILON, Number.MAX_VALUE))
      || !Number.isSafeInteger(clock) || clock < 0
      || typeof observedAt !== 'number' || !Number.isSafeInteger(observedAt) || observedAt <= 0
      || typeof nativePriceObservedAt !== 'number'
      || !Number.isSafeInteger(nativePriceObservedAt) || nativePriceObservedAt <= 0
      || !finiteBetween(maxAge, 1, MAX_QUOTE_AGE_MS)
      || observedAt - clock > MAX_FUTURE_SKEW_MS
      || nativePriceObservedAt - clock > MAX_FUTURE_SKEW_MS) return { ok: false, reason: 'invalidQuote' };
    if (clock - observedAt > maxAge || clock - nativePriceObservedAt > maxAge) {
      return { ok: false, reason: 'staleQuote' };
    }
    return { ok: true };
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
      launchpad: String(context?.launchpad || quote?.launchpad || ''),
      launchMode: String(context?.launchMode || quote?.launchMode || '')
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
      || resolvedFallbackSupply
    );
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
    if (!existing || !positiveFinite(existing.quantity)
      || !Number.isSafeInteger(Number(now)) || Number(now) < 0
      || !validateQuote(quote, Number(now), Tango.QUOTE_STALE_MS, existing).ok) {
      return { status: 'NOOP', state };
    }

    const oldMark = markPosition(existing);
    const preservedValueNative = Number(oldMark.valueNative);
    const newPriceUsd = effectiveQuotePrice(quote, existing, existing);
    const newNativePriceUsd = Number(quote.nativePriceUsd || existing.lastNativePriceUsd);
    const oldSupply = trustedSupply(existing);
    const observedSupply = quoteSupply(quote, existing);
    const priceCorrection = existing.provisionalTokenPrice === true
      && quote.syntheticTokenPrice !== true;
    const nativeCorrection = existing.provisionalNativePrice === true
      && quote.syntheticNativePrice !== true;
    const supplyCorrection = usesMarketCapValuation(existing)
      && Boolean(oldSupply)
      && Boolean(observedSupply)
      && supplyRank(observedSupply.source) > supplyRank(oldSupply.source)
      && Math.abs(observedSupply.totalSupply - oldSupply.totalSupply)
        > oldSupply.totalSupply * Number.EPSILON;
    const reason = calibrationReason(priceCorrection, nativeCorrection, supplyCorrection);
    if (!reason) return { status: 'NOOP', state };

    const nextQuantity = preservedValueNative * newNativePriceUsd / newPriceUsd;
    const nextAverageEntryPriceUsd = Number(existing.costBasisNative) * newNativePriceUsd / nextQuantity;
    const selectedSupply = preferredSupply(quote, existing);
    const nextAverageEntryMarketCap = selectedSupply
      ? nextAverageEntryPriceUsd * selectedSupply.totalSupply
      : Number(existing.averageEntryMarketCap || 0);
    if (![oldMark.priceUsd, oldMark.nativePriceUsd, preservedValueNative, existing.costBasisNative,
      newPriceUsd, newNativePriceUsd, nextQuantity, nextAverageEntryPriceUsd].every(positiveFinite)
      || (selectedSupply
        ? !positiveFinite(nextAverageEntryMarketCap)
        : !finiteBetween(nextAverageEntryMarketCap, 0, Number.MAX_VALUE))) {
      return { status: 'FAILED', state, reason: 'calibrationFailed' };
    }

    const nextProvisionalTokenPrice = existing.provisionalTokenPrice === true && !priceCorrection;
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
      quantity: nextQuantity,
      averageEntryPriceUsd: nextAverageEntryPriceUsd,
      averageEntryMarketCap: nextAverageEntryMarketCap,
      lastPriceUsd: newPriceUsd,
      lastMarketCapUsd: Number(quote.marketCapUsd || existing.lastMarketCapUsd || 0),
      lastNativePriceUsd: newNativePriceUsd,
      quoteObservedAt: Number(quote.observedAt),
      updatedAt: Number(now),
      lastPriceProvenance: priceProvenanceForQuote(quote, existing),
      totalSupply: Number(selectedSupply?.totalSupply || existing.totalSupply || existing.marketCapDivisor || 0),
      supplySource: String(selectedSupply?.source || existing.supplySource || ''),
      marketCapDivisor: Number(selectedSupply?.totalSupply || existing.marketCapDivisor || 0),
      needsCalibration,
      provisional: nextProvisionalTokenPrice || nextProvisionalNativePrice,
      syntheticTokenPrice: nextProvisionalTokenPrice,
      syntheticNativePrice: nextProvisionalNativePrice,
      provisionalTokenPrice: nextProvisionalTokenPrice,
      provisionalNativePrice: nextProvisionalNativePrice,
      ...(selectedSupply?.source === 'LEGACY_PUMP_RULE'
        ? { marketCapProvenance: MARKET_CAP_PROVENANCE }
        : {})
    };
    if (selectedSupply?.source !== 'LEGACY_PUMP_RULE') {
      delete nextState.positions[key].marketCapProvenance;
    }
    const event = {
      id: cryptoId(Number(now)),
      chain: existing.chain,
      tokenAddress: existing.tokenAddress,
      reason,
      fromPriceUsd: Number(oldMark.priceUsd),
      toPriceUsd: Number(newPriceUsd),
      fromNativePriceUsd: Number(oldMark.nativePriceUsd),
      toNativePriceUsd: Number(newNativePriceUsd),
      fromSupply: Number(oldSupply?.totalSupply || existing.totalSupply || existing.marketCapDivisor || 0),
      toSupply: Number(selectedSupply?.totalSupply || oldSupply?.totalSupply || 0),
      quantityBefore: Number(existing.quantity),
      quantityAfter: Number(nextQuantity),
      costBasisNative: Number(existing.costBasisNative),
      createdAt: Number(now)
    };
    nextState.calibrations = [event, ...(state.calibrations || [])].slice(0, Tango.MAX_TRADES || 10_000);
    return { status: 'CALIBRATED', state: nextState };
  }

  function calibratePosition(state, token, quote, now = Date.now()) {
    return calibratePositionResult(state, token, quote, now).state;
  }

  function executeBuy(state, order, settings, now = Date.now()) {
    const registered = Tango.Chains?.get(order?.token?.chain);
    if (!registered) throw new Error('unsupportedChain');
    const chain = registered.id;
    const tokenAddress = Tango.Chains.normalizeAddress(chain, order?.token?.address);
    const key = positionKey(chain, tokenAddress);
    const originalPosition = state.positions[key];
    const callerSupplyContext = callerTokenSupplyContext(order.token, chain, tokenAddress);
    const executionSettings = validatedExecutionSettings(settings, chain);
    const originalTrustContext = originalPosition || callerSupplyContext;
    const quoteValidation = validateQuote(
      order.quote, now, order.staleMs, originalPosition || callerSupplyContext, originalTrustContext
    );
    if (!quoteValidation.ok) throw new Error(quoteValidation.reason);
    const calibration = originalPosition
      ? calibratePositionResult(state, order.token, order.quote, now)
      : { status: 'NOOP', state };
    if (calibration.status === 'FAILED') throw new Error(calibration.reason);
    const workingState = calibration.state;
    const account = chainAccount(workingState, chain);
    const existing = workingState.positions[key];
    const trustContext = existing || callerSupplyContext;
    const amountNative = Number(order.amountNative);
    if (!finiteBetween(amountNative, Number.EPSILON, Number.MAX_VALUE)) throw new Error('invalidAmount');
    const cashBalanceNative = checkedArithmetic(account.cashBalanceNative, 'nonnegative');
    if (amountNative > cashBalanceNative + 1e-12) throw new Error('insufficientBalance');

    const slippage = executionSettings.slippageBps / 10_000;
    const networkFeeNative = checkedArithmetic(executionSettings.networkFeeNative, 'nonnegative');
    const platformFeeNative = checkedArithmetic(feeFor(amountNative, executionSettings), 'nonnegative');
    const netInvestmentNative = checkedArithmetic(amountNative - platformFeeNative - networkFeeNative);
    if (netInvestmentNative <= 0) throw new Error('invalidAmount');

    const trustedMarketCap = trustedMarketCapQuote(order.quote, trustContext);
    const valuationMode = existing
      ? (usesMarketCapValuation(existing) ? 'MARKET_CAP' : 'PRICE')
      : (trustedMarketCap && trustedMarketCap.source !== 'GMGN_RATIO' ? 'MARKET_CAP' : 'PRICE');
    const provenanceContext = existing || callerSupplyContext;
    const executionSupply = supplyIdentity(order.quote, provenanceContext);
    const executionTotalSupply = checkedArithmetic(executionSupply.totalSupply, 'nonnegative');
    const marketCapDivisor = checkedArithmetic(
      executionTotalSupply || existing?.marketCapDivisor || 0, 'nonnegative'
    );
    const valuationContext = existing || (valuationMode === 'MARKET_CAP'
      ? {
        ...callerSupplyContext, ...executionSupply, valuationMode, marketCapDivisor,
        ...(executionSupply.supplySource === 'LEGACY_PUMP_RULE'
          ? { marketCapProvenance: MARKET_CAP_PROVENANCE }
          : {})
      }
      : callerSupplyContext);
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
    const existingEntryProvenance = existing?.averageEntryPriceProvenance
      || (existing ? (usesMarketCapValuation(existing) ? 'MARKET_CAP_DERIVED' : 'OBSERVED_PRICE') : '');
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

    const trade = {
      id: cryptoId(now), chain, tokenAddress, symbol: positionSymbol, name: positionName, logoUrl: positionLogoUrl,
      side: 'BUY', quantity: roundedQuantity, amountNative: roundedAmountNative,
      observedPriceUsd, executionPriceUsd: roundedExecutionPriceUsd,
      marketCapUsd: quoteMarketCapUsd, liquidityUsd: quoteLiquidityUsd, nativePriceUsd,
      nativeSymbol: nativeSymbol(chain), slippageBps: executionSettings.slippageBps,
      platformFeeNative: roundedPlatformFeeNative, networkFeeNative: roundedNetworkFeeNative,
      realizedPnlNative: 0, realizedPnlUsd: 0, valuationMode, priceProvenance,
      quoteSource: String(order.quote.source || ''), paperFallback: order.quote.paperFallback === true,
      provisional: order.quote.provisional === true,
      syntheticTokenPrice: order.quote.syntheticTokenPrice === true,
      syntheticNativePrice: order.quote.syntheticNativePrice === true,
      totalSupply: executionTotalSupply,
      supplySource: String(executionSupply.supplySource),
      launchpad: executionSupply.launchpad,
      launchMode: executionSupply.launchMode,
      quoteObservedAtOriginal: Number(order.quote.originalObservedAt || order.quote.observedAt),
      nativePriceObservedAtOriginal: Number(order.quote.nativeOriginalObservedAt || order.quote.nativePriceObservedAt),
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
      lastPriceUsd: observedPriceUsd, lastMarketCapUsd: quoteMarketCapUsd,
      lastNativePriceUsd: nativePriceUsd, quoteObservedAt: Number(order.quote.observedAt), openedAt: existing?.openedAt || now,
      updatedAt: now, valuationMode, marketCapDivisor, lastPriceProvenance: priceProvenance,
      provisional: order.quote.provisional === true,
      syntheticTokenPrice: order.quote.syntheticTokenPrice === true,
      syntheticNativePrice: order.quote.syntheticNativePrice === true,
      totalSupply: executionTotalSupply, supplySource: String(executionSupply.supplySource),
      launchpad: executionSupply.launchpad, launchMode: executionSupply.launchMode,
      needsCalibration, provisionalTokenPrice, provisionalNativePrice,
      averageEntryPriceProvenance: existingQuantity > 0 && existingEntryProvenance !== priceProvenance
        ? 'MIXED_DERIVED'
        : existingEntryProvenance || priceProvenance,
      ...(legacyExecutionSupply ? { marketCapProvenance: MARKET_CAP_PROVENANCE } : {})
    };
    if (!legacyExecutionSupply) delete nextState.positions[key].marketCapProvenance;
    nextState.trades = [trade, ...(workingState.trades || [])].slice(0, Tango.MAX_TRADES || 10_000);
    return { state: nextState, trade, position: nextState.positions[key] };
  }

  function executeSell(state, order, settings, now = Date.now()) {
    const registered = Tango.Chains?.get(order?.token?.chain);
    if (!registered) throw new Error('unsupportedChain');
    const chain = registered.id;
    const tokenAddress = Tango.Chains.normalizeAddress(chain, order?.token?.address);
    const key = positionKey(chain, tokenAddress);
    const originalPosition = state.positions[key];
    if (!originalPosition || !(Number(originalPosition.quantity) > 0)) throw new Error('noPosition');
    const executionSettings = validatedExecutionSettings(settings, chain);
    const quoteValidation = validateQuote(order.quote, now, order.staleMs, originalPosition);
    if (!quoteValidation.ok) throw new Error(quoteValidation.reason);
    const calibration = calibratePositionResult(state, order.token, order.quote, now);
    if (calibration.status === 'FAILED') throw new Error(calibration.reason);
    const workingState = calibration.state;
    const account = chainAccount(workingState, chain);
    const existing = workingState.positions[key];

    const percent = Number(order.percent || 0);
    if (order.quantity == null && !finiteBetween(percent, Number.EPSILON, 100)) throw new Error('invalidAmount');
    const existingQuantity = checkedArithmetic(existing.quantity, 'positive');
    const requestedQuantity = order.quantity == null
      ? checkedArithmetic(existingQuantity * percent / 100, 'positive')
      : Number(order.quantity);
    const quantity = Math.min(existingQuantity, requestedQuantity);
    if (!finiteBetween(requestedQuantity, Number.EPSILON, Number.MAX_VALUE)
      || !finiteBetween(quantity, Number.EPSILON, Number.MAX_VALUE)) throw new Error('invalidAmount');

    const slippage = executionSettings.slippageBps / 10_000;
    const observedPriceUsd = checkedArithmetic(effectiveQuotePrice(order.quote, existing), 'positive');
    const executionPriceUsd = checkedArithmetic(observedPriceUsd * (1 - slippage), 'positive');
    const valuationMode = usesMarketCapValuation(existing) ? 'MARKET_CAP' : 'PRICE';
    const trustedMarketCap = trustedMarketCapQuote(order.quote, existing);
    const priceProvenance = priceProvenanceForQuote(order.quote, existing, trustedMarketCap);
    const executionSupply = supplyIdentity(order.quote, existing);
    const legacyExecutionSupply = executionSupply.supplySource === 'LEGACY_PUMP_RULE';
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
    const remainingQuantity = checkedArithmetic(Math.max(0, existingQuantity - quantity), 'nonnegative');
    const partialPositionWithCost = existingCostBasisNative > 0 && remainingQuantity > 0;
    const costShareNative = checkedArithmetic(
      existingCostBasisNative * quantity / existingQuantity,
      existingCostBasisNative > 0 ? 'positive' : 'nonnegative'
    );
    if (partialPositionWithCost && costShareNative >= existingCostBasisNative) {
      throw new Error('invalidArithmetic');
    }
    const remainingCost = checkedArithmetic(
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
    const heldMs = checkedArithmetic(now - Number(existing.openedAt ?? now), 'nonnegative');
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
    const roundedNextPositionRealizedPnlNative = checkedRound(nextPositionRealizedPnlNative);
    const roundedNextDayNative = checkedRound(nextDayNative);
    const roundedNextDayUsdAtExecution = checkedRound(nextDayUsdAtExecution);

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
      launchpad: executionSupply.launchpad,
      launchMode: executionSupply.launchMode,
      quoteObservedAtOriginal: Number(order.quote.originalObservedAt || order.quote.observedAt),
      nativePriceObservedAtOriginal: Number(order.quote.nativeOriginalObservedAt || order.quote.nativePriceObservedAt),
      ...(legacyExecutionSupply ? { marketCapProvenance: MARKET_CAP_PROVENANCE } : {})
    };

    const nextState = structuredCloneSafe(workingState);
    nextState.accounts[chain].cashBalanceNative = roundedNextCashBalanceNative;
    nextState.accounts[chain].realizedPnlNative = roundedNextAccountRealizedPnlNative;
    nextState.accounts[chain].updatedAt = now;
    if (remainingQuantity <= 1e-12) delete nextState.positions[key];
    else {
      nextState.positions[key] = {
        ...existing, quantity: roundedRemainingQuantity, costBasisNative: roundedRemainingCost,
        realizedPnlNative: roundedNextPositionRealizedPnlNative,
        lastPriceUsd: observedPriceUsd, lastMarketCapUsd: quoteMarketCapUsd,
        lastNativePriceUsd: nativePriceUsd, quoteObservedAt: Number(order.quote.observedAt), updatedAt: now,
        lastPriceProvenance: priceProvenance,
        provisional: order.quote.provisional === true,
        syntheticTokenPrice: order.quote.syntheticTokenPrice === true,
        syntheticNativePrice: order.quote.syntheticNativePrice === true,
        totalSupply: executionTotalSupply, supplySource: String(executionSupply.supplySource),
        launchpad: executionSupply.launchpad, launchMode: executionSupply.launchMode,
        marketCapDivisor,
        needsCalibration: calibrationStillNeeded(existing, order.quote, executionSupply),
        provisionalTokenPrice: existing.provisionalTokenPrice === true || order.quote.syntheticTokenPrice === true,
        provisionalNativePrice: existing.provisionalNativePrice === true || order.quote.syntheticNativePrice === true,
        ...(legacyExecutionSupply ? { marketCapProvenance: MARKET_CAP_PROVENANCE } : {})
      };
      if (!legacyExecutionSupply) delete nextState.positions[key].marketCapProvenance;
    }
    nextState.trades = [trade, ...(workingState.trades || [])].slice(0, Tango.MAX_TRADES || 10_000);
    nextState.dailyRealizedByChain[chain][dayKey] = {
      native: roundedNextDayNative, usdAtExecution: roundedNextDayUsdAtExecution
    };
    return { state: nextState, trade, position: nextState.positions[key] || null };
  }

  function executeCloseAll(state, chain, orders, settings, now = Date.now()) {
    chainAccount(state, chain);
    let nextState = state;
    const trades = [];
    const failures = [];
    for (const order of orders || []) {
      if (order?.token?.chain !== chain) {
        failures.push({ order, reason: 'wrongChain' });
        continue;
      }
      try {
        const result = executeSell(nextState, { ...order, percent: 100 }, settings, now);
        nextState = result.state;
        trades.push(result.trade);
      } catch (error) {
        failures.push({ order, reason: error?.message || 'invalidQuote' });
      }
    }
    return { state: nextState, trades, failures };
  }

  function markPosition(position, quote, currentNativePriceUsd) {
    const priceUsd = quote ? effectiveQuotePrice(quote, position) : Number(position.lastPriceUsd || position.averageEntryPriceUsd || 0);
    const override = Number(currentNativePriceUsd);
    const nativePriceUsd = Number.isFinite(override) && override > 0
      ? override
      : Number(quote?.nativePriceUsd || position.lastNativePriceUsd || 0);
    const valueNative = priceUsd > 0 && nativePriceUsd > 0
      ? Number(position.quantity) * priceUsd / nativePriceUsd : Number(position.costBasisNative);
    const unrealizedPnlNative = valueNative - Number(position.costBasisNative);
    const roi = Number(position.costBasisNative) > 0 ? unrealizedPnlNative / Number(position.costBasisNative) * 100 : 0;
    return { valueNative, unrealizedPnlNative, roi, priceUsd, nativePriceUsd };
  }

  function breakevenSellPercent(position, quote, settings) {
    if (!position || !(Number(position.quantity) > 0) || !validateQuote(quote, Date.now(), undefined, position).ok) return null;
    const slippage = Number(settings.slippageBps || 0) / 10_000;
    const feeRate = Number(settings.platformFeeBps || 0) / 10_000;
    const executionPriceUsd = effectiveQuotePrice(quote, position) * (1 - slippage);
    const grossFullValueNative = Number(position.quantity) * executionPriceUsd / Number(quote.nativePriceUsd);
    const targetGrossNative = (Number(position.costBasisNative) + Number(tradeSettings(settings, position.chain).networkFeeNative || 0)) / Math.max(1e-9, 1 - feeRate);
    const percent = targetGrossNative / grossFullValueNative * 100;
    return percent > 0 && percent <= 100 ? Math.min(100, round(percent, 4)) : null;
  }

  function portfolioSummary(state, chain, currentNativePriceUsd) {
    const account = chainAccount(state, chain);
    const positions = Object.values(state.positions || {}).filter((position) => position.chain === chain);
    const trades = (state.trades || []).filter((trade) => trade.chain === chain);
    const marks = positions.map((position) => markPosition(position, undefined, currentNativePriceUsd));
    const positionsValueNative = marks.reduce((sum, mark) => sum + mark.valueNative, 0);
    const unrealizedPnlNative = marks.reduce((sum, mark) => sum + mark.unrealizedPnlNative, 0);
    const equityNative = Number(account.cashBalanceNative) + positionsValueNative;
    const totalPnlNative = equityNative - Number(account.initialBalanceNative);
    const closed = trades.filter((trade) => trade.side === 'SELL');
    const wins = closed.filter((trade) => Number(trade.realizedPnlNative) > 0);
    const grossProfit = wins.reduce((sum, trade) => sum + Number(trade.realizedPnlNative), 0);
    const grossLoss = Math.abs(closed.filter((trade) => Number(trade.realizedPnlNative) < 0).reduce((sum, trade) => sum + Number(trade.realizedPnlNative), 0));
    return {
      cashBalanceNative: Number(account.cashBalanceNative), positionsValueNative, equityNative,
      realizedPnlNative: Number(account.realizedPnlNative || 0), unrealizedPnlNative, totalPnlNative,
      todayPnlNative: Number(state.dailyRealizedByChain?.[chain]?.[localDateKey(Date.now())]?.native || 0),
      positionCount: positions.length, totalTrades: trades.length, closedTrades: closed.length,
      winRate: closed.length ? wins.length / closed.length * 100 : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
    };
  }

  function chainUsdSummary(state, chain, nativePriceUsd) {
    const account = chainAccount(state, chain);
    const price = Number(nativePriceUsd);
    if (!(price > 0)) throw new Error('invalidNativePrice');
    const positionsUsd = Object.values(state.positions || {})
      .filter((position) => position.chain === chain)
      .reduce((sum, position) => sum + Number(position.quantity) * markPosition(position).priceUsd, 0);
    const cashUsd = Number(account.cashBalanceNative) * price;
    const principalUsd = Number(account.initialBalanceNative) * price;
    const assetsUsd = cashUsd + positionsUsd;
    return { cashUsd, positionsUsd, assetsUsd, principalUsd, pnlUsd: assetsUsd - principalUsd };
  }

  function globalUsdSummary(state, nativePricesByChain) {
    let assetsUsd = 0; let pnlUsd = 0; const missingChains = [];
    Tango.Chains.all().forEach((chain) => {
      const price = Number(nativePricesByChain?.[chain.id] || 0);
      if (!(price > 0)) { missingChains.push(chain.id); return; }
      const summary = chainUsdSummary(state, chain.id, price);
      assetsUsd += summary.assetsUsd;
      pnlUsd += summary.pnlUsd;
    });
    return { assetsUsd, pnlUsd, complete: missingChains.length === 0, missingChains };
  }

  function updatePositionQuote(state, token, quote, now = Date.now()) {
    const key = positionKey(token.chain, token.address);
    if (!state.positions[key]
      || !Number.isSafeInteger(Number(now)) || Number(now) < 0
      || !validateQuote(quote, Number(now), Tango.QUOTE_STALE_MS, state.positions[key]).ok) return state;
    const calibration = calibratePositionResult(state, token, quote, now);
    if (calibration.status === 'FAILED') return state;
    const nextState = structuredCloneSafe(calibration.state);
    const existing = nextState.positions[key];
    const trustedMarketCap = trustedMarketCapQuote(quote, existing);
    const executionSupply = supplyIdentity(quote, existing);
    const needsCalibration = calibrationStillNeeded(existing, quote, executionSupply);
    const provisional = needsCalibration
      && (existing.provisional === true || quote.provisional === true);
    nextState.positions[key] = {
      ...existing, lastPriceUsd: effectiveQuotePrice(quote, existing),
      lastMarketCapUsd: Number(quote.marketCapUsd || existing.lastMarketCapUsd || 0),
      lastNativePriceUsd: Number(quote.nativePriceUsd || existing.lastNativePriceUsd || 0),
      quoteObservedAt: Number(quote.observedAt), updatedAt: Number(now),
      lastPriceProvenance: priceProvenanceForQuote(quote, existing, trustedMarketCap),
      totalSupply: Number(executionSupply.totalSupply), supplySource: String(executionSupply.supplySource),
      launchpad: executionSupply.launchpad, launchMode: executionSupply.launchMode,
      marketCapDivisor: Number(executionSupply.totalSupply || existing.marketCapDivisor || 0),
      needsCalibration, provisional,
      ...(executionSupply.supplySource === 'LEGACY_PUMP_RULE'
        ? { marketCapProvenance: MARKET_CAP_PROVENANCE }
        : {})
    };
    if (executionSupply.supplySource !== 'LEGACY_PUMP_RULE') {
      delete nextState.positions[key].marketCapProvenance;
    }
    return nextState;
  }

  function updatePositionMetadata(state, token) {
    const key = positionKey(token?.chain, token?.address);
    const existing = state.positions[key];
    if (!existing) return state;
    const source = trustedMetadataSource(token);
    if (!source) return state;
    const sourceRank = METADATA_SOURCE_RANK[source];
    const existingSource = String(existing.metadataSource || '').toUpperCase();
    const existingRank = METADATA_SOURCE_RANK[existingSource] || 0;
    if (sourceRank < existingRank) return state;
    const symbol = validIdentityText(token.symbol, 32);
    const name = validIdentityText(token.name, 100);
    const logoUrl = String(token.logoUrl || '').trim();
    if (!symbol && !name && !logoUrl) return state;
    const nextSymbol = symbol || existing.symbol;
    const nextName = name || existing.name;
    const nextLogoUrl = logoUrl || existing.logoUrl || '';
    if (nextSymbol === existing.symbol && nextName === existing.name && nextLogoUrl === existing.logoUrl && source === existingSource) return state;
    const nextState = structuredCloneSafe(state);
    nextState.positions[key] = {
      ...nextState.positions[key], symbol: nextSymbol, name: nextName, logoUrl: nextLogoUrl,
      metadataSource: source, metadataUpdatedAt: Date.now(), updatedAt: Date.now()
    };
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
    portfolioSummary, chainUsdSummary, globalUsdSummary, updatePositionQuote, updatePositionMetadata, breakevenSellPercent,
    usesMarketCapValuation, calibratePosition
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Engine;
})(globalThis);
