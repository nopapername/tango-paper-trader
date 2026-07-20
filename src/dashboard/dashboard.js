(function initDashboard(global) {
  const Tango = global.Tango;
  const app = document.querySelector('#app');
  const fileInput = document.querySelector('#import-file');
  const tabs = ['overview', 'positions', 'history', 'calendar', 'settings'];
  const initialTab = tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  const requestedChain = Tango.Chains.get(new URLSearchParams(location.search || '').get('chain'))?.id || '';
  const runtime = {
    state: null,
    settings: null,
    selectedChain: requestedChain || 'sol',
    startupChain: requestedChain,
    startupChainApplied: false,
    selectedChainRevision: 0,
    settingsWrite: Promise.resolve(),
    selectionPending: null,
    nativePrices: {},
    nativePriceObservedAt: {},
    nativePricesRequested: false,
    tab: initialTab,
    month: new Date(),
    filters: { search: '', side: 'ALL', result: 'ALL', date: '' },
    toast: '',
    loadError: ''
  };

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
  const lang = () => Tango.I18n.resolveLanguage(runtime.settings?.language);
  const t = (key) => Tango.I18n.t(key, runtime.settings?.language);
  const label = (english, chinese) => lang() === 'zh-CN' ? chinese : english;
  const cls = (value) => Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : 'flat';
  const native = (value, model, signed = false) => Tango.Format.native(value, model.chain.nativeSymbol, lang(), signed);
  const model = () => Tango.DashboardModel.build(
    runtime.state, runtime.settings, runtime.selectedChain, runtime.nativePrices, runtime.filters
  );

  async function load() {
    try {
      const data = await Tango.Store.getAll();
      runtime.state = data.state;
      const startupChain = !runtime.startupChainApplied ? runtime.startupChain : '';
      runtime.settings = startupChain ? { ...data.settings, selectedChain: startupChain } : data.settings;
      runtime.loadError = '';
      const hasSelectionIntent = runtime.selectionPending?.revision === runtime.selectedChainRevision;
      if (!hasSelectionIntent) runtime.selectedChain = startupChain
        || Tango.Chains.get(data.settings.selectedChain)?.id || 'sol';
      runtime.startupChainApplied = true;
      render();
      if (!runtime.nativePricesRequested && runtime.state.initialized) {
        runtime.nativePricesRequested = true;
        refreshNativePrices();
      }
      return data;
    } catch {
      runtime.loadError = 'storageLoadFailed';
      render();
      return null;
    }
  }

  async function refreshNativePrices() {
    const observations = await Promise.all(Tango.Chains.all().map(async (chain) => {
      try {
        const observation = await global.chrome?.runtime?.sendMessage({ type: 'TANGO_GET_NATIVE_PRICE', chain: chain.id });
        return [chain.id, observation?.ok && Number(observation.price) > 0 ? observation : null];
      } catch {
        return [chain.id, null];
      }
    }));
    runtime.nativePrices = Object.fromEntries(observations.map(([chain, observation]) => [chain, Number(observation?.price || 0)]));
    runtime.nativePriceObservedAt = Object.fromEntries(observations.map(([chain, observation]) => [chain, Number(observation?.observedAt || 0)]));
    if (runtime.state && runtime.settings) render();
  }

  function queueSettingsMutation(patch, selectionRevision = 0) {
    const write = runtime.settingsWrite.then(async () => {
      if (selectionRevision && selectionRevision !== runtime.selectedChainRevision) return runtime.settings;
      const saved = await Tango.Store.patchSettings(patch);
      runtime.settings = saved;
      const currentSelection = !selectionRevision || selectionRevision === runtime.selectedChainRevision;
      if (currentSelection && saved.selectedChain === runtime.selectedChain) {
        render();
      }
      return saved;
    });
    runtime.settingsWrite = write.catch(() => undefined);
    return write;
  }

  function saveSelectedChain(chainId) {
    const selected = Tango.Chains.get(chainId);
    if (!selected) return Promise.resolve(runtime.settings);
    const revision = ++runtime.selectedChainRevision;
    runtime.selectedChain = selected.id;
    render();
    const promise = queueSettingsMutation({ selectedChain: selected.id }, revision).catch(() => {
      if (revision === runtime.selectedChainRevision) {
        runtime.selectedChain = Tango.Chains.get(runtime.settings?.selectedChain)?.id || 'sol';
        showToast(t('settingsSaveFailed'));
      }
      return runtime.settings;
    });
    const pending = { chainId: selected.id, revision, promise };
    runtime.selectionPending = pending;
    const clearPending = () => {
      if (runtime.selectionPending === pending) runtime.selectionPending = null;
    };
    promise.then(clearPending, clearPending);
    return promise;
  }

  async function selectedModel(chainId = runtime.selectedChain) {
    const pending = runtime.selectionPending;
    if (pending?.chainId === chainId) await pending.promise;
    await runtime.settingsWrite;
    if (runtime.selectedChain !== chainId || runtime.settings?.selectedChain !== chainId) return null;
    const view = model();
    return view.chain.id === chainId ? view : null;
  }

  function render() {
    document.documentElement.lang = lang();
    document.documentElement.dataset.theme = runtime.settings?.theme === 'light' ? 'light' : 'dark';
    if (runtime.loadError) return renderStorageError();
    if (!runtime.state?.initialized) return renderSetupRequired();
    const view = model();
    const titles = {
      overview: t('overview'), positions: t('positions'), history: t('tradeHistory'),
      calendar: t('calendar'), settings: t('settings')
    };
    const chainOptions = Tango.Chains.all().map((chain) => (
      `<option value="${chain.id}" ${chain.id === view.chain.id ? 'selected' : ''}>${esc(chain.name)} (${esc(chain.nativeSymbol)})</option>`
    )).join('');
    app.innerHTML = `<div class="app"><aside class="sidebar">
      <div class="brand"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div>
      <nav class="nav">${Object.entries(titles).map(([id, title]) => `<button data-tab="${id}" class="${runtime.tab === id ? 'active' : ''}">${title}</button>`).join('')}</nav>
      <div class="sidebar-bottom">Tango Paper Trader v${Tango.VERSION}<br>${t('paperOnly')}</div>
    </aside><main class="main"><div class="topbar"><div><h1>${titles[runtime.tab]}</h1><p>${t('welcome')}</p></div>
      <div class="topbar-actions"><label class="chain-select"><span>${label('Selected chain', '已选链')}</span><select id="dashboard-chain">${chainOptions}</select></label>
      <button class="button primary" data-action="open-gmgn">GMGN ↗</button></div></div>
      ${renderTab(view)}
    </main></div>${runtime.toast ? `<div class="toast">${esc(runtime.toast)}</div>` : ''}`;
    bind();
  }

  function renderStorageError() {
    app.innerHTML = `<div class="onboarding-page"><section class="onboarding card">
      <div class="brand" style="justify-content:center;padding:0"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div>
      <h1>${t('storageLoadFailed')}</h1><p>${t('storageLoadFailedHint')}</p>
      <button class="button primary" id="retry-storage-load">${t('retry')}</button>
    </section></div>`;
    app.querySelector('#retry-storage-load')?.addEventListener('click', () => load());
  }

  function renderSetupRequired() {
    app.innerHTML = `<div class="onboarding-page"><section class="onboarding card">
      <div class="brand" style="justify-content:center;padding:0"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div>
      <h1>${t('setup')}</h1><p>${t('setupInPopup')}</p>
    </section></div>`;
  }

  function renderTab(view) {
    if (runtime.tab === 'positions') return positionsPanel(view);
    if (runtime.tab === 'history') return historyPanel(view);
    if (runtime.tab === 'calendar') return calendarPanel(view);
    if (runtime.tab === 'settings') return settingsPanel(view);
    return overviewPanel(view);
  }

  function overviewPanel(view) {
    const summary = view.summary;
    const stats = [
      [t('equity'), native(summary.equityNative, view), ''],
      [t('totalPnl'), native(summary.totalPnlNative, view, true), cls(summary.totalPnlNative)],
      [t('realizedPnl'), native(summary.realizedPnlNative, view, true), cls(summary.realizedPnlNative)],
      [t('unrealizedPnl'), native(summary.unrealizedPnlNative, view, true), cls(summary.unrealizedPnlNative)],
      [t('balance'), native(summary.cashBalanceNative, view), ''],
      [t('positions'), String(summary.positionCount), ''],
      [t('totalTrades'), String(summary.totalTrades), ''],
      [t('winRate'), Tango.Format.percent(summary.winRate, lang()), cls(summary.winRate)],
      [t('profitFactor'), Number.isFinite(summary.profitFactor) ? Tango.Format.number(summary.profitFactor, lang(), 2) : '∞', cls(summary.profitFactor)]
    ];
    const accounts = view.accounts.map(({ chain, summary: account, nativePriceUsd, usdSummary }) => `<button class="chain-account card ${chain.id === view.chain.id ? 'active' : ''}" data-account-chain="${chain.id}">
      <span>${esc(chain.name)} · ${esc(chain.nativeSymbol)}</span>
      <strong>${Tango.Format.native(account.equityNative, chain.nativeSymbol, lang())}</strong>
      <small>${nativePriceUsd > 0 && usdSummary ? Tango.Format.usd(usdSummary.assetsUsd, lang()) : t('partialUsdData')}</small>
    </button>`).join('');
    return `<section class="global-overview"><div class="global-usd-summary">
      <div class="stat card"><span>${label('All-chain total USD assets', '全链美元资产总额')}</span><strong>${Tango.Format.usd(view.globalUsd.assetsUsd, lang())}</strong></div>
      <div class="stat card"><span>${label('All-chain paper PnL', '全链模拟盈亏')}</span><strong class="${cls(view.globalUsd.pnlUsd)}">${Tango.Format.usd(view.globalUsd.pnlUsd, lang())}</strong></div>
    </div>${view.globalUsd.complete ? '' : `<p class="partial-data">${t('partialUsdData')}</p>`}
    <div class="chain-account-grid">${accounts}</div></section>
    <div class="stats">${stats.map(([title, value, className]) => `<div class="stat card"><span>${title} · ${esc(view.chain.nativeSymbol)}</span><strong class="${className}">${value}</strong></div>`).join('')}</div>
    ${positionsPanel(view, true)}${historyPanel(view, true)}`;
  }

  function positionsPanel(view, compact = false) {
    const rows = view.positions.map((position) => {
      const mark = Tango.Engine.markPosition(position, undefined, view.nativePriceUsd);
      return `<tr><td class="token-cell">${esc(position.symbol || position.tokenAddress)}</td><td>${esc(view.chain.name)}</td><td>${native(position.costBasisNative, view)}</td>
        <td>${native(mark.valueNative, view)}</td><td class="${cls(mark.unrealizedPnlNative)}">${native(mark.unrealizedPnlNative, view, true)} (${Tango.Format.percent(mark.roi, lang(), true)})</td>
        <td>${Tango.Format.usd(position.averageEntryMarketCap, lang(), true)}</td><td>${Tango.Format.usd(position.lastMarketCapUsd, lang(), true)}</td><td>${Tango.Format.duration(Date.now() - position.openedAt, lang())}</td></tr>`;
    }).join('');
    return `<section class="panel card"><div class="panel-header"><h2>${t('positions')} · ${esc(view.chain.name)}</h2>${compact ? `<button class="button" data-tab="positions">${t('positions')} →</button>` : ''}</div>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>${t('token')}</th><th>Chain</th><th>${t('cost')}</th><th>${t('value')}</th><th>${t('pnl')}</th><th>${t('entryMc')}</th><th>${t('currentMc')}</th><th>${t('held')}</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${t('noPositions')}</div>`}</section>`;
  }

  function historyResults(view, compact = false) {
    const trades = view.trades.slice(0, compact ? 8 : 500);
    const valuation = (trade) => Tango.DashboardModel.hasDerivedMarketCapPrice(trade)
      ? `${t('marketCap')} · ${Tango.Format.usd(trade.marketCapUsd, lang(), true)}`
      : Tango.Format.usd(trade.executionPriceUsd, lang());
    const rows = trades.map((trade) => `<tr><td>${new Date(trade.executedAt).toLocaleString(lang())}</td><td class="token-cell">${esc(trade.symbol || trade.tokenAddress)}</td>
      <td class="${trade.side === 'BUY' ? 'up' : 'down'}">${trade.side}</td><td>${native(trade.amountNative, view)}</td><td>${valuation(trade)}</td>
      <td>${Tango.Format.usd(trade.marketCapUsd, lang(), true)}</td><td class="${cls(trade.realizedPnlNative)}">${trade.side === 'SELL' ? native(trade.realizedPnlNative, view, true) : '—'}</td>
      <td>${trade.side === 'SELL' ? `<button class="button" data-share="${esc(trade.id)}">PNG</button> <button class="button" data-copy-share="${esc(trade.id)}">${t('copyImage')}</button>` : ''}</td></tr>`).join('');
    return rows ? `<div class="table-wrap"><table><thead><tr><th>${t('date')}</th><th>${t('token')}</th><th>${t('side')}</th><th>${t('amount')} · ${esc(view.chain.nativeSymbol)}</th><th>${t('executionPrice')}</th><th>${t('marketCap')}</th><th>${t('realizedPnl')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${t('noTrades')}</div>`;
  }

  function historyPanel(view, compact = false) {
    return `<section class="panel card"><div class="panel-header"><h2>${t('tradeHistory')} · ${esc(view.chain.name)}</h2><div class="actions">
      ${compact ? `<button class="button" data-tab="history">${t('history')} →</button>` : `<button class="button" data-action="export-csv">${t('exportCsv')}</button><button class="button" data-action="export-json">${t('exportJson')}</button>`}</div></div>
      ${compact ? '' : `<div class="filters"><input class="input" id="trade-search" value="${esc(runtime.filters.search)}" placeholder="${t('token')} / CA"><input class="input" id="trade-date" type="date" value="${esc(runtime.filters.date)}"><select class="select" id="trade-side"><option value="ALL">ALL</option><option value="BUY" ${runtime.filters.side === 'BUY' ? 'selected' : ''}>BUY</option><option value="SELL" ${runtime.filters.side === 'SELL' ? 'selected' : ''}>SELL</option></select><select class="select" id="trade-result"><option value="ALL">ALL PnL</option><option value="WIN" ${runtime.filters.result === 'WIN' ? 'selected' : ''}>WIN</option><option value="LOSS" ${runtime.filters.result === 'LOSS' ? 'selected' : ''}>LOSS</option></select></div>`}
      ${compact ? historyResults(view, true) : `<div id="history-results">${historyResults(view)}</div>`}</section>`;
  }

  function calendarPanel(view) {
    const date = runtime.month;
    const year = date.getFullYear();
    const month = date.getMonth();
    const calendar = Tango.DashboardModel.calendar(runtime.state, view.chain.id, year, month);
    const firstDay = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    const offset = (firstDay.getDay() + 6) % 7;
    const labels = lang() === 'zh-CN' ? ['一', '二', '三', '四', '五', '六', '日'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const cells = Array.from({ length: offset }, () => '<div class="calendar-day empty-day"></div>');
    for (let day = 1; day <= days; day += 1) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const pnl = Number(calendar.days[key]?.native || 0);
      cells.push(`<button class="calendar-day ${pnl > 0 ? 'win' : pnl < 0 ? 'loss' : ''}" data-calendar-date="${key}"><span class="day">${day}</span><strong class="day-pnl ${cls(pnl)}">${pnl ? native(pnl, view, true) : '—'}</strong></button>`);
    }
    return `<div class="stats"><div class="stat card"><span>${t('totalPnl')} · ${esc(view.chain.nativeSymbol)}</span><strong class="${cls(calendar.totalNative)}">${native(calendar.totalNative, view, true)}</strong></div><div class="stat card"><span>${t('totalTrades')}</span><strong>${calendar.trades.length}</strong></div><div class="stat card"><span>${t('winRate')}</span><strong>${Tango.Format.percent(calendar.winRate, lang())}</strong></div><div class="stat card"><span>Best / Worst · ${esc(view.chain.nativeSymbol)}</span><strong>${native(calendar.bestNative, view, true)} / ${native(calendar.worstNative, view, true)}</strong></div></div>
      <section class="panel card"><div class="calendar-head"><button class="button" data-month="-1">←</button><h2>${date.toLocaleDateString(lang(), { month: 'long', year: 'numeric' })} · ${esc(view.chain.name)}</h2><button class="button" data-month="1">→</button></div>
      <div class="calendar-grid">${labels.map((dayLabel) => `<div class="calendar-label">${dayLabel}</div>`).join('')}${cells.join('')}</div></section>`;
  }

  function settingsPanel(view) {
    const settings = runtime.settings;
    const chainSettings = view.chainSettings;
    return `<section class="panel card"><div class="settings-section"><h3>${t('settings')} · ${esc(view.chain.name)}</h3><div class="settings-grid">
      <div class="field"><label>${t('language')}</label><select class="select" id="setting-language"><option value="auto" ${settings.language === 'auto' ? 'selected' : ''}>${t('auto')}</option><option value="zh-CN" ${settings.language === 'zh-CN' ? 'selected' : ''}>简体中文</option><option value="en" ${settings.language === 'en' ? 'selected' : ''}>English</option></select></div>
      <div class="field"><label>${t('displayCurrency')}</label><select class="select" id="setting-currency"><option value="NATIVE" ${settings.displayCurrency === 'NATIVE' || settings.displayCurrency === 'SOL' ? 'selected' : ''}>Native</option><option value="USD" ${settings.displayCurrency === 'USD' ? 'selected' : ''}>USD</option></select></div>
      <div class="field"><label>Theme</label><select class="select" id="setting-theme"><option value="dark" ${settings.theme === 'dark' || settings.theme === 'auto' ? 'selected' : ''}>Dark</option><option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light</option></select></div>
      <div class="field"><label>${label('Buy presets', '买入预设')} · ${esc(view.chain.nativeSymbol)}</label><input class="input" id="setting-buy-presets" value="${esc((chainSettings.buyPresets || []).join(', '))}"></div>
      <div class="field"><label>${t('startingBalance')} · ${esc(view.chain.nativeSymbol)}</label><input class="input" id="setting-initial-balance" type="number" min="0.01" step="0.01" value="${esc(chainSettings.initialBalanceNative || 10)}"></div>
      <div class="field"><label>${t('networkFee')} · ${esc(view.chain.nativeSymbol)}</label><input class="input" id="setting-network-fee" type="number" min="0" step="0.0001" value="${esc(chainSettings.networkFeeNative || 0)}"></div>
      <div class="field"><label>${label('Sell presets', '卖出预设')} · %</label><input class="input" id="setting-sell-presets" value="${esc((settings.sellPresets || []).join(', '))}"></div>
      <div class="field"><label>${t('slippage')} (bps)</label><input class="input" id="setting-slippage" type="number" min="0" max="5000" value="${settings.slippageBps}"></div>
      <div class="field"><label>${t('tradingFee')} (bps)</label><input class="input" id="setting-platform-fee" type="number" min="0" max="5000" value="${settings.platformFeeBps}"></div>
      <div class="field"><label>PnL Bar</label><select class="select" id="setting-bar-position"><option value="bottom" ${settings.pnlBarPosition === 'bottom' ? 'selected' : ''}>Bottom</option><option value="top" ${settings.pnlBarPosition === 'top' ? 'selected' : ''}>Top</option></select></div>
      <label class="checkbox"><input id="setting-fast" type="checkbox" ${settings.fastMode ? 'checked' : ''}> ${t('fastMode')}</label>
      <label class="checkbox"><input id="setting-confirm" type="checkbox" ${settings.confirmationEnabled ? 'checked' : ''}> ${t('confirmTrades')}</label>
      <label class="checkbox"><input id="setting-sound" type="checkbox" ${settings.soundEnabled ? 'checked' : ''}> ${t('sound')}</label>
      <label class="checkbox"><input id="setting-list-buy" type="checkbox" ${settings.showListQuickBuy ? 'checked' : ''}> ${t('quickBuy')}</label>
    </div><div class="actions settings-actions"><button class="button primary" data-action="save-settings">${t('confirm')}</button></div></div>
    <div class="settings-section"><h3>Data</h3><div class="actions"><button class="button" data-action="export-json">${t('exportJson')}</button><button class="button" data-action="import-json">${t('importJson')}</button><button class="button danger" data-action="reset-chain">${label('Reset selected chain', '重置已选链')} · ${esc(view.chain.name)}</button><button class="button danger" data-action="reset-all">${label('Reset all chains', '重置全部链')}</button></div><p class="muted">${t('resetWarning')}</p></div></section>`;
  }

  function updateHistoryResults() {
    const results = app.querySelector('#history-results');
    if (results) {
      results.innerHTML = historyResults(model());
      bindShareButtons(results);
    }
  }

  function bindShareButtons(root) {
    root.querySelectorAll('[data-share]').forEach((button) => button.addEventListener('click', () => shareTrade(button.dataset.share)));
    root.querySelectorAll('[data-copy-share]').forEach((button) => button.addEventListener('click', () => shareTrade(button.dataset.copyShare, 'copy')));
  }

  function bind() {
    app.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { runtime.tab = button.dataset.tab; render(); }));
    app.querySelectorAll('[data-month]').forEach((button) => button.addEventListener('click', () => { runtime.month = new Date(runtime.month.getFullYear(), runtime.month.getMonth() + Number(button.dataset.month), 1); render(); }));
    app.querySelectorAll('[data-calendar-date]').forEach((button) => button.addEventListener('click', () => { runtime.filters.date = button.dataset.calendarDate; runtime.tab = 'history'; render(); }));
    app.querySelectorAll('[data-account-chain]').forEach((button) => button.addEventListener('click', () => saveSelectedChain(button.dataset.accountChain)));
    bindShareButtons(app);
    app.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => action(button.dataset.action)));
    app.querySelector('#dashboard-chain')?.addEventListener('change', (event) => saveSelectedChain(event.target.value));
    const search = app.querySelector('#trade-search'); if (search) search.addEventListener('input', () => { runtime.filters.search = search.value; updateHistoryResults(); });
    const side = app.querySelector('#trade-side'); if (side) side.addEventListener('change', () => { runtime.filters.side = side.value; updateHistoryResults(); });
    const result = app.querySelector('#trade-result'); if (result) result.addEventListener('change', () => { runtime.filters.result = result.value; updateHistoryResults(); });
    const date = app.querySelector('#trade-date'); if (date) date.addEventListener('change', () => { runtime.filters.date = date.value; updateHistoryResults(); });
  }

  const parsePresets = (value, fallback) => {
    const values = String(value).split(',').map(Number).filter((item) => item > 0).slice(0, 12);
    return values.length ? values : fallback;
  };

  async function action(name) {
    if (name === 'export-json') return download(`tango-backup-${dateStamp()}.json`, JSON.stringify(await Tango.Store.exportData(), null, 2), 'application/json');
    if (name === 'import-json') return fileInput.click();
    if (name === 'reset-all') {
      const confirmed = global.confirm(label(
        'Permanently reset all chains? This deletes every paper trade, position, and PnL calendar record on all chains.',
        '永久重置全部链？这会删除所有链上的全部模拟交易、持仓和盈亏日历记录。'
      ));
      if (!confirmed) return;
      try {
        await runtime.settingsWrite;
        runtime.state = await Tango.Store.resetAll();
        await load();
      } catch {
        try { await load(); } catch { /* keep the last rendered snapshot */ }
        showToast(t('settingsSaveFailed'));
      }
      return;
    }
    if (name === 'save-settings') {
      const chainId = runtime.selectedChain;
      const view = model();
      if (view.chain.id !== chainId) return;
      const form = {
        language: app.querySelector('#setting-language').value,
        displayCurrency: app.querySelector('#setting-currency').value,
        theme: app.querySelector('#setting-theme').value,
        buyPresets: parsePresets(app.querySelector('#setting-buy-presets').value, view.chainSettings.buyPresets),
        networkFeeNative: Number(app.querySelector('#setting-network-fee').value),
        initialBalanceNative: Number(app.querySelector('#setting-initial-balance').value),
        sellPresets: parsePresets(app.querySelector('#setting-sell-presets').value, runtime.settings.sellPresets),
        slippageBps: Number(app.querySelector('#setting-slippage').value),
        platformFeeBps: Number(app.querySelector('#setting-platform-fee').value),
        pnlBarPosition: app.querySelector('#setting-bar-position').value,
        fastMode: app.querySelector('#setting-fast').checked,
        confirmationEnabled: app.querySelector('#setting-confirm').checked,
        soundEnabled: app.querySelector('#setting-sound').checked,
        showListQuickBuy: app.querySelector('#setting-list-buy').checked
      };
      let saved;
      try {
        saved = await queueSettingsMutation({
          language: form.language,
          displayCurrency: form.displayCurrency,
          theme: form.theme,
          sellPresets: form.sellPresets,
          slippageBps: form.slippageBps,
          platformFeeBps: form.platformFeeBps,
          pnlBarPosition: form.pnlBarPosition,
          fastMode: form.fastMode,
          confirmationEnabled: form.confirmationEnabled,
          soundEnabled: form.soundEnabled,
          showListQuickBuy: form.showListQuickBuy,
          chains: {
            [chainId]: {
              buyPresets: form.buyPresets,
              networkFeeNative: form.networkFeeNative,
              initialBalanceNative: form.initialBalanceNative
            }
          }
        });
      } catch {
        showToast(t('settingsSaveFailed'));
        return;
      }
      if (runtime.selectedChain === chainId && saved?.selectedChain === chainId) showToast(t('confirm'));
      return;
    }

    const chainId = runtime.selectedChain;
    const view = await selectedModel(chainId);
    if (!view) return;
    if (name === 'open-gmgn') return global.chrome.tabs.create({ url: Tango.Chains.trenchUrl(chainId) });
    if (name === 'export-csv') return download(`tango-trades-${chainId}-${dateStamp()}.csv`, tradesCsv(chainId), 'text/csv;charset=utf-8');
    if (name === 'reset-chain') {
      const confirmed = global.confirm(label(
        `Permanently reset only ${view.chain.name}? Its paper trades, positions, and PnL calendar records will be deleted; all other chains will be preserved.`,
        `永久仅重置 ${view.chain.name}？该链的模拟交易、持仓和盈亏日历记录将被删除；其他链会保留。`
      ));
      if (!confirmed) return;
      const executionView = model();
      if (runtime.selectedChain !== chainId || runtime.settings?.selectedChain !== chainId || executionView.chain.id !== chainId) return;
      try {
        runtime.state = await Tango.Store.resetChain(chainId, Number(executionView.chainSettings.initialBalanceNative || 10));
        await load();
      } catch {
        try { await load(); } catch { /* keep the last rendered snapshot */ }
        showToast(t('settingsSaveFailed'));
      }
    }
  }

  function tradesCsv(chainId = runtime.selectedChain) {
    const selected = Tango.Chains.get(chainId)?.id || 'sol';
    const rows = Tango.DashboardModel.tradesCsvRows(runtime.state, selected);
    const headers = [
      'executedAt', 'chain', 'nativeSymbol', 'tokenAddress', 'symbol', 'side', 'amountNative',
      'quantity', 'observedPriceUsd', 'executionPriceUsd', 'marketCapUsd', 'nativePriceUsd',
      'slippageBps', 'platformFeeNative', 'networkFeeNative', 'realizedPnlNative',
      'realizedPnlUsd', 'valuationMode', 'priceProvenance', 'sourceUrl'
    ];
    const encode = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return '\ufeff' + [headers.join(','), ...rows.map((row) => headers.map((key) => encode(row[key])).join(','))].join('\n');
  }

  function dateStamp() { return new Date().toISOString().slice(0, 10); }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  function showToast(message) {
    runtime.toast = message; render();
    setTimeout(() => { runtime.toast = ''; render(); }, 1_800);
  }

  async function shareTrade(id, mode = 'download') {
    const chainId = runtime.selectedChain;
    const view = await selectedModel(chainId);
    if (!view) return;
    const trade = view.trades.find((item) => item.id === id);
    if (!trade) return;
    const canvas = document.createElement('canvas'); canvas.width = 1_200; canvas.height = 630;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 1_200, 630);
    gradient.addColorStop(0, '#090a0f'); gradient.addColorStop(1, '#28165c'); context.fillStyle = gradient; context.fillRect(0, 0, 1_200, 630);
    context.fillStyle = '#9b7cff'; context.beginPath(); context.arc(75, 72, 12, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#fff'; context.font = '800 30px sans-serif'; context.fillText('TANGO PAPER TRADE', 105, 82);
    context.font = '900 72px sans-serif'; context.fillText(trade.symbol, 70, 190);
    context.fillStyle = Number(trade.realizedPnlNative) >= 0 ? '#3ee6a0' : '#ff647c'; context.font = '900 58px sans-serif';
    context.fillText(Tango.Format.native(trade.realizedPnlNative, view.chain.nativeSymbol, lang(), true), 70, 280);
    context.fillStyle = '#fff'; context.font = '700 28px sans-serif'; context.fillText(Tango.Format.usd(trade.realizedPnlUsd, lang()), 70, 330);
    context.fillStyle = '#9ca0b3'; context.font = '24px sans-serif'; context.fillText(`${view.chain.name} · ${view.chain.nativeSymbol}`, 70, 390);
    context.fillText(`${t('entryMc')}  ${Tango.Format.usd(trade.entryMarketCapUsd, lang(), true)}`, 70, 435);
    context.fillText(`${t('exitMc')}  ${Tango.Format.usd(trade.marketCapUsd, lang(), true)}`, 70, 480);
    context.fillStyle = '#fff'; context.font = '700 22px sans-serif'; context.fillText(t('simulatedTrade'), 70, 570);
    canvas.toBlob(async (blob) => {
      if (mode === 'copy' && global.navigator.clipboard?.write && global.ClipboardItem) {
        try { await global.navigator.clipboard.write([new global.ClipboardItem({ 'image/png': blob })]); showToast(t('copyImage')); return; } catch { /* download below */ }
      }
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `tango-${view.chain.id}-${trade.symbol}-${dateStamp()}.png`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }, 'image/png');
  }

  fileInput.addEventListener('change', async () => {
    try {
      const payload = JSON.parse(await fileInput.files[0].text());
      const data = await Tango.Store.importData(payload);
      runtime.state = data.state; runtime.settings = data.settings;
      runtime.selectedChain = Tango.Chains.get(data.settings.selectedChain)?.id || 'sol';
      showToast(t('dataImported'));
    } catch {
      showToast(t('importFailed'));
    } finally {
      fileInput.value = '';
    }
  });
  Tango.Store.subscribe(load);load();
})(globalThis);
