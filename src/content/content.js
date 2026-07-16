(function initContent(global) {
  if (global.__tangoPaperTraderLoaded) return;
  global.__tangoPaperTraderLoaded = true;

  const Tango = global.Tango;
  const runtime = {
    state: null, settings: null, current: null, drawerOpen: false, modal: null,
    toast: null, lastQuoteWriteAt: 0, quoteTimer: null, observer: null, renderQueued: false,
    presetEditing: null, suppressConfirmForSession: false, audioContext: null, tradeSounds: null,
    solPriceUsd: 0, solPricePromise: null, tokenQuotePromise: null, gmgnQuotes: new Map(), lastUrl: location.href, routeTimer: null
  };

  const host = document.createElement('div');
  host.id = 'tango-paper-trader-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = chrome.runtime.getURL('src/content/content.css');
  const shell = document.createElement('div');
  shell.className = 'tango-shell';
  shadow.append(stylesheet, shell);
  document.documentElement.appendChild(host);

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'TANGO_GMGN_PAGE' || event.data?.type !== 'TOKEN_QUOTES') return;
    (event.data.quotes || []).forEach((quote) => {
      if (!quote?.address) return;
      const address = String(quote.address).toLowerCase();
      runtime.gmgnQuotes.set(address, quote);
      if (runtime.current?.token?.address?.toLowerCase() === address && Number(quote.priceUsd) > 0) {
        runtime.current.quote = {
          ...runtime.current.quote,
          ...quote,
          marketCapUsd: Number(runtime.current.quote.marketCapUsd || quote.marketCapUsd || 0),
          solPriceUsd: Number(runtime.current.quote.solPriceUsd || runtime.solPriceUsd || 0),
          valuationMode: 'PRICE'
        };
        queueRender();
      }
    });
  });
  window.postMessage({ source: 'TANGO_PAPER_CONTENT', type: 'REQUEST_QUOTES' }, '*');

  function language() { return Tango.I18n.resolveLanguage(runtime.settings?.language); }
  function t(key) { return Tango.I18n.t(key, runtime.settings?.language); }
  function accountMoney(value, signed = false) {
    const reference = Number(runtime.current?.quote?.solPriceUsd || Object.values(runtime.state?.positions || {}).find((position) => position.lastSolPriceUsd)?.lastSolPriceUsd || 0);
    if (runtime.settings?.displayCurrency !== 'USD' || !(reference > 0)) return Tango.Format.sol(value, language(), signed);
    const numeric = Number(value || 0); const sign = signed && numeric > 0 ? '+' : numeric < 0 ? '-' : '';
    return `${sign}${Tango.Format.usd(Math.abs(numeric) * reference, language())}`;
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
  function pnlClass(value) { return Number(value) > 0 ? 'tango-up' : Number(value) < 0 ? 'tango-down' : 'tango-flat'; }
  function currentPosition() {
    if (!runtime.current?.token) return null;
    return runtime.state.positions[Tango.Engine.positionKey(runtime.current.token.chain, runtime.current.token.address)] || null;
  }
  function requiresConfirmation() {
    return !runtime.settings.fastMode && runtime.settings.confirmationEnabled && !runtime.suppressConfirmForSession;
  }

  async function refresh() {
    const previousSettings = runtime.settings;
    const data = await Tango.Store.getAll();
    runtime.state = data.state;
    runtime.settings = data.settings;
    const quickBuyConfigChanged = previousSettings && (
      previousSettings.enabled !== runtime.settings.enabled ||
      previousSettings.showListQuickBuy !== runtime.settings.showListQuickBuy ||
      previousSettings.language !== runtime.settings.language ||
      Number(previousSettings.buyPresets?.[0]) !== Number(runtime.settings.buyPresets?.[0])
    );
    if (!runtime.settings.enabled || !runtime.state.initialized || !runtime.settings.showListQuickBuy || quickBuyConfigChanged) Tango.GMGN.clearQuickBuy();
    if (!runtime.settings.enabled) runtime.current = null;
    queueRender();
  }

  function queueRender() {
    if (runtime.renderQueued) return;
    runtime.renderQueued = true;
    requestAnimationFrame(() => { runtime.renderQueued = false; render(); });
  }

  async function tickQuote() {
    if (!runtime.settings?.enabled || !runtime.state?.initialized) {
      Tango.GMGN.clearQuickBuy();
      return;
    }
    const previousAddress = runtime.current?.token?.address;
    runtime.current = await Tango.GMGN.readCurrentToken();
    if (runtime.current) {
      const positionPrice = currentPosition()?.lastSolPriceUsd;
      runtime.current.quote.solPriceUsd = Number(runtime.solPriceUsd || positionPrice || 0);
    }
    queueRender();
    ensureSolPrice(runtime.current);
    ensureTokenQuote(runtime.current);
    if (runtime.current?.quote?.priceUsd > 0 && currentPosition() && Date.now() - runtime.lastQuoteWriteAt > 10_000) {
      runtime.state = Tango.Engine.updatePositionQuote(runtime.state, runtime.current.token, runtime.current.quote);
      runtime.lastQuoteWriteAt = Date.now();
      await Tango.Store.saveState(runtime.state);
    }
    if (runtime.settings?.showListQuickBuy) Tango.GMGN.discoverTokenCards(handleQuickBuy, runtime.settings.buyPresets?.[0] || 0.1, t('paper'));
    else Tango.GMGN.clearQuickBuy();
    if (previousAddress !== runtime.current?.token?.address || runtime.current) queueRender();
  }

  function ensureSolPrice(context) {
    if (!context || context.quote.solPriceUsd > 0 || runtime.solPricePromise) return;
    runtime.solPricePromise = chrome.runtime.sendMessage({ type: 'TANGO_GET_SOL_PRICE' })
      .then((response) => {
        const price = Number(response?.price || 0);
        if (!(price > 0)) return;
        runtime.solPriceUsd = price;
        if (runtime.current) runtime.current.quote.solPriceUsd = price;
        queueRender();
      })
      .catch(() => null)
      .finally(() => { runtime.solPricePromise = null; });
  }

  function ensureTokenQuote(context) {
    if (!context?.token?.address || runtime.tokenQuotePromise || (context.quote.priceUsd > 0 && context.quote.marketCapUsd > 0)) return;
    const address = context.token.address;
    const gmgnQuote = runtime.gmgnQuotes.get(address.toLowerCase());
    if (Number(gmgnQuote?.priceUsd) > 0) {
      context.quote = {
        ...context.quote,
        ...gmgnQuote,
        marketCapUsd: Number(context.quote.marketCapUsd || gmgnQuote.marketCapUsd || 0),
        solPriceUsd: Number(context.quote.solPriceUsd || runtime.solPriceUsd || 0),
        valuationMode: 'PRICE'
      };
      queueRender();
      return;
    }
    runtime.tokenQuotePromise = chrome.runtime.sendMessage({ type: 'TANGO_GET_TOKEN_QUOTE', chain: context.token.chain, address })
      .then((response) => {
        const quote = response?.quote;
        if (!quote || runtime.current?.token?.address !== address) return;
        runtime.current.quote = {
          ...runtime.current.quote,
          ...quote,
          marketCapUsd: Number(runtime.current.quote.marketCapUsd || quote.marketCapUsd || 0),
          solPriceUsd: Number(runtime.current.quote.solPriceUsd || runtime.solPriceUsd || 0),
          valuationMode: 'PRICE'
        };
        queueRender();
      })
      .catch(() => null)
      .finally(() => { runtime.tokenQuotePromise = null; });
  }

  function requestWithTimeout(message, timeoutMs = 650) {
    return Promise.race([
      chrome.runtime.sendMessage(message).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
  }

  function positionUrl(position) {
    return `https://gmgn.ai/sol/token/${encodeURIComponent(position.tokenAddress)}`;
  }

  function openPosition(position) {
    location.href = positionUrl(position);
  }

  async function handleQuickBuy(context) {
    if (!runtime.settings?.enabled) return;
    if (context.token.chain !== 'sol') return showToast('GMGN Solana only in V1', 'error');
    const gmgnQuote = runtime.gmgnQuotes.get(context.token.address.toLowerCase());
    const needsExternalTokenFallback = !(Number(gmgnQuote?.priceUsd) > 0 || Number(context.quote.marketCapUsd) > 0);
    const [tokenResponse, solResponse] = await Promise.all([
      Number(gmgnQuote?.priceUsd) > 0
        ? { quote: gmgnQuote }
        : needsExternalTokenFallback
          ? requestWithTimeout({ type: 'TANGO_GET_TOKEN_QUOTE', chain: context.token.chain, address: context.token.address })
          : null,
      context.quote.solPriceUsd > 0 ? null : requestWithTimeout({ type: 'TANGO_GET_SOL_PRICE' })
    ]);
    const externalQuote = tokenResponse?.quote;
    if (Number(externalQuote?.priceUsd) > 0) {
      context.quote = {
        ...context.quote,
        ...externalQuote,
        marketCapUsd: Number(context.quote.marketCapUsd || externalQuote.marketCapUsd || 0),
        valuationMode: 'PRICE'
      };
    }
    context.quote.solPriceUsd = Number(context.quote.solPriceUsd || solResponse?.price || runtime.solPriceUsd || 1);
    context.quote.observedAt = Date.now();
    if (!(Number(context.quote.priceUsd) > 0 || Number(context.quote.marketCapUsd) > 0)) {
      return showToast(t('quoteLoading'), 'error');
    }
    await buy(context.amountSol, context);
  }

  async function buy(amountSol, context = runtime.current) {
    primeTradeAudio();
    if (!runtime.state.initialized) return showToast(t('startPaperTrading'), 'error');
    const order = {
      token: context?.token,
      quote: context?.quote,
      amountSol: Number(amountSol),
      sourceUrl: context?.sourceUrl || location.href
    };
    try {
      previewBuy(order);
      if (requiresConfirmation()) return;
      await commitBuy(order);
    } catch (error) { showToast(t(error.message), 'error'); }
  }

  function previewBuy(order) {
    const validation = Tango.Engine.validateQuote(order.quote);
    if (!validation.ok) throw new Error(validation.reason);
    if (!(order.amountSol > 0)) throw new Error('invalidAmount');
    if (order.amountSol > runtime.state.account.cashBalanceSol) throw new Error('insufficientBalance');
    if (!requiresConfirmation()) return;
    const fee = order.amountSol * runtime.settings.platformFeeBps / 10_000;
    const executionPrice = order.quote.priceUsd * (1 + runtime.settings.slippageBps / 10_000);
    runtime.modal = {
      type: 'confirm',
      title: t('simulatedBuy'),
      rows: [
        [t('token'), order.token.symbol], [t('investment'), Tango.Format.sol(order.amountSol, language())],
        [t('observedPrice'), Tango.Format.usd(order.quote.priceUsd, language())],
        [t('slippage'), Tango.Format.percent(runtime.settings.slippageBps / 100, language())],
        [t('tradingFee'), Tango.Format.sol(fee, language())],
        [t('networkFee'), Tango.Format.sol(runtime.settings.networkFeeSol, language())],
        [t('executionPrice'), Tango.Format.usd(executionPrice, language())]
      ],
      allowSessionSuppress: true,
      action: () => commitBuy(order)
    };
    render();
  }

  async function commitBuy(order) {
    try {
      const result = Tango.Engine.executeBuy(runtime.state, order, runtime.settings);
      runtime.state = result.state;
      runtime.modal = null;
      await Tango.Store.saveState(runtime.state);
      playTradeSound('BUY');
      showToast(`${t('buySuccess')} · ${Tango.Format.sol(order.amountSol, language())} ${order.token.symbol}`, 'success');
    } catch (error) { runtime.modal = null; showToast(t(error.message), 'error'); }
  }

  async function sell(percent, context = runtime.current) {
    primeTradeAudio();
    const order = { token: context?.token, quote: context?.quote, percent: Number(percent), sourceUrl: location.href };
    try {
      const key = Tango.Engine.positionKey(order.token?.chain, order.token?.address);
      if (!runtime.state.positions[key]) throw new Error('noPosition');
      const validation = Tango.Engine.validateQuote(order.quote);
      if (!validation.ok) throw new Error(validation.reason);
      if (requiresConfirmation()) {
        runtime.modal = {
          type: 'confirm', title: t('simulatedSell'),
          rows: [[t('token'), order.token.symbol], [t('amount'), `${percent}%`], [t('observedPrice'), Tango.Format.usd(order.quote.priceUsd, language())]],
          allowSessionSuppress: true,
          action: () => commitSell(order)
        };
        return render();
      }
      await commitSell(order);
    } catch (error) { showToast(t(error.message), 'error'); }
  }

  async function sellPosition(position, percent) {
    const currentMatches = runtime.current?.token?.address?.toLowerCase() === position.tokenAddress.toLowerCase();
    const quote = currentMatches && Tango.Engine.validateQuote(runtime.current?.quote).ok ? runtime.current.quote : {
      priceUsd: position.lastPriceUsd, marketCapUsd: position.lastMarketCapUsd,
      solPriceUsd: position.lastSolPriceUsd, observedAt: Date.now()
    };
    await sell(percent, { token: { chain: position.chain, address: position.tokenAddress, symbol: position.symbol }, quote });
  }

  async function commitSell(order) {
    try {
      const result = Tango.Engine.executeSell(runtime.state, order, runtime.settings);
      runtime.state = result.state;
      runtime.modal = null;
      await Tango.Store.saveState(runtime.state);
      playTradeSound('SELL');
      showToast(`${t('sellSuccess')} · ${order.percent}% ${order.token.symbol}`, 'success');
    } catch (error) { runtime.modal = null; showToast(t(error.message), 'error'); }
  }

  async function sellBreakeven() {
    const percent = Tango.Engine.breakevenSellPercent(currentPosition(), runtime.current?.quote, runtime.settings);
    if (!(percent > 0 && percent <= 100)) return showToast(t('breakevenUnavailable'), 'error');
    await sell(percent);
  }

  function showToast(message, type) {
    runtime.toast = { message, type };
    render();
    clearTimeout(runtime.toastTimer);
    runtime.toastTimer = setTimeout(() => { runtime.toast = null; render(); }, 2600);
  }

  function primeTradeAudio() {
    if (!runtime.settings?.soundEnabled) return;
    try {
      if (!runtime.tradeSounds && global.Audio) {
        runtime.tradeSounds = {
          BUY: new global.Audio('https://gmgn.ai/static/sounds/Handgun.mp3'),
          SELL: new global.Audio('https://gmgn.ai/static/sounds/Kaching.mp3')
        };
        Object.values(runtime.tradeSounds).forEach((audio) => {
          audio.preload = 'auto';
          audio.volume = 0.55;
        });
      }
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return null;
      if (!runtime.audioContext || runtime.audioContext.state === 'closed') runtime.audioContext = new AudioContext();
      if (runtime.audioContext.state === 'suspended') runtime.audioContext.resume().catch(() => {});
      return runtime.audioContext;
    } catch { return null; }
  }

  function playTradeSound(side) {
    const context = primeTradeAudio();
    const sound = runtime.tradeSounds?.[side];
    if (sound) {
      try {
        sound.currentTime = 0;
        const playback = sound.play();
        if (playback?.catch) playback.catch(() => playFallbackTradeSound(side, context));
        return;
      } catch { /* Fall through to a short locally generated cue. */ }
    }
    playFallbackTradeSound(side, context);
  }

  function playFallbackTradeSound(side, context) {
    if (!context) return;
    try {
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.34);
      gain.connect(context.destination);
      const notes = side === 'BUY' ? [660, 880] : [520, 390];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(context.currentTime + index * 0.09);
        oscillator.stop(context.currentTime + 0.2 + index * 0.09);
      });
    } catch { /* Audio can be blocked by browser policy; the visual confirmation remains. */ }
  }

  function renderBar(summary) {
    const collapsed = runtime.settings.barCollapsed;
    return `<div class="tango-bar tango-card ${esc(runtime.settings.pnlBarPosition)} ${collapsed ? 'collapsed' : ''}" style="${floatingStyle(runtime.settings.barPosition)}">
      <span class="tango-drag-grip" data-bar-drag title="${t('dragToMove')}">⠿</span>
      <div class="tango-bar-main" data-action="toggle-drawer">
        ${collapsed ? `<strong class="${pnlClass(summary.totalPnlSol)}">${accountMoney(summary.totalPnlSol, true)}</strong>` : `
          <div class="tango-stat"><strong>${accountMoney(summary.cashBalanceSol)}</strong><span>${t('balance')}</span></div>
          <div class="tango-bar-divider"></div>
          <div class="tango-stat optional"><strong>${accountMoney(summary.equitySol)}</strong><span>${t('equity')}</span></div>
          <div class="tango-bar-divider"></div>
          <div class="tango-stat"><strong class="${pnlClass(summary.totalPnlSol)}">${accountMoney(summary.totalPnlSol, true)}</strong><span>${t('pnl')}</span></div>`}
        <span class="tango-bar-hint">${t('clickForPositions')} · ${summary.positionCount}</span>
      </div>
      <button class="tango-icon-button" data-action="collapse-bar">${collapsed ? '＋' : '－'}</button>
    </div>`;
  }

  function clearHeaderAccountSummary() {
    const node = document.querySelector('#tango-header-account-summary');
    node?.parentElement?.classList.remove('tango-wallet-summary-anchor');
    node?.remove();
  }

  function ensureHeaderAccountSummaryStyle() {
    if (document.querySelector('#tango-header-account-summary-style')) return;
    const style = document.createElement('style');
    style.id = 'tango-header-account-summary-style';
    style.textContent = `
      [data-testid="wallet-connected"].tango-wallet-summary-anchor { overflow: visible !important; position: relative !important; }
      #tango-header-account-summary {
        align-items: center; background: rgba(12,13,18,.96); border: 1px solid rgba(155,124,255,.34);
        border-radius: 5px; color: #aeb1bd; display: flex; font: 600 9px/18px Inter,ui-sans-serif,system-ui,sans-serif;
        gap: 6px; padding: 1px 6px; pointer-events: none; position: absolute; right: 0;
        top: calc(100% + 2px); white-space: nowrap; width: max-content; z-index: 80;
      }
      #tango-header-account-summary strong { color: #f4f1ff; font-weight: 800; }
      #tango-header-account-summary i { background: rgba(255,255,255,.12); height: 10px; width: 1px; }
      #tango-header-account-summary .tango-header-paper-badge { color: #bcaaff; font-size: 8px; font-weight: 800; letter-spacing: .04em; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function renderHeaderAccountSummary(summary) {
    const wallet = document.querySelector('[data-testid="wallet-connected"]');
    if (!wallet || !summary) {
      clearHeaderAccountSummary();
      return;
    }
    ensureHeaderAccountSummaryStyle();
    let node = document.querySelector('#tango-header-account-summary');
    if (!node) {
      node = document.createElement('div');
      node.id = 'tango-header-account-summary';
    }
    if (node.parentElement !== wallet) wallet.appendChild(node);
    wallet.classList.add('tango-wallet-summary-anchor');
    const cash = Tango.Format.sol(summary.cashBalanceSol, language());
    const equity = Tango.Format.sol(summary.equitySol, language());
    const markup = `<span class="tango-header-paper-badge">${esc(t('paper'))}</span><span>${esc(t('paperBalance'))} <strong>${esc(cash)}</strong></span><i></i><span>${esc(t('totalAssets'))} <strong>${esc(equity)}</strong></span>`;
    if (node.innerHTML !== markup) node.innerHTML = markup;
  }

  function renderPresetGrid(side, values) {
    if (runtime.presetEditing === 'all') {
      return values.map((value, index) => `<input class="tango-preset-editor ${side}" data-preset-side="${side}" data-preset-index="${index}" type="number" min="0.0001" ${side === 'sell' ? 'max="100"' : ''} step="any" value="${esc(value)}">`).join('');
    }
    const attribute = side === 'buy' ? 'data-buy' : 'data-sell';
    return values.map((value) => `<button class="tango-button tango-preset ${side}-preset" ${attribute}="${value}">${value}${side === 'sell' ? '%' : ''}</button>`).join('');
  }

  async function savePresetEdits() {
    const readValues = (side) => [...shadow.querySelectorAll(`[data-preset-side="${side}"]`)].map((input) => Number(input.value));
    const buyValues = readValues('buy');
    const sellValues = readValues('sell');
    const validBuy = buyValues.length === 8 && buyValues.every((value) => value > 0);
    const validSell = sellValues.length === 8 && sellValues.every((value) => value > 0 && value <= 100);
    if (!validBuy || !validSell) return showToast(t('invalidPresets'), 'error');
    runtime.settings.buyPresets = buyValues;
    runtime.settings.sellPresets = sellValues;
    runtime.presetEditing = null;
    await Tango.Store.saveSettings(runtime.settings);
    showToast(t('presetsSaved'), 'success');
  }

  function renderPanel() {
    if (!runtime.state.initialized || !runtime.settings.enabled) return '';
    const current = runtime.current;
    if (!current?.token) return '';
    const position = currentPosition();
    const mark = position ? Tango.Engine.markPosition(position, current?.quote) : null;
    const quoteValid = Tango.Engine.validateQuote(current?.quote).ok;
    const symbol = current?.token?.symbol || 'GMGN';
    const tokenTrades = current ? (runtime.state.trades || []).filter((trade) =>
      trade.chain === current.token.chain && trade.tokenAddress.toLowerCase() === current.token.address.toLowerCase()
    ) : [];
    const totalBuy = tokenTrades.filter((trade) => trade.side === 'BUY').reduce((sum, trade) => sum + Number(trade.amountSol || 0), 0);
    const totalSell = tokenTrades.filter((trade) => trade.side === 'SELL').reduce((sum, trade) => sum + Number(trade.amountSol || 0), 0);
    const totalProfit = tokenTrades.filter((trade) => trade.side === 'SELL').reduce((sum, trade) => sum + Number(trade.realizedPnlSol || 0), 0) + Number(mark?.unrealizedPnlSol || 0);
    const feePercent = Number(runtime.settings.platformFeeBps || 0) / 100;
    const breakevenPercent = Tango.Engine.breakevenSellPercent(position, current?.quote, runtime.settings);
    const breakevenLabel = breakevenPercent ? `${t('breakeven')} ${Tango.Format.number(breakevenPercent, language(), 1)}%` : t('breakeven');
    return `<div class="tango-panel tango-card ${runtime.settings.panelCollapsed ? 'collapsed' : ''}" style="${panelStyle()}">
      <div class="tango-header" data-drag-handle>
        <div class="tango-token-strip"><span class="tango-paper-logo">T</span><strong>TANGO</strong><span class="tango-paper-badge">${t('paper')}</span><span>${esc(symbol)}</span></div>
        <div class="tango-header-actions"><button class="tango-icon-button tango-edit-all" data-action="${runtime.presetEditing === 'all' ? 'save-presets' : 'edit-presets'}" title="${t(runtime.presetEditing === 'all' ? 'savePresets' : 'editPresets')}">${runtime.presetEditing === 'all' ? '✓' : '✎'}</button><button class="tango-icon-button" data-action="toggle-sound" title="${t('sound')}">${runtime.settings.soundEnabled ? '🔊' : '🔇'}</button><button class="tango-icon-button" data-action="dashboard">⚙</button><button class="tango-icon-button" data-action="collapse-panel">${runtime.settings.panelCollapsed ? '＋' : '×'}</button></div>
      </div>
      ${runtime.settings.panelCollapsed ? '' : `<div class="tango-trade-body">
        <section class="tango-trade-block">
          <div class="tango-trade-title buy-title"><span>${t('buy')}</span><span class="tango-title-balance">◎ ${Tango.Format.number(runtime.state.account.cashBalanceSol, language(), 4)}</span></div>
          <div class="tango-preset-grid">${renderPresetGrid('buy', runtime.settings.buyPresets)}</div>
          <div class="tango-trade-meta"><span>⌁ ${Tango.Format.percent(runtime.settings.slippageBps / 100, language())}</span><span>♜ ${Tango.Format.sol(runtime.settings.networkFeeSol, language())}</span><span>♙ ${feePercent}%</span><span class="safe">${t('entryMc')} ${position ? Tango.Format.usd(position.averageEntryMarketCap, language(), true) : '--'}</span></div>
        </section>
        <section class="tango-trade-block">
          <div class="tango-trade-title sell-title"><span>${t('sell')} %</span><span class="tango-title-balance">${position ? `${Tango.Format.compact(position.quantity, language(), 2)} ${esc(symbol)}` : `0 ${esc(symbol)}`}</span></div>
          <div class="tango-preset-grid">${renderPresetGrid('sell', runtime.settings.sellPresets)}</div>
          <div class="tango-trade-meta"><span>⌁ ${runtime.settings.fastMode ? 'FAST' : t('auto')}</span><span>♜ ${Tango.Format.sol(runtime.settings.networkFeeSol, language())}</span><button class="tango-breakeven-link" data-action="breakeven" ${breakevenPercent ? '' : 'disabled'} title="${esc(breakevenPercent ? breakevenLabel : t('breakevenUnavailable'))}">${esc(breakevenLabel)}</button><span class="safe">${t('currentMc')} ${Tango.Format.usd(current.quote.marketCapUsd, language(), true)}</span></div>
        </section>
        <div class="tango-summary-grid">
          <div class="tango-summary-item"><span>${t('paperBalance')}</span><strong>${accountMoney(runtime.state.account.cashBalanceSol)}</strong></div>
          <div class="tango-summary-item"><span>${t('totalBuy')}</span><strong>${accountMoney(totalBuy)}</strong></div>
          <div class="tango-summary-item"><span>${t('totalSell')}</span><strong>${accountMoney(totalSell)}</strong></div>
          <div class="tango-summary-item"><span>${t('totalProfit')}</span><strong class="${pnlClass(totalProfit)}">${accountMoney(totalProfit, true)}</strong></div>
        </div>
        <div class="tango-bottom-details">
          <span>${t('entryMc')} <strong>${position ? Tango.Format.usd(position.averageEntryMarketCap, language(), true) : '--'}</strong></span>
          <span>${t('currentMc')} <strong>${Tango.Format.usd(current.quote.marketCapUsd, language(), true)}</strong></span>
          <span>${t('pnl')} <strong class="${pnlClass(mark?.unrealizedPnlSol)}">${position ? Tango.Format.percent(mark.roi, language(), true) : '--'}</strong></span>
          <span>${t('pnlAmount')} <strong class="${pnlClass(totalProfit)}">${accountMoney(totalProfit, true)}</strong></span>
        </div>
        ${quoteValid ? '' : `<div class="tango-warning">${t(current?.quote?.priceUsd ? 'staleQuote' : 'invalidQuote')}</div>`}
      </div>`}
    </div>`;
  }

  function panelStyle() {
    const pos = runtime.settings.panelPosition;
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return '';
    return `left:${Math.max(0,pos.x)}px;top:${Math.max(0,pos.y)}px;right:auto;transform:none;`;
  }

  function floatingStyle(position) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return '';
    return `left:${Math.max(0, position.x)}px;top:${Math.max(0, position.y)}px;right:auto;bottom:auto;transform:none;`;
  }

  function renderDrawer() {
    if (!runtime.drawerOpen) return '';
    const positions = Object.values(runtime.state.positions || {});
    return `<div class="tango-drawer tango-card" style="${floatingStyle(runtime.settings.drawerPosition)}">
      <div class="tango-drawer-header" data-drawer-drag><div class="tango-brand"><span class="tango-dot"></span>${t('openPositions')}</div><button class="tango-icon-button" data-action="toggle-drawer">✕</button></div>
      ${positions.length ? positions.map((position) => {
        const currentMatches = runtime.current?.token?.address?.toLowerCase() === position.tokenAddress.toLowerCase();
        const hasLiveQuote = currentMatches && Tango.Engine.validateQuote(runtime.current?.quote).ok;
        const mark = Tango.Engine.markPosition(position, hasLiveQuote ? runtime.current.quote : null);
        return `<div class="tango-position">
          <div class="tango-row"><button class="tango-position-link" data-position-open data-key="${esc(Tango.Engine.positionKey(position.chain, position.tokenAddress))}" title="${t('openToken')}">${position.logoUrl ? `<img src="${esc(position.logoUrl)}" alt="">` : `<span class="tango-position-fallback">${esc(position.symbol.slice(0, 1))}</span>`}<span><strong>${esc(position.symbol)}</strong><small>${esc(position.name || position.tokenAddress.slice(0, 8))}</small></span></button><strong class="${pnlClass(mark.unrealizedPnlSol)}">${accountMoney(mark.unrealizedPnlSol, true)} · ${Tango.Format.percent(mark.roi, language(), true)}</strong></div>
          <div class="tango-position-meta"><span>${t('value')} ${accountMoney(mark.valueSol)}</span><span>${t('cost')} ${accountMoney(position.costBasisSol)}</span><span>${t('held')} ${Tango.Format.duration(Date.now()-position.openedAt, language())}</span></div>
          <div class="tango-mini-actions">
            <button class="tango-button sell-position" data-position-sell="25" data-key="${esc(Tango.Engine.positionKey(position.chain, position.tokenAddress))}">25%</button>
            <button class="tango-button sell-position" data-position-sell="50" data-key="${esc(Tango.Engine.positionKey(position.chain, position.tokenAddress))}">50%</button>
            <button class="tango-button sell-position" data-position-sell="100" data-key="${esc(Tango.Engine.positionKey(position.chain, position.tokenAddress))}">${t('close')}</button>
          </div>${hasLiveQuote ? '' : `<div class="tango-position-note">${t('lastKnownPrice')}</div>`}
        </div>`;
      }).join('') : `<div class="tango-empty">${t('noPositions')}</div>`}
    </div>`;
  }

  function chartMarkerPayload() {
    if (!runtime.current?.token) return { markers: [] };
    const address = runtime.current.token.address.toLowerCase();
    const tokenTrades = (runtime.state.trades || []).filter((trade) =>
      trade.chain === runtime.current.token.chain && trade.tokenAddress.toLowerCase() === address && Number(trade.marketCapUsd) > 0
    );
    const position = currentPosition();
    const currentPrice = Number(runtime.current.quote.priceUsd || 0);
    const currentMarketCap = Number(runtime.current.quote.marketCapUsd || 0);
    const priceAtMarketCap = (marketCap, recordedPrice = 0) => Number(recordedPrice) > 0
      ? Number(recordedPrice)
      : currentPrice > 0 && currentMarketCap > 0
        ? currentPrice * Number(marketCap) / currentMarketCap
        : 0;
    const markers = [];
    const entryMarketCap = Number(position?.averageEntryMarketCap || tokenTrades.find((trade) => trade.side === 'BUY')?.marketCapUsd || 0);
    if (entryMarketCap > 0) markers.push({
      side: 'BUY', marketCap: entryMarketCap,
      price: priceAtMarketCap(entryMarketCap, position?.averageEntryPriceUsd), label: t('paperBuy')
    });
    tokenTrades.filter((trade) => trade.side === 'SELL').slice(-4).forEach((trade) => {
      markers.push({
        side: 'SELL', marketCap: Number(trade.marketCapUsd),
        price: priceAtMarketCap(trade.marketCapUsd, trade.observedPriceUsd), label: t('paperSell')
      });
    });
    return { tokenAddress: address, currentPrice, currentMarketCap, markers };
  }

  function syncChartMarkers() {
    const frame = document.querySelector('iframe[title="Financial Chart"], [data-sentry-component="TradingView"] iframe');
    frame?.contentWindow?.postMessage({
      source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload: chartMarkerPayload()
    }, '*');
  }

  function renderModal() {
    if (!runtime.modal) return '';
    return `<div class="tango-modal-backdrop"><div class="tango-modal tango-card"><h3>${esc(runtime.modal.title)}</h3>
      <div class="tango-confirm-list">${runtime.modal.rows.map(([label,value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
      ${runtime.modal.allowSessionSuppress ? `<label class="tango-session-confirm"><input id="tango-skip-session-confirm" type="checkbox"><span>${t('skipConfirmSession')}</span></label>` : ''}
      <div class="tango-modal-actions"><button class="tango-button" data-action="cancel-modal">${t('cancel')}</button><button class="tango-button primary" data-action="confirm-modal">${t('confirm')}</button></div>
    </div></div>`;
  }

  function render() {
    if (!runtime.state || !runtime.settings) return;
    if (!runtime.settings.enabled || !runtime.state.initialized) {
      shell.innerHTML = '';
      clearHeaderAccountSummary();
      return;
    }
    const summary = Tango.Engine.portfolioSummary(runtime.state);
    renderHeaderAccountSummary(summary);
    shell.innerHTML = `${renderBar(summary)}${renderPanel()}${renderDrawer()}${renderModal()}${runtime.toast ? `<div class="tango-toast ${esc(runtime.toast.type)}">${esc(runtime.toast.message)}</div>` : ''}`;
    bindEvents();
    syncChartMarkers();
  }

  function bindEvents() {
    shell.querySelectorAll('[data-buy]').forEach((button) => button.addEventListener('click', () => buy(Number(button.dataset.buy))));
    shell.querySelectorAll('[data-sell]').forEach((button) => button.addEventListener('click', () => sell(Number(button.dataset.sell))));
    shell.querySelectorAll('[data-position-open]').forEach((button) => button.addEventListener('click', () => {
      const position = runtime.state.positions[button.dataset.key];
      if (position) openPosition(position);
    }));
    shell.querySelectorAll('[data-position-sell]').forEach((button) => button.addEventListener('click', () => {
      const position = runtime.state.positions[button.dataset.key];
      if (position) sellPosition(position, Number(button.dataset.positionSell));
    }));
    shell.querySelectorAll('[data-action]').forEach((element) => element.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = element.dataset.action;
      if (action === 'toggle-drawer') { runtime.drawerOpen = !runtime.drawerOpen; render(); }
      if (action === 'collapse-bar') { runtime.settings.barCollapsed = !runtime.settings.barCollapsed; await Tango.Store.saveSettings(runtime.settings); }
      if (action === 'collapse-panel') { runtime.settings.panelCollapsed = !runtime.settings.panelCollapsed; await Tango.Store.saveSettings(runtime.settings); }
      if (action === 'dashboard') {
        chrome.runtime.sendMessage({ type: 'TANGO_OPEN_DASHBOARD' })
          .then((response) => { if (!response?.ok) showToast(t('openDashboardFailed'), 'error'); })
          .catch(() => showToast(t('openDashboardFailed'), 'error'));
      }
      if (action === 'toggle-sound') { runtime.settings.soundEnabled = !runtime.settings.soundEnabled; await Tango.Store.saveSettings(runtime.settings); render(); }
      if (action === 'breakeven') await sellBreakeven();
      if (action === 'edit-presets') { runtime.presetEditing = 'all'; render(); }
      if (action === 'save-presets') await savePresetEdits();
      if (action === 'cancel-modal') { runtime.modal = null; render(); }
      if (action === 'confirm-modal') {
        const suppressForSession = Boolean(runtime.modal?.allowSessionSuppress && shadow.querySelector('#tango-skip-session-confirm')?.checked);
        const callback = runtime.modal?.action;
        if (callback) await callback();
        if (suppressForSession) {
          runtime.suppressConfirmForSession = true;
          await chrome.runtime.sendMessage({ type: 'TANGO_SET_SESSION_CONFIRM', suppressed: true }).catch(() => null);
        }
      }
    }));
    shell.querySelectorAll('.tango-preset-editor').forEach((input) => input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') savePresetEdits();
    }));
    bindDrag();
  }

  function bindDrag() {
    bindDraggable('[data-drag-handle]', '.tango-panel', 'panelPosition');
    bindDraggable('[data-drawer-drag]', '.tango-drawer', 'drawerPosition');
    bindDraggable('[data-bar-drag]', '.tango-bar', 'barPosition');
  }

  function bindDraggable(handleSelector, elementSelector, settingKey) {
    const handle = shadow.querySelector(handleSelector);
    const element = shadow.querySelector(elementSelector);
    if (!handle || !element) return;
    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const startX = event.clientX; const startY = event.clientY;
      const onMove = (move) => {
        runtime.settings[settingKey] = {
          x: Math.min(Math.max(0, innerWidth - rect.width), Math.max(0, rect.left + move.clientX - startX)),
          y: Math.min(Math.max(0, innerHeight - rect.height), Math.max(0, rect.top + move.clientY - startY))
        };
        element.style.left = `${runtime.settings[settingKey].x}px`;
        element.style.top = `${runtime.settings[settingKey].y}px`;
        element.style.right = 'auto'; element.style.bottom = 'auto'; element.style.transform = 'none';
      };
      const onUp = async () => {
        global.removeEventListener('pointermove', onMove); global.removeEventListener('pointerup', onUp);
        await Tango.Store.saveSettings(runtime.settings);
      };
      global.addEventListener('pointermove', onMove); global.addEventListener('pointerup', onUp);
    });
  }

  async function start() {
    const session = await chrome.runtime.sendMessage({ type: 'TANGO_GET_SESSION_CONFIRM' }).catch(() => null);
    runtime.suppressConfirmForSession = Boolean(session?.suppressed);
    await refresh();
    await tickQuote();
    runtime.quoteTimer = setInterval(tickQuote, 3000);
    runtime.routeTimer = setInterval(() => {
      if (location.href === runtime.lastUrl) return;
      runtime.lastUrl = location.href;
      tickQuote();
    }, 150);
    let mutationTimer;
    runtime.observer = new MutationObserver(() => {
      if (location.href !== runtime.lastUrl) {
        runtime.lastUrl = location.href;
        tickQuote();
      }
      if (mutationTimer) return;
      mutationTimer = setTimeout(() => {
        mutationTimer = null;
        if (runtime.settings?.enabled && runtime.state?.initialized && runtime.settings?.showListQuickBuy) Tango.GMGN.discoverTokenCards(handleQuickBuy, runtime.settings.buyPresets?.[0] || 0.1, t('paper'));
        else Tango.GMGN.clearQuickBuy();
        if (runtime.settings?.enabled && runtime.state?.initialized) renderHeaderAccountSummary(Tango.Engine.portfolioSummary(runtime.state));
        if (document.querySelector('iframe[title="Financial Chart"], [data-sentry-component="TradingView"] iframe')) syncChartMarkers();
      }, 160);
    });
    runtime.observer.observe(document.body, { childList: true, subtree: true });
    Tango.Store.subscribe(refresh);
  }

  start().catch((error) => console.error('[Tango Paper Trader]', error));
})(globalThis);
