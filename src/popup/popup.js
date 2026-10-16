(async function initPopup(global) {
  const Tango = global.Tango;
  const app = document.querySelector('#app');
  let state = null;
  let settings = null;
  let nativePrices = {};
  let nativePriceObservedAt = {};
  let selectedChainRevision = 0;
  let visibleSelectedChain = 'sol';
  let activeTabChain = '';
  let selectionPending = null;
  let settingsWrite = Promise.resolve();
  let loadError = false;
  let statusMessage = '';
  const nativePriceRequests = {};
  let nativePriceRefreshTimer = null;
  const NATIVE_PRICE_TTL_MS = 60_000;
  // Cover the worker's primary + fallback provider deadlines (6s each).
  const NATIVE_PRICE_TIMEOUT_MS = 14_000;

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const language = () => Tango.I18n.resolveLanguage(settings?.language);
  const t = (key, vars) => Tango.I18n.t(key, settings?.language, vars);
  const cls = (value) => Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : '';
  const selectedChainLabel = () => language() === 'zh-CN' ? '已选链' : 'Selected chain';
  const allChainsLabel = () => language() === 'zh-CN' ? '全部链' : 'All chains';
  const globalUsdLabel = () => language() === 'zh-CN' ? '全部链 USD 汇总' : 'All-chain USD summary';
  const validCommonCapital = (value) => Number.isFinite(Number(value))
    && Number(value) > Number.EPSILON && Number(value) <= 1e15;
  function commonCapitalSnapshot() {
    const values = Tango.Chains.all().flatMap((chain) => [
      Number(settings?.chains?.[chain.id]?.initialBalanceNative),
      Number(state?.accounts?.[chain.id]?.initialBalanceNative)
    ]);
    const value = values.find(validCommonCapital) || 10;
    return {
      value,
      consistent: values.length === Tango.Chains.all().length * 2
        && values.every((candidate) => validCommonCapital(candidate) && candidate === value)
    };
  }
  function model() {
    return Tango.PopupModel.build(state, settings, visibleSelectedChain, freshNativePrices());
  }
  function freshNativePrices() {
    return Object.fromEntries(Tango.Chains.all().map((chain) => {
      const price = Number(nativePrices[chain.id]);
      const age = Date.now() - Number(nativePriceObservedAt[chain.id]);
      return [chain.id, Number.isFinite(price) && price > 0 && age >= -5_000 && age <= NATIVE_PRICE_TTL_MS ? price : 0];
    }));
  }

  async function activeGmgnChain() {
    try {
      const [tab] = await global.chrome?.tabs?.query?.({ active: true, currentWindow: true }) || [];
      return Tango.Chains.fromUrl(tab?.url || '')?.id || '';
    } catch {
      return '';
    }
  }

  async function reload() {
    ({ state, settings } = await Tango.Store.getAll());
    const hasSelectionIntent = selectionPending?.revision === selectedChainRevision;
    if (!hasSelectionIntent) {
      visibleSelectedChain = activeTabChain || Tango.Chains.get(settings?.selectedChain)?.id || 'sol';
    }
  }

  async function runStoreWrite(write, apply) {
    try {
      const result = await write();
      statusMessage = '';
      await apply(result);
      return result;
    } catch {
      try { await reload(); } catch { /* keep the last rendered snapshot */ }
      statusMessage = t('settingsSaveFailed');
      render();
      return null;
    }
  }

  async function loadInitial() {
    try {
      await reload();
      loadError = false;
      statusMessage = '';
      render();
      if (state.initialized) { refreshNativePrices(); scheduleNativePriceRefresh(); }
      return true;
    } catch {
      loadError = true;
      render();
      return false;
    }
  }

  function saveSelectedChain(chainId) {
    activeTabChain = '';
    const selected = Tango.Chains.get(chainId);
    if (!selected) return Promise.resolve(settings);
    const revision = ++selectedChainRevision;
    visibleSelectedChain = selected.id;
    render();
    let pending;
    const promise = persistSettings({ selectedChain: selected.id }, {
      isCurrent: () => revision === selectedChainRevision
    }).then((saved) => {
      if (revision === selectedChainRevision) {
        visibleSelectedChain = saved?.selectedChain === selected.id
          ? selected.id
          : Tango.Chains.get(settings?.selectedChain)?.id || 'sol';
        render();
      }
      return saved;
    }).finally(() => {
      if (selectionPending === pending) selectionPending = null;
    });
    pending = { revision, chainId: selected.id, promise };
    selectionPending = pending;
    return promise;
  }

  function persistSettings(patch, { isCurrent = () => true } = {}) {
    const write = settingsWrite.then(async () => {
      if (!isCurrent()) return settings;
      const next = await Tango.Store.patchSettings(patch);
      settings = next;
      if (!isCurrent()) return settings;
      statusMessage = '';
      render();
      return settings;
    });
    settingsWrite = write.catch(() => undefined);
    return write.catch(() => {
      if (isCurrent()) {
        statusMessage = t('settingsSaveFailed');
        render();
      }
      return settings;
    });
  }

  async function refreshNativePrices() {
    return Promise.all(Tango.Chains.all().map((chain) => refreshNativePrice(chain)));
  }
  function renderPriceUpdate() {
    const balanceInput = document.querySelector('#common-capital-balance');
    const balanceDraft = balanceInput?.value;
    const details = app.querySelector?.('.account-settings');
    const detailsOpen = details?.open;
    const focusedId = document.activeElement?.id;
    render();
    const refreshed = document.querySelector('#common-capital-balance');
    if (refreshed && balanceDraft !== undefined) refreshed.value = balanceDraft;
    const refreshedDetails = app.querySelector?.('.account-settings');
    if (refreshedDetails && detailsOpen !== undefined) refreshedDetails.open = detailsOpen;
    if (focusedId) document.querySelector(`#${focusedId}`)?.focus?.();
  }
  function refreshNativePrice(chain) {
    if (nativePriceRequests[chain.id]) return nativePriceRequests[chain.id];
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
          nativePrices[chain.id] = price;
          nativePriceObservedAt[chain.id] = observedAt;
        }
      } catch { /* stale retained prices are excluded by freshNativePrices */ }
      finally { clearTimeout(timer); delete nativePriceRequests[chain.id]; renderPriceUpdate(); }
    })();
    nativePriceRequests[chain.id] = request;
    return request;
  }
  function scheduleNativePriceRefresh() {
    if (nativePriceRefreshTimer != null) return;
    nativePriceRefreshTimer = setTimeout(() => {
      nativePriceRefreshTimer = null;
      if (state?.initialized) { renderPriceUpdate(); refreshNativePrices(); }
      scheduleNativePriceRefresh();
    }, 30_000);
  }

  function selectedPositions(chainModel) {
    if (!chainModel.chainPositions.length) return '';
    return `<section class="chain-positions"><h2>${t('openPositions')} · ${esc(chainModel.chain.name)}</h2>${chainModel.chainPositions.map((position) => {
      const mark = Tango.Engine.markPosition(position, undefined, chainModel.nativePriceUsd);
      return `<div class="chain-position"><strong>${esc(position.symbol || position.tokenAddress)}</strong><span>${Tango.Format.native(mark.valueNative, chainModel.nativeSymbol, language())}</span></div>`;
    }).join('')}</section>`;
  }

  function render() {
    document.documentElement.lang = language();
    if (document.documentElement.dataset) document.documentElement.dataset.theme = Tango.I18n.resolveTheme?.(settings?.theme)
      || (settings?.theme === 'light' ? 'light' : 'dark');
    if (loadError || !state || !settings) {
      app.innerHTML = `<div class="popup"><section class="setup-card storage-error">
        <h2>${t('storageLoadFailed')}</h2><p>${t('storageLoadFailedHint')}</p>
        <button class="button" id="retry-storage-load">${t('retry')}</button>
      </section></div>`;
      document.querySelector('#retry-storage-load')?.addEventListener('click', () => loadInitial());
      return;
    }
    const switchMarkup = `<label class="master-switch"><span><strong>${t('enabled')}</strong><small>${settings.enabled ? 'ON' : 'OFF'}</small></span><input id="master-enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}><i></i></label>`;
    if (!state.initialized) {
      app.innerHTML = `<div class="popup">
        <div class="brand-row"><div class="brand"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div>${switchMarkup}</div>
        <section class="setup-card"><h2>${t('setup')}</h2><p>${t('onboardingPopupHint')}</p>
          <button class="button" id="open-onboarding">${t('startPaperTrading')}</button>
        </section>
        ${settings.enabled ? '' : `<div class="disabled-note">${t('disabled')}</div>`}
      </div>`;
    } else {
      const chainModel = model();
      const summary = chainModel.summary;
      const commonCapital = commonCapitalSnapshot();
      app.innerHTML = `<div class="popup">
        <div class="brand-row"><div class="brand"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div>${switchMarkup}</div>
        <label class="chain-selector"><span>${selectedChainLabel()}</span><select id="popup-chain">${chainModel.chainOptions.map((chain) => `<option value="${chain.id}" ${chain.id === chainModel.chain.id ? 'selected' : ''}>${esc(chain.name)} (${esc(chain.nativeSymbol)})</option>`).join('')}</select></label>
        ${settings.enabled ? `<div class="stats">
          <div class="stat"><span>${t('balance')}</span><strong>${Tango.Format.native(summary.cashBalanceNative, chainModel.nativeSymbol, language())}</strong></div>
          <div class="stat"><span>${t('equity')}</span><strong>${Tango.Format.native(summary.equityNative, chainModel.nativeSymbol, language())}</strong></div>
          <div class="stat"><span>${t('totalPnl')}</span><strong class="${cls(summary.totalPnlNative)}">${Tango.Format.native(summary.totalPnlNative, chainModel.nativeSymbol, language(), true)}</strong></div>
          <div class="stat"><span>${t('positions')}</span><strong>${summary.positionCount}</strong></div>
        </div>
        ${selectedPositions(chainModel)}
        <section class="global-summary"><h2>${globalUsdLabel()}</h2><div class="stats">
          <div class="stat"><span>${t('totalAssets')}</span><strong>${Tango.Format.usd(chainModel.globalUsd.assetsUsd, language())}</strong></div>
          <div class="stat"><span>${t('totalPnl')}</span><strong class="${cls(chainModel.globalUsd.pnlUsd)}">${Tango.Format.usd(chainModel.globalUsd.pnlUsd, language())}</strong></div>
        </div>${chainModel.globalUsd.complete ? '' : `<p class="partial-data">${t('nativePriceStale')}</p>`}
        <button class="button secondary" id="refresh-native-prices">${t('nativePriceRefresh')}</button></section>` : `<div class="disabled-note">${t('disabled')}</div>`}
        <details class="account-settings"><summary>${t('accountSettings')}</summary>
          <label class="field"><span>${t('language')}</span><select id="account-language"><option value="zh-CN" ${language() === 'zh-CN' ? 'selected' : ''}>${t('chinese')}</option><option value="en" ${language() === 'en' ? 'selected' : ''}>${t('english')}</option></select></label>
          <label class="field"><span>${t('commonCapital')}</span><input class="input" id="common-capital-balance" type="number" min="0" max="1000000000000000" step="any" value="${esc(commonCapital.value)}"></label>
          <button class="button secondary reset-balance" id="save-common-capital">${allChainsLabel()} · ${t('resetWithBalance')}</button>
          <small class="reset-note">${t('independentChains')}</small>
          <small class="reset-note">${t('calendarClearedOnReset')}</small>
          <small class="reset-note">${t('resetWarning')}</small>
          <button class="button secondary" id="reset-all-button">${allChainsLabel()} · ${t('resetAccount')}</button>
        </details>
        <button class="button" id="dashboard">${t('openDashboard')}</button><button class="button secondary" id="gmgn">GMGN →</button>
      </div>`;
    }
    if (statusMessage) app.innerHTML += `<div class="disabled-note storage-status">${esc(statusMessage)}</div>`;
    bind();
  }

  function bind() {
    document.querySelector('#refresh-native-prices')?.addEventListener('click', refreshNativePrices);
    document.querySelector('#master-enabled')?.addEventListener('change', async (event) => {
      await persistSettings({ enabled: event.target.checked });
    });
    document.querySelector('#account-language')?.addEventListener('change', async (event) => {
      await persistSettings({ language: event.target.value });
    });
    document.querySelector('#popup-chain')?.addEventListener('change', async (event) => {
      await saveSelectedChain(event.target.value);
    });
    document.querySelector('#open-onboarding')?.addEventListener('click', () => {
      global.chrome.tabs.create({ url: global.chrome.runtime.getURL('dashboard.html?onboarding=1') });
    });
    document.querySelector('#save-common-capital')?.addEventListener('click', async () => {
      const balance = Number(document.querySelector('#common-capital-balance')?.value);
      if (!validCommonCapital(balance)) { statusMessage = t('invalidCommonCapital'); renderPriceUpdate(); return; }
      await settingsWrite;
      try { await reload(); } catch { /* runStoreWrite will surface a failed mutation */ }
      const currentCapital = commonCapitalSnapshot();
      if (currentCapital.consistent && currentCapital.value === balance) return;
      if (!global.confirm(t('commonCapitalResetConfirm'))) return;
      await runStoreWrite(
        () => Tango.Store.resetAllWithBalance(balance, language()),
        async (result) => {
          if (result?.state && result?.settings) ({ state, settings } = result);
          else await reload();
          render();
        }
      );
    });
    document.querySelector('#reset-all-button')?.addEventListener('click', async () => {
      if (!global.confirm(t('resetAllChainsConfirm'))) return;
      await runStoreWrite(
        () => Tango.Store.resetAll(),
        async () => { await reload(); render(); }
      );
    });
    document.querySelector('#dashboard')?.addEventListener('click', async () => {
      try {
        const response = await global.chrome.runtime.sendMessage({ type: 'TANGO_OPEN_DASHBOARD' });
        if (!response?.ok) throw new Error(response?.error || '');
      } catch (error) {
        const detail = String(error?.message || '').trim().slice(0, 300);
        statusMessage = detail ? `${t('openDashboardFailed')}: ${detail}` : t('openDashboardFailed');
        render();
      }
    });
    document.querySelector('#gmgn')?.addEventListener('click', async () => {
      const selectionRevision = selectedChainRevision;
      if (selectionPending) await selectionPending.promise;
      if (selectionRevision !== selectedChainRevision) return;
      try {
        const response = await global.chrome.runtime.sendMessage({ type: 'TANGO_OPEN_GMGN' });
        if (!response?.ok) throw new Error('openGmgnFailed');
      } catch { statusMessage = t('openGmgnFailed'); render(); }
    });
  }

  global.chrome.storage?.onChanged?.addListener((_changes, areaName) => {
    if (areaName !== 'local') return;
    reload().then(() => {
      loadError = false;
      render();
    }).catch(() => {
      loadError = true;
      render();
    });
  });

  global.matchMedia?.('(prefers-color-scheme: light)')?.addEventListener?.('change', () => {
    if (settings?.theme === 'auto') renderPriceUpdate();
  });
  activeTabChain = await activeGmgnChain();
  await loadInitial();
})(globalThis);
