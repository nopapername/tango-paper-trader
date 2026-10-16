(function initDashboard(global) {
  const Tango = global.Tango;
  const app = document.querySelector('#app');
  const fileInput = document.querySelector('#import-file');
  const tabs = ['overview', 'positions', 'history', 'calendar', 'settings'];
  const initialTab = tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  const searchParams = new URLSearchParams(location.search || '');
  const requestedChain = Tango.Chains.get(searchParams.get('chain'))?.id || '';
  const runtime = {
    state: null,
    settings: null,
    selectedChain: requestedChain || 'sol',
    startupChain: requestedChain,
    startupChainApplied: false,
    selectedChainRevision: 0,
    settingsWrite: Promise.resolve(),
    settingsFormBaseline: null,
    settingsFormRevision: 0,
    selectionPending: null,
    nativePrices: {},
    nativePriceObservedAt: {},
    nativePricesRequested: false,
    nativePriceRequests: {},
    nativePriceRefreshTimer: null,
    tab: initialTab,
    month: new Date(),
    filters: { search: '', side: 'ALL', result: 'ALL', date: Tango.DailyReport.validDate(searchParams.get('date')) ? searchParams.get('date') : '' },
    dailyReport:null, reportCurrency:'NATIVE', reportBusy:false,
    historyPage: 0,
    onboardingActive: searchParams.get('onboarding') === '1',
    onboardingComplete: false,
    onboardingSetupVerified: false,
    onboardingCompletion: null,
    onboardingStatus: '',
    onboardingBalance: '10',
    onboardingLanguage: '',
    toast: '',
    loadError: ''
  };

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
  const lang = () => Tango.I18n.resolveLanguage(runtime.settings?.language);
  const t = (key, vars) => Tango.I18n.t(key, runtime.settings?.language, vars);
  const label = (english, chinese) => lang() === 'zh-CN' ? chinese : english;
  const cls = (value) => Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : 'flat';
  const native = (value, model, signed = false) => Tango.Format.native(value, model.chain.nativeSymbol, lang(), signed);
  const NATIVE_PRICE_TTL_MS = 60_000;
  // The worker can try two providers sequentially, each with a 6s deadline.
  // Allow both attempts plus message delivery before giving up locally.
  const NATIVE_PRICE_TIMEOUT_MS = 14_000;
  const HISTORY_PAGE_SIZE = 100;
  const freshNativePrices = () => Object.fromEntries(Tango.Chains.all().map((chain) => {
    const price = Number(runtime.nativePrices[chain.id]);
    const age = Date.now() - Number(runtime.nativePriceObservedAt[chain.id]);
    return [chain.id, Number.isFinite(price) && price > 0 && age >= -5_000 && age <= NATIVE_PRICE_TTL_MS ? price : 0];
  }));
  const model = () => Tango.DashboardModel.forTab
    ? Tango.DashboardModel.forTab(runtime.state, runtime.settings, runtime.selectedChain, freshNativePrices(), runtime.filters, runtime.tab)
    : (runtime.tab === 'overview' || !Tango.DashboardModel.selected
    ? Tango.DashboardModel.build : Tango.DashboardModel.selected)(
    runtime.state, runtime.settings, runtime.selectedChain, freshNativePrices(), runtime.filters
  );

  async function performLoad() {
    try {
      const data = await Tango.Store.getAll();
      runtime.state = data.state;
      const startupChain = !runtime.startupChainApplied ? runtime.startupChain : '';
      runtime.settings = startupChain ? { ...data.settings, selectedChain: startupChain } : data.settings;
      runtime.onboardingSetupVerified = runtime.onboardingSetupVerified
        || data.settings?.onboardingInitialized === true;
      runtime.loadError = '';
      const hasSelectionIntent = runtime.selectionPending?.revision === runtime.selectedChainRevision;
      if (!hasSelectionIntent) runtime.selectedChain = startupChain
        || Tango.Chains.get(data.settings.selectedChain)?.id || 'sol';
      runtime.startupChainApplied = true;
      render();
      if (!runtime.nativePricesRequested && runtime.state.initialized) {
        runtime.nativePricesRequested = true;
        refreshNativePrices();
        scheduleNativePriceRefresh();
      }
      return data;
    } catch {
      runtime.loadError = 'storageLoadFailed';
      render();
      return null;
    }
  }

  let loadTask = null; let loadAgain = false;
  function load() {
    if (loadTask) { loadAgain = true; return loadTask; }
    loadTask = (async () => {
      let result;
      do { loadAgain = false; result = await performLoad(); } while (loadAgain);
      return result;
    })().finally(() => { loadTask = null; });
    return loadTask;
  }

  async function refreshNativePrices() {
    return Promise.all(Tango.Chains.all().map((chain) => refreshNativePrice(chain)));
  }

  function renderPriceUpdate() {
    const drafts = [...app.querySelectorAll('input[id], select[id]')].map((input) => ({ id: input.id, value: input.value, checked: input.checked }));
    const focused = document.activeElement;
    const focusId = focused?.id;
    const selection = [focused?.selectionStart, focused?.selectionEnd];
    render();
    drafts.forEach((draft) => {
      const input = app.querySelector(`#${draft.id}`);
      if (input) { input.value = draft.value; input.checked = draft.checked; }
    });
    const input = focusId ? app.querySelector(`#${focusId}`) : null;
    if (typeof input?.focus === 'function') input.focus();
    if (input && Number.isInteger(selection[0]) && typeof input.setSelectionRange === 'function') input.setSelectionRange(...selection);
  }

  let priceRenderQueued = false;
  function queuePriceRender() {
    if (priceRenderQueued) return;
    priceRenderQueued = true;
    Promise.resolve().then(() => {
      priceRenderQueued = false;
      if (!document.hidden && runtime.state && runtime.settings) renderPriceUpdate();
    });
  }

  function refreshNativePrice(chain) {
    if (runtime.nativePriceRequests[chain.id]) return runtime.nativePriceRequests[chain.id];
    const request = (async () => {
      let timer;
      try {
        const observation = await Promise.race([
          global.chrome?.runtime?.sendMessage({ type: 'TANGO_GET_NATIVE_PRICE', chain: chain.id }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('nativePriceTimeout')), NATIVE_PRICE_TIMEOUT_MS); })
        ]);
        const price = Number(observation?.price);
        const observedAt = Number(observation?.observedAt);
        const age = Date.now() - observedAt;
        if (observation?.ok && Number.isFinite(price) && price > 0 && Number.isFinite(observedAt)
          && observedAt > 0 && age >= -5_000 && age <= NATIVE_PRICE_TTL_MS) {
          runtime.nativePrices[chain.id] = price;
          runtime.nativePriceObservedAt[chain.id] = observedAt;
        }
      } catch { /* retained observations remain usable only until their TTL */ }
      finally {
        clearTimeout(timer);
        delete runtime.nativePriceRequests[chain.id];
        if (runtime.state && runtime.settings) queuePriceRender();
      }
    })();
    runtime.nativePriceRequests[chain.id] = request;
    return request;
  }

  function scheduleNativePriceRefresh() {
    if (runtime.nativePriceRefreshTimer != null) return;
    runtime.nativePriceRefreshTimer = setTimeout(() => {
      runtime.nativePriceRefreshTimer = null;
      if (runtime.state?.initialized) { renderPriceUpdate(); refreshNativePrices(); }
      scheduleNativePriceRefresh();
    }, 30_000);
  }

  function nativePriceStatus() {
    const prices = freshNativePrices();
    const times = Tango.Chains.all().filter((chain) => prices[chain.id] > 0)
      .map((chain) => runtime.nativePriceObservedAt[chain.id]);
    const complete = times.length === Tango.Chains.all().length;
    return `<div class="price-status"><small class="${complete ? 'muted' : 'partial-data'}">${complete ? '' : t('nativePriceStale')}
      ${times.length ? esc(t('nativePricesUpdated', { time: new Date(Math.min(...times)).toLocaleTimeString(lang()) })) : ''}</small>
      <button class="button" data-action="refresh-native-prices">${t('nativePriceRefresh')}</button></div>`;
  }

  function queueSettingsMutation(patch, selectionRevision = 0, submittedForm = null) {
    const write = runtime.settingsWrite.then(async () => {
      if (selectionRevision && selectionRevision !== runtime.selectedChainRevision) return runtime.settings;
      const saved = await Tango.Store.patchSettings(patch);
      runtime.settings = saved;
      acknowledgeSettingsSubmission(submittedForm);
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
    runtime.dailyReport = null;
    runtime.selectedChain = selected.id;
    runtime.historyPage = 0;
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
    // Export actions must not depend on a tab that can change while awaiting a write.
    const view = Tango.DashboardModel.history
      ? Tango.DashboardModel.history(runtime.state, chainId, runtime.filters)
      : model();
    return view.chain.id === chainId ? view : null;
  }

  const SETTINGS_FORM_FIELDS = [
    'language', 'currency', 'theme', 'buy-presets', 'network-fee', 'common-balance',
    'sell-presets', 'slippage', 'platform-fee', 'bar-position', 'fast', 'confirm', 'sound', 'list-buy'
  ];
  const SETTINGS_CHECKBOX_FIELDS = new Set(['fast', 'confirm', 'sound', 'list-buy']);

  function settingsFormSnapshot(root = app) {
    if (runtime.tab !== 'settings') return null;
    const fields = {};
    SETTINGS_FORM_FIELDS.forEach((field) => {
      const input = root.querySelector(`#setting-${field}`);
      if (input) fields[field] = SETTINGS_CHECKBOX_FIELDS.has(field)
        ? { checked: Boolean(input.checked) } : { value: String(input.value ?? '') };
    });
    return Object.keys(fields).length ? { chain: runtime.selectedChain, selectionRevision: runtime.selectedChainRevision, formRevision: runtime.settingsFormRevision, fields } : null;
  }

  function acknowledgeSettingsSubmission(submittedForm) {
    const baseline = runtime.settingsFormBaseline;
    if (!submittedForm || !baseline || baseline.chain !== submittedForm.chain
      || runtime.selectedChain !== submittedForm.chain
      || runtime.selectedChainRevision !== submittedForm.selectionRevision
      || runtime.settingsFormRevision !== submittedForm.formRevision) return;
    baseline.fields = { ...baseline.fields, ...submittedForm.fields };
  }

  function settingsFormDraft() {
    const baseline = runtime.settingsFormBaseline;
    const current = settingsFormSnapshot();
    if (!baseline || !current || baseline.chain !== current.chain) return null;
    const fields = Object.fromEntries(Object.entries(current.fields).filter(([field, value]) =>
      JSON.stringify(value) !== JSON.stringify(baseline.fields[field])));
    const focused = document.activeElement;
    return { chain: current.chain, fields, focusId: focused?.id,
      selectionStart: focused?.selectionStart, selectionEnd: focused?.selectionEnd };
  }

  function restoreSettingsDraft(draft) {
    if (!draft || runtime.tab !== 'settings' || runtime.selectedChain !== draft.chain) return;
    Object.entries(draft.fields).forEach(([field, value]) => {
      const input = app.querySelector(`#setting-${field}`);
      if (input) Object.assign(input, value);
    });
    if (!String(draft.focusId || '').startsWith('setting-')) return;
    const focused = app.querySelector(`#${draft.focusId}`);
    focused?.focus();
    if (focused && Number.isInteger(draft.selectionStart) && Number.isInteger(draft.selectionEnd)) {
      focused.setSelectionRange?.(draft.selectionStart, draft.selectionEnd);
    }
  }

  function patchDashboardText(template) {
    if (!template.content || !app.childNodes) return false;
    const changes = [];
    const structuralClasses = value => String(value || '').split(/\s+/)
      .filter(name => name && !['up', 'down', 'flat'].includes(name)).join(' ');
    const equalShape = (before, after) => {
      if (before.length !== after.length) return false;
      for (let index = 0; index < before.length; index += 1) {
        const left = before[index]; const right = after[index];
        if (left.nodeType !== right.nodeType) return false;
        if (left.nodeType === 3) {
          if (left.nodeValue !== right.nodeValue) changes.push(() => { left.nodeValue = right.nodeValue; });
        } else if (left.nodeType === 1) {
          if (left.nodeName !== right.nodeName || left.attributes.length !== right.attributes.length) return false;
          for (const attr of right.attributes) {
            const old = left.getAttribute(attr.name);
            if (old === attr.value) continue;
            if (attr.name !== 'class' || structuralClasses(old) !== structuralClasses(attr.value)) return false;
            changes.push(() => left.setAttribute('class', attr.value));
          }
          if (!equalShape(left.childNodes, right.childNodes)) return false;
        } else if (left.nodeValue !== right.nodeValue) return false;
      }
      return true;
    };
    if (!equalShape(app.childNodes, template.content.childNodes)) return false;
    changes.forEach(change => change());
    return true;
  }

  function render() {
    if (runtime.tab === 'settings' && (!runtime.settingsFormBaseline
      || runtime.settingsFormBaseline.chain !== runtime.selectedChain)) runtime.settingsFormRevision += 1;
    const settingsDraft = settingsFormDraft();
    document.documentElement.lang = lang();
    document.documentElement.dataset.theme = Tango.I18n.resolveTheme?.(runtime.settings?.theme)
      || (runtime.settings?.theme === 'light' ? 'light' : 'dark');
    if (runtime.loadError) return renderStorageError();
    if (runtime.onboardingComplete) return renderOnboardingComplete();
    if (runtime.onboardingActive || !runtime.state?.initialized) return renderSetupRequired();
    const view = model();
    const titles = {
      overview: t('overview'), positions: t('positions'), history: t('tradeHistory'),
      calendar: t('calendar'), settings: t('settings')
    };
    const chainOptions = Tango.Chains.all().map((chain) => (
      `<option value="${chain.id}" ${chain.id === view.chain.id ? 'selected' : ''}>${esc(chain.name)} (${esc(chain.nativeSymbol)})</option>`
    )).join('');
    const markup = `<div class="app"><aside class="sidebar">
      <div class="brand"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div>
      <nav class="nav">${Object.entries(titles).map(([id, title]) => `<button data-tab="${id}" class="${runtime.tab === id ? 'active' : ''}">${title}</button>`).join('')}</nav>
      <div class="sidebar-bottom">Tango Paper Trader v${Tango.VERSION}<br>${t('paperOnly')}</div>
    </aside><main class="main"><div class="topbar"><div><h1>${titles[runtime.tab]}</h1><p>${t('welcome')}</p></div>
      <div class="topbar-actions"><label class="chain-select"><span>${label('Selected chain', '已选链')}</span><select id="dashboard-chain">${chainOptions}</select></label>
      <button class="button primary" data-action="open-gmgn">${t('referralLink')} ↗</button></div></div>
      <div class="privacy-links"><a href="privacy.html" target="_blank" rel="noopener noreferrer">${t('privacyPolicy')}</a> · <a href="https://gmgn.ai/" target="_blank" rel="noopener noreferrer">${t('plainGmgnLink')}</a></div>${nativePriceStatus()}${renderTab(view)}
    </main></div>${runtime.dailyReport ? Tango.DailyReport.dialog(runtime.dailyReport,runtime.reportCurrency,lang(),runtime.reportBusy) : ''}${runtime.toast ? `<div class="toast">${esc(runtime.toast)}</div>` : ''}`;
    const template = document.createElement('template');
    if (template.content) template.innerHTML = markup;
    const nextBaseline = template.content ? settingsFormSnapshot(template.content) : null;
    const patched = patchDashboardText(template);
    if (!patched) {
      if (template.content && app.replaceChildren) app.replaceChildren(template.content);
      else app.innerHTML = markup;
      bind();
    }
    runtime.settingsFormBaseline = nextBaseline || settingsFormSnapshot();
    restoreSettingsDraft(settingsDraft);
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
    const onboardingLanguage = Tango.I18n.resolveLanguage(
      runtime.onboardingLanguage || runtime.settings?.language
    );
    const onboardingBalance = runtime.onboardingBalance;
    runtime.onboardingLanguage = onboardingLanguage;
    app.innerHTML = `<div class="onboarding-page"><section class="onboarding card">
      <div class="brand" style="justify-content:center;padding:0"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div>
      <h1>${t('setup')}</h1><p>${t('onboardingCommonCapital')}</p>
      <p>${t('independentChains')}</p><p>${t('paperOnly')}</p><p>${t('settingsAvailableLater')}</p>
      <label class="field onboarding-field"><span>${t('language')}</span><select class="select" id="onboarding-language" value="${esc(onboardingLanguage)}"><option value="zh-CN" ${onboardingLanguage === 'zh-CN' ? 'selected' : ''}>${t('chinese')}</option><option value="en" ${onboardingLanguage === 'en' ? 'selected' : ''}>${t('english')}</option></select></label>
      <label class="field onboarding-field"><span>${t('commonCapital')}</span><input class="input custom-balance" id="onboarding-balance" type="number" min="0" max="1000000000000000" step="any" value="${esc(onboardingBalance)}"></label>
      <p class="onboarding-capital-note" id="onboarding-capital-note">${esc(Tango.I18n.t('onboardingCapitalAllocation', onboardingLanguage, { amount: onboardingBalance }))}</p>
      <button class="button primary onboarding-submit" id="complete-onboarding">${t('startWithReferral')}</button><button class="button secondary" id="complete-onboarding-local">${t('saveWithoutReferral')}</button><div class="privacy-links"><a href="privacy.html" target="_blank" rel="noopener noreferrer">${t('privacyPolicy')}</a> · <a href="https://gmgn.ai/" target="_blank" rel="noopener noreferrer">${t('plainGmgnLink')}</a></div>
      ${runtime.onboardingStatus ? `<p class="onboarding-status">${esc(t(runtime.onboardingStatus))}</p>` : ''}
    </section></div>`;
    const updateCapitalNote = () => {
      const amount = app.querySelector('#onboarding-balance')?.value || '10';
      const language = app.querySelector('#onboarding-language')?.value || onboardingLanguage;
      const note = app.querySelector('#onboarding-capital-note');
      if (note) note.textContent = Tango.I18n.t('onboardingCapitalAllocation', language, { amount });
    };
    app.querySelector('#onboarding-balance')?.addEventListener('input', (event) => {
      runtime.onboardingBalance = event.target.value;
      updateCapitalNote();
    });
    app.querySelector('#onboarding-language')?.addEventListener('change', (event) => {
      runtime.onboardingLanguage = event.target.value;
      updateCapitalNote();
    });
    app.querySelector('#complete-onboarding')?.addEventListener('click', () => completeOnboarding(true));
    app.querySelector('#complete-onboarding-local')?.addEventListener('click', () => completeOnboarding(false));
  }

  function renderOnboardingComplete() {
    app.innerHTML = `<div class="onboarding-page"><section class="onboarding card onboarding-complete"><h1>${t('onboardingComplete')}</h1><p>${t('onboardingCompleteHint')}</p></section></div>`;
  }

  function validCommonCapital(value) {
    return typeof value === 'number' && Number.isFinite(value)
      && value > Number.EPSILON && value <= 1e15;
  }

  function verifiedCommonCapital(data, balanceNative) {
    if (!data?.state?.initialized) return false;
    return Tango.Chains.all().every((chain) => (
      data.state.accounts?.[chain.id]?.initialBalanceNative === balanceNative
      && data.state.accounts?.[chain.id]?.cashBalanceNative === balanceNative
      && data.settings?.chains?.[chain.id]?.initialBalanceNative === balanceNative
    ));
  }

  async function runOnboardingCompletion(openReferral = true) {
    const balanceInput = app.querySelector('#onboarding-balance');
    runtime.onboardingBalance = balanceInput?.value ?? runtime.onboardingBalance;
    runtime.onboardingLanguage = app.querySelector('#onboarding-language')?.value
      || runtime.onboardingLanguage;
    const balanceNative = Number(runtime.onboardingBalance);
    const language = runtime.onboardingLanguage;
    if (!validCommonCapital(balanceNative)) {
      runtime.onboardingStatus = 'invalidCommonCapital';
      render();
      return;
    }
    runtime.onboardingActive = true;
    if (!runtime.onboardingSetupVerified) {
      let persisted;
      try {
        await Tango.Store.resetAllWithBalance(balanceNative, language);
        persisted = await Tango.Store.getAll();
        if (!verifiedCommonCapital(persisted, balanceNative)) throw new Error('onboardingVerificationFailed');
        persisted.settings = await Tango.Store.patchSettings({ onboardingInitialized: true });
      } catch {
        runtime.onboardingStatus = 'onboardingVerificationFailed';
        render();
        return;
      }
      runtime.state = persisted.state;
      runtime.settings = persisted.settings;
      runtime.onboardingSetupVerified = true;
    }
    let opened = { ok: !openReferral };
    try {
      if (openReferral) opened = await global.chrome.runtime.sendMessage({ type: 'TANGO_OPEN_GMGN' });
    } catch {}
    if (!opened?.ok) {
      runtime.onboardingStatus = 'openGmgnFailed';
      render();
      return;
    }
    runtime.onboardingStatus = '';
    runtime.onboardingActive = false;
    runtime.onboardingComplete = true;
    global.close();
    if (!global.closed) render();
  }

  function completeOnboarding(openReferral = true) {
    if (runtime.onboardingCompletion) return runtime.onboardingCompletion;
    const completion = runOnboardingCompletion(openReferral).finally(() => {
      if (runtime.onboardingCompletion === completion) runtime.onboardingCompletion = null;
    });
    runtime.onboardingCompletion = completion;
    return completion;
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
    <p class="muted statistics-note">${t('retainedOverviewStats')}</p>${positionsPanel(view, true)}${historyPanel(view, true)}`;
  }

  function positionsPanel(view, compact = false) {
    const rows = view.positions.map((position) => {
      const mark = Tango.Engine.markPosition(position, undefined, view.nativePriceUsd);
      return `<tr><td class="token-cell">${esc(position.symbol || position.tokenAddress)}</td><td>${esc(view.chain.name)}</td><td>${native(position.costBasisNative, view)}</td>
        <td>${native(mark.valueNative, view)}</td><td class="${cls(mark.unrealizedPnlNative)}">${native(mark.unrealizedPnlNative, view, true)} (${Tango.Format.percent(mark.roi, lang(), true)})</td>
        <td>${Tango.Format.usd(position.averageEntryMarketCap, lang(), true)}</td><td>${Tango.Format.usd(position.lastMarketCapUsd, lang(), true)}</td><td>${Tango.Format.duration(Date.now() - position.openedAt, lang())}</td></tr>`;
    }).join('');
    return `<section class="panel card"><div class="panel-header"><h2>${t('positions')} · ${esc(view.chain.name)}</h2>${compact ? `<button class="button" data-tab="positions">${t('positions')} →</button>` : ''}</div>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>${t('token')}</th><th>${t('chain')}</th><th>${t('cost')}</th><th>${t('value')}</th><th>${t('pnl')}</th><th>${t('entryMc')}</th><th>${t('currentMc')}</th><th>${t('held')}</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${t('noPositions')}</div>`}</section>`;
  }

  function historyResults(view, compact = false) {
    const formatDate = Tango.Format.dateTimeFormatter?.(lang())
      || (value => new Date(value).toLocaleString(lang()));
    const pageCount = Math.max(1, Math.ceil(view.trades.length / HISTORY_PAGE_SIZE));
    runtime.historyPage = Math.max(0, Math.min(runtime.historyPage, pageCount - 1));
    const offset = compact ? 0 : runtime.historyPage * HISTORY_PAGE_SIZE;
    const trades = view.trades.slice(offset, offset + (compact ? 8 : HISTORY_PAGE_SIZE));
    const valuation = (trade) => Tango.DashboardModel.hasDerivedMarketCapPrice(trade)
      ? `${t('marketCap')} · ${Tango.Format.usd(trade.marketCapUsd, lang(), true)}`
      : Tango.Format.usd(trade.executionPriceUsd, lang());
    const rows = trades.map((trade) => `<tr><td>${formatDate(trade.executedAt)}</td><td class="token-cell">${esc(trade.symbol || trade.tokenAddress)}</td>
      <td class="${trade.side === 'BUY' ? 'up' : 'down'}">${trade.side === 'BUY' ? t('buy') : t('sell')}</td><td>${native(trade.amountNative, view)}</td><td>${valuation(trade)}</td>
      <td>${Tango.Format.usd(trade.marketCapUsd, lang(), true)}</td><td class="${cls(trade.realizedPnlNative)}">${trade.side === 'SELL' ? native(trade.realizedPnlNative, view, true) : '—'}</td>
      <td><button class="button" data-trade-replay="${esc(trade.id)}">${label('View trades','查看买卖记录')}</button> ${trade.side === 'SELL' ? `<button class="button" data-share="${esc(trade.id)}">PNG</button> <button class="button" data-copy-share="${esc(trade.id)}">${t('copyImage')}</button>` : ''}</td></tr>`).join('');
    const pagination = compact ? '' : `<p class="muted statistics-note">${esc(t('historyCount', { count: view.trades.length }))}</p><div class="pagination"><span>${esc(t('showingTrades', { from: view.trades.length ? offset + 1 : 0, to: offset + trades.length, count: view.trades.length }))}</span>
      <button class="button" data-history-page="-1" ${runtime.historyPage === 0 ? 'disabled' : ''}>${t('previousPage')}</button>
      <button class="button" data-history-page="1" ${runtime.historyPage >= pageCount - 1 ? 'disabled' : ''}>${t('nextPage')}</button></div>`;
    return (rows ? `<div class="table-wrap"><table><thead><tr><th>${t('date')}</th><th>${t('token')}</th><th>${t('side')}</th><th>${t('amount')} · ${esc(view.chain.nativeSymbol)}</th><th>${t('executionPrice')}</th><th>${t('marketCap')}</th><th>${t('realizedPnl')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${t('noTrades')}</div>`) + pagination;
  }

  function historyPanel(view, compact = false) {
    return `<section class="panel card"><div class="panel-header"><h2>${t('tradeHistory')} · ${esc(view.chain.name)}</h2><div class="actions">
      ${compact ? `<button class="button" data-tab="history">${t('history')} →</button>` : `<button class="button" data-action="export-csv">${t('exportChainCsv')}</button><button class="button" data-action="export-json">${t('exportJson')}</button>`}</div></div>
      ${compact ? '' : `<div class="filters"><input class="input" id="trade-search" value="${esc(runtime.filters.search)}" placeholder="${t('token')} / CA"><input class="input" id="trade-date" type="date" value="${esc(runtime.filters.date)}"><select class="select" id="trade-side"><option value="ALL">${t('allSides')}</option><option value="BUY" ${runtime.filters.side === 'BUY' ? 'selected' : ''}>${t('buy')}</option><option value="SELL" ${runtime.filters.side === 'SELL' ? 'selected' : ''}>${t('sell')}</option></select><select class="select" id="trade-result"><option value="ALL">${t('allResults')}</option><option value="WIN" ${runtime.filters.result === 'WIN' ? 'selected' : ''}>${t('win')}</option><option value="LOSS" ${runtime.filters.result === 'LOSS' ? 'selected' : ''}>${t('loss')}</option></select></div>`}
      ${compact ? historyResults(view, true) : `<div id="history-results">${historyResults(view)}</div>`}</section>`;
  }

  function openDailyReport(date) {
    try {runtime.dailyReport=Tango.DailyReport.summarize(runtime.state,runtime.selectedChain,date);runtime.reportCurrency='NATIVE';render();}
    catch {showToast(t('imageExportFailed'));}
  }
  async function reportAction(action) {
    const report=runtime.dailyReport;
    if(!report||runtime.reportBusy)return;
    if(action==='close'){runtime.dailyReport=null;render();return;}
    if(action==='native'||action==='usd'){runtime.reportCurrency=action==='usd'?'USD':'NATIVE';render();return;}
    if(action==='history'){runtime.filters={search:'',side:'ALL',result:'ALL',date:report.date};runtime.historyPage=0;runtime.tab='history';runtime.dailyReport=null;render();return;}
    if(action!=='download'&&action!=='copy')return;
    runtime.reportBusy=true;render();
    try {const result=await Tango.DailyReport.exportImage(report,runtime.reportCurrency,lang(),action);showToast(t(result==='copied'?'copyImage':result==='fallback'?'imageCopyFallback':'downloadPng'));}
    catch {showToast(t('imageExportFailed'));}
    finally {runtime.reportBusy=false;render();}
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
    return `<div class="stats"><div class="stat card"><span>${t('totalPnl')} · ${esc(view.chain.nativeSymbol)}</span><strong class="${cls(calendar.totalNative)}">${native(calendar.totalNative, view, true)}</strong></div><div class="stat card"><span>${t('totalTrades')}</span><strong>${calendar.trades.length}</strong></div><div class="stat card"><span>${t('winRate')}</span><strong>${Tango.Format.percent(calendar.winRate, lang())}</strong></div><div class="stat card"><span>${t('bestWorst')} · ${esc(view.chain.nativeSymbol)}</span><strong>${native(calendar.bestNative, view, true)} / ${native(calendar.worstNative, view, true)}</strong></div></div><p class="muted statistics-note">${t('retainedHistoryStats')}</p>
      <section class="panel card"><div class="calendar-head"><button class="button" data-month="-1">←</button><h2>${date.toLocaleDateString(lang(), { month: 'long', year: 'numeric' })} · ${esc(view.chain.name)}</h2><button class="button" data-month="1">→</button></div>
      <div class="calendar-grid">${labels.map((dayLabel) => `<div class="calendar-label">${dayLabel}</div>`).join('')}${cells.join('')}</div></section>`;
  }

  function settingsPanel(view) {
    const settings = runtime.settings;
    const chainSettings = view.chainSettings;
    return `<section class="panel card"><div class="settings-section"><h3>${t('settings')} · ${esc(view.chain.name)}</h3><div class="settings-grid">
      <div class="field"><label>${t('language')}</label><select class="select" id="setting-language"><option value="auto" ${settings.language === 'auto' ? 'selected' : ''}>${t('auto')}</option><option value="zh-CN" ${settings.language === 'zh-CN' ? 'selected' : ''}>简体中文</option><option value="en" ${settings.language === 'en' ? 'selected' : ''}>English</option></select></div>
      <div class="field"><label>${t('displayCurrency')}</label><select class="select" id="setting-currency"><option value="NATIVE" ${settings.displayCurrency === 'NATIVE' || settings.displayCurrency === 'SOL' ? 'selected' : ''}>${t('nativeCurrency')}</option><option value="USD" ${settings.displayCurrency === 'USD' ? 'selected' : ''}>USD</option></select></div>
      <div class="field"><label>${t('theme')}</label><select class="select" id="setting-theme"><option value="auto" ${settings.theme === 'auto' ? 'selected' : ''}>${t('auto')}</option><option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>${t('darkTheme')}</option><option value="light" ${settings.theme === 'light' ? 'selected' : ''}>${t('lightTheme')}</option></select></div>
      <div class="field"><label>${label('Buy presets', '买入预设')} · ${esc(view.chain.nativeSymbol)}</label><input class="input" id="setting-buy-presets" value="${esc((chainSettings.buyPresets || []).join(', '))}"></div>
      <div class="field common-capital-field"><label>${t('commonCapital')}</label><input class="input" id="setting-common-balance" type="number" min="0" max="1000000000000000" step="any" value="${esc(chainSettings.initialBalanceNative || 10)}"><small>${t('independentChains')}</small></div>
      <div class="field"><label>${t('networkFee')} · ${esc(view.chain.nativeSymbol)}</label><input class="input" id="setting-network-fee" type="number" min="0" max="1000000" step="any" value="${esc(chainSettings.networkFeeNative || 0)}"></div>
      <div class="field"><label>${label('Sell presets', '卖出预设')} · %</label><input class="input" id="setting-sell-presets" value="${esc((settings.sellPresets || []).join(', '))}"></div>
      <div class="field"><label>${t('slippage')} (bps)</label><input class="input" id="setting-slippage" type="number" min="0" max="9999" step="any" value="${settings.slippageBps}"></div>
      <div class="field"><label>${t('tradingFee')} (bps)</label><input class="input" id="setting-platform-fee" type="number" min="0" max="9999" step="any" value="${settings.platformFeeBps}"></div>
      <div class="field"><label>${t('pnlBar')}</label><select class="select" id="setting-bar-position"><option value="bottom" ${settings.pnlBarPosition === 'bottom' ? 'selected' : ''}>${t('bottom')}</option><option value="top" ${settings.pnlBarPosition === 'top' ? 'selected' : ''}>${t('top')}</option></select></div>
      <label class="checkbox"><input id="setting-fast" type="checkbox" ${settings.fastMode ? 'checked' : ''}> ${t('fastMode')}</label>
      <label class="checkbox"><input id="setting-confirm" type="checkbox" ${settings.confirmationEnabled ? 'checked' : ''}> ${t('confirmTrades')}</label>
      <label class="checkbox"><input id="setting-sound" type="checkbox" ${settings.soundEnabled ? 'checked' : ''}> ${t('sound')}</label>
      <label class="checkbox"><input id="setting-list-buy" type="checkbox" ${settings.showListQuickBuy ? 'checked' : ''}> ${t('quickBuy')}</label>
    </div><div class="actions settings-actions"><button class="button primary" data-action="save-settings">${t('confirm')}</button></div></div>
    <div class="settings-section"><h3>${t('data')}</h3><div class="actions"><button class="button" data-action="export-json">${t('exportJson')}</button><button class="button" data-action="import-json">${t('importJson')}</button><button class="button danger" data-action="reset-chain">${label('Reset selected chain', '重置已选链')} · ${esc(view.chain.name)}</button><button class="button danger" data-action="reset-all">${label('Reset all chains', '重置全部链')}</button></div><p class="muted">${t('resetWarning')}</p></div></section>`;
  }

  function updateHistoryResults() {
    const results = app.querySelector('#history-results');
    if (results) {
      const view = Tango.DashboardModel.history
        ? Tango.DashboardModel.history(runtime.state, runtime.selectedChain, runtime.filters) : model();
      results.innerHTML = historyResults(view);
      bindShareButtons(results);
      bindHistoryPages(results);
    }
  }

  function bindShareButtons(root) {
    root.querySelectorAll('[data-trade-replay]').forEach(button=>button.addEventListener('click',()=>{
      const trade=runtime.state.trades.find(t=>t.id===button.dataset.tradeReplay);
      if(trade) Tango.TradeReplay.open(document.body,runtime.state,trade.chain,trade.tokenAddress,lang());
    }));
    root.querySelectorAll('[data-share]').forEach((button) => button.addEventListener('click', () => shareTrade(button.dataset.share)));
    root.querySelectorAll('[data-copy-share]').forEach((button) => button.addEventListener('click', () => shareTrade(button.dataset.copyShare, 'copy')));
  }

  function bindHistoryPages(root) {
    root.querySelectorAll('[data-history-page]').forEach((button) => button.addEventListener('click', () => {
      runtime.historyPage += Number(button.dataset.historyPage);
      updateHistoryResults();
    }));
  }

  function bind() {
    app.querySelectorAll('[data-report-action]').forEach(button=>button.addEventListener('click',()=>reportAction(button.dataset.reportAction)));
    app.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { runtime.tab = button.dataset.tab; render(); }));
    app.querySelectorAll('[data-month]').forEach((button) => button.addEventListener('click', () => { runtime.month = new Date(runtime.month.getFullYear(), runtime.month.getMonth() + Number(button.dataset.month), 1); render(); }));
    app.querySelectorAll('[data-calendar-date]').forEach((button) => button.addEventListener('click', () => { openDailyReport(button.dataset.calendarDate); }));
    app.querySelectorAll('[data-account-chain]').forEach((button) => button.addEventListener('click', () => saveSelectedChain(button.dataset.accountChain)));
    bindShareButtons(app);
    bindHistoryPages(app);
    app.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => action(button.dataset.action)));
    app.querySelector('#dashboard-chain')?.addEventListener('change', (event) => saveSelectedChain(event.target.value));
    const search = app.querySelector('#trade-search'); if (search) search.addEventListener('input', () => { runtime.filters.search = search.value; runtime.historyPage = 0; updateHistoryResults(); });
    const side = app.querySelector('#trade-side'); if (side) side.addEventListener('change', () => { runtime.filters.side = side.value; runtime.historyPage = 0; updateHistoryResults(); });
    const result = app.querySelector('#trade-result'); if (result) result.addEventListener('change', () => { runtime.filters.result = result.value; runtime.historyPage = 0; updateHistoryResults(); });
    const date = app.querySelector('#trade-date'); if (date) date.addEventListener('change', () => { runtime.filters.date = date.value; runtime.historyPage = 0; updateHistoryResults(); });
  }

  const parsePresets = (value, field, maximum = Infinity) => {
    const parts = String(value).split(',').map((item) => item.trim());
    const values = parts.map(Number);
    if (!parts.length || parts.length > 12 || parts.some((part) => !part)
      || values.some((item) => !Number.isFinite(item) || item <= Number.EPSILON || item > maximum)) {
      throw new Error(t('invalidSettingsField', { field, reason: t('invalidPresetList', { limit: maximum === 100 ? label(' (at most 100)', '（不超过 100）') : '' }) }));
    }
    return values;
  };
  const parseNumber = (value, field, minimum, maximum) => {
    const text = String(value).trim();
    const number = Number(text);
    if (!text || !Number.isFinite(number) || number < minimum || number > maximum) {
      throw new Error(t('invalidSettingsField', { field, reason: t('invalidNumericValue', { min: minimum, max: maximum }) }));
    }
    return number;
  };

  async function action(name) {
    if (name === 'refresh-native-prices') return refreshNativePrices();
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
      let form;
      try { form = {
        language: app.querySelector('#setting-language').value,
        displayCurrency: app.querySelector('#setting-currency').value,
        theme: app.querySelector('#setting-theme').value,
        buyPresets: parsePresets(app.querySelector('#setting-buy-presets').value, t('buyPresets')),
        networkFeeNative: parseNumber(app.querySelector('#setting-network-fee').value, t('networkFee'), 0, 1_000_000),
        commonBalanceNative: Number(app.querySelector('#setting-common-balance').value),
        sellPresets: parsePresets(app.querySelector('#setting-sell-presets').value, t('sellPresets'), 100),
        slippageBps: parseNumber(app.querySelector('#setting-slippage').value, t('slippage'), 0, 9999),
        platformFeeBps: parseNumber(app.querySelector('#setting-platform-fee').value, t('tradingFee'), 0, 9999),
        pnlBarPosition: app.querySelector('#setting-bar-position').value,
        fastMode: app.querySelector('#setting-fast').checked,
        confirmationEnabled: app.querySelector('#setting-confirm').checked,
        soundEnabled: app.querySelector('#setting-sound').checked,
        showListQuickBuy: app.querySelector('#setting-list-buy').checked
      }; } catch (error) { showFormError(error.message); return; }
      if (!validCommonCapital(form.commonBalanceNative)) {
        showFormError(t('invalidCommonCapital'));
        return;
      }
      const commonCapitalChanged = Tango.Chains.all().some((chain) => (
        Number(runtime.settings.chains?.[chain.id]?.initialBalanceNative) !== form.commonBalanceNative
      ));
      const submittedForm = settingsFormSnapshot();
      const settingsPatch = {
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
            networkFeeNative: form.networkFeeNative
          }
        }
      };
      if (commonCapitalChanged && !global.confirm(t('commonCapitalResetConfirm'))) return;
      if (commonCapitalChanged) {
        try {
          await runtime.settingsWrite;
          const reset = await Tango.Store.resetAllWithBalance(form.commonBalanceNative, form.language, settingsPatch);
          runtime.state = reset.state;
          runtime.settings = reset.settings;
          acknowledgeSettingsSubmission(submittedForm);
          showToast(t('confirm'));
        } catch {
          if (runtime.selectedChain === chainId) runtime.settingsFormBaseline = null;
          try { await load(); } catch { /* keep the last rendered snapshot */ }
          showToast(t('settingsSaveFailed'));
          return;
        }
        return;
      }
      let saved;
      try {
        saved = await queueSettingsMutation(settingsPatch, 0, submittedForm);
      } catch {
        if (runtime.selectedChain === chainId) runtime.settingsFormBaseline = null;
        showToast(t('settingsSaveFailed'));
        return;
      }
      if (runtime.selectedChain === chainId && saved?.selectedChain === chainId) showToast(t('confirm'));
      return;
    }

    const chainId = runtime.selectedChain;
    const view = await selectedModel(chainId);
    if (!view) return;
    if (name === 'open-gmgn') return global.chrome.runtime.sendMessage({ type: 'TANGO_OPEN_GMGN' });
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
    const headers = Tango.DashboardModel.CSV_FIELDS;
    const CSV_FORMULA_PREFIX = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u;
    const encodeCsvCell = (value) => {
      const raw = value ?? '';
      const text = typeof raw === 'string' && CSV_FORMULA_PREFIX.test(raw)
        ? `'${raw}`
        : String(raw);
      return `"${text.replaceAll('"', '""')}"`;
    };
    return '\ufeff' + [
      headers.join(','),
      ...rows.map((row) => headers.map((key) => encodeCsvCell(row[key])).join(','))
    ].join('\n');
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
  function showFormError(message) {
    runtime.toast = message;
    renderPriceUpdate();
    setTimeout(() => { runtime.toast = ''; renderPriceUpdate(); }, 1_800);
  }

  async function shareTrade(id, mode = 'download') {
    const chainId = runtime.selectedChain;
    const view = await selectedModel(chainId);
    if (!view) return;
    const trade = view.trades.find((item) => item.id === id);
    if (!trade) return;
    try {
      const canvas = document.createElement('canvas'); canvas.width = 1_200; canvas.height = 630;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('imageExportFailed');
      const fitText = (value, x, y, size, weight = 700, maxWidth = 1_060) => {
        const text = String(value ?? '');
        context.font = `${weight} ${size}px sans-serif`;
        const width = context.measureText(text).width;
        const fittedSize = Math.max(12, Math.min(size, size * maxWidth / Math.max(width, 1)));
        context.font = `${weight} ${fittedSize}px sans-serif`;
        context.fillText(text, x, y, maxWidth);
      };
      const gradient = context.createLinearGradient(0, 0, 1_200, 630);
      gradient.addColorStop(0, '#101311'); gradient.addColorStop(1, '#26371c'); context.fillStyle = gradient; context.fillRect(0, 0, 1_200, 630);
      context.fillStyle = '#c6fa74'; context.beginPath(); context.arc(75, 72, 12, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#fff'; fitText(`TANGO · ${t('paper')}`, 105, 82, 30, 800, 990);
      fitText(trade.symbol || trade.tokenAddress, 70, 190, 72, 900);
      context.fillStyle = Number(trade.realizedPnlNative) >= 0 ? '#3ee6a0' : '#ff647c';
      fitText(Tango.Format.native(trade.realizedPnlNative, view.chain.nativeSymbol, lang(), true), 70, 280, 58, 900);
      context.fillStyle = '#fff'; fitText(Tango.Format.usd(trade.realizedPnlUsd, lang()), 70, 330, 28);
      context.fillStyle = '#9ca0b3'; fitText(`${view.chain.name} · ${view.chain.nativeSymbol}`, 70, 390, 24);
      fitText(`${t('entryMc')}  ${Tango.Format.usd(trade.entryMarketCapUsd, lang(), true)}`, 70, 435, 24);
      fitText(`${t('exitMc')}  ${Tango.Format.usd(trade.marketCapUsd, lang(), true)}`, 70, 480, 24);
      context.fillStyle = '#fff'; fitText(t('simulatedTrade'), 70, 570, 22);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('imageExportFailed');
      if (mode === 'copy' && global.navigator.clipboard?.write && global.ClipboardItem) {
        try { await global.navigator.clipboard.write([new global.ClipboardItem({ 'image/png': blob })]); showToast(t('copyImage')); return; } catch { /* download below */ }
      }
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      const filenameSymbol = String(trade.symbol || 'token').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80);
      anchor.href = url; anchor.download = `tango-${view.chain.id}-${filenameSymbol}-${dateStamp()}.png`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      if (mode === 'copy') showToast(t('imageCopyFallback'));
    } catch { showToast(t('imageExportFailed')); }
  }

  fileInput.addEventListener('change', async () => {
    try {
      const payload = JSON.parse(await fileInput.files[0].text());
      const data = await Tango.Store.importData(payload);
      runtime.settingsFormBaseline = null;
      runtime.state = data.state; runtime.settings = data.settings;
      runtime.selectedChain = Tango.Chains.get(data.settings.selectedChain)?.id || 'sol';
      showToast(t('dataImported'));
    } catch (error) {
      if (error?.code === 'importTooLarge'
        && error?.message === error.code
        && Number.isSafeInteger(error.measuredBytes)
        && error.measuredBytes >= 0
        && Number.isSafeInteger(error.budgetBytes)
        && error.budgetBytes > 0
        && error.measuredBytes > error.budgetBytes) {
        const toMiB = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
        showToast(t('importTooLarge', {
          measured: toMiB(error.measuredBytes),
          budget: toMiB(error.budgetBytes)
        }));
      } else if (error?.message === 'importTooManyRecords') {
        showToast(t('importTooManyRecords'));
      } else {
        showToast(t('importFailed'));
      }
    } finally {
      fileInput.value = '';
    }
  });
  global.matchMedia?.('(prefers-color-scheme: light)')?.addEventListener?.('change', () => {
    if (runtime.settings?.theme === 'auto') renderPriceUpdate();
  });
  document.addEventListener?.('visibilitychange', () => {
    if (!document.hidden && runtime.state && runtime.settings) renderPriceUpdate();
  });
  Tango.Store.subscribe(load);load();
})(globalThis);
