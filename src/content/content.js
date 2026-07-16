(function initContent(global) {
  if (global.__tangoPaperTraderLoaded) return;
  global.__tangoPaperTraderLoaded = true;

  const Tango = global.Tango;
  const runtime = {
    state: null, settings: null, current: null, drawerOpen: false, modal: null,
    toast: null, lastQuoteWriteAt: 0, quoteTimer: null, observer: null, renderQueued: false,
    presetEditing: null, suppressConfirmForSession: false, audioContext: null
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
    if (runtime.current?.quote?.priceUsd > 0 && currentPosition() && Date.now() - runtime.lastQuoteWriteAt > 10_000) {
      runtime.state = Tango.Engine.updatePositionQuote(runtime.state, runtime.current.token, runtime.current.quote);
      runtime.lastQuoteWriteAt = Date.now();
      await Tango.Store.saveState(runtime.state);
    }
    if (runtime.settings?.showListQuickBuy) Tango.GMGN.discoverTokenCards(handleQuickBuy, runtime.settings.buyPresets?.[0] || 0.1);
    else Tango.GMGN.clearQuickBuy();
    if (previousAddress !== runtime.current?.token?.address || runtime.current) queueRender();
  }

  async function handleQuickBuy(context) {
    if (!runtime.settings?.enabled) return;
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
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return null;
      if (!runtime.audioContext || runtime.audioContext.state === 'closed') runtime.audioContext = new AudioContext();
      if (runtime.audioContext.state === 'suspended') runtime.audioContext.resume().catch(() => {});
      return runtime.audioContext;
    } catch { return null; }
  }

  function playTradeSound(side) {
    const context = primeTradeAudio();
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
    return `<div class="tango-bar tango-card ${esc(runtime.settings.pnlBarPosition)}" data-action="toggle-drawer">
      ${collapsed ? `<strong class="${pnlClass(summary.totalPnlSol)}">${accountMoney(summary.totalPnlSol, true)}</strong>` : `
        <div class="tango-stat"><strong>${accountMoney(summary.equitySol)}</strong><span>${t('balance')}</span></div>
        <div class="tango-bar-divider"></div>
        <div class="tango-stat"><strong class="${pnlClass(summary.totalPnlSol)}">${accountMoney(summary.totalPnlSol, true)}</strong><span>${t('pnl')}</span></div>`}
      <button class="tango-icon-button" data-action="collapse-bar">${collapsed ? '＋' : '－'}</button>
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
    if (!runtime.state.initialized || !runtime.settings.enabled) return '';
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
        <div class="tango-header-actions"><button class="tango-icon-button tango-edit-all" data-action="${runtime.presetEditing === 'all' ? 'save-presets' : 'edit-presets'}" title="${t(runtime.presetEditing === 'all' ? 'savePresets' : 'editPresets')}">${runtime.presetEditing === 'all' ? '✓' : '✎'}</button><button class="tango-icon-button" data-action="toggle-sound" title="${t('sound')}">${runtime.settings.soundEnabled ? '🔊' : '🔇'}</button><button class="tango-icon-button" data-action="dashboard">⚙</button><button class="tango-icon-button" data-action="collapse-panel">${runtime.settings.panelCollapsed ? '＋' : '×'}</button></div>
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
      ${runtime.modal.allowSessionSuppress ? `<label class="tango-session-confirm"><input id="tango-skip-session-confirm" type="checkbox"><span>${t('skipConfirmSession')}</span></label>` : ''}
      <div class="tango-modal-actions"><button class="tango-button" data-action="cancel-modal">${t('cancel')}</button><button class="tango-button primary" data-action="confirm-modal">${t('confirm')}</button></div>
    </div></div>`;
  }

  function render() {
    if (!runtime.state || !runtime.settings) return;
    if (!runtime.settings.enabled || !runtime.state.initialized) {
      shell.innerHTML = '';
      return;
    }
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
    shell.querySelectorAll('[data-action]').forEach((element) => element.addEventListener('click', async (event) => {
      event.stopPropagation();
      const action = element.dataset.action;
      if (action === 'toggle-drawer') { runtime.drawerOpen = !runtime.drawerOpen; render(); }
      if (action === 'collapse-bar') { runtime.settings.barCollapsed = !runtime.settings.barCollapsed; await Tango.Store.saveSettings(runtime.settings); }
      if (action === 'collapse-panel') { runtime.settings.panelCollapsed = !runtime.settings.panelCollapsed; await Tango.Store.saveSettings(runtime.settings); }
      if (action === 'dashboard') chrome.runtime.openOptionsPage();
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
    const session = await chrome.runtime.sendMessage({ type: 'TANGO_GET_SESSION_CONFIRM' }).catch(() => null);
    runtime.suppressConfirmForSession = Boolean(session?.suppressed);
    await refresh();
    await tickQuote();
    runtime.quoteTimer = setInterval(tickQuote, 3000);
    let mutationTimer;
    runtime.observer = new MutationObserver(() => {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        if (runtime.settings?.enabled && runtime.state?.initialized && runtime.settings?.showListQuickBuy) Tango.GMGN.discoverTokenCards(handleQuickBuy, runtime.settings.buyPresets?.[0] || 0.1);
        else Tango.GMGN.clearQuickBuy();
      }, 500);
    });
    runtime.observer.observe(document.body, { childList: true, subtree: true });
    Tango.Store.subscribe(refresh);
  }

  start().catch((error) => console.error('[Tango Paper Trader]', error));
})(globalThis);
