(function initState(global) {
  const Tango = global.Tango = global.Tango || {};
  const MARKET_CAP_PROVENANCE = 'SOLANA_PUMP_TRENCH_V1';
  const MARKET_CAP_DIVISOR = 1_000_000_000;
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
  const migrateTrade = (trade) => ({
    ...trade,
    amountNative: native(trade, 'amountNative', 'amountSol'),
    platformFeeNative: native(trade, 'platformFeeNative', 'platformFeeSol'),
    networkFeeNative: native(trade, 'networkFeeNative', 'networkFeeSol'),
    realizedPnlNative: native(trade, 'realizedPnlNative', 'realizedPnlSol'),
    nativePriceUsd: native(trade, 'nativePriceUsd', 'solPriceUsd'),
    nativeSymbol: trade.nativeSymbol || 'SOL'
  });
  const normalizeV2Trade = (trade, strict) => {
    const chain = Tango.Chains.get(trade?.chain);
    if (!chain) {
      if (strict) throw new Error('invalidTrade');
      return { ...trade };
    }
    if (strict && trade.nativeSymbol && trade.nativeSymbol !== chain.nativeSymbol) throw new Error('invalidTrade');
    return {
      ...trade,
      amountNative: native(trade, 'amountNative', 'amountSol'),
      platformFeeNative: native(trade, 'platformFeeNative', 'platformFeeSol'),
      networkFeeNative: native(trade, 'networkFeeNative', 'networkFeeSol'),
      realizedPnlNative: native(trade, 'realizedPnlNative', 'realizedPnlSol'),
      nativePriceUsd: native(trade, 'nativePriceUsd', 'solPriceUsd'),
      nativeSymbol: chain.nativeSymbol
    };
  };

  function createInitialState({ now = Date.now(), initialBalances = {} } = {}) {
    const accounts = Object.fromEntries(Tango.Chains.all().map((chain) => [
      chain.id,
      accountFor(initialBalances[chain.id] || 10, now)
    ]));
    const dailyRealizedByChain = Object.fromEntries(Tango.Chains.all().map((chain) => [chain.id, {}]));
    return { schemaVersion: 2, accounts, positions: {}, trades: [], dailyRealizedByChain, initialized: false };
  }

  function normalizeSettings(raw) {
    const source = raw || {};
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
    return { ...defaultGlobalSettings, ...globalSettings, chains };
  }

  function normalizeAccount(raw, fallback, strict) {
    if (strict && raw && (!Number.isFinite(Number(raw.initialBalanceNative)) || !Number.isFinite(Number(raw.cashBalanceNative)) || !Number.isFinite(Number(raw.realizedPnlNative)))) {
      throw new Error('invalidAccount');
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
    const ratioMatches = (marketCap, price) => {
      const cap = Number(marketCap); const value = Number(price);
      if (!(cap > 0) || !(value > 0)) return false;
      return Math.abs(cap / value - MARKET_CAP_DIVISOR) <= MARKET_CAP_DIVISOR * 0.001;
    };
    return !position?.marketCapProvenance
      && chainId === 'sol'
      && /pump$/i.test(String(address || ''))
      && position?.valuationMode === 'MARKET_CAP'
      && Number(position?.marketCapDivisor) === MARKET_CAP_DIVISOR
      && quantity > 0
      && Number.isFinite(costBasis) && costBasis > 0
      && Number.isFinite(nativePrice) && nativePrice > 0
      && Number.isFinite(averageMarketCap) && averageMarketCap > 0
      && Number.isFinite(averagePrice) && averagePrice > 0
      && ratioMatches(position?.lastMarketCapUsd, position?.lastPriceUsd);
  }

  function normalizePosition(position, key, accounts, strict) {
    const chainId = String(position?.chain || '').toLowerCase();
    const chain = Tango.Chains.get(chainId);
    const address = position?.tokenAddress ?? position?.address;
    const valid = Boolean(chain && Tango.Chains.validateAddress(chainId, address));
    const quantity = Number(position?.quantity);
    if (!valid || !Number.isFinite(quantity) || quantity < 0 || !accounts[chainId]) {
      if (strict) throw new Error('invalidPosition');
      return null;
    }
    const marketCapProvenance = coherentLegacyPumpMarketCap(position, chainId, address, quantity)
      ? MARKET_CAP_PROVENANCE
      : position?.marketCapProvenance;
    return [key, {
      ...position,
      chain: chainId,
      tokenAddress: Tango.Chains.normalizeAddress(chainId, address),
      quantity,
      costBasisNative: native(position, 'costBasisNative', 'costBasisSol'),
      realizedPnlNative: native(position, 'realizedPnlNative', 'realizedPnlSol'),
      lastNativePriceUsd: native(position, 'lastNativePriceUsd', 'lastSolPriceUsd'),
      ...(marketCapProvenance ? { marketCapProvenance } : {})
    }];
  }

  function normalizeDaily(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return Object.fromEntries(Object.entries(value).map(([date, entry]) => [date, {
      native: Number(entry?.native ?? entry ?? 0),
      usdAtExecution: Number(entry?.usdAtExecution ?? 0)
    }]));
  }

  function migrateV1(raw, settings, strict) {
    const state = createInitialState();
    const account = raw.account || {};
    if (strict && ['initialBalanceNative', 'initialBalanceSol', 'cashBalanceNative', 'cashBalanceSol', 'realizedPnlNative', 'realizedPnlSol']
      .some((field) => account[field] != null && !Number.isFinite(Number(account[field])))) {
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
      const normalized = normalizePosition(position, key, state.accounts, strict);
      if (normalized) state.positions[normalized[0]] = normalized[1];
    });
    state.trades = Array.isArray(raw.trades) ? raw.trades.slice(0, Tango.MAX_TRADES).map(migrateTrade) : [];
    state.dailyRealizedByChain.sol = normalizeDaily(raw.dailyRealized);
    state.initialized = Boolean(raw.initialized);
    return state;
  }

  function normalizeState(raw, settings, options = {}) {
    const strict = Boolean(options.strict);
    if (!raw) return createInitialState();
    if (Number(raw.schemaVersion) === 1) return migrateV1(raw, settings, strict);
    if (Number(raw.schemaVersion) !== 2) {
      if (strict) throw new Error('unsupportedSchema');
      return createInitialState();
    }

    const base = createInitialState();
    const accounts = Object.fromEntries(Tango.Chains.all().map((chain) => [
      chain.id,
      normalizeAccount(raw.accounts?.[chain.id], base.accounts[chain.id], strict)
    ]));
    const positions = {};
    Object.entries(raw.positions || {}).forEach(([key, position]) => {
      const normalized = normalizePosition(position, key, raw.accounts || {}, strict);
      if (normalized) positions[normalized[0]] = normalized[1];
    });
    const dailyRealizedByChain = Object.fromEntries(Tango.Chains.all().map((chain) => [
      chain.id,
      normalizeDaily(raw.dailyRealizedByChain?.[chain.id])
    ]));
    return {
      ...base,
      ...raw,
      schemaVersion: 2,
      accounts,
      positions,
      trades: Array.isArray(raw.trades) ? raw.trades.slice(0, Tango.MAX_TRADES).map((trade) => normalizeV2Trade(trade, strict)) : [],
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

  Tango.State = { createInitialState, normalizeSettings, normalizeState, resetChain, resetAll };
  Tango.createInitialState = (solBalance = 10) => createInitialState({ initialBalances: { sol: Number(solBalance) } });
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.State;
})(globalThis);
