(async function initPopup(global) {
  const Tango = global.Tango;
  const app = document.querySelector('#app');
  let { state, settings } = await Tango.Store.getAll();
  let pendingBalance = Number(settings.initialBalanceSol || 100);

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const language = () => Tango.I18n.resolveLanguage(settings.language);
  const t = (key) => Tango.I18n.t(key, settings.language);
  const cls = (value) => Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : '';

  function render() {
    document.documentElement.lang = language();
    const switchMarkup = `<label class="master-switch"><span><strong>${t('enabled')}</strong><small>${settings.enabled ? 'ON' : 'OFF'}</small></span><input id="master-enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}><i></i></label>`;
    if (!state.initialized) {
      app.innerHTML = `<div class="popup">
        <div class="brand-row"><div class="brand"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div>${switchMarkup}</div>
        <section class="setup-card"><h2>${t('setup')}</h2><p>${t('setupHint')}</p>
          <label class="field"><span>${t('language')}</span><select id="setup-language"><option value="zh-CN" ${language() === 'zh-CN' ? 'selected' : ''}>简体中文</option><option value="en" ${language() === 'en' ? 'selected' : ''}>English</option></select></label>
          <span class="field-label">${t('startingBalance')}</span>
          <div class="balance-options">${[10, 50, 100].map((value) => `<button class="balance-button ${pendingBalance === value ? 'selected' : ''}" data-balance="${value}">${value} SOL</button>`).join('')}</div>
          <input class="input" id="custom-balance" type="number" min="0.01" step="0.01" placeholder="${t('customBalance')} · SOL">
          <button class="button" id="initialize">${t('startPaperTrading')}</button>
        </section>
        ${settings.enabled ? '' : `<div class="disabled-note">${t('disabled')}</div>`}
      </div>`;
    } else {
      const summary = Tango.Engine.portfolioSummary(state);
      app.innerHTML = `<div class="popup">
        <div class="brand-row"><div class="brand"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div>${switchMarkup}</div>
        ${settings.enabled ? `<div class="stats">
          <div class="stat"><span>${t('balance')}</span><strong>${Tango.Format.sol(summary.cashBalanceSol, language())}</strong></div>
          <div class="stat"><span>${t('equity')}</span><strong>${Tango.Format.sol(summary.equitySol, language())}</strong></div>
          <div class="stat"><span>${t('totalPnl')}</span><strong class="${cls(summary.totalPnlSol)}">${Tango.Format.sol(summary.totalPnlSol, language(), true)}</strong></div>
          <div class="stat"><span>${t('positions')}</span><strong>${summary.positionCount}</strong></div>
        </div>` : `<div class="disabled-note">${t('disabled')}</div>`}
        <button class="button" id="dashboard">${t('openDashboard')}</button><button class="button secondary" id="gmgn">GMGN ↗</button>
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
    document.querySelectorAll('[data-balance]').forEach((button) => button.addEventListener('click', () => {
      pendingBalance = Number(button.dataset.balance);
      render();
    }));
    document.querySelector('#initialize')?.addEventListener('click', async () => {
      const custom = Number(document.querySelector('#custom-balance')?.value);
      const balance = custom > 0 ? custom : pendingBalance;
      const data = await Tango.Store.initialize(balance, settings.language);
      state = data.state;
      settings = data.settings;
      render();
    });
    document.querySelector('#dashboard')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
    document.querySelector('#gmgn')?.addEventListener('click', () => chrome.tabs.create({ url: 'https://gmgn.ai/?chain=sol' }));
  }

  render();
})(globalThis);
