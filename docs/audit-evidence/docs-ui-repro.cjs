// Read-only reproductions using the project's real runtime and existing test harnesses.
// Run: node docs/audit-evidence/docs-ui-repro.cjs
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');

function harness(name, exports, transform = value => value) {
  const filename = path.join(root, 'tests', name);
  const original = fs.readFileSync(filename, 'utf8');
  const firstTest = original.indexOf("\ntest('");
  assert.ok(firstTest > 0);
  const source = transform(original.slice(0, firstTest));
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(`${source}\nmodule.exports = { ${exports} };`, filename);
  return mod.exports;
}

const { loadDashboard, fillSettingsForm, stateFixture } = harness('dashboard-runtime.test.js', 'loadDashboard, fillSettingsForm, stateFixture', source => source.replace('refreshNativePrices, action, tradesCsv }', 'refreshNativePrices, action, tradesCsv, shareTrade }'));
const { loadPopup } = harness('popup-runtime.test.js', 'loadPopup');
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  const popup = await loadPopup({ activeTabUrl: 'https://gmgn.ai/?chain=robinhood' });
  await popup.element('#gmgn').click();
  const openMessages = popup.runtimeMessages.filter(message => message.type === 'TANGO_OPEN_GMGN');
  assert.equal(popup.element('#popup-chain').value, 'robinhood');
  assert.equal(popup.persistedSettings.selectedChain, 'eth');
  assert.equal(openMessages.length, 0);
  console.log('UI-1 CONFIRMED:', JSON.stringify({ visibleChain: 'robinhood', persistedChain: 'eth', gmgnOpenMessages: openMessages.length }));

  const state = stateFixture();
  Object.assign(state.trades[0], { quoteSource: 'DETERMINISTIC_FALLBACK', paperFallback: true, provisional: true, syntheticTokenPrice: true, syntheticNativePrice: true, totalSupply: 1e9, supplySource: 'UNKNOWN_FALLBACK', launchpad: 'unknown', launchMode: '' });
  const dashboard = await loadDashboard({ initialState: state });
  await tick();
  const csv = dashboard.api.tradesCsv('eth');
  const headers = csv.replace(/^\ufeff/, '').split('\n')[0].split(',');
  const missing = ['quoteSource', 'paperFallback', 'provisional', 'syntheticTokenPrice', 'syntheticNativePrice', 'totalSupply', 'supplySource', 'launchpad', 'launchMode'].filter(field => !headers.includes(field));
  assert.equal(missing.length, 9);
  console.log('UI-2 CONFIRMED: CSV drops provenance columns:', missing.join(', '));

  const previousCount = dashboard.calls.nativeMessages.filter(message => message.type === 'TANGO_GET_NATIVE_PRICE').length;
  await dashboard.emitStorage();
  await dashboard.api.load();
  assert.equal(dashboard.calls.nativeMessages.filter(message => message.type === 'TANGO_GET_NATIVE_PRICE').length, previousCount);
  dashboard.context.chrome.runtime.sendMessage = async () => ({ ok: true, price: 123, observedAt: 1 });
  await dashboard.api.refreshNativePrices();
  assert.equal(dashboard.api.runtime.nativePrices.eth, 123);
  assert.equal(dashboard.api.runtime.nativePriceObservedAt.eth, 1);
  console.log('UI-3 CONFIRMED:', JSON.stringify({ repeatedLoadsFetchAgain: false, acceptedEthPrice: 123, acceptedObservedAt: 1 }));

  dashboard.context.chrome.runtime.sendMessage = message => message.chain === 'sol'
    ? new Promise(() => {}) : Promise.resolve({ ok: true, price: 456, observedAt: Date.now() });
  let settled = false;
  dashboard.api.refreshNativePrices().then(() => { settled = true; });
  await tick();
  await tick();
  assert.equal(settled, false);
  assert.equal(dashboard.api.runtime.nativePrices.eth, 123);
  console.log('UI-4 CONFIRMED:', JSON.stringify({ oneHungChain: 'sol', ethResponse: 456, displayedEthPrice: 123, refreshSettled: settled }));

  const settingsDashboard = await loadDashboard();
  settingsDashboard.api.runtime.tab = 'settings';
  settingsDashboard.api.render();
  fillSettingsForm(settingsDashboard);
  settingsDashboard.element('#setting-common-balance').value = '10';
  settingsDashboard.element('#setting-slippage').value = '';
  settingsDashboard.element('#setting-network-fee').value = '';
  const save = settingsDashboard.api.action('save-settings');
  await tick();
  const patch = settingsDashboard.calls.saves[0].patch;
  assert.equal(patch.slippageBps, 0);
  assert.equal(patch.chains.eth.networkFeeNative, 0);
  settingsDashboard.calls.saves[0].gate.resolve();
  await save;
  console.log('UI-5 CONFIRMED: blank numeric settings become zero:', JSON.stringify({ slippageBps: patch.slippageBps, networkFeeNative: patch.chains.eth.networkFeeNative }));

  const pngDashboard = await loadDashboard();
  const trade = pngDashboard.api.runtime.state.trades.find(row => row.chain === 'eth');
  trade.symbol = 'A'.repeat(200);
  const drawCalls = [];
  const ctx = { createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {}, fillText(...args) { drawCalls.push(args); } };
  const originalCreate = pngDashboard.context.document.createElement;
  pngDashboard.context.document.createElement = tag => tag === 'canvas'
    ? { getContext: () => ctx, toBlob(callback) { callback(new Blob(['fake png'])); } }
    : originalCreate(tag);
  await pngDashboard.api.shareTrade(trade.id);
  const symbolDraw = drawCalls.find(args => args[0] === trade.symbol);
  assert.equal(symbolDraw.length, 3);
  console.log('UI-6 CONFIRMED: PNG symbol is drawn without maxWidth or text measurement:', JSON.stringify({ symbolLength: trade.symbol.length, fillTextArguments: symbolDraw.length }));
})().catch(error => { console.error(error); process.exitCode = 1; });
