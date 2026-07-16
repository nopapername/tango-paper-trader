(() => {
  'use strict';

  const NS = 'gmgnPaperTrader';
  const STORAGE = {
    settings: `${NS}.settings`,
    account: `${NS}.account`,
    positions: `${NS}.positions`,
    trades: `${NS}.trades`,
    panelPosition: `${NS}.panelPosition`
  };
  const CHAIN_CONFIG = {
    sol: { quote: 'SOL', initial: 10 },
    bsc: { quote: 'BNB', initial: 5 },
    base: { quote: 'ETH', initial: 5 },
    eth: { quote: 'ETH', initial: 5 },
    tron: { quote: 'TRX', initial: 1000 },
    monad: { quote: 'MON', initial: 100 },
    hyperevm: { quote: 'HYPE', initial: 10 },
    megaeth: { quote: 'ETH', initial: 5 },
    xlayer: { quote: 'OKB', initial: 10 },
    robinhood: { quote: 'USD', initial: 10000 }
  };
  const CHAIN_ALIASES = {
    solana: 'sol', bnb: 'bsc', ethereum: 'eth', hyper: 'hyperevm',
    hyper_evm: 'hyperevm', mega: 'megaeth', x_layer: 'xlayer', rh: 'robinhood'
  };
  const DEFAULT_BALANCES = Object.fromEntries(Object.entries(CHAIN_CONFIG).map(([chain, config]) => [chain, config.initial]));
  const DEFAULT_SETTINGS = {
    startingBalances: DEFAULT_BALANCES,
    feePct: 1,
    slippagePct: 0.5,
    buyPresets: [0.1, 0.25, 0.5, 1],
    sellPresets: [25, 50, 75, 100]
  };

  let routeKey = '';
  let token = null;
  let currentPrice = null;
  let manualPrice = null;
  let panel = null;
  let refreshTimer = null;

  const storageGet = (defaults) => new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  const storageSet = (value) => new Promise((resolve) => chrome.storage.local.set(value, resolve));

  function parseRoute() {
    const match = location.pathname.match(/^\/([^/?#]+)\/token\/([^/?#]+)/i);
    if (!match) return null;
    const routeChain = match[1].toLowerCase();
    const chain = CHAIN_ALIASES[routeChain] || routeChain;
    const address = decodeURIComponent(match[2]);
    const config = CHAIN_CONFIG[chain] || { quote: chain.toUpperCase(), initial: 100 };
    return {
      chain,
      address,
      key: `${chain}:${address.toLowerCase()}`,
      quote: config.quote
    };
  }

  function visible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function parseNumber(text) {
    if (!text) return null;
    let value = String(text).replace(/,/g, '').replace(/\s+/g, ' ').trim();
    const suffix = value.match(/(-?\d+(?:\.\d+)?)\s*([KMBT])\b/i);
    if (suffix) {
      const multipliers = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
      return Number(suffix[1]) * multipliers[suffix[2].toUpperCase()];
    }
    const match = value.match(/\$?\s*(0\.0+\d+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
    if (!match) return null;
    const number = Number(match[1]);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function extractPrice() {
    if (manualPrice && manualPrice > 0) return manualPrice;

    const selectors = [
      '[data-testid="token-price"]',
      '[data-testid*="price" i]',
      '[class*="token-price" i]',
      '[class*="TokenPrice"]',
      '[aria-label*="price" i]'
    ];
    const candidates = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        const text = (element.textContent || element.getAttribute('aria-label') || '').trim();
        if (!text || text.length > 80) continue;
        const price = parseNumber(text);
        if (!price || price > 1e9) continue;
        let score = 1;
        if (/price/i.test(element.getAttribute('data-testid') || '')) score += 5;
        if (/price/i.test(element.getAttribute('aria-label') || '')) score += 4;
        if (/\$/.test(text)) score += 2;
        if (/price/i.test((element.parentElement?.textContent || '').slice(0, 120))) score += 2;
        candidates.push({ price, score });
      }
    }

    if (candidates.length) {
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0].price;
    }

    // GMGN 页面结构变化时的保守兜底：只检查带 Price 标签的短文本节点。
    for (const element of document.querySelectorAll('div,span')) {
      if (!visible(element)) continue;
      const text = (element.textContent || '').trim();
      if (text.length > 70 || !/price/i.test(text) || !/\$/.test(text)) continue;
      const price = parseNumber(text.replace(/.*?price\s*[:：]?/i, ''));
      if (price && price < 1e9) return price;
    }
    return null;
  }

  function extractTokenMeta(route) {
    const title = document.title.replace(/\s*[|｜-]\s*GMGN.*$/i, '').trim();
    const heading = [...document.querySelectorAll('h1,h2')]
      .find((element) => visible(element) && (element.textContent || '').trim().length < 80);
    const raw = (heading?.textContent || title || route.address.slice(0, 8)).trim();
    const symbolMatch = raw.match(/\$([A-Za-z0-9_]+)/) || raw.match(/\(([A-Za-z0-9_]{2,16})\)/);
    const symbol = symbolMatch?.[1] || raw.split(/\s+/)[0] || route.address.slice(0, 6);
    return { ...route, name: raw, symbol: symbol.toUpperCase() };
  }

  function money(value, digits = 5) {
    if (!Number.isFinite(value)) return '--';
    if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (Math.abs(value) >= 1) return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '') || '0';
  }

  function usd(value) {
    if (!Number.isFinite(value)) return '--';
    if (value >= 1) return `$${money(value, 4)}`;
    return `$${value.toPrecision(6)}`;
  }

  async function loadState() {
    const data = await storageGet({
      [STORAGE.settings]: DEFAULT_SETTINGS,
      [STORAGE.account]: null,
      [STORAGE.positions]: {},
      [STORAGE.trades]: []
    });
    const settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE.settings] || {}) };
    settings.startingBalances = { ...DEFAULT_SETTINGS.startingBalances, ...(settings.startingBalances || {}) };
    const account = data[STORAGE.account] || {
      balances: { ...settings.startingBalances },
      initialBalances: { ...settings.startingBalances },
      createdAt: Date.now()
    };
    account.balances = { ...DEFAULT_BALANCES, ...settings.startingBalances, ...(account.balances || {}) };
    account.initialBalances = { ...settings.startingBalances, ...(account.initialBalances || {}) };
    return {
      settings,
      account,
      positions: data[STORAGE.positions] || {},
      trades: data[STORAGE.trades] || []
    };
  }

  async function ensureAccount() {
    const state = await loadState();
    const existing = await storageGet({ [STORAGE.account]: null });
    if (!existing[STORAGE.account]) await storageSet({ [STORAGE.account]: state.account });
    return state;
  }

  async function buy(amount) {
    if (!token || !currentPrice) return toast('请先输入或等待识别价格', 'error');
    const state = await ensureAccount();
    const quoteKey = token.chain;
    const balance = Number(state.account.balances[quoteKey] || 0);
    amount = Number(amount);
    if (!Number.isFinite(amount) || amount <= 0) return toast('请输入有效买入金额', 'error');
    if (amount > balance) return toast(`虚拟余额不足：${money(balance)} ${token.quote}`, 'error');

    const fee = amount * state.settings.feePct / 100;
    const executionPrice = currentPrice * (1 + state.settings.slippagePct / 100);
    const units = (amount - fee) / executionPrice;
    if (units <= 0) return toast('手续费设置过高', 'error');

    const position = state.positions[token.key] || {
      key: token.key,
      chain: token.chain,
      address: token.address,
      quote: token.quote,
      symbol: token.symbol,
      name: token.name,
      units: 0,
      costBasis: 0,
      realizedPnl: 0,
      lastPrice: currentPrice
    };
    position.units += units;
    position.costBasis += amount;
    position.avgEntry = position.costBasis / position.units;
    position.lastPrice = currentPrice;
    position.updatedAt = Date.now();
    state.positions[token.key] = position;
    state.account.balances[quoteKey] = balance - amount;
    state.trades.unshift({
      id: crypto.randomUUID(), type: 'BUY', time: Date.now(), tokenKey: token.key,
      chain: token.chain, symbol: token.symbol, address: token.address, quote: token.quote,
      amount, units, marketPrice: currentPrice, executionPrice, fee
    });
    state.trades = state.trades.slice(0, 1000);
    await storageSet({
      [STORAGE.account]: state.account,
      [STORAGE.positions]: state.positions,
      [STORAGE.trades]: state.trades
    });
    toast(`已虚拟买入 ${money(amount)} ${token.quote}`, 'success');
    await renderState();
  }

  async function sell(percent) {
    if (!token || !currentPrice) return toast('请先输入或等待识别价格', 'error');
    const state = await ensureAccount();
    const position = state.positions[token.key];
    percent = Number(percent);
    if (!position || position.units <= 0) return toast('当前代币没有虚拟持仓', 'error');
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return toast('请输入 1–100 的卖出比例', 'error');

    const fraction = percent / 100;
    const units = percent >= 99.999 ? position.units : position.units * fraction;
    const allocatedCost = position.costBasis * (units / position.units);
    const executionPrice = currentPrice * (1 - state.settings.slippagePct / 100);
    const gross = units * executionPrice;
    const fee = gross * state.settings.feePct / 100;
    const net = gross - fee;
    const pnl = net - allocatedCost;

    state.account.balances[token.chain] = Number(state.account.balances[token.chain] || 0) + net;
    position.units -= units;
    position.costBasis -= allocatedCost;
    position.realizedPnl = Number(position.realizedPnl || 0) + pnl;
    position.lastPrice = currentPrice;
    position.updatedAt = Date.now();
    if (position.units < 1e-15 || percent >= 99.999) delete state.positions[token.key];
    else {
      position.avgEntry = position.costBasis / position.units;
      state.positions[token.key] = position;
    }
    state.trades.unshift({
      id: crypto.randomUUID(), type: 'SELL', time: Date.now(), tokenKey: token.key,
      chain: token.chain, symbol: token.symbol, address: token.address, quote: token.quote,
      amount: net, units, marketPrice: currentPrice, executionPrice, fee, pnl
    });
    state.trades = state.trades.slice(0, 1000);
    await storageSet({
      [STORAGE.account]: state.account,
      [STORAGE.positions]: state.positions,
      [STORAGE.trades]: state.trades
    });
    toast(`已虚拟卖出 ${percent}% · PnL ${pnl >= 0 ? '+' : ''}${money(pnl)} ${token.quote}`, pnl >= 0 ? 'success' : 'error');
    await renderState();
  }

  function panelMarkup() {
    return `
      <div class="gpt-card">
        <div class="gpt-header">
          <div class="gpt-title"><strong>虚拟交易面板</strong><span class="gpt-live">SIM</span><small>TANGO PAPER TRADER</small></div>
          <button class="gpt-icon" data-action="collapse" title="折叠">−</button>
        </div>
        <div class="gpt-body">
          <div class="gpt-token-row">
            <div><b data-role="symbol">--</b><small data-role="address">--</small></div>
            <div class="gpt-price"><small>标记价格</small><b data-role="price">识别中</b></div>
          </div>
          <div class="gpt-manual">
            <input data-role="manual-price" type="number" min="0" step="any" placeholder="无法识别？输入 USD 价格">
            <button data-action="set-price">应用</button>
            <button data-action="auto-price">自动</button>
          </div>
          <div class="gpt-stats">
            <div><small>虚拟余额</small><b data-role="balance">--</b></div>
            <div><small>持仓价值</small><b data-role="value">--</b></div>
            <div><small>未实现 PnL</small><b data-role="pnl">--</b></div>
          </div>
          <div class="gpt-section gpt-buy-section">
            <div class="gpt-label"><span>买入</span><span data-role="costs">--</span></div>
            <div class="gpt-presets" data-role="buy-presets"></div>
            <div class="gpt-order"><input data-role="buy-amount" type="number" min="0" step="any" placeholder="自定义金额"><button class="gpt-buy" data-action="buy">虚拟买入</button></div>
          </div>
          <div class="gpt-section gpt-sell-section">
            <div class="gpt-label"><span>卖出持仓</span><span data-role="position">--</span></div>
            <div class="gpt-presets" data-role="sell-presets"></div>
            <div class="gpt-order"><input data-role="sell-percent" type="number" min="1" max="100" placeholder="比例 %"><button class="gpt-sell" data-action="sell">虚拟卖出</button></div>
          </div>
          <div class="gpt-footer"><b>仅供模拟训练</b> · 不连接钱包 · 不发送真实交易</div>
        </div>
        <div class="gpt-toast" data-role="toast"></div>
      </div>`;
  }

  function clampPanelPosition(left, top) {
    const rect = panel.getBoundingClientRect();
    return {
      left: Math.max(8, Math.min(left, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - Math.min(rect.height, window.innerHeight - 16) - 8))
    };
  }

  async function restorePanelPosition() {
    const data = await storageGet({ [STORAGE.panelPosition]: null });
    const saved = data[STORAGE.panelPosition];
    if (!panel || !saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return;
    const next = clampPanelPosition(saved.left, saved.top);
    panel.style.left = `${next.left}px`;
    panel.style.top = `${next.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function enablePanelDrag() {
    const handle = panel.querySelector('.gpt-header');
    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add('gpt-dragging');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const next = clampPanelPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    const finish = async (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag = null;
      panel.classList.remove('gpt-dragging');
      const rect = panel.getBoundingClientRect();
      await storageSet({ [STORAGE.panelPosition]: { left: rect.left, top: rect.top } });
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function createPanel() {
    panel?.remove();
    panel = document.createElement('div');
    panel.id = 'gmgn-paper-trader-root';
    panel.innerHTML = panelMarkup();
    document.documentElement.appendChild(panel);
    enablePanelDrag();
    restorePanelPosition();
    panel.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'collapse') {
        panel.classList.toggle('gpt-collapsed');
        button.textContent = panel.classList.contains('gpt-collapsed') ? '+' : '−';
      } else if (action === 'set-price') {
        const value = Number(panel.querySelector('[data-role="manual-price"]').value);
        if (!(value > 0)) return toast('请输入有效 USD 价格', 'error');
        manualPrice = value;
        currentPrice = value;
        await renderState();
      } else if (action === 'auto-price') {
        manualPrice = null;
        panel.querySelector('[data-role="manual-price"]').value = '';
        currentPrice = extractPrice();
        await renderState();
      } else if (action === 'buy-preset') {
        await buy(Number(button.dataset.value));
      } else if (action === 'sell-preset') {
        await sell(Number(button.dataset.value));
      } else if (action === 'buy') {
        await buy(panel.querySelector('[data-role="buy-amount"]').value);
      } else if (action === 'sell') {
        await sell(panel.querySelector('[data-role="sell-percent"]').value);
      }
    });
  }

  function toast(message, type = '') {
    if (!panel) return;
    const element = panel.querySelector('[data-role="toast"]');
    element.textContent = message;
    element.className = `gpt-toast show ${type}`;
    clearTimeout(element._timer);
    element._timer = setTimeout(() => { element.className = 'gpt-toast'; }, 3200);
  }

  async function renderState() {
    if (!panel || !token) return;
    const state = await ensureAccount();
    const position = state.positions[token.key];
    const balance = Number(state.account.balances[token.chain] || 0);
    const value = position && currentPrice ? position.units * currentPrice : 0;
    const pnl = position ? value - position.costBasis : 0;

    panel.querySelector('[data-role="symbol"]').textContent = token.symbol;
    panel.querySelector('[data-role="address"]').textContent = `${token.address.slice(0, 6)}…${token.address.slice(-5)}`;
    panel.querySelector('[data-role="price"]').textContent = currentPrice ? usd(currentPrice) : '等待价格';
    panel.querySelector('[data-role="balance"]').textContent = `${money(balance)} ${token.quote}`;
    panel.querySelector('[data-role="value"]').textContent = `${money(value)} ${token.quote}`;
    const pnlElement = panel.querySelector('[data-role="pnl"]');
    pnlElement.textContent = `${pnl >= 0 ? '+' : ''}${money(pnl)} ${token.quote}`;
    pnlElement.className = pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : '';
    panel.querySelector('[data-role="position"]').textContent = position
      ? `均价 ${usd(position.avgEntry)} · ${money(position.units, 8)} units`
      : '暂无持仓';
    panel.querySelector('[data-role="costs"]').textContent = `费 ${state.settings.feePct}% · 滑点 ${state.settings.slippagePct}%`;
    panel.querySelector('[data-role="buy-presets"]').innerHTML = state.settings.buyPresets
      .map((amount) => `<button data-action="buy-preset" data-value="${amount}">${amount} ${token.quote}</button>`).join('');
    panel.querySelector('[data-role="sell-presets"]').innerHTML = state.settings.sellPresets
      .map((percent) => `<button data-action="sell-preset" data-value="${percent}">${percent}%</button>`).join('');

    if (position && currentPrice && position.lastPrice !== currentPrice) {
      position.lastPrice = currentPrice;
      position.updatedAt = Date.now();
      state.positions[token.key] = position;
      await storageSet({ [STORAGE.positions]: state.positions });
    }
  }

  async function handleRoute() {
    const route = parseRoute();
    const nextKey = route?.key || '';
    if (nextKey === routeKey && panel?.isConnected) return;
    routeKey = nextKey;
    manualPrice = null;
    currentPrice = null;
    if (!route) {
      panel?.remove();
      panel = null;
      token = null;
      return;
    }
    token = extractTokenMeta(route);
    createPanel();
    currentPrice = extractPrice();
    await renderState();
  }

  async function tick() {
    await handleRoute();
    if (!token || !panel) return;
    token = extractTokenMeta(token);
    const detected = extractPrice();
    if (detected && detected !== currentPrice) {
      currentPrice = detected;
      await renderState();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && panel && Object.keys(changes).some((key) => key.startsWith(NS))) renderState();
  });
  handleRoute();
  refreshTimer = setInterval(tick, 1500);
  window.addEventListener('beforeunload', () => clearInterval(refreshTimer), { once: true });
})();
