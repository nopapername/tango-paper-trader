const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/content/content.js'), 'utf8');
const cssSource = fs.readFileSync(path.resolve(__dirname, '../src/content/content.css'), 'utf8');
const root = path.resolve(__dirname, '..');

function between(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(start, -1, `missing ${startText}`);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test('chart frames are checked before a marker payload scans trades', () => {
  const block = between('function syncChartMarkers(', 'function renderModal(');
  const query = block.indexOf('document.querySelectorAll(');
  const guard = block.indexOf('if (!frames.length) return;');
  const payload = block.indexOf('chartMarkerPayload()');
  assert.ok(query >= 0 && guard > query && payload > guard);
});

test('render computes one portfolio summary and passes it to the drawer', () => {
  const drawer = between('function renderDrawer(', 'function chartMarkerPayload(');
  const render = between('function render()', 'function bindEvents()');
  assert.match(drawer, /^function renderDrawer\(summary\)/);
  assert.doesNotMatch(drawer, /portfolioSummary/);
  assert.match(render, /const summary = Tango\.Engine\.portfolioSummary\(runtime\.state, activeChain\(\)\.id\)/);
  assert.equal([...render.matchAll(/Tango\.Engine\.portfolioSummary\(runtime\.state, activeChain\(\)\.id\)/g)].length, 1);
  assert.match(render, /renderDrawer\(summary\)/);
});

test('clearing route context immediately publishes an empty marker payload', () => {
  const clear = between('function clearChainContext()', "window.addEventListener('message'");
  assert.match(clear, /syncChartMarkers\(true\)/);
});

test('content resolves account and settings from the active GMGN chain', () => {
  assert.match(source, /function activeChain\(\) \{ return Tango\.Chains\.fromUrl\(location\.href\); \}/);
  assert.match(source, /function activeAccount\(\)/);
  assert.match(source, /runtime\.state\.accounts\[chain\.id\]/);
  assert.match(source, /function chainSettings\(\)/);
  assert.match(source, /runtime\.settings\.chainSettings\?\.\[chain\.id\]/);
});

test('drawer and close all operate on current-chain positions only', () => {
  const drawer = between('function renderDrawer(', 'function chartMarkerPayload(');
  const closeAll = between('async function commitCloseAll(', 'async function sellBreakeven()');
  assert.match(drawer, /Tango\.ChainView\.positions\(runtime\.state, activeChain\(\)\.id\)/);
  assert.doesNotMatch(drawer, /Object\.values\(runtime\.state\.positions/);
  assert.match(closeAll, /const chain = activeChain\(\)\.id/);
  assert.match(closeAll, /Tango\.ChainView\.closeOrders\(runtime\.state, chain,/);
  assert.match(closeAll, /Tango\.Store\.executeCloseAll\(chain, orders\)/);
});

test('all content state writes express mutation intent to the extension-owned coordinator', () => {
  assert.doesNotMatch(source, /Tango\.Store\.saveState\(/);
  assert.match(source, /Tango\.Store\.executeBuy\(executableOrder\)/);
  assert.match(source, /Tango\.Store\.executeSell\(executableOrder\)/);
  assert.match(source, /Tango\.Store\.executeCloseAll\(chain, orders\)/);
  assert.match(source, /Tango\.Store\.updatePositionQuote\(/);
  assert.match(source, /Tango\.Store\.updatePositionMetadata/);
});

test('all content settings writers use exact scoped patches', () => {
  assert.doesNotMatch(source, /Tango\.Store\.saveSettings\(/);
  assert.match(source, /Tango\.Store\.patchSettings\(patch\)/);
  assert.match(source, /chains:\s*\{\s*\[chain\.id\]:\s*\{\s*buyPresets:\s*buyValues\s*\}\s*\}/s);
  assert.match(source, /sellPresets:\s*sellValues/);
  assert.match(source, /patchRuntimeSettings\(\{\s*barCollapsed\s*\}\)/);
  assert.match(source, /patchRuntimeSettings\(\{\s*panelCollapsed\s*\}\)/);
  assert.match(source, /patchRuntimeSettings\(\{\s*soundEnabled\s*\}\)/);
  assert.match(source, /patchRuntimeSettings\(\{\s*\[settingKey\]:\s*runtime\.settings\[settingKey\]\s*\}/);
});

test('content preset validation explicitly rejects non-finite buys and sells', () => {
  const presetSave = between('async function savePresetEdits()', 'function renderPanel()');
  assert.match(presetSave, /validBuy[\s\S]*Number\.isFinite\(value\)[\s\S]*value > 0/);
  assert.match(presetSave, /validSell[\s\S]*Number\.isFinite\(value\)[\s\S]*value > 0[\s\S]*value <= 100/);
});

test('header balance is read from the active account', () => {
  const header = between('function renderHeaderAccountSummary(', 'function renderPresetGrid(');
  assert.match(header, /activeAccount\(\)/);
  assert.doesNotMatch(header, /state\.account|cashBalanceSol/);
});

test('trading uses native fields without manufacturing fresh quote timestamps', () => {
  const buy = between('async function buy(', 'function previewBuy(');
  const sell = between('async function sell(', 'async function sellPosition(');
  const sellPosition = between('async function sellPosition(', 'async function commitSell(');
  const closeAll = between('async function commitCloseAll(', 'async function sellBreakeven()');
  assert.match(buy, /amountNative:/);
  assert.doesNotMatch(buy, /amountSol:/);
  assert.match(buy, /requireExecutableQuote\(context\?\.token, context\?\.quote\)/);
  assert.match(sell, /requireExecutableQuote\(context\?\.token, context\?\.quote\)/);
  assert.match(sellPosition, /freshExecutableQuote\(position\)/);
  assert.doesNotMatch(sellPosition, /lastPriceUsd|observedAt:\s*Date\.now/);
  assert.doesNotMatch(closeAll, /lastPriceUsd|observedAt:\s*Date\.now/);
});

test('native prices and GMGN quotes are explicitly keyed by chain', () => {
  const nativePrice = between('function ensureNativePrice(', 'function ensureTokenQuote(');
  const quoteTick = between('async function performQuoteTick()', 'const tickQuote =');
  assert.match(source, /nativePrices:\s*new Map\(\)/);
  assert.match(source, /nativePriceObservedAt:\s*new Map\(\)/);
  assert.match(nativePrice, /freshNativePrice\(chain\.id\)/);
  assert.match(source, /TANGO_GET_NATIVE_PRICE/);
  assert.match(source, /gmgnQuoteKey\(chain, address\)/);
  assert.doesNotMatch(source, /TANGO_GET_SOL_PRICE/);
  assert.doesNotMatch(nativePrice, /!context/);
  assert.match(quoteTick, /runtime\.current\.quote\.nativePriceUsd = freshNativePrice\(chain\.id\)/);
  assert.doesNotMatch(quoteTick, /lastNativePriceUsd|runtime\.nativePrices\.get/);
  assert.match(quoteTick, /const executable = executableQuote\(runtime\.current\?\.token, runtime\.current\?\.quote\)/);
  assert.match(quoteTick, /updatePositionQuote\(runtime\.current\.token, executable\)/);
});

test('panel marks positions only from a coherent executable quote', () => {
  const panel = between('function renderPanel()', 'function floatingStyle(');
  assert.ok(panel.indexOf('const liveQuote = executableQuote(current.token, current.quote)')
    < panel.indexOf('const mark = position ? Tango.Engine.markPosition(position, liveQuote) : null'));
  assert.doesNotMatch(panel, /markPosition\(position, current\?\.quote\)/);
});

test('fresh quote merges never inherit executable valuation fields from an older observation', () => {
  const merge = between('function mergeQuote(', 'async function sharedQuoteRequest(');
  assert.match(merge, /priceUsd: Number\(quote\.priceUsd \|\| 0\)/);
  assert.match(merge, /marketCapUsd: Number\(quote\.marketCapUsd \|\| 0\)/);
  assert.match(merge, /observedAt: Number\(quote\.observedAt \|\| 0\)/);
  assert.match(merge, /source: String\(quote\.source \|\| ''\)/);
  assert.doesNotMatch(merge, /quote\.marketCapUsd \|\| context\.quote\.marketCapUsd/);
});

test('route chain changes clear chain-bound contexts before reading again', () => {
  const route = between('function handleRouteChange()', 'async function start()');
  assert.match(route, /activeChain\(\)\?\.id/);
  assert.match(route, /clearChainContext\(\)/);
  assert.ok(route.indexOf('clearChainContext()') < route.indexOf('tickQuote()'));
});

test('same-chain navigation invalidates stale token modals before the next quote tick', () => {
  const route = between('function handleRouteChange()', 'async function start()');
  const identityCheck = 'Tango.GMGN.resolveCurrentTokenRead(runtime.current, null) !== runtime.current';
  assert.match(route, new RegExp(identityCheck.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(route.indexOf(identityCheck) < route.indexOf('tickQuote()'));
});

test('panel balance labels leave room for multichain native symbols', () => {
  assert.match(cssSource, /\.tango-title-balance\s*\{[^}]*max-width:\s*150px/s);
  assert.match(cssSource, /\.buy-title \.tango-title-balance\s*\{[^}]*max-width:\s*175px/s);
});

test('every operational surface is registry and selected-chain driven', () => {
  const content = fs.readFileSync(path.join(root, 'src/content/content.js'), 'utf8');
  const popup = fs.readFileSync(path.join(root, 'src/popup/popup.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'src/dashboard/dashboard.js'), 'utf8');
  assert.match(content, /portfolioSummary\(runtime\.state, activeChain\(\)\.id\)/);
  assert.match(content, /ChainView\.positions\(runtime\.state, activeChain\(\)\.id\)/);
  assert.match(popup, /PopupModel\.build/);
  assert.match(dashboard, /DashboardModel\.build/);
  assert.doesNotMatch(content, /GMGN Solana only in V1/);
});
