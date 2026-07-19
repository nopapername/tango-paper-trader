(async function initPopup(global) {
  const Tango = global.Tango;
  const app = document.querySelector('#app');
  let { state, settings } = await Tango.Store.getAll();
  let nativePrices = {};
  let nativePriceObservedAt = {};
  let selectedChainRevision = 0;
  let selectedChainWrite = Promise.resolve();

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const language = () => Tango.I18n.resolveLanguage(settings.language);
  const t = (key) => Tango.I18n.t(key, settings.language);
  const cls = (value) => Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : '';
  const selectedChainLabel = () => language() === 'zh-CN' ? '已选链' : 'Selected chain';
  const allChainsLabel = () => language() === 'zh-CN' ? '全部链' : 'All chains';
  const globalUsdLabel = () => language() === 'zh-CN' ? '全部链 USD 汇总' : 'All-chain USD summary';
  const selectedResetConfirm = () => language() === 'zh-CN'
    ? '重置此链并只清空其交易、持仓和盈亏日历记录吗？'
    : 'Reset this chain and clear only its trades, positions, and PnL calendar records?';

  function model() {
    return Tango.PopupModel.build(state, settings, settings.selectedChain, nativePrices);
  }

  async function reload() {
    ({ state, settings } = await Tango.Store.getAll());
  }

  function saveSelectedChain(chainId) {
    const revision = ++selectedChainRevision;
    selectedChainWrite = selectedChainWrite.then(async () => {
      if (revision !== selectedChainRevision) return;
      const latest = await Tango.Store.getAll();
      if (revision !== selectedChainRevision) return;
      const next = await Tango.Store.saveSettings({ ...latest.settings, selectedChain: chainId });
      if (revision !== selectedChainRevision) return;
      settings = next;
      render();
    });
    return selectedChainWrite;
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
      const mark = Tango.Engine.markPosition(position);
      return `<div class="chain-position"><strong>${esc(position.symbol || position.tokenAddress)}</strong><span>${Tango.Format.native(mark.valueNative, chainModel.nativeSymbol, language())}</span></div>`;
    }).join('')}</section>`;
  }

  function render() {
    document.documentElement.lang = language();
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
    bind();
  }

  function bind() {
    document.querySelector('#master-enabled')?.addEventListener('change', async (event) => {
      settings = await Tango.Store.saveSettings({ ...settings, enabled: event.target.checked });
      render();
    });
    document.querySelector('#setup-language')?.addEventListener('change', (event) => {
      settings.language = event.target.value;
      render();
    });
    document.querySelector('#account-language')?.addEventListener('change', async (event) => {
      settings = await Tango.Store.saveSettings({ ...settings, language: event.target.value });
      render();
    });
    document.querySelector('#popup-chain')?.addEventListener('change', async (event) => {
      await saveSelectedChain(event.target.value);
    });
    document.querySelector('#initialize')?.addEventListener('click', async () => {
      const data = await Tango.Store.initialize(10, settings.language);
      state = data.state;
      settings = data.settings;
      render();
      refreshNativePrices();
    });
    document.querySelector('#reset-chain-button')?.addEventListener('click', async () => {
      const chainModel = model();
      const balance = Number(document.querySelector('#reset-balance')?.value);
      if (!(balance > 0) || !global.confirm(selectedResetConfirm())) return;
      await Tango.Store.resetChain(chainModel.chain.id, balance);
      await reload();
      render();
    });
    document.querySelector('#reset-all-button')?.addEventListener('click', async () => {
      if (!global.confirm(t('resetConfirm'))) return;
      await Tango.Store.resetAll();
      await reload();
      render();
    });
    document.querySelector('#dashboard')?.addEventListener('click', () => global.chrome.runtime.openOptionsPage());
    document.querySelector('#gmgn')?.addEventListener('click', () => global.chrome.tabs.create({ url: Tango.Chains.trenchUrl(model().chain.id) }));
  }

  render();
  if (state.initialized) refreshNativePrices();
})(globalThis);
