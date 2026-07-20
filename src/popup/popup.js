(async function initPopup(global) {
  const Tango = global.Tango;
  const app = document.querySelector('#app');
  let state = null;
  let settings = null;
  let nativePrices = {};
  let nativePriceObservedAt = {};
  let selectedChainRevision = 0;
  let visibleSelectedChain = 'sol';
  let selectionPending = null;
  let settingsWrite = Promise.resolve();
  let loadError = false;
  let statusMessage = '';

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const language = () => Tango.I18n.resolveLanguage(settings?.language);
  const t = (key) => Tango.I18n.t(key, settings?.language);
  const cls = (value) => Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : '';
  const selectedChainLabel = () => language() === 'zh-CN' ? '已选链' : 'Selected chain';
  const allChainsLabel = () => language() === 'zh-CN' ? '全部链' : 'All chains';
  const globalUsdLabel = () => language() === 'zh-CN' ? '全部链 USD 汇总' : 'All-chain USD summary';
  function model() {
    return Tango.PopupModel.build(state, settings, visibleSelectedChain, nativePrices);
  }

  async function reload() {
    ({ state, settings } = await Tango.Store.getAll());
    const hasSelectionIntent = selectionPending?.revision === selectedChainRevision;
    if (!hasSelectionIntent) {
      visibleSelectedChain = Tango.Chains.get(settings?.selectedChain)?.id || 'sol';
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
      if (state.initialized) refreshNativePrices();
      return true;
    } catch {
      loadError = true;
      render();
      return false;
    }
  }

  function saveSelectedChain(chainId) {
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

  async function selectedModel(chainId = visibleSelectedChain) {
    const pending = selectionPending;
    if (pending) await pending.promise;
    if (visibleSelectedChain !== chainId || settings?.selectedChain !== chainId) return null;
    const selected = model();
    return selected.chain.id === chainId ? selected : null;
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
    const observations = await Promise.all(Tango.Chains.all().map(async (chain) => {
      try {
        const observation = await global.chrome?.runtime?.sendMessage({ type: 'TANGO_GET_NATIVE_PRICE', chain: chain.id });
        return [chain.id, observation?.ok && Number(observation.price) > 0 ? observation : null];
      } catch { return [chain.id, null]; }
    }));
    nativePrices = Object.fromEntries(observations.map(([chain, observation]) => [chain, Number(observation?.price || 0)]));
    nativePriceObservedAt = Object.fromEntries(observations.map(([chain, observation]) => [chain, Number(observation?.observedAt || 0)]));
    render();
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
        <section class="setup-card"><h2>${t('setup')}</h2><p>${t('setupHint')}</p>
          <label class="field"><span>${t('language')}</span><select id="setup-language"><option value="zh-CN" ${language() === 'zh-CN' ? 'selected' : ''}>${t('chinese')}</option><option value="en" ${language() === 'en' ? 'selected' : ''}>${t('english')}</option></select></label>
          <button class="button" id="initialize">${t('startPaperTrading')}</button>
        </section>
        ${settings.enabled ? '' : `<div class="disabled-note">${t('disabled')}</div>`}
      </div>`;
    } else {
      const chainModel = model();
      const summary = chainModel.summary;
      const selectedBalance = settings.chains?.[chainModel.chain.id]?.initialBalanceNative || 10;
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
        </div>${chainModel.globalUsd.complete ? '' : `<p class="partial-data">${t('partialUsdData')}</p>`}</section>` : `<div class="disabled-note">${t('disabled')}</div>`}
        <details class="account-settings"><summary>${t('accountSettings')}</summary>
          <label class="field"><span>${t('language')}</span><select id="account-language"><option value="zh-CN" ${language() === 'zh-CN' ? 'selected' : ''}>${t('chinese')}</option><option value="en" ${language() === 'en' ? 'selected' : ''}>${t('english')}</option></select></label>
          <label class="field"><span>${t('startingBalance')} · ${esc(chainModel.nativeSymbol)}</span><input class="input" id="reset-balance" type="number" min="0.01" step="0.01" value="${esc(selectedBalance)}"></label>
          <button class="button secondary reset-balance" id="reset-chain-button">${selectedChainLabel()} · ${esc(chainModel.chain.name)} · ${t('resetWithBalance')}</button>
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
    document.querySelector('#master-enabled')?.addEventListener('change', async (event) => {
      await persistSettings({ enabled: event.target.checked });
    });
    document.querySelector('#setup-language')?.addEventListener('change', (event) => {
      settings.language = event.target.value;
      render();
    });
    document.querySelector('#account-language')?.addEventListener('change', async (event) => {
      await persistSettings({ language: event.target.value });
    });
    document.querySelector('#popup-chain')?.addEventListener('change', async (event) => {
      await saveSelectedChain(event.target.value);
    });
    document.querySelector('#initialize')?.addEventListener('click', async () => {
      await runStoreWrite(
        () => Tango.Store.initialize(10, settings.language),
        async (data) => {
          state = data.state;
          settings = data.settings;
          render();
          refreshNativePrices();
        }
      );
    });
    document.querySelector('#reset-chain-button')?.addEventListener('click', async () => {
      const chainId = visibleSelectedChain;
      const chainModel = await selectedModel(chainId);
      if (!chainModel) return;
      const balance = Number(document.querySelector('#reset-balance')?.value);
      if (!(balance > 0) || !global.confirm(t('resetSelectedChainConfirm'))) return;
      const executionModel = await selectedModel(chainId);
      if (!executionModel) return;
      await runStoreWrite(
        () => Tango.Store.resetChain(executionModel.chain.id, balance),
        async () => { await reload(); render(); }
      );
    });
    document.querySelector('#reset-all-button')?.addEventListener('click', async () => {
      if (!global.confirm(t('resetAllChainsConfirm'))) return;
      await runStoreWrite(
        () => Tango.Store.resetAll(),
        async () => { await reload(); render(); }
      );
    });
    document.querySelector('#dashboard')?.addEventListener('click', () => global.chrome.runtime.openOptionsPage());
    document.querySelector('#gmgn')?.addEventListener('click', async () => {
      const chainId = visibleSelectedChain;
      const chainModel = await selectedModel(chainId);
      if (chainModel) global.chrome.tabs.create({ url: Tango.Chains.trenchUrl(chainModel.chain.id) });
    });
  }

  await loadInitial();
})(globalThis);
