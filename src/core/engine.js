(function initEngine(global) {
  const Tango = global.Tango = global.Tango || {};

  function round(value, digits = 12) {
    const factor = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }

  function positionKey(chain, tokenAddress) {
    return `${String(chain || '').toLowerCase()}:${String(tokenAddress || '').toLowerCase()}`;
  }

  function usesMarketCapValuation(position) {
    if (position?.valuationMode === 'MARKET_CAP') return true;
    const price = Number(position?.averageEntryPriceUsd || 0);
    const marketCap = Number(position?.averageEntryMarketCap || 0);
    if (!(price > 0 && marketCap > 0)) return false;
    const ratio = marketCap / price;
    return ratio > 900_000_000 && ratio < 1_100_000_000;
  }

  function effectiveQuotePrice(quote, position) {
    const marketCap = Number(quote?.marketCapUsd || 0);
    const positionUsesMarketCap = usesMarketCapValuation(position);
    const useMarketCap = position ? positionUsesMarketCap : quote?.valuationMode === 'MARKET_CAP';
    if (useMarketCap && marketCap > 0) {
      return marketCap / Number(position?.marketCapDivisor || quote?.marketCapDivisor || 1_000_000_000);
    }
    if (position && !positionUsesMarketCap && quote?.valuationMode === 'MARKET_CAP' && marketCap > 0) {
      const referencePrice = Number(position.lastPriceUsd || position.averageEntryPriceUsd || 0);
      const referenceMarketCap = Number(position.lastMarketCapUsd || position.averageEntryMarketCap || 0);
      if (referencePrice > 0 && referenceMarketCap > 0) return referencePrice * marketCap / referenceMarketCap;
    }
    const price = Number(quote?.priceUsd || 0);
    return price > 0 ? price : marketCap > 0 ? marketCap / 1_000_000_000 : 0;
  }

  function validateQuote(quote, now = Date.now(), staleMs) {
    if (!quote || !(effectiveQuotePrice(quote) > 0)) return { ok: false, reason: 'invalidQuote' };
    if (!(Number(quote.solPriceUsd) > 0)) return { ok: false, reason: 'invalidQuote' };
    const maxAge = Number(staleMs || Tango.QUOTE_STALE_MS || 15_000);
    if (!quote.observedAt || now - Number(quote.observedAt) > maxAge) return { ok: false, reason: 'staleQuote' };
    return { ok: true };
  }

  function feeFor(amountSol, settings) {
    return Number(amountSol) * Number(settings.platformFeeBps || 0) / 10_000;
  }

  function executeBuy(state, order, settings, now = Date.now()) {
    const quoteValidation = validateQuote(order.quote, now, order.staleMs);
    if (!quoteValidation.ok) throw new Error(quoteValidation.reason);
    const amountSol = Number(order.amountSol);
    if (!(amountSol > 0)) throw new Error('invalidAmount');
    if (amountSol > Number(state.account.cashBalanceSol) + 1e-12) throw new Error('insufficientBalance');

    const slippage = Number(settings.slippageBps || 0) / 10_000;
    const platformFeeSol = feeFor(amountSol, settings);
    const networkFeeSol = Number(settings.networkFeeSol || 0);
    const netInvestmentSol = amountSol - platformFeeSol - networkFeeSol;
    if (!(netInvestmentSol > 0)) throw new Error('invalidAmount');

    const key = positionKey(order.token.chain, order.token.address);
    const existing = state.positions[key];
    const valuationMode = existing
      ? (usesMarketCapValuation(existing) ? 'MARKET_CAP' : 'PRICE')
      : (order.quote.valuationMode === 'MARKET_CAP' ? 'MARKET_CAP' : 'PRICE');
    const marketCapDivisor = Number(existing?.marketCapDivisor || order.quote.marketCapDivisor || 1_000_000_000);
    const valuationContext = existing || (valuationMode === 'MARKET_CAP' ? { valuationMode, marketCapDivisor } : null);
    const executionPriceUsd = effectiveQuotePrice(order.quote, valuationContext) * (1 + slippage);
    const solPriceUsd = Number(order.quote.solPriceUsd || 1);
    const quantity = netInvestmentSol * solPriceUsd / executionPriceUsd;
    const existingQuantity = Number(existing?.quantity || 0);
    const existingCost = Number(existing?.costBasisSol || 0);
    const nextQuantity = existingQuantity + quantity;
    const nextCost = existingCost + amountSol;
    const averageEntryPriceUsd = nextQuantity > 0
      ? ((existingQuantity * Number(existing?.averageEntryPriceUsd || 0)) + (quantity * executionPriceUsd)) / nextQuantity
      : executionPriceUsd;
    const averageEntryMarketCap = nextCost > 0
      ? ((existingCost * Number(existing?.averageEntryMarketCap || order.quote.marketCapUsd || 0)) + (amountSol * Number(order.quote.marketCapUsd || 0))) / nextCost
      : Number(order.quote.marketCapUsd || 0);

    const trade = {
      id: cryptoId(now),
      chain: order.token.chain,
      tokenAddress: order.token.address,
      symbol: order.token.symbol || 'TOKEN',
      name: order.token.name || order.token.symbol || 'Token',
      logoUrl: order.token.logoUrl || '',
      side: 'BUY',
      quantity: round(quantity),
      amountSol: round(amountSol),
      observedPriceUsd: effectiveQuotePrice(order.quote, valuationContext),
      executionPriceUsd: round(executionPriceUsd),
      marketCapUsd: Number(order.quote.marketCapUsd || 0),
      liquidityUsd: Number(order.quote.liquidityUsd || 0),
      solPriceUsd,
      slippageBps: Number(settings.slippageBps || 0),
      platformFeeSol: round(platformFeeSol),
      networkFeeSol: round(networkFeeSol),
      realizedPnlSol: 0,
      sourceUrl: order.sourceUrl || '',
      executedAt: now
    };

    const nextState = structuredCloneSafe(state);
    nextState.account.cashBalanceSol = round(Number(state.account.cashBalanceSol) - amountSol);
    nextState.account.updatedAt = now;
    nextState.positions[key] = {
      chain: order.token.chain,
      tokenAddress: order.token.address,
      symbol: order.token.symbol || 'TOKEN',
      name: order.token.name || order.token.symbol || 'Token',
      logoUrl: order.token.logoUrl || '',
      quantity: round(nextQuantity),
      costBasisSol: round(nextCost),
      averageEntryPriceUsd: round(averageEntryPriceUsd),
      averageEntryMarketCap: round(averageEntryMarketCap),
      realizedPnlSol: Number(existing?.realizedPnlSol || 0),
      lastPriceUsd: effectiveQuotePrice(order.quote, valuationContext),
      lastMarketCapUsd: Number(order.quote.marketCapUsd || 0),
      lastSolPriceUsd: solPriceUsd,
      quoteObservedAt: Number(order.quote.observedAt),
      openedAt: existing?.openedAt || now,
      updatedAt: now,
      valuationMode,
      marketCapDivisor
    };
    nextState.trades = [trade, ...(state.trades || [])].slice(0, Tango.MAX_TRADES || 10_000);
    return { state: nextState, trade, position: nextState.positions[key] };
  }

  function executeSell(state, order, settings, now = Date.now()) {
    const quoteValidation = validateQuote(order.quote, now, order.staleMs);
    if (!quoteValidation.ok) throw new Error(quoteValidation.reason);
    const key = positionKey(order.token.chain, order.token.address);
    const existing = state.positions[key];
    if (!existing || !(Number(existing.quantity) > 0)) throw new Error('noPosition');

    const percent = Number(order.percent || 0);
    const requestedQuantity = order.quantity == null
      ? Number(existing.quantity) * percent / 100
      : Number(order.quantity);
    const quantity = Math.min(Number(existing.quantity), requestedQuantity);
    if (!(quantity > 0)) throw new Error('invalidAmount');

    const slippage = Number(settings.slippageBps || 0) / 10_000;
    const executionPriceUsd = effectiveQuotePrice(order.quote, existing) * (1 - slippage);
    const solPriceUsd = Number(order.quote.solPriceUsd || existing.lastSolPriceUsd || 1);
    const grossProceedsSol = quantity * executionPriceUsd / solPriceUsd;
    const platformFeeSol = feeFor(grossProceedsSol, settings);
    const networkFeeSol = Number(settings.networkFeeSol || 0);
    const netProceedsSol = Math.max(0, grossProceedsSol - platformFeeSol - networkFeeSol);
    const costShare = Number(existing.costBasisSol) * quantity / Number(existing.quantity);
    const realizedPnlSol = netProceedsSol - costShare;
    const remainingQuantity = Math.max(0, Number(existing.quantity) - quantity);
    const remainingCost = Math.max(0, Number(existing.costBasisSol) - costShare);

    const trade = {
      id: cryptoId(now),
      chain: order.token.chain,
      tokenAddress: order.token.address,
      symbol: existing.symbol,
      name: existing.name,
      logoUrl: existing.logoUrl || '',
      side: 'SELL',
      quantity: round(quantity),
      amountSol: round(netProceedsSol),
      observedPriceUsd: effectiveQuotePrice(order.quote, existing),
      executionPriceUsd: round(executionPriceUsd),
      marketCapUsd: Number(order.quote.marketCapUsd || 0),
      liquidityUsd: Number(order.quote.liquidityUsd || 0),
      entryMarketCapUsd: Number(existing.averageEntryMarketCap || 0),
      solPriceUsd,
      slippageBps: Number(settings.slippageBps || 0),
      platformFeeSol: round(platformFeeSol),
      networkFeeSol: round(networkFeeSol),
      realizedPnlSol: round(realizedPnlSol),
      sourceUrl: order.sourceUrl || '',
      heldMs: now - Number(existing.openedAt || now),
      executedAt: now
    };

    const nextState = structuredCloneSafe(state);
    nextState.account.cashBalanceSol = round(Number(state.account.cashBalanceSol) + netProceedsSol);
    nextState.account.realizedPnlSol = round(Number(state.account.realizedPnlSol || 0) + realizedPnlSol);
    nextState.account.updatedAt = now;
    if (remainingQuantity <= 1e-12) {
      delete nextState.positions[key];
    } else {
      nextState.positions[key] = {
        ...existing,
        quantity: round(remainingQuantity),
        costBasisSol: round(remainingCost),
        realizedPnlSol: round(Number(existing.realizedPnlSol || 0) + realizedPnlSol),
        lastPriceUsd: effectiveQuotePrice(order.quote, existing),
        lastMarketCapUsd: Number(order.quote.marketCapUsd || 0),
        lastSolPriceUsd: solPriceUsd,
        quoteObservedAt: Number(order.quote.observedAt),
        updatedAt: now
      };
    }
    nextState.trades = [trade, ...(state.trades || [])].slice(0, Tango.MAX_TRADES || 10_000);
    const dayKey = localDateKey(now);
    nextState.dailyRealized[dayKey] = round(Number(nextState.dailyRealized[dayKey] || 0) + realizedPnlSol);
    return { state: nextState, trade, position: nextState.positions[key] || null };
  }

  function executeCloseAll(state, orders, settings, now = Date.now()) {
    let nextState = state;
    const trades = [];
    const failures = [];
    for (const order of orders || []) {
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

  function markPosition(position, quote) {
    const priceUsd = quote ? effectiveQuotePrice(quote, position) : Number(position.lastPriceUsd || position.averageEntryPriceUsd || 0);
    const solPriceUsd = Number(quote?.solPriceUsd || position.lastSolPriceUsd || 1);
    const valueSol = priceUsd > 0 ? Number(position.quantity) * priceUsd / solPriceUsd : Number(position.costBasisSol);
    const unrealizedPnlSol = valueSol - Number(position.costBasisSol);
    const roi = Number(position.costBasisSol) > 0 ? unrealizedPnlSol / Number(position.costBasisSol) * 100 : 0;
    return { valueSol, unrealizedPnlSol, roi, priceUsd, solPriceUsd };
  }

  function breakevenSellPercent(position, quote, settings) {
    if (!position || !(Number(position.quantity) > 0) || !validateQuote(quote).ok) return null;
    const slippage = Number(settings.slippageBps || 0) / 10_000;
    const feeRate = Number(settings.platformFeeBps || 0) / 10_000;
    const executionPriceUsd = effectiveQuotePrice(quote, position) * (1 - slippage);
    const grossFullValueSol = Number(position.quantity) * executionPriceUsd / Number(quote.solPriceUsd);
    const targetGrossSol = (Number(position.costBasisSol) + Number(settings.networkFeeSol || 0)) / Math.max(1e-9, 1 - feeRate);
    const percent = targetGrossSol / grossFullValueSol * 100;
    return percent > 0 && percent <= 100 ? Math.min(100, round(percent, 4)) : null;
  }

  function portfolioSummary(state) {
    let positionsValueSol = 0;
    let unrealizedPnlSol = 0;
    Object.values(state.positions || {}).forEach((position) => {
      const mark = markPosition(position);
      positionsValueSol += mark.valueSol;
      unrealizedPnlSol += mark.unrealizedPnlSol;
    });
    const equitySol = Number(state.account.cashBalanceSol) + positionsValueSol;
    const totalPnlSol = equitySol - Number(state.account.initialBalanceSol);
    const closed = (state.trades || []).filter((trade) => trade.side === 'SELL');
    const wins = closed.filter((trade) => Number(trade.realizedPnlSol) > 0);
    const grossProfit = wins.reduce((sum, trade) => sum + Number(trade.realizedPnlSol), 0);
    const grossLoss = Math.abs(closed.filter((trade) => Number(trade.realizedPnlSol) < 0)
      .reduce((sum, trade) => sum + Number(trade.realizedPnlSol), 0));
    const todayKey = localDateKey(Date.now());
    return {
      cashBalanceSol: Number(state.account.cashBalanceSol),
      positionsValueSol,
      equitySol,
      realizedPnlSol: Number(state.account.realizedPnlSol || 0),
      unrealizedPnlSol,
      totalPnlSol,
      todayPnlSol: Number(state.dailyRealized?.[todayKey] || 0),
      positionCount: Object.keys(state.positions || {}).length,
      totalTrades: (state.trades || []).length,
      closedTrades: closed.length,
      winRate: closed.length ? wins.length / closed.length * 100 : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
    };
  }

  function updatePositionQuote(state, token, quote) {
    const key = positionKey(token.chain, token.address);
    if (!state.positions[key] || !validateQuote(quote, Number(quote.observedAt), Infinity).ok) return state;
    const nextState = structuredCloneSafe(state);
    nextState.positions[key] = {
      ...nextState.positions[key],
      lastPriceUsd: effectiveQuotePrice(quote, nextState.positions[key]),
      lastMarketCapUsd: Number(quote.marketCapUsd || nextState.positions[key].lastMarketCapUsd || 0),
      lastSolPriceUsd: Number(quote.solPriceUsd || nextState.positions[key].lastSolPriceUsd || 1),
      quoteObservedAt: Number(quote.observedAt),
      updatedAt: Date.now()
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
    return typeof global.structuredClone === 'function'
      ? global.structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  Tango.Engine = {
    round, positionKey, validateQuote, executeBuy, executeSell, executeCloseAll, markPosition,
    portfolioSummary, updatePositionQuote, breakevenSellPercent
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Engine;
})(globalThis);
