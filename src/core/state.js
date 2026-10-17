(function initState(global) {
  const Tango = global.Tango = global.Tango || {};
  const MARKET_CAP_PROVENANCE = 'SOLANA_PUMP_TRENCH_V1';
  const MARKET_CAP_DIVISOR = 1_000_000_000;
  const UNKNOWN_FALLBACK_SOURCE = 'UNKNOWN_FALLBACK';
  const UNKNOWN_FALLBACK_PROVENANCE = 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1';
  const TRUSTED_SUPPLY_SOURCES = Object.freeze([
    'GMGN_EXACT', 'GMGN_RATIO', 'LAUNCHPAD_RULE', 'LEGACY_PUMP_RULE',
    UNKNOWN_FALLBACK_SOURCE
  ]);
  const VALUATION_MODES = ['PRICE', 'MARKET_CAP'];
  const PRICE_PROVENANCES = [
    'OBSERVED_PRICE', 'MARKET_CAP_DERIVED', 'MARKET_CAP_RATIO_DERIVED', 'MIXED_DERIVED',
    'SYNTHETIC_PRICE'
  ];
  const CALIBRATION_REASONS = [
    'PRICE', 'NATIVE', 'SUPPLY', 'PRICE_AND_NATIVE', 'PRICE_AND_SUPPLY',
    'NATIVE_AND_SUPPLY', 'PRICE_NATIVE_AND_SUPPLY'
  ];
  const LOCAL_LAUNCHPAD_RULES = Object.freeze([
    Object.freeze({ chain: 'sol', aliases: Object.freeze(['pump', 'pumpfun']), launchMode: 'mayhem', totalSupply: 2_000_000_000 }),
    Object.freeze({ chain: 'sol', aliases: Object.freeze(['pump', 'pumpfun']), launchMode: '', totalSupply: MARKET_CAP_DIVISOR }),
    Object.freeze({ chain: 'bsc', aliases: Object.freeze(['fourmeme']), launchMode: '', totalSupply: MARKET_CAP_DIVISOR }),
    Object.freeze({ chain: 'bsc', aliases: Object.freeze(['flap']), launchMode: '', totalSupply: MARKET_CAP_DIVISOR }),
    Object.freeze({ chain: 'base', aliases: Object.freeze(['zora', 'zoracoins']), launchMode: '', totalSupply: MARKET_CAP_DIVISOR }),
    Object.freeze({ chain: 'xlayer', aliases: Object.freeze(['dyor']), launchMode: '', totalSupply: MARKET_CAP_DIVISOR }),
    Object.freeze({ chain: 'xlayer', aliases: Object.freeze(['bow', 'bowfun']), launchMode: '', totalSupply: MARKET_CAP_DIVISOR }),
    Object.freeze({ chain: 'base', aliases: Object.freeze(['bankr', 'bankrbot', 'banker']), launchMode: '', totalSupply: 100_000_000_000 }),
    Object.freeze({ chain: 'robinhood', aliases: Object.freeze(['bankr', 'bankrbot', 'banker']), launchMode: '', totalSupply: 100_000_000_000 }),
    Object.freeze({ chain: 'base', aliases: Object.freeze(['clanker']), launchMode: '', totalSupply: 100_000_000_000 }),
    Object.freeze({ chain: 'robinhood', aliases: Object.freeze(['clanker']), launchMode: '', totalSupply: 100_000_000_000 })
  ]);
  const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const finiteBetween = (value, minimum, maximum) => finite(value)
    && value >= minimum && value <= maximum;
  const validTimestamp = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const coherentPumpIdentity = (chainId, address) => chainId === 'sol'
    && Tango.Chains.validateAddress(chainId, address)
    && /pump$/i.test(String(address || ''));
  const marketCapRatioMatches = (marketCap, price) => {
    const cap = Number(marketCap); const value = Number(price);
    return cap > 0 && value > 0
      && Math.abs(cap / value - MARKET_CAP_DIVISOR) <= MARKET_CAP_DIVISOR * 0.001;
  };
  const cleanRuleIdentity = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const localRuleSupply = (chain, launchpad, launchMode) => {
    const id = Tango.Chains?.get?.(chain)?.id || '';
    const platform = cleanRuleIdentity(launchpad);
    const mode = cleanRuleIdentity(launchMode);
    const matches = LOCAL_LAUNCHPAD_RULES.filter((rule) => rule.chain === id && rule.aliases.includes(platform));
    return (matches.find((rule) => rule.launchMode === mode)
      || matches.find((rule) => !rule.launchMode))?.totalSupply || 0;
  };
  const ruleSupply = (value) => contextualRuleSupply(value);
  const contextualRuleSupply = (value) => {
    const resolved = typeof Tango.Supply?.ruleSupply === 'function'
      ? Number(Tango.Supply.ruleSupply(value?.chain, value?.launchpad, value?.launchMode))
      : localRuleSupply(value?.chain, value?.launchpad, value?.launchMode);
    return Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
  };
  const trustedSupplyIdentity = (value) => {
    const totalSupply = Number(value?.totalSupply);
    const source = String(value?.supplySource || '');
    if (!Number.isFinite(totalSupply) || totalSupply <= 0
      || !TRUSTED_SUPPLY_SOURCES.includes(source)) return null;
    const marketCap = value?.marketCapUsd ?? value?.lastMarketCapUsd;
    const price = value?.observedPriceUsd ?? value?.lastPriceUsd;
    if (source === 'GMGN_RATIO' && !supplyRatioMatches(marketCap, price, totalSupply)) return null;
    if (source === 'LAUNCHPAD_RULE' && contextualRuleSupply(value) !== totalSupply) return null;
    if (source === UNKNOWN_FALLBACK_SOURCE && (
      totalSupply !== MARKET_CAP_DIVISOR
      || Number(value?.marketCapDivisor) !== MARKET_CAP_DIVISOR
      || Number(value?.provisionalSupply) !== MARKET_CAP_DIVISOR
      || value?.provisionalSupplyProvenance !== UNKNOWN_FALLBACK_PROVENANCE
    )) return null;
    if (source === 'LEGACY_PUMP_RULE') {
      const address = value?.tokenAddress ?? value?.address;
      const validDivisor = value?.side
        ? (value?.marketCapDivisor == null || Number(value.marketCapDivisor) === MARKET_CAP_DIVISOR)
        : Number(value?.marketCapDivisor) === MARKET_CAP_DIVISOR;
      if (!coherentPumpIdentity(value?.chain, address)
        || value?.marketCapProvenance !== MARKET_CAP_PROVENANCE
        || totalSupply !== MARKET_CAP_DIVISOR
        || !validDivisor) return null;
    }
    return { totalSupply, source };
  };
  const supplyRatioMatches = (marketCap, price, totalSupply) => {
    const cap = Number(marketCap); const value = Number(price); const supply = Number(totalSupply);
    return cap > 0 && value > 0 && supply > 0
      && Math.abs(cap / value - supply) <= supply * 0.001;
  };
  const inferredTradeValuationMode = (trade) => {
    if (VALUATION_MODES.includes(trade?.valuationMode)) return trade.valuationMode;
    return trade?.priceProvenance === 'MARKET_CAP_DERIVED' ? 'MARKET_CAP' : 'PRICE';
  };
  const migrationTimestamp = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0;
  const hasOwn = (value, field) => isRecord(value) && Object.hasOwn(value, field);
  const optional = (object, field, validate) => !hasOwn(object, field) || validate(object[field]);
  const alias = (object, modern, legacy, validate) => optional(object, modern, validate)
    && (!legacy || optional(object, legacy, validate));
  const canonicalChainIds = () => Tango.Chains.all().map((chain) => chain.id);
  const sameKeys = (value, keys) => isRecord(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
  const accountFor = (balance, now) => ({
    initialBalanceNative: Number(balance), cashBalanceNative: Number(balance), realizedPnlNative: 0,
    createdAt: now, updatedAt: now
  });
  const chainSettingsFor = (chain, existing = {}) => ({
    buyPresets: Array.isArray(existing.buyPresets) ? existing.buyPresets.map(Number).filter((value) => value > 0).slice(0, 12) : [...chain.defaultBuyPresets],
    networkFeeNative: Number.isFinite(Number(existing.networkFeeNative)) ? Number(existing.networkFeeNative) : chain.defaultNetworkFeeNative,
    initialBalanceNative: Number(existing.initialBalanceNative || 10)
  });
  const native = (object, modern, legacy, fallback = 0) => Number(object?.[modern] ?? object?.[legacy] ?? fallback);

  const isTrustedSupplySource = (value) => !value || TRUSTED_SUPPLY_SOURCES.includes(String(value));
  const optionalText = (value, maximum = 100) => typeof value === 'string' && value.length <= maximum;
  const PROVENANCE_FIELDS = [
    ['quoteSource', (value) => optionalText(value)],
    ['paperFallback', (value) => typeof value === 'boolean'],
    ['provisional', (value) => typeof value === 'boolean'],
    ['syntheticTokenPrice', (value) => typeof value === 'boolean'],
    ['syntheticNativePrice', (value) => typeof value === 'boolean'],
    ['needsCalibration', (value) => typeof value === 'boolean'],
    ['provisionalTokenPrice', (value) => typeof value === 'boolean'],
    ['initialMarketCapPending', (value) => typeof value === 'boolean'],
    ['provisionalNativePrice', (value) => typeof value === 'boolean'],
    ['totalSupply', (value) => finiteBetween(value, 0, Number.MAX_VALUE)],
    ['provisionalSupply', (value) => finiteBetween(value, 0, Number.MAX_VALUE)],
    ['provisionalSupplyProvenance', (value) => value === UNKNOWN_FALLBACK_PROVENANCE],
    ['supplySource', (value) => optionalText(value) && isTrustedSupplySource(value)],
    ['launchpad', (value) => optionalText(value)],
    ['launchMode', (value) => optionalText(value)]
  ];

  function validProvenance(value) {
    return PROVENANCE_FIELDS.every(([field, validate]) => optional(value, field, validate));
  }

  function normalizeProvenance(value) {
    const normalized = { ...value };
    PROVENANCE_FIELDS.forEach(([field, validate]) => {
      delete normalized[field];
      if (validate(value?.[field])) normalized[field] = value[field];
    });
    if (normalized.supplySource === UNKNOWN_FALLBACK_SOURCE
      && !trustedSupplyIdentity(normalized)) {
      delete normalized.supplySource;
      delete normalized.totalSupply;
      delete normalized.provisionalSupply;
      delete normalized.provisionalSupplyProvenance;
    }
    return normalized;
  }

  function validatePresetList(value, { maximum = Infinity } = {}) {
    return Array.isArray(value) && value.length > 0 && value.length <= 12
      && value.every((entry) => finiteBetween(entry, Number.EPSILON, maximum));
  }

  function validateLayoutPosition(value) {
    return value == null || (isRecord(value) && finiteBetween(value.x, 0, 1_000_000)
      && finiteBetween(value.y, 0, 1_000_000));
  }

  function validateSettings(source, options) {
    if (!isRecord(source)) throw new Error('invalidSettings');
    const booleanFields = [
      'enabled', 'fastMode', 'confirmationEnabled', 'soundEnabled', 'showListQuickBuy',
      'barCollapsed', 'panelCollapsed', 'onboardingInitialized'
    ];
    if (booleanFields.some((field) => hasOwn(source, field) && typeof source[field] !== 'boolean')) {
      throw new Error('invalidSettings');
    }
    if (hasOwn(source, 'language') && !['auto', 'en', 'zh-CN'].includes(source.language)) throw new Error('invalidSettings');
    if (hasOwn(source, 'displayCurrency') && !['SOL', 'NATIVE', 'USD'].includes(source.displayCurrency)) throw new Error('invalidSettings');
    if (hasOwn(source, 'theme') && !['auto', 'dark', 'light'].includes(source.theme)) throw new Error('invalidSettings');
    if (hasOwn(source, 'pnlBarPosition') && !['top', 'bottom'].includes(source.pnlBarPosition)) throw new Error('invalidSettings');
    if (hasOwn(source, 'selectedChain') && !Tango.Chains.get(source.selectedChain)) throw new Error('invalidSettings');
    if (!optional(source, 'slippageBps', (value) => finiteBetween(value, 0, 9_999))) throw new Error('invalidSettings');
    if (!optional(source, 'platformFeeBps', (value) => finiteBetween(value, 0, 9_999))) throw new Error('invalidSettings');
    if (!optional(source, 'sellPresets', (value) => validatePresetList(value, { maximum: 100 }))) throw new Error('invalidSettings');
    if (!optional(source, 'buyPresets', validatePresetList)) throw new Error('invalidSettings');
    if (!optional(source, 'networkFeeSol', (value) => finiteBetween(value, 0, 1_000_000))) throw new Error('invalidSettings');
    if (!optional(source, 'initialBalanceSol', (value) => finiteBetween(value, Number.EPSILON, 1e15))) throw new Error('invalidSettings');
    if (['panelPosition', 'drawerPosition', 'barPosition'].some((field) => !validateLayoutPosition(source[field]))) {
      throw new Error('invalidSettings');
    }

    if (['barScale', 'panelScale'].some(field => !optional(source, field, value => finiteBetween(value, .75, 1.5)))) throw new Error('invalidSettings');

    const rawChains = source.chains ?? source.chainSettings;
    const chainAliases = ['chains', 'chainSettings'].filter((field) => hasOwn(source, field));
    if (chainAliases.length) {
      const allowed = new Set(canonicalChainIds());
      chainAliases.forEach((field) => {
        const chainSettings = source[field];
        if (!isRecord(chainSettings)) throw new Error('invalidSettings');
        if (Object.keys(chainSettings).some((chainId) => !allowed.has(chainId))) throw new Error('invalidSettings');
        if (options.requireAllChains && chainSettings === rawChains && !sameKeys(chainSettings, canonicalChainIds())) {
          throw new Error('invalidSettings');
        }
        Object.values(chainSettings).forEach((settings) => {
          if (!isRecord(settings)) throw new Error('invalidSettings');
          if (!optional(settings, 'buyPresets', validatePresetList)) throw new Error('invalidSettings');
          if (!optional(settings, 'networkFeeNative', (value) => finiteBetween(value, 0, 1_000_000))) throw new Error('invalidSettings');
          if (!optional(settings, 'initialBalanceNative', (value) => finiteBetween(value, Number.EPSILON, 1e15))) throw new Error('invalidSettings');
        });
      });
    } else if (options.requireAllChains) throw new Error('invalidSettings');
  }

  function validateTrade(trade, legacy = false) {
    if (!isRecord(trade)) throw new Error('invalidTrade');
    const chain = Tango.Chains.get(trade.chain);
    if (!chain || trade.chain !== chain.id || (legacy && chain.id !== 'sol')) throw new Error('invalidTrade');
    if (!Tango.Chains.validateAddress(chain.id, trade.tokenAddress)
      || trade.tokenAddress !== Tango.Chains.normalizeAddress(chain.id, trade.tokenAddress)) throw new Error('invalidTrade');
    if (!String(trade.id || '').trim() || !['BUY', 'SELL'].includes(trade.side)) throw new Error('invalidTrade');
    const nonnegativeFields = legacy
      ? ['amountSol', 'quantity', 'observedPriceUsd', 'executionPriceUsd', 'marketCapUsd', 'liquidityUsd', 'solPriceUsd', 'slippageBps', 'platformFeeSol', 'networkFeeSol']
      : ['amountNative', 'quantity', 'observedPriceUsd', 'executionPriceUsd', 'marketCapUsd', 'liquidityUsd', 'nativePriceUsd', 'slippageBps', 'platformFeeNative', 'networkFeeNative'];
    if (nonnegativeFields.some((field) => !finiteBetween(trade[field], 0, Number.MAX_VALUE))) throw new Error('invalidTrade');
    if (!(Number(trade.quantity) > 0) || !(Number(legacy ? trade.solPriceUsd : trade.nativePriceUsd) > 0)
      || !(Number(trade.executionPriceUsd) > 0)) throw new Error('invalidTrade');
    const signedFields = legacy ? ['realizedPnlSol'] : ['realizedPnlNative', 'realizedPnlUsd'];
    if (signedFields.some((field) => !optional(trade, field, finite))) throw new Error('invalidTrade');
    if (legacy && (
      !optional(trade, 'amountNative', (value) => finiteBetween(value, 0, Number.MAX_VALUE))
      || !optional(trade, 'platformFeeNative', (value) => finiteBetween(value, 0, Number.MAX_VALUE))
      || !optional(trade, 'networkFeeNative', (value) => finiteBetween(value, 0, Number.MAX_VALUE))
      || !optional(trade, 'realizedPnlNative', finite)
      || !optional(trade, 'nativePriceUsd', (value) => finiteBetween(value, Number.EPSILON, Number.MAX_VALUE))
    )) throw new Error('invalidTrade');
    if (!optional(trade, 'entryMarketCapUsd', (value) => finiteBetween(value, 0, Number.MAX_VALUE))) throw new Error('invalidTrade');
    if (!optional(trade, 'heldMs', (value) => finiteBetween(value, 0, Number.MAX_SAFE_INTEGER))) throw new Error('invalidTrade');
    if (!validTimestamp(trade.executedAt)) throw new Error('invalidTrade');
    if (!validProvenance(trade)
      || !optional(trade, 'quoteObservedAtOriginal', validTimestamp)
      || !optional(trade, 'nativePriceObservedAtOriginal', validTimestamp)) throw new Error('invalidTrade');
    if (['quoteObservedAtOriginal', 'nativePriceObservedAtOriginal'].some((field) => (
      hasOwn(trade, field) && trade[field] > trade.executedAt
    ))) throw new Error('invalidTrade');
    if (!legacy && trade.nativeSymbol && trade.nativeSymbol !== chain.nativeSymbol) throw new Error('invalidTrade');
    if (trade.valuationMode != null && !VALUATION_MODES.includes(trade.valuationMode)) throw new Error('invalidTrade');
    if (trade.priceProvenance != null && !PRICE_PROVENANCES.includes(trade.priceProvenance)) throw new Error('invalidTrade');
    if (trade.marketCapProvenance != null && trade.marketCapProvenance !== MARKET_CAP_PROVENANCE) {
      throw new Error('invalidTrade');
    }
    const coherentPump = coherentPumpIdentity(chain.id, trade.tokenAddress);
    const valuationMode = inferredTradeValuationMode(trade);
    const derivedPrice = ['MARKET_CAP_DERIVED', 'MARKET_CAP_RATIO_DERIVED', 'MIXED_DERIVED']
      .includes(trade.priceProvenance);
    const supply = trustedSupplyIdentity(trade);
    if (String(trade.supplySource || '') && !supply) throw new Error('invalidTrade');
    const coherentTrustedSupply = Boolean(supply
      && supplyRatioMatches(trade.marketCapUsd, trade.observedPriceUsd, supply.totalSupply));
    if ((valuationMode === 'MARKET_CAP' || derivedPrice)
      && !coherentPump && !coherentTrustedSupply) {
      throw new Error('invalidTrade');
    }
    if (trade.marketCapProvenance != null && !coherentPump) throw new Error('invalidTrade');
    if ((trade.valuationMode === 'PRICE' && trade.priceProvenance === 'MARKET_CAP_DERIVED')
      || (trade.valuationMode === 'MARKET_CAP' && trade.priceProvenance === 'MARKET_CAP_RATIO_DERIVED')
      || (trade.marketCapProvenance != null && valuationMode === 'PRICE'
        && trade.priceProvenance !== 'MARKET_CAP_RATIO_DERIVED')
      || (trade.valuationMode === 'MARKET_CAP' && trade.priceProvenance == null
        && !marketCapRatioMatches(trade.marketCapUsd, trade.observedPriceUsd))) {
      throw new Error('invalidTrade');
    }
  }

  function validateCalibration(event) {
    if (!isRecord(event) || !String(event.id || '').trim()) throw new Error('invalidCalibration');
    const chain = Tango.Chains.get(event.chain);
    if (!chain || !Tango.Chains.validateAddress(chain.id, event.tokenAddress)) throw new Error('invalidCalibration');
    const nonnegative = [
      'fromPriceUsd', 'toPriceUsd', 'fromNativePriceUsd', 'toNativePriceUsd',
      'fromSupply', 'toSupply', 'quantityBefore', 'quantityAfter', 'costBasisNative'
    ];
    if (nonnegative.some((field) => !finiteBetween(event[field], 0, Number.MAX_VALUE))
      || !validTimestamp(event.createdAt)
      || !CALIBRATION_REASONS.includes(event.reason)) {
      throw new Error('invalidCalibration');
    }
  }

  function normalizeCalibration(event, strict) {
    try {
      validateCalibration(event);
    } catch (error) {
      if (strict) throw error;
      return null;
    }
    const chain = Tango.Chains.get(event.chain);
    return {
      id: String(event.id).trim(), chain: chain.id,
      tokenAddress: Tango.Chains.normalizeAddress(chain.id, event.tokenAddress),
      reason: event.reason,
      fromPriceUsd: event.fromPriceUsd, toPriceUsd: event.toPriceUsd,
      fromNativePriceUsd: event.fromNativePriceUsd, toNativePriceUsd: event.toNativePriceUsd,
      fromSupply: event.fromSupply, toSupply: event.toSupply,
      quantityBefore: event.quantityBefore, quantityAfter: event.quantityAfter,
      costBasisNative: event.costBasisNative, createdAt: event.createdAt
    };
  }

  function inferredTradeProvenance(trade, chain) {
    if (trade?.priceProvenance) return {
      valuationMode: inferredTradeValuationMode(trade),
      priceProvenance: trade.priceProvenance,
      ...(trade.marketCapProvenance ? { marketCapProvenance: trade.marketCapProvenance } : {})
    };
    if (trade?.valuationMode === 'PRICE') {
      return { valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE' };
    }
    const coherentLegacyMarketCap = chain?.id === 'sol'
      && coherentPumpIdentity(chain.id, trade?.tokenAddress)
      && marketCapRatioMatches(trade?.marketCapUsd, trade?.observedPriceUsd);
    return coherentLegacyMarketCap
      ? { valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED', marketCapProvenance: MARKET_CAP_PROVENANCE }
      : { valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE' };
  }

  const migrateTrade = (trade, strict) => {
    if (strict) validateTrade(trade, true);
    const chain = Tango.Chains.get(trade?.chain);
    const provenance = inferredTradeProvenance(trade, chain);
    return normalizeProvenance({
      ...trade,
      chain: chain?.id || trade?.chain,
      tokenAddress: chain && Tango.Chains.validateAddress(chain.id, trade?.tokenAddress)
        ? Tango.Chains.normalizeAddress(chain.id, trade.tokenAddress)
        : trade?.tokenAddress,
      amountNative: native(trade, 'amountNative', 'amountSol'),
      platformFeeNative: native(trade, 'platformFeeNative', 'platformFeeSol'),
      networkFeeNative: native(trade, 'networkFeeNative', 'networkFeeSol'),
      realizedPnlNative: native(trade, 'realizedPnlNative', 'realizedPnlSol'),
      nativePriceUsd: native(trade, 'nativePriceUsd', 'solPriceUsd'),
      nativeSymbol: trade.nativeSymbol || 'SOL',
      ...provenance
    });
  };
  const normalizeV2Trade = (trade, strict) => {
    const chain = Tango.Chains.get(trade?.chain);
    if (!chain) {
      if (strict) throw new Error('invalidTrade');
      return { ...trade };
    }
    if (strict) validateTrade(trade);
    const provenance = inferredTradeProvenance(trade, chain);
    return normalizeProvenance({
      ...trade,
      chain: chain.id,
      tokenAddress: Tango.Chains.validateAddress(chain.id, trade?.tokenAddress)
        ? Tango.Chains.normalizeAddress(chain.id, trade.tokenAddress)
        : trade?.tokenAddress,
      amountNative: native(trade, 'amountNative', 'amountSol'),
      platformFeeNative: native(trade, 'platformFeeNative', 'platformFeeSol'),
      networkFeeNative: native(trade, 'networkFeeNative', 'networkFeeSol'),
      realizedPnlNative: native(trade, 'realizedPnlNative', 'realizedPnlSol'),
      nativePriceUsd: native(trade, 'nativePriceUsd', 'solPriceUsd'),
      nativeSymbol: chain.nativeSymbol,
      ...provenance
    });
  };

  function createInitialState({ now = Date.now(), initialBalances = {} } = {}) {
    const accounts = Object.fromEntries(Tango.Chains.all().map((chain) => [
      chain.id,
      accountFor(initialBalances[chain.id] || 10, now)
    ]));
    const dailyRealizedByChain = Object.fromEntries(Tango.Chains.all().map((chain) => [chain.id, {}]));
    return {
      schemaVersion: 2,
      stateRevision: 0,
      accounts,
      positions: {},
      trades: [],
      calibrations: [],
      dailyRealizedByChain,
      initialized: false
    };
  }

  function normalizeSettings(raw, options = {}) {
    const source = raw || {};
    if (options.strict) validateSettings(source, options);
    const existing = source.chains || source.chainSettings || {};
    const chains = Object.fromEntries(Tango.Chains.all().map((chain) => {
      const legacySolSettings = chain.id === 'sol' ? {
        buyPresets: source.buyPresets,
        networkFeeNative: source.networkFeeSol,
        initialBalanceNative: source.initialBalanceSol
      } : {};
      return [chain.id, chainSettingsFor(chain, { ...legacySolSettings, ...(existing[chain.id] || {}) })];
    }));
    const {
      chains: ignoredChains, chainSettings: ignoredChainSettings,
      buyPresets: ignoredBuyPresets, networkFeeSol: ignoredNetworkFeeSol,
      initialBalanceSol: ignoredInitialBalanceSol, ...globalSettings
    } = source;
    const {
      buyPresets: defaultBuyPresets, networkFeeSol: defaultNetworkFeeSol,
      initialBalanceSol: defaultInitialBalanceSol, ...defaultGlobalSettings
    } = Tango.DEFAULT_SETTINGS;
    const selectedChain = Tango.Chains.get(globalSettings.selectedChain)?.id || 'sol';
    return { ...defaultGlobalSettings, ...globalSettings, selectedChain, chains,
      barScale: finiteBetween(source.barScale, .75, 1.5) ? source.barScale : 1,
      panelScale: finiteBetween(source.panelScale, .75, 1.5) ? source.panelScale : 1
    };
  }

  function normalizeAccount(raw, fallback, strict) {
    if (strict) {
      if (!isRecord(raw)
        || !finiteBetween(raw.initialBalanceNative, Number.EPSILON, Number.MAX_VALUE)
        || !finiteBetween(raw.cashBalanceNative, 0, Number.MAX_VALUE)
        || !finite(raw.realizedPnlNative)
        || !validTimestamp(raw.createdAt)
        || !validTimestamp(raw.updatedAt)) throw new Error('invalidAccount');
    }
    return {
      ...fallback,
      ...(raw || {}),
      initialBalanceNative: Number(raw?.initialBalanceNative ?? fallback.initialBalanceNative),
      cashBalanceNative: Number(raw?.cashBalanceNative ?? fallback.cashBalanceNative),
      realizedPnlNative: Number(raw?.realizedPnlNative ?? fallback.realizedPnlNative)
    };
  }

  function coherentLegacyPumpMarketCap(position, chainId, address, quantity) {
    const costBasis = native(position, 'costBasisNative', 'costBasisSol');
    const nativePrice = native(position, 'lastNativePriceUsd', 'lastSolPriceUsd');
    const averageMarketCap = Number(position?.averageEntryMarketCap);
    const averagePrice = Number(position?.averageEntryPriceUsd);
    return !position?.marketCapProvenance
      && coherentPumpIdentity(chainId, address)
      && position?.valuationMode === 'MARKET_CAP'
      && Number(position?.marketCapDivisor) === MARKET_CAP_DIVISOR
      && quantity > 0
      && Number.isFinite(costBasis) && costBasis > 0
      && Number.isFinite(nativePrice) && nativePrice > 0
      && Number.isFinite(averageMarketCap) && averageMarketCap > 0
      && Number.isFinite(averagePrice) && averagePrice > 0
      && marketCapRatioMatches(position?.lastMarketCapUsd, position?.lastPriceUsd);
  }

  function isDurableUnknownFallbackTrade(trade) {
    return trade?.supplySource === UNKNOWN_FALLBACK_SOURCE
      && trade?.provisionalSupplyProvenance === UNKNOWN_FALLBACK_PROVENANCE;
  }

  function isCanonicalUnknownFallbackOrigin(trade) {
    const canonicalMarketCap = Number(
      Tango.Supply?.UNKNOWN_INITIAL_MARKET_CAP_USD || 3_200
    );
    const canonicalPrice = canonicalMarketCap / MARKET_CAP_DIVISOR;
    const canonicalFallbackOrigin = String(trade?.quoteSource || '').toUpperCase() === 'TANGO_FALLBACK'
      && Number(trade?.marketCapUsd) === canonicalMarketCap
      && Math.abs(Number(trade?.observedPriceUsd) - canonicalPrice)
        <= canonicalPrice * 0.001;
    const cardMarketCapOrigin = String(trade?.quoteSource || '').toUpperCase()
      === 'TANGO_FALLBACK_CARD_MARKET_CAP'
      && Number.isSafeInteger(trade?.quoteObservedAtOriginal)
      && trade.quoteObservedAtOriginal > 0
      && trade.quoteObservedAtOriginal <= trade.executedAt
      && Number(trade.marketCapUsd) > 0
      && Number(trade.observedPriceUsd) > 0
      && Math.abs(trade.marketCapUsd / trade.observedPriceUsd - MARKET_CAP_DIVISOR)
        <= MARKET_CAP_DIVISOR * 0.001;
    const durableUnknownFallbackBuy = trade?.side === 'BUY'
      && isDurableUnknownFallbackTrade(trade)
      && Number(trade?.totalSupply) === MARKET_CAP_DIVISOR
      && Number(trade.marketCapDivisor) === MARKET_CAP_DIVISOR
      && Number(trade.provisionalSupply) === MARKET_CAP_DIVISOR;
    const syntheticPriceOrigin = trade?.paperFallback === true
      && trade?.provisional === true
      && trade?.syntheticTokenPrice === true
      && trade?.valuationMode === 'MARKET_CAP'
      && trade?.priceProvenance === 'SYNTHETIC_PRICE'
      && (canonicalFallbackOrigin || cardMarketCapOrigin);
    const nativeOnlyProvisional = trade?.provisional === true
      && trade?.syntheticTokenPrice === false
      && trade?.syntheticNativePrice === true
      && Number(trade?.nativePriceUsd) === 1;
    const factualPriceSyntheticMarketCapOrigin = trade?.paperFallback === true
      && (trade?.provisional === false || nativeOnlyProvisional)
      && trade?.syntheticTokenPrice === false
      && trade?.valuationMode === 'PRICE'
      && trade?.priceProvenance === 'OBSERVED_PRICE'
      && ['GMGN', 'GMGN_TRENCH', 'GMGN_DETAIL', 'GMGN_NETWORK'].includes(
        String(trade?.quoteSource || '').toUpperCase()
      )
      && Number.isSafeInteger(trade?.quoteObservedAtOriginal)
      && trade.quoteObservedAtOriginal > 0
      && trade.quoteObservedAtOriginal <= trade.executedAt
      && Number(trade.marketCapUsd) === canonicalMarketCap
      && Number(trade.observedPriceUsd) > 0;
    return durableUnknownFallbackBuy
      && trade.paperFallback === true
      && (syntheticPriceOrigin || factualPriceSyntheticMarketCapOrigin);
  }

  function validateUnknownFallbackTradeHistories(trades) {
    const histories = new Map();
    trades.forEach((trade) => {
      if (!isDurableUnknownFallbackTrade(trade)) return;
      const key = `${trade.chain}:${trade.tokenAddress}`;
      const history = histories.get(key) || [];
      history.push(trade);
      histories.set(key, history);
    });
    histories.forEach((history) => {
      const originTime = Math.min(...history.map((trade) => Number(trade.executedAt)));
      if (!history.some((trade) => (
        Number(trade.executedAt) === originTime
        && isCanonicalUnknownFallbackOrigin(trade)
      ))) {
        throw new Error('invalidTrade');
      }
    });
  }

  function hasCanonicalUnknownFallbackEntry(position, trades) {
    const address = Tango.Chains.normalizeAddress(position.chain, position.tokenAddress);
    return trades.some((trade) => (
      trade.chain === position.chain
      && trade.tokenAddress === address
      && isCanonicalUnknownFallbackOrigin(trade)
      && Number(trade.executedAt) === Number(position.openedAt)
    ));
  }

  function normalizePosition(position, key, accounts, strict, legacyKey = false, trades = [], maximumTimestamp) {
    const chainId = String(position?.chain || '').toLowerCase();
    const chain = Tango.Chains.get(chainId);
    const address = position?.tokenAddress ?? position?.address;
    const valid = Boolean(chain && Tango.Chains.validateAddress(chainId, address));
    const quantity = Number(position?.quantity);
    if (!valid || !Number.isFinite(quantity) || quantity < 0 || !accounts[chainId]) {
      if (strict) throw new Error('invalidPosition');
      return null;
    }
    if (strict) {
      const nonnegativeFields = [
        ['costBasisNative', 'costBasisSol'], ['averageEntryPriceUsd'], ['averageEntryMarketCap'],
        ['lastPriceUsd'], ['lastMarketCapUsd'], ['lastNativePriceUsd', 'lastSolPriceUsd'],
        ['marketCapDivisor']
      ];
      if (nonnegativeFields.some(([modern, legacy]) => {
        const value = position?.[modern] ?? (legacy ? position?.[legacy] : 0);
        return !alias(position, modern, legacy, (entry) => finiteBetween(entry, 0, Number.MAX_VALUE))
          || !finiteBetween(value, 0, Number.MAX_VALUE);
      })) throw new Error('invalidPosition');
      if (!finiteBetween(position?.quantity, 0, Number.MAX_VALUE)
        || !alias(position, 'realizedPnlNative', 'realizedPnlSol', finite)
        || !finite(position?.realizedPnlNative ?? position?.realizedPnlSol ?? 0)
        || !validTimestamp(position?.openedAt)
        || !validTimestamp(position?.updatedAt)
        || position.openedAt > position.updatedAt
        || (maximumTimestamp != null && position.openedAt > maximumTimestamp)
        || !validProvenance(position)
        || !optional(position, 'quoteObservedAt', validTimestamp)
        || !optional(position, 'metadataUpdatedAt', validTimestamp)) {
        throw new Error('invalidPosition');
      }
      if (position.valuationMode != null && !VALUATION_MODES.includes(position.valuationMode)) {
        throw new Error('invalidPosition');
      }
      if (hasOwn(position, 'quoteObservedAt') && position.quoteObservedAt > position.updatedAt) {
        throw new Error('invalidPosition');
      }
      if (position.marketCapProvenance != null && position.marketCapProvenance !== MARKET_CAP_PROVENANCE) {
        throw new Error('invalidPosition');
      }
      if (['lastPriceProvenance', 'averageEntryPriceProvenance'].some((field) =>
        position[field] != null && !PRICE_PROVENANCES.includes(position[field]))) {
        throw new Error('invalidPosition');
      }
      const coherentLegacyMarketCapContext = chainId === 'sol'
        && /pump$/i.test(String(address || ''))
        && position.valuationMode === 'MARKET_CAP'
        && position.marketCapDivisor === MARKET_CAP_DIVISOR;
      const supply = trustedSupplyIdentity(position);
      if (String(position.supplySource || '') && !supply) throw new Error('invalidPosition');
      const coherentTrustedSupply = Boolean(supply
        && Number(position.marketCapDivisor) === supply.totalSupply
        && (supply.source === UNKNOWN_FALLBACK_SOURCE
          || supplyRatioMatches(position.lastMarketCapUsd, position.lastPriceUsd, supply.totalSupply)));
      if (supply?.source === UNKNOWN_FALLBACK_SOURCE
        && !hasCanonicalUnknownFallbackEntry(position, trades)) {
        throw new Error('invalidPosition');
      }
      const coherentLegacyRatioContext = supply?.source === 'LEGACY_PUMP_RULE'
        && coherentTrustedSupply;
      const derivedPrice = ['MARKET_CAP_DERIVED', 'MARKET_CAP_RATIO_DERIVED', 'MIXED_DERIVED']
        .some((provenance) => position.lastPriceProvenance === provenance
          || position.averageEntryPriceProvenance === provenance);
      if ((position.valuationMode === 'MARKET_CAP' || derivedPrice)
        && !coherentLegacyMarketCapContext && !coherentTrustedSupply) {
        throw new Error('invalidPosition');
      }
      if (position.marketCapProvenance != null
        && !coherentLegacyMarketCapContext && !coherentLegacyRatioContext) {
        throw new Error('invalidPosition');
      }
    }
    const normalizedAddress = Tango.Chains.normalizeAddress(chainId, address);
    const canonicalKey = `${chainId}:${normalizedAddress}`;
    const expectedKey = legacyKey ? `${chainId}:${String(address).trim().toLowerCase()}` : canonicalKey;
    const marketCapProvenance = coherentLegacyPumpMarketCap(position, chainId, address, quantity)
      ? MARKET_CAP_PROVENANCE
      : position?.marketCapProvenance;
    const normalizedPosition = normalizeProvenance({
      ...position,
      chain: chainId,
      tokenAddress: normalizedAddress,
      quantity,
      costBasisNative: native(position, 'costBasisNative', 'costBasisSol'),
      realizedPnlNative: native(position, 'realizedPnlNative', 'realizedPnlSol'),
      lastNativePriceUsd: native(position, 'lastNativePriceUsd', 'lastSolPriceUsd'),
      ...(marketCapProvenance ? { marketCapProvenance } : {})
    });
    // Recover the timestamp of an already stored legacy position without
    // changing its economics. Strict backup imports reject this inconsistency.
    if (!strict && validTimestamp(position.openedAt) && validTimestamp(position.updatedAt)
      && position.openedAt > position.updatedAt) {
      if (trustedSupplyIdentity(position)?.source === UNKNOWN_FALLBACK_SOURCE
        && hasCanonicalUnknownFallbackEntry(position, trades)) {
        // The opening timestamp identifies the durable fallback origin. A
        // clock rollback must not sever that dependency during recovery.
        normalizedPosition.updatedAt = position.openedAt;
      } else {
        normalizedPosition.openedAt = position.updatedAt;
      }
    }
    if (marketCapProvenance === MARKET_CAP_PROVENANCE && !hasOwn(position, 'totalSupply')) {
      normalizedPosition.totalSupply = MARKET_CAP_DIVISOR;
      normalizedPosition.supplySource = 'LEGACY_PUMP_RULE';
    }
    return [canonicalKey, normalizedPosition, key === expectedKey];
  }

  function validDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function normalizeDaily(raw, strict, legacy = false) {
    if (strict && !isRecord(raw)) throw new Error('invalidDaily');
    const value = raw && typeof raw === 'object' ? raw : {};
    return Object.fromEntries(Object.entries(value).map(([date, entry]) => {
      const nativeValue = entry?.native ?? entry ?? 0;
      const usdValue = entry?.usdAtExecution ?? 0;
      if (strict && (
        !validDateKey(date) || entry == null || (!legacy && !isRecord(entry))
        || (isRecord(entry) && (!optional(entry, 'native', finite) || !optional(entry, 'usdAtExecution', finite)))
        || !finite(nativeValue) || !finite(usdValue)
      )) {
        throw new Error('invalidDaily');
      }
      return [date, { native: Number(nativeValue), usdAtExecution: Number(usdValue) }];
    }));
  }

  function derivedMigrationTimestamp(raw, supplied) {
    if (migrationTimestamp(supplied)) return Number(supplied);
    const candidates = [raw?.account?.createdAt, raw?.account?.updatedAt];
    Object.values(isRecord(raw?.positions) ? raw.positions : {}).forEach((position) => {
      candidates.push(position?.openedAt, position?.updatedAt);
    });
    (Array.isArray(raw?.trades) ? raw.trades : []).forEach((trade) => candidates.push(trade?.executedAt));
    const valid = candidates.filter(migrationTimestamp).map(Number);
    return valid.length ? Math.max(...valid) : 0;
  }

  function migrateV1(raw, settings, strict, migrationNow, maximumTimestamp) {
    if (strict) {
      if (!isRecord(raw.account)) throw new Error('invalidAccount');
      if (!isRecord(raw.positions)) throw new Error('invalidPositions');
      if (!Array.isArray(raw.trades)) throw new Error('invalidTrades');
      if (!isRecord(raw.dailyRealized)) throw new Error('invalidDaily');
      if (typeof raw.initialized !== 'boolean') throw new Error('invalidState');
    }
    const state = createInitialState({ now: derivedMigrationTimestamp(raw, migrationNow) });
    const account = raw.account || {};
    if (strict && (
      !alias(account, 'initialBalanceNative', 'initialBalanceSol', (value) => finiteBetween(value, Number.EPSILON, Number.MAX_VALUE))
      || !alias(account, 'cashBalanceNative', 'cashBalanceSol', (value) => finiteBetween(value, 0, Number.MAX_VALUE))
      || !alias(account, 'realizedPnlNative', 'realizedPnlSol', finite)
      || !finiteBetween(account.initialBalanceNative ?? account.initialBalanceSol, Number.EPSILON, Number.MAX_VALUE)
      || !finiteBetween(account.cashBalanceNative ?? account.cashBalanceSol, 0, Number.MAX_VALUE)
      || !finite(account.realizedPnlNative ?? account.realizedPnlSol)
      || !validTimestamp(account.createdAt)
      || !validTimestamp(account.updatedAt)
    )) {
      throw new Error('invalidAccount');
    }
    state.accounts.sol = {
      initialBalanceNative: native(account, 'initialBalanceNative', 'initialBalanceSol', state.accounts.sol.initialBalanceNative),
      cashBalanceNative: native(account, 'cashBalanceNative', 'cashBalanceSol', state.accounts.sol.cashBalanceNative),
      realizedPnlNative: native(account, 'realizedPnlNative', 'realizedPnlSol'),
      createdAt: account.createdAt ?? state.accounts.sol.createdAt,
      updatedAt: account.updatedAt ?? state.accounts.sol.updatedAt
    };
    state.positions = {};
    Object.entries(raw.positions || {}).forEach(([key, position]) => {
      const normalized = normalizePosition(position, key, state.accounts, strict, true, [], maximumTimestamp);
      if (!normalized) return;
      if (state.positions[normalized[0]] && strict) throw new Error('positionCollision');
      if (strict && !normalized[2]) throw new Error('invalidPosition');
      state.positions[normalized[0]] = normalized[1];
    });
    state.trades = Array.isArray(raw.trades) ? raw.trades.map((trade) => migrateTrade(trade, strict)) : [];
    state.dailyRealizedByChain.sol = normalizeDaily(raw.dailyRealized, strict, true);
    state.initialized = Boolean(raw.initialized);
    if (strict && state.trades.length > Tango.MAX_TRADES) throw new Error('importTooManyRecords');
    return state;
  }

  function normalizeState(raw, settings, options = {}) {
    const strict = Boolean(options.strict);
    if (!raw) return createInitialState();
    if (strict && !isRecord(raw)) throw new Error('invalidState');
    if ((strict ? raw.schemaVersion : Number(raw.schemaVersion)) === 1) {
      return migrateV1(raw, settings, strict, options.migrationNow, options.maximumTimestamp);
    }
    if (Number(raw.schemaVersion) !== 2) {
      if (strict) throw new Error('unsupportedSchema');
      return createInitialState();
    }

    if (strict) {
      const chainIds = canonicalChainIds();
      if (raw.schemaVersion !== 2 || !sameKeys(raw.accounts, chainIds)) throw new Error('invalidAccounts');
      if (!isRecord(raw.positions)) throw new Error('invalidPositions');
      if (!Array.isArray(raw.trades)) throw new Error('invalidTrades');
      if (!optional(raw, 'calibrations', Array.isArray)) throw new Error('invalidCalibration');
      if (!sameKeys(raw.dailyRealizedByChain, chainIds)) throw new Error('invalidDaily');
      if (typeof raw.initialized !== 'boolean') throw new Error('invalidState');
      if (raw.stateRevision != null && (!Number.isSafeInteger(raw.stateRevision) || raw.stateRevision < 0)) throw new Error('invalidState');
    }

    const base = createInitialState();
    const accounts = Object.fromEntries(Tango.Chains.all().map((chain) => [
      chain.id,
      normalizeAccount(raw.accounts?.[chain.id], base.accounts[chain.id], strict)
    ]));
    const trades = Array.isArray(raw.trades)
      ? raw.trades.map((trade) => normalizeV2Trade(trade, strict))
      : [];
    if (strict) validateUnknownFallbackTradeHistories(trades);
    const positions = {};
    Object.entries(raw.positions || {}).forEach(([key, position]) => {
      const normalized = normalizePosition(position, key, accounts, strict, false, trades, options.maximumTimestamp);
      if (!normalized) return;
      if (positions[normalized[0]] && strict) throw new Error('positionCollision');
      if (strict && !normalized[2]) throw new Error('invalidPosition');
      positions[normalized[0]] = normalized[1];
    });
    const dailyRealizedByChain = Object.fromEntries(Tango.Chains.all().map((chain) => [
      chain.id,
      normalizeDaily(raw.dailyRealizedByChain?.[chain.id], strict)
    ]));
    const calibrations = Array.isArray(raw.calibrations)
      ? raw.calibrations.map((event) => normalizeCalibration(event, strict)).filter(Boolean)
      : [];
    // Validate the complete input before rejecting a lossless import. Runtime
    // history limits are enforced together with byte limits by the coordinator,
    // where open fallback origins and the current mutation can be protected.
    if (strict && (trades.length > Tango.MAX_TRADES || calibrations.length > Tango.MAX_TRADES)) {
      throw new Error('importTooManyRecords');
    }
    return {
      ...base,
      ...raw,
      schemaVersion: 2,
      stateRevision: Number.isSafeInteger(Number(raw.stateRevision)) && Number(raw.stateRevision) >= 0
        ? Number(raw.stateRevision)
        : 0,
      accounts,
      positions,
      trades,
      calibrations,
      dailyRealizedByChain,
      initialized: Boolean(raw.initialized)
    };
  }

  function resetChain(state, chainId, balance = 10, now = Date.now()) {
    const chain = Tango.Chains.require(chainId);
    const next = normalizeState(state, normalizeSettings({}));
    next.accounts[chain.id] = accountFor(balance, now);
    next.positions = Object.fromEntries(Object.entries(next.positions).filter(([, position]) => position.chain !== chain.id));
    next.trades = next.trades.filter((trade) => trade.chain !== chain.id);
    next.calibrations = next.calibrations.filter((event) => event.chain !== chain.id);
    next.dailyRealizedByChain[chain.id] = {};
    return next;
  }

  function resetAll(settings, now = Date.now()) {
    const normalizedSettings = normalizeSettings(settings);
    const initialBalances = Object.fromEntries(Tango.Chains.all().map((chain) => [
      chain.id,
      normalizedSettings.chains[chain.id].initialBalanceNative
    ]));
    const state = createInitialState({ now, initialBalances });
    state.initialized = true;
    return state;
  }

  Tango.State = { createInitialState, normalizeSettings, normalizeState, resetChain, resetAll, ruleSupply };
  Tango.createInitialState = (solBalance = 10) => createInitialState({ initialBalances: { sol: Number(solBalance) } });
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.State;
})(globalThis);
