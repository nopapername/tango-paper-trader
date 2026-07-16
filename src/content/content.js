(function initContent(global) {
  if (global.__tangoPaperTraderLoaded) return;
  global.__tangoPaperTraderLoaded = true;

  const Tango = global.Tango;
  const runtime = {
    state: null, settings: null, current: null, drawerOpen: false, modal: null,
    toast: null, lastQuoteWriteAt: 0, quoteTimer: null, observer: null, renderQueued: false,
    presetEditing: null
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

  async function refresh() {
    const data = await Tango.Store.getAll();
    runtime.state = data.state;
    runtime.settings = data.settings;
    queueRender();
  }

  function queueRender() {
    if (runtime.renderQueued) return;
    runtime.renderQueued = true;
    requestAnimationFrame(() => { runtime.renderQueued = false; render(); });
  }

  async function tickQuote() {
    const previousAddress = runtime.current?.token?.address;
    runtime.current = await Tango.GMGN.readCurrentToken();
    if (runtime.current?.quote?.priceUsd > 0 && currentPosition() && Date.now() - runtime.lastQuoteWriteAt > 10_000) {
      runtime.state = Tango.Engine.updatePositionQuote(runtime.state, runtime.current.token, runtime.current.quote);
      runtime.lastQuoteWriteAt = Date.now();
      await Tango.Store.saveState(runtime.state);
    }
    if (runtime.settings?.showListQuickBuy) Tango.GMGN.discoverTokenCards(handleQuickBuy);
    if (previousAddress !== runtime.current?.token?.address || runtime.current) queueRender();
  }

  async function handleQuickBuy(context) {
    if (context.token.chain !== 'sol') return showToast('GMGN Solana only in V1', 'error');
    if (!(context.quote.solPriceUsd > 0)) {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'TANGO_GET_SOL_PRICE' });
        context.quote.solPriceUsd = Number(response?.price || 1);
      } catch { context.quote.solPriceUsd = 0; }
    }
    await buy(context.amountSol, context);
  }

  async function buy(amountSol, context = runtime.current) {
    if (!runtime.state.initialized) return showToast(t('startPaperTrading'), 'error');
    const order = {
      token: context?.token,
      quote: context?.quote,
      amountSol: Number(amountSol),
      sourceUrl: context?.sourceUrl || location.href
    };
    try {
      previewBuy(order);
      if (!runtime.settings.fastMode && runtime.settings.confirmationEnabled) return;
      await commitBuy(order);
    } catch (error) { showToast(t(error.message), 'error'); }
  }

  function previewBuy(order) {
    const validation = Tango.Engine.validateQuote(order.quote);
    if (!validation.ok) throw new Error(validation.reason);
    if (!(order.amountSol > 0)) throw new Error('invalidAmount');
    if (order.amountSol > runtime.state.account.cashBalanceSol) throw new Error('insufficientBalance');
    if (runtime.settings.fastMode || !runtime.settings.confirmationEnabled) return;
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
      showToast(`${t('tradeFilled')}: ${Tango.Format.sol(order.amountSol, language())} ${order.token.symbol}`, 'success');
    } catch (error) { runtime.modal = null; showToast(t(error.message), 'error'); }
  }

  async function sell(percent, context = runtime.current) {
    const order = { token: context?.token, quote: context?.quote, percent: Number(percent), sourceUrl: location.href };
    try {
      const key = Tango.Engine.positionKey(order.token?.chain, order.token?.address);
      if (!runtime.state.positions[key]) throw new Error('noPosition');
      const validation = Tango.Engine.validateQuote(order.quote);
      if (!validation.ok) throw new Error(validation.reason);
      if (!runtime.settings.fastMode && runtime.settings.confirmationEnabled) {
        runtime.modal = {
          type: 'confirm', title: t('simulatedSell'),
          rows: [[t('token'), order.token.symbol], [t('amount'), `${percent}%`], [t('observedPrice'), Tango.Format.usd(order.quote.priceUsd, language())]],
          action: () => commitSell(order)
        };
        return render();
      }
      await commitSell(order);
    } catch (error) { showToast(t(error.message), 'error'); }
  }

  async function sellPosition(position, percent) {
    const quote = {
      priceUsd: position.lastPriceUsd, marketCapUsd: position.lastMarketCapUsd,
      solPriceUsd: position.lastSolPriceUsd, observedAt: position.quoteObservedAt
    };
    await sell(percent, { token: { chain: position.chain, address: position.tokenAddress, symbol: position.symbol }, quote });
  }

  async function commitSell(order) {
    try {
      const result = Tango.Engine.executeSell(runtime.state, order, runtime.settings);
      runtime.state = result.state;
      runtime.modal = null;
      await Tango.Store.saveState(runtime.state);
      showToast(`${t('tradeFilled')}: ${order.percent}% ${order.token.symbol}`, 'success');
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

  function renderBar(summary) {
    const collapsed = runtime.settings.barCollapsed;
    return `<div class="tango-bar tango-card ${esc(runtime.settings.pnlBarPosition)}" data-action="toggle-drawer">
      ${collapsed ? `<strong class="${pnlClass(summary.totalPnlSol)}">${accountMoney(summary.totalPnlSol, true)}</strong>` : `
        <div class="tango-stat"><strong>${accountMoney(summary.equitySol)}</strong><span>${t('balance')}</span></div>
        <div class="tango-bar-divider"></div>
        <div class="tango-stat"><strong class="${pnlClass(summary.totalPnlSol)}">${accountMoney(summary.totalPnlSol, true)}</strong><span>${t('pnl')}</span></div>`}
      <button class="tango-icon-button" data-action="collapse-bar">${collapsed ? '＋' : '－'}</button>
    </div>`;
  }

  function renderOnboarding() {
    return `<div class="tango-onboarding">
      <div class="tango-brand" style="justify-content:center"><span class="tango-dot"></span>TANGO <span class="tango-paper-badge">${t('paper')}</span></div>
      <h2>${t('welcome')}</h2><p>${t('paperOnly')}</p>
      <div class="tango-balance-options">
        ${[10,50,100].map((value) => `<button class="tango-button" data-init-balance="${value}">${value} SOL</button>`).join('')}
      </div>
      <div class="tango-language">
        <button class="tango-button" data-init-language="zh-CN">简体中文</button>
        <button class="tango-button" data-init-language="en">English</button>
      </div>
      <button class="tango-button primary" data-action="initialize">${t('startPaperTrading')}</button>
    </div>`;
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
    if (!runtime.state.initialized) return `<div class="tango-panel tango-card"><div class="tango-trade-body">${renderOnboarding()}</div></div>`;
    const current = runtime.current;
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
        <div class="tango-header-actions"><button class="tango-icon-button tango-edit-all" data-action="${runtime.presetEditing === 'all' ? 'save-presets' : 'edit-presets'}" title="${t(runtime.presetEditing === 'all' ? 'savePresets' : 'editPresets')}">${runtime.presetEditing === 'all' ? '✓' : '✎'}</button><button class="tango-icon-button" data-action="dashboard">⚙</button><button class="tango-icon-button" data-action="collapse-panel">${runtime.settings.panelCollapsed ? '＋' : '×'}</button></div>
      </div>
      ${runtime.settings.panelCollapsed ? '' : current ? `<div class="tango-trade-body">
        <section class="tango-trade-block">
          <div class="tango-trade-title buy-title"><span>${t('buy')}</span><span class="tango-mode-tab active buy-tab">P1</span><span class="tango-mode-tab">P2</span><span class="tango-mode-tab">P3</span><span class="tango-title-balance">◎ ${Tango.Format.number(runtime.state.account.cashBalanceSol, language(), 4)}</span></div>
          <div class="tango-preset-grid">${renderPresetGrid('buy', runtime.settings.buyPresets)}</div>
          <div class="tango-trade-meta"><span>⌁ ${Tango.Format.percent(runtime.settings.slippageBps / 100, language())}</span><span>♜ ${Tango.Format.sol(runtime.settings.networkFeeSol, language())}</span><span>♙ ${feePercent}%</span><span class="safe">${t('entryMc')} ${position ? Tango.Format.usd(position.averageEntryMarketCap, language(), true) : '--'}</span></div>
        </section>
        <section class="tango-trade-block">
          <div class="tango-trade-title sell-title"><span>${t('sell')} %</span><span class="tango-mode-tab active sell-tab">P1</span><span class="tango-mode-tab">P2</span><span class="tango-mode-tab">P3</span><span class="tango-title-balance">${position ? `${Tango.Format.compact(position.quantity, language(), 2)} ${esc(symbol)}` : `0 ${esc(symbol)}`}</span></div>
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
      </div>` : `<div class="tango-empty">${t('gmgnOnly')}</div>`}
    </div>`;
  }

  function panelStyle() {
    const pos = runtime.settings.panelPosition;
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return '';
    return `left:${Math.max(0,pos.x)}px;top:${Math.max(0,pos.y)}px;right:auto;transform:none;`;
  }

  function renderDrawer() {
    if (!runtime.drawerOpen) return '';
    const positions = Object.values(runtime.state.positions || {});
    return `<div class="tango-drawer tango-card">
      <div class="tango-row"><div class="tango-brand"><span class="tango-dot"></span>${t('openPositions')}</div><button class="tango-icon-button" data-action="toggle-drawer">✕</button></div>
      ${positions.length ? positions.map((position) => {
        const mark = Tango.Engine.markPosition(position);
        const stale = Date.now() - Number(position.quoteObservedAt || 0) > Tango.QUOTE_STALE_MS;
        return `<div class="tango-position">
          <div class="tango-row"><span class="tango-position-title">${esc(position.symbol)}</span><strong class="${pnlClass(mark.unrealizedPnlSol)}">${accountMoney(mark.unrealizedPnlSol, true)} · ${Tango.Format.percent(mark.roi, language(), true)}</strong></div>
          <div class="tango-position-meta"><span>${t('value')} ${accountMoney(mark.valueSol)}</span><span>${t('cost')} ${accountMoney(position.costBasisSol)}</span><span>${t('held')} ${Tango.Format.duration(Date.now()-position.openedAt, language())}</span></div>
          <div class="tango-mini-actions">
            <button class="tango-button" data-position-sell="25" data-key="${esc(Tango.Engine.positionKey(position.chain, position.tokenAddress))}" ${stale ? 'disabled' : ''}>25%</button>
            <button class="tango-button" data-position-sell="50" data-key="${esc(Tango.Engine.positionKey(position.chain, position.tokenAddress))}" ${stale ? 'disabled' : ''}>50%</button>
            <button class="tango-button" data-position-sell="100" data-key="${esc(Tango.Engine.positionKey(position.chain, position.tokenAddress))}" ${stale ? 'disabled' : ''}>${t('close')}</button>
          </div>${stale ? `<div class="tango-warning">${t('staleQuote')}</div>` : ''}
        </div>`;
      }).join('') : `<div class="tango-empty">${t('noPositions')}</div>`}
    </div>`;
  }

  function renderModal() {
    if (!runtime.modal) return '';
    return `<div class="tango-modal-backdrop"><div class="tango-modal tango-card"><h3>${esc(runtime.modal.title)}</h3>
      <div class="tango-confirm-list">${runtime.modal.rows.map(([label,value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
      <div class="tango-modal-actions"><button class="tango-button" data-action="cancel-modal">${t('cancel')}</button><button class="tango-button primary" data-action="confirm-modal">${t('confirm')}</button></div>
    </div></div>`;
  }

  function render() {
    if (!runtime.state || !runtime.settings) return;
    const summary = Tango.Engine.portfolioSummary(runtime.state);
    shell.innerHTML = `${renderBar(summary)}${renderPanel()}${renderDrawer()}${renderModal()}${runtime.toast ? `<div class="tango-toast ${esc(runtime.toast.type)}">${esc(runtime.toast.message)}</div>` : ''}`;
    bindEvents();
  }

  function bindEvents() {
    shell.querySelectorAll('[data-buy]').forEach((button) => button.addEventListener('click', () => buy(Number(button.dataset.buy))));
    shell.querySelectorAll('[data-sell]').forEach((button) => button.addEventListener('click', () => sell(Number(button.dataset.sell))));
    shell.querySelectorAll('[data-position-sell]').forEach((button) => button.addEventListener('click', () => {
      const position = runtime.state.positions[button.dataset.key];
      if (position) sellPosition(position, Number(button.dataset.positionSell));
    }));
    shell.querySelectorAll('[data-init-balance]').forEach((button) => button.addEventListener('click', () => {
      shell.querySelectorAll('[data-init-balance]').forEach((item) => item.dataset.selected = '0');
      button.dataset.selected = '1';
      runtime.pendingBalance = Number(button.dataset.initBalance);
    }));
    shell.querySelectorAll('[data-init-language]').forEach((button) => button.addEventListener('click', () => {
      runtime.pendingLanguage = button.dataset.initLanguage;
      runtime.settings.language = runtime.pendingLanguage;
      render();
    }));
    shell.querySelectorAll('[data-action]').forEach((element) => element.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = element.dataset.action;
      if (action === 'toggle-drawer') { runtime.drawerOpen = !runtime.drawerOpen; render(); }
      if (action === 'collapse-bar') { runtime.settings.barCollapsed = !runtime.settings.barCollapsed; await Tango.Store.saveSettings(runtime.settings); }
      if (action === 'collapse-panel') { runtime.settings.panelCollapsed = !runtime.settings.panelCollapsed; await Tango.Store.saveSettings(runtime.settings); }
      if (action === 'dashboard') chrome.runtime.openOptionsPage();
      if (action === 'breakeven') await sellBreakeven();
      if (action === 'edit-presets') { runtime.presetEditing = 'all'; render(); }
      if (action === 'save-presets') await savePresetEdits();
      if (action === 'cancel-modal') { runtime.modal = null; render(); }
      if (action === 'confirm-modal') { const callback = runtime.modal?.action; if (callback) await callback(); }
      if (action === 'initialize') {
        const data = await Tango.Store.initialize(runtime.pendingBalance || 100, runtime.pendingLanguage || runtime.settings.language);
        runtime.state = data.state; runtime.settings = data.settings; render();
      }
    }));
    shell.querySelectorAll('.tango-preset-editor').forEach((input) => input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') savePresetEdits();
    }));
    bindDrag();
  }

  function bindDrag() {
    const handle = shadow.querySelector('[data-drag-handle]');
    const panel = shadow.querySelector('.tango-panel');
    if (!handle || !panel) return;
    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      const startX = event.clientX; const startY = event.clientY;
      const onMove = (move) => {
        runtime.settings.panelPosition = {
          x: Math.min(innerWidth - rect.width, Math.max(0, rect.left + move.clientX - startX)),
          y: Math.min(innerHeight - rect.height, Math.max(0, rect.top + move.clientY - startY))
        };
        panel.style.left = `${runtime.settings.panelPosition.x}px`;
        panel.style.top = `${runtime.settings.panelPosition.y}px`;
        panel.style.right = 'auto'; panel.style.transform = 'none';
      };
      const onUp = async () => {
        global.removeEventListener('pointermove', onMove); global.removeEventListener('pointerup', onUp);
        await Tango.Store.saveSettings(runtime.settings);
      };
      global.addEventListener('pointermove', onMove); global.addEventListener('pointerup', onUp);
    });
  }

  async function start() {
    await refresh();
    await tickQuote();
    runtime.quoteTimer = setInterval(tickQuote, 3000);
    let mutationTimer;
    runtime.observer = new MutationObserver(() => {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        if (runtime.settings?.showListQuickBuy) Tango.GMGN.discoverTokenCards(handleQuickBuy);
      }, 500);
    });
    runtime.observer.observe(document.body, { childList: true, subtree: true });
    Tango.Store.subscribe(refresh);
  }

  start().catch((error) => console.error('[Tango Paper Trader]', error));
})(globalThis);
