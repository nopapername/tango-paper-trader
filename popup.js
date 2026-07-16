(() => {
  'use strict';
  const NS = 'gmgnPaperTrader';
  const STORAGE = {
    settings: `${NS}.settings`, account: `${NS}.account`,
    positions: `${NS}.positions`, trades: `${NS}.trades`
  };
  const CHAIN_CONFIG = {
    sol: { name: 'Solana', quote: 'SOL', initial: 10 }, bsc: { name: 'BSC', quote: 'BNB', initial: 5 },
    base: { name: 'Base', quote: 'ETH', initial: 5 }, eth: { name: 'Ethereum', quote: 'ETH', initial: 5 },
    tron: { name: 'Tron', quote: 'TRX', initial: 1000 }, monad: { name: 'Monad', quote: 'MON', initial: 100 },
    hyperevm: { name: 'HyperEVM', quote: 'HYPE', initial: 10 }, megaeth: { name: 'MegaETH', quote: 'ETH', initial: 5 },
    xlayer: { name: 'X Layer', quote: 'OKB', initial: 10 }, robinhood: { name: 'Robinhood', quote: 'USD', initial: 10000 }
  };
  const DEFAULT_BALANCES = Object.fromEntries(Object.entries(CHAIN_CONFIG).map(([chain, config]) => [chain, config.initial]));
  const DEFAULTS = { startingBalances: DEFAULT_BALANCES, feePct: 1, slippagePct: 0.5, buyPresets: [0.1, .25, .5, 1], sellPresets: [25, 50, 75, 100] };
  const get = (defaults) => new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  const set = (value) => new Promise((resolve) => chrome.storage.local.set(value, resolve));
  const $ = (selector) => document.querySelector(selector);

  function number(value, digits = 5) {
    value = Number(value);
    if (!Number.isFinite(value)) return '--';
    return value.toLocaleString(undefined, { maximumFractionDigits: digits });
  }
  function price(value) {
    value = Number(value);
    return Number.isFinite(value) ? `$${value < 1 ? value.toPrecision(5) : number(value, 4)}` : '--';
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
  function status(message) { $('#status').textContent = message; setTimeout(() => $('#status').textContent = '不连接钱包，不发送真实交易', 2200); }

  async function state() {
    const data = await get({ [STORAGE.settings]: DEFAULTS, [STORAGE.account]: null, [STORAGE.positions]: {}, [STORAGE.trades]: [] });
    const settings = { ...DEFAULTS, ...(data[STORAGE.settings] || {}) };
    settings.startingBalances = { ...DEFAULTS.startingBalances, ...(settings.startingBalances || {}) };
    if (data[STORAGE.account]) {
      data[STORAGE.account].balances = { ...DEFAULT_BALANCES, ...settings.startingBalances, ...(data[STORAGE.account].balances || {}) };
    }
    return { settings, account: data[STORAGE.account], positions: data[STORAGE.positions] || {}, trades: data[STORAGE.trades] || [] };
  }

  async function render() {
    const data = await state();
    const balances = data.account?.balances || data.settings.startingBalances;
    $('#balances').innerHTML = Object.entries(CHAIN_CONFIG).map(([chain, config]) =>
      `<div><small>${escapeHtml(config.name)}</small><b>${number(balances[chain])} ${escapeHtml(config.quote)}</b></div>`
    ).join('');
    $('#chainSettings').innerHTML = Object.entries(CHAIN_CONFIG).map(([chain, config]) =>
      `<label>初始 ${escapeHtml(config.name)}<input data-start-chain="${chain}" type="number" min="0" step="any" value="${Number(data.settings.startingBalances[chain]) || 0}"></label>`
    ).join('');
    $('#feePct').value = data.settings.feePct;
    $('#slippagePct').value = data.settings.slippagePct;

    const positions = Object.values(data.positions);
    $('#positions').innerHTML = positions.length ? positions.map((position) => {
      const value = Number(position.units || 0) * Number(position.lastPrice || 0);
      const pnl = value - Number(position.costBasis || 0);
      return `<div class="item"><div><b>${escapeHtml(position.symbol)}</b><small>${escapeHtml(position.quote)} · 均价 ${price(position.avgEntry)}</small></div><div class="right"><b>${number(value)} ${escapeHtml(position.quote)}</b><small class="${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${number(pnl)} (${position.costBasis ? number(pnl / position.costBasis * 100, 2) : 0}%)</small></div></div>`;
    }).join('') : '<div class="empty">还没有虚拟持仓<br>打开 GMGN 代币页面开始练习</div>';

    $('#trades').innerHTML = data.trades.length ? data.trades.slice(0, 100).map((trade) => {
      const pnl = Number(trade.pnl);
      return `<div class="item"><div><b>${trade.type === 'BUY' ? '买入' : '卖出'} ${escapeHtml(trade.symbol)}</b><small>${new Date(trade.time).toLocaleString()}</small></div><div class="right"><b>${number(trade.amount)} ${escapeHtml(trade.quote)}</b><small>${trade.type === 'SELL' ? `<span class="${pnl >= 0 ? 'positive' : 'negative'}">PnL ${pnl >= 0 ? '+' : ''}${number(pnl)}</span>` : price(trade.executionPrice)}</small></div></div>`;
    }).join('') : '<div class="empty">暂无交易记录</div>';
  }

  document.addEventListener('click', async (event) => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) {
      document.querySelectorAll('nav button,.tab').forEach((element) => element.classList.remove('active'));
      tabButton.classList.add('active');
      $(`#${tabButton.dataset.tab}`).classList.add('active');
    }
  });
  $('#save').addEventListener('click', async () => {
    const data = await state();
    data.settings.startingBalances = { ...data.settings.startingBalances };
    document.querySelectorAll('[data-start-chain]').forEach((input) => {
      data.settings.startingBalances[input.dataset.startChain] = Math.max(0, Number(input.value) || 0);
    });
    data.settings.feePct = Math.min(100, Math.max(0, Number($('#feePct').value) || 0));
    data.settings.slippagePct = Math.min(100, Math.max(0, Number($('#slippagePct').value) || 0));
    await set({ [STORAGE.settings]: data.settings });
    status('设置已保存');
    await render();
  });
  $('#reset').addEventListener('click', async () => {
    if (!confirm('确定清空全部虚拟持仓和交易历史吗？')) return;
    const data = await state();
    await set({
      [STORAGE.account]: { balances: { ...data.settings.startingBalances }, initialBalances: { ...data.settings.startingBalances }, createdAt: Date.now() },
      [STORAGE.positions]: {}, [STORAGE.trades]: []
    });
    status('虚拟账户已重置');
    await render();
  });
  $('#export').addEventListener('click', async () => {
    const data = await state();
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `tango-paper-trader-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('数据已导出');
  });
  chrome.storage.onChanged.addListener(() => render());
  render();
})();
