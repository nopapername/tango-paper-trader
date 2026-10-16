(function initDashboardModel(global) {
  const Tango = global.Tango = global.Tango || {};
  const CSV_FIELDS = Object.freeze([
    'executedAt', 'chain', 'nativeSymbol', 'tokenAddress', 'symbol', 'side', 'amountNative',
    'quantity', 'observedPriceUsd', 'executionPriceUsd', 'marketCapUsd', 'nativePriceUsd',
    'slippageBps', 'platformFeeNative', 'networkFeeNative', 'realizedPnlNative',
    'realizedPnlUsd', 'valuationMode', 'priceProvenance', 'quoteSource', 'paperFallback',
    'provisional', 'syntheticTokenPrice', 'syntheticNativePrice', 'totalSupply', 'supplySource',
    'launchpad', 'launchMode', 'sourceUrl'
  ]);

  function dateKey(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function matchesPreparedFilters(trade, filters, search) {
    const matchesSearch = !search || `${trade.symbol || ''} ${trade.tokenAddress || ''}`.toLowerCase().includes(search);
    const matchesSide = !filters.side || filters.side === 'ALL' || trade.side === filters.side;
    const matchesResult = !filters.result || filters.result === 'ALL'
      || (filters.result === 'WIN' && Number(trade.realizedPnlNative) > 0)
      || (filters.result === 'LOSS' && Number(trade.realizedPnlNative) < 0);
    const matchesDate = !filters.date || dateKey(trade.executedAt) === filters.date;
    return matchesSearch && matchesSide && matchesResult && matchesDate;
  }

  function matchesFilters(trade, filters = {}) {
    return matchesPreparedFilters(trade, filters, String(filters.search || '').trim().toLowerCase());
  }

  function history(state, selectedChain, filters = {}) {
    const chain = Tango.Chains.get(selectedChain) || Tango.Chains.get('sol');
    const search = String(filters.search || '').trim().toLowerCase();
    const trades = Tango.ChainView.trades(state, chain.id)
      .filter(trade => matchesPreparedFilters(trade, filters, search));
    return { chain, trades };
  }

  function settingsFor(settings, chainId) {
    return settings?.chainSettings?.[chainId] || settings?.chains?.[chainId] || {};
  }

  function hasDerivedMarketCapPrice(trade) {
    const provenance = String(trade?.priceProvenance || '');
    if (provenance) {
      return provenance.startsWith('MARKET_CAP') || provenance === 'MIXED_DERIVED';
    }
    return trade?.valuationMode === 'MARKET_CAP';
  }

  function availableChainUsdSummary(state, chainId, nativePriceUsd) {
    const price = Number(nativePriceUsd);
    if (!Number.isFinite(price) || !(price > 0)) return null;
    try {
      return Tango.Engine.chainUsdSummary(state, chainId, price);
    } catch (error) {
      if (!['invalidArithmetic', 'invalidNativePrice', 'unsupportedChain'].includes(error?.message)) throw error;
      return null;
    }
  }

  function selected(state, settings, selectedChain, nativePrices = {}, filters = {}) {
    const { chain, trades } = history(state, selectedChain, filters);
    const nativePriceUsd = Number(nativePrices?.[chain.id] || 0);
    return {
      chain, trades, nativePriceUsd,
      positions: Tango.ChainView.positions(state, chain.id),
      summary: Tango.Engine.portfolioSummary(state, chain.id, nativePriceUsd),
      chainSettings: settingsFor(settings, chain.id)
    };
  }

  function forTab(state, settings, selectedChain, nativePrices = {}, filters = {}, tab = 'overview') {
    if (!['positions', 'history', 'settings', 'calendar'].includes(tab)) return build(state, settings, selectedChain, nativePrices, filters);
    const chain = Tango.Chains.get(selectedChain) || Tango.Chains.get('sol');
    const view = { chain, chainSettings: settingsFor(settings, chain.id),
      nativePriceUsd: Number(nativePrices?.[chain.id] || 0) };
    if (tab === 'positions') view.positions = Tango.ChainView.positions(state, chain.id);
    if (tab === 'history') view.trades = history(state, chain.id, filters).trades;
    return view;
  }

  function build(state, settings, selectedChain, nativePrices = {}, filters = {}) {
    const chain = Tango.Chains.get(selectedChain) || Tango.Chains.get('sol');
    const nativePriceUsd = Number(nativePrices?.[chain.id] || 0);
    const positions = Tango.ChainView.positions(state, chain.id);
    const trades = history(state, chain.id, filters).trades;
    const accounts = Tango.Chains.all().map((entry) => ({
      chain: entry,
      summary: Tango.Engine.portfolioSummary(state, entry.id, Number(nativePrices?.[entry.id] || 0)),
      nativePriceUsd: Number(nativePrices?.[entry.id] || 0),
      usdSummary: availableChainUsdSummary(state, entry.id, nativePrices?.[entry.id])
    }));
    // Aggregate exactly the same canonical chain values, in chain order. Commit
    // both totals together so an overflowing chain leaves neither half applied.
    let assetsUsd = 0; let pnlUsd = 0; const missingChains = [];
    for (const account of accounts) {
      const usd = account.usdSummary;
      const nextAssets = usd ? assetsUsd + usd.assetsUsd : NaN;
      const nextPnl = usd ? pnlUsd + usd.pnlUsd : NaN;
      if (!usd || !Number.isFinite(nextAssets) || nextAssets < 0 || !Number.isFinite(nextPnl)) {
        missingChains.push(account.chain.id);
        continue;
      }
      assetsUsd = nextAssets; pnlUsd = nextPnl;
    }
    return {
      chain, positions, trades,
      summary: { ...accounts.find(account => account.chain.id === chain.id).summary },
      globalUsd: { assetsUsd, pnlUsd, complete: missingChains.length === 0, missingChains },
      nativePriceUsd,
      chainSettings: settingsFor(settings, chain.id),
      accounts
    };
  }

  function tradesCsvRows(state, chain) {
    const selected = Tango.Chains.get(chain) || Tango.Chains.get('sol');
    return Tango.ChainView.trades(state, selected.id).map((trade) => {
      const derived = hasDerivedMarketCapPrice(trade);
      return Object.fromEntries(CSV_FIELDS.map((field) => [field,
        field === 'executedAt' ? new Date(trade.executedAt).toISOString()
          : derived && (field === 'observedPriceUsd' || field === 'executionPriceUsd') ? ''
            : trade[field]
      ]));
    });
  }

  function calendar(state, chain, year, month) {
    const selected = Tango.Chains.get(chain) || Tango.Chains.get('sol');
    const prefix = `${year}-${String(Number(month) + 1).padStart(2, '0')}-`;
    const days = Object.fromEntries(Object.entries(Tango.ChainView.daily(state, selected.id))
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key, {
        native: Number(value?.native ?? value ?? 0),
        usdAtExecution: Number(value?.usdAtExecution || 0)
      }]));
    const trades = Tango.ChainView.trades(state, selected.id).filter((trade) => {
      const date = new Date(trade.executedAt);
      return trade.side === 'SELL' && date.getFullYear() === Number(year) && date.getMonth() === Number(month);
    });
    const realized = trades.map((trade) => Number(trade.realizedPnlNative || 0));
    const wins = realized.filter((value) => value > 0);
    return {
      chain: selected,
      days,
      trades,
      totalNative: Object.values(days).reduce((sum, value) => sum + value.native, 0),
      statisticsScope: 'retainedHistory',
      winRate: trades.length ? wins.length / trades.length * 100 : 0,
      bestNative: realized.length ? Math.max(...realized) : 0,
      worstNative: realized.length ? Math.min(...realized) : 0
    };
  }

  Tango.DashboardModel = { build, selected, history, forTab, matchesFilters, tradesCsvRows, calendar, hasDerivedMarketCapPrice, CSV_FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.DashboardModel;
})(globalThis);
