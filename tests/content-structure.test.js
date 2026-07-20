const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/content/content.js'), 'utf8');
const cssSource = fs.readFileSync(path.resolve(__dirname, '../src/content/content.css'), 'utf8');
const i18nSource = fs.readFileSync(path.resolve(__dirname, '../src/shared/i18n.js'), 'utf8');
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
  assert.match(render, /const summary = Tango\.Engine\.portfolioSummary\(runtime\.state, activeChain\(\)\.id, currentNativePriceUsd\(\)\)/);
  assert.equal([...render.matchAll(/Tango\.Engine\.portfolioSummary\(runtime\.state, activeChain\(\)\.id, currentNativePriceUsd\(\)\)/g)].length, 1);
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

test('content USD portfolio and position values do not reconvert native marks', () => {
  const bar = between('function renderBar(', 'function calendarDateKey(');
  const drawer = between('function renderDrawer(', 'function chartMarkerPayload(');
  const closeAll = between('function requestCloseAll(', 'async function commitCloseAll(');
  assert.match(source, /Tango\.Engine\.chainUsdSummary\(/);
  assert.doesNotMatch(bar, /accountMoney\(summary\.totalPnlNative/);
  assert.match(source, /return price > 0 \? Tango\.Engine\.chainUsdSummary/);
  assert.match(drawer, /usdMoney\(positionUsdTotal\(positions\)\)/);
  assert.match(drawer, /usdMoney\(positionUsdValue\(position, mark\)\)/);
  assert.match(closeAll, /usdMode\s*\? usdMoney\(positionUsdTotal\(positions\)\)/);
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

test('paper execution paths contain no quote wait, pending intent, or network await', () => {
  const resolver = between('function resolvePaperTradeQuote(', 'function requireExecutableQuote(');
  const execution = between('async function buy(', 'function showToast(');
  const quickBuy = between('async function handleQuickBuy(', 'async function buy(');
  const buy = between('async function buy(', 'function previewBuy(');
  const commitBuy = between('async function commitBuy(', 'async function sell(');
  const sell = between('async function sell(', 'async function sellPosition(');
  const sellPosition = between('async function sellPosition(', 'async function commitSell(');
  const closeAll = between('async function commitCloseAll(', 'async function sellBreakeven()');
  const breakeven = between('async function sellBreakeven(', 'function showToast(');
  assert.doesNotMatch(resolver, /await|setTimeout|requestWithTimeout|sharedQuoteRequest|waitForGmgnQuote/);
  const blockingQuoteWork = /setTimeout|requestWithTimeout|sharedQuoteRequest|waitForGmgnQuote|latestCardMarketCap/;
  assert.doesNotMatch(quickBuy, blockingQuoteWork);
  assert.doesNotMatch(buy, blockingQuoteWork);
  assert.doesNotMatch(commitBuy, blockingQuoteWork);
  assert.doesNotMatch(execution, /queuePendingPaperIntent|pendingTradeIntents|quoteQueued/);
  for (const [name, entryPoint] of Object.entries({ buy, sell, sellPosition, closeAll, breakeven })) {
    assert.match(entryPoint, /resolvePaperTradeQuote\(/, name);
  }
});

test('content integration remains paper-only and contains no wallet or transaction submission path', () => {
  assert.doesNotMatch(source, /connectWallet|requestSignature|signTransaction|sendTransaction|eth_sendTransaction|wallet_requestPermissions/);
});

test('extension permissions and code remain paper-only', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../manifest.json'), 'utf8'));
  const pageMain = fs.readFileSync(path.resolve(__dirname, '../src/content/page-main.js'), 'utf8');
  const content = fs.readFileSync(path.resolve(__dirname, '../src/content/content.js'), 'utf8');
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.permissions.includes('web3'), false);
  assert.doesNotMatch(`${pageMain}\n${content}`,
    /connectWallet|requestSignature|signTransaction|sendTransaction|eth_sendTransaction|wallet_requestPermissions|strategy_order|swap\/route/);
  assert.doesNotMatch(pageMain, /new\s+WebSocket\s*\(/);
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

test('panel prefers a fresh quote and falls back through the complete local quote resolver', () => {
  const panel = between('function renderPanel()', 'function floatingStyle(');
  assert.ok(panel.indexOf('const liveQuote = executableQuote(current.token, current.quote)')
    < panel.indexOf('const paperQuote = liveQuote || resolvePaperTradeQuote(current.token, current.quote, { position })'));
  assert.match(panel, /markPosition\(position, paperQuote, currentNativePriceUsd\(\)\)/);
  assert.doesNotMatch(panel, /markPosition\(position, current\?\.quote\)/);
});

test('provisional paper valuation copy is bilingual and rendered only from the provisional flag', () => {
  assert.equal((i18nSource.match(/provisionalQuote:/g) || []).length, 2);
  const panel = between('function renderPanel()', 'function floatingStyle(');
  const buy = between('function previewBuy(', 'async function commitBuy(');
  const sell = between('async function sell(', 'async function sellPosition(');
  assert.match(panel, /paperQuote\?\.provisional === true[\s\S]*t\('provisionalQuote'\)/);
  assert.match(buy, /order\.quote\.provisional === true \? t\('provisionalQuote'\) : undefined/);
  assert.match(sell, /order\.quote\.provisional === true \? t\('provisionalQuote'\) : undefined/);
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

test('mutation processing batches affected roots while route changes fully reconcile quick buy', () => {
  const route = between('function handleRouteChange()', 'async function start()');
  const start = between('async function start()', "document.addEventListener('input'");
  assert.match(source, /pendingMutationRoots:\s*new Set\(\)/);
  assert.match(route, /syncQuickBuyButtons\(\)/);
  assert.match(start, /record\.target/);
  assert.match(start, /record\.addedNodes/);
  assert.match(start, /pendingMutationRoots\.clear\(\)/);
  assert.match(start, /syncQuickBuyButtons\(roots\)/);
});

test('panel balance labels leave room for multichain native symbols', () => {
  assert.match(cssSource, /\.tango-title-balance\s*\{[^}]*max-width:\s*150px/s);
  assert.match(cssSource, /\.buy-title \.tango-title-balance\s*\{[^}]*max-width:\s*175px/s);
});

test('every operational surface is registry and selected-chain driven', () => {
  const content = fs.readFileSync(path.join(root, 'src/content/content.js'), 'utf8');
  const popup = fs.readFileSync(path.join(root, 'src/popup/popup.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'src/dashboard/dashboard.js'), 'utf8');
  assert.match(content, /portfolioSummary\(runtime\.state, activeChain\(\)\.id, currentNativePriceUsd\(\)\)/);
  assert.match(content, /ChainView\.positions\(runtime\.state, activeChain\(\)\.id\)/);
  assert.match(popup, /PopupModel\.build/);
  assert.match(dashboard, /DashboardModel\.build/);
  assert.doesNotMatch(content, /GMGN Solana only in V1/);
});
