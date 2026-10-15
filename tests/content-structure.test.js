const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { paperOnlySafetyErrors } = require('../scripts/validate-extension.js');

const source = fs.readFileSync(path.resolve(__dirname, '../src/content/content.js'), 'utf8');
const cssSource = fs.readFileSync(path.resolve(__dirname, '../src/content/content.css'), 'utf8');
const i18nSource = fs.readFileSync(path.resolve(__dirname, '../src/shared/i18n.js'), 'utf8');
const root = path.resolve(__dirname, '..');
const safetyCssPath = path.join(root, 'src/content/quick-buy-safety.css');
const safetyCssSource = fs.existsSync(safetyCssPath) ? fs.readFileSync(safetyCssPath, 'utf8') : '';

function between(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(start, -1, `missing ${startText}`);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test('syncChartMarkers caches the current payload before returning when no chart frame exists', () => {
  const block = between('function syncChartMarkers(', 'function renderModal(');
  const query = block.indexOf('const frames = chartFrames();');
  const guard = block.indexOf('if (!frames.length) return;');
  const payload = block.indexOf('chartMarkerPayload()');
  assert.ok(query >= 0 && payload > query && guard > payload);
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
  assert.match(clear, /clearChartMarkers\(\)/);
  assert.ok(clear.indexOf('clearChartMarkers()') < clear.indexOf('runtime.current = null'));
});

test('successful direct trades force marker publication after committed state assignment', () => {
  const buy = between('async function commitBuy(', 'async function sell(');
  const sell = between('async function commitSell(', 'function requestCloseAll(');
  for (const block of [buy, sell]) {
    assert.match(block, /runtime\.state = result\.state;\s*publishChartMarkers\(true\);/);
  }
});

test('marker delivery stores one latest payload while signatures remain frame-local', () => {
  const block = between('function chartMarkerPayload()', 'function renderModal(');
  assert.match(block, /runtime\.latestMarkerPayload/);
  assert.match(block, /runtime\.markerPayloads\.get\(frame\)/);
  assert.match(block, /runtime\.markerPayloads\.set\(frame, signature\)/);
  assert.match(block, /runtime\.markerPayloads\.delete\(frame\)/);
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
  assert.match(source, /try \{ return Tango\.Engine\.chainUsdSummary\(runtime\.state, chain\.id, price\); \}/);
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
  const commitQuote = between('function resolveCommitPaperTradeQuote(', 'function previewBuy(');
  const execution = between('async function buy(', 'function showToast(');
  const quickBuy = between('async function handleQuickBuy(', 'async function buy(');
  const buy = between('async function buy(', 'function previewBuy(');
  const commitBuy = between('async function commitBuy(', 'async function sell(');
  const sell = between('async function sell(', 'async function sellPosition(');
  const sellPosition = between('async function sellPosition(', 'async function commitSell(');
  const closeAll = between('async function commitCloseAll(', 'async function sellBreakeven()');
  const breakeven = between('async function sellBreakeven(', 'function showToast(');
  assert.doesNotMatch(resolver, /await|setTimeout|requestWithTimeout|sharedQuoteRequest|waitForGmgnQuote/);
  assert.match(resolver, /fallbackValuation\(/);
  assert.doesNotMatch(resolver, /historicalPrice \|\| 1/);
  assert.doesNotMatch(commitQuote, /await|setTimeout|requestWithTimeout|sharedQuoteRequest|waitForGmgnQuote|sendMessage/);
  assert.match(commitQuote, /readVerifiedCurrentTokenSnapshot/);
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
  assert.deepEqual(paperOnlySafetyErrors([{
    file: 'combined content scripts',
    source: `${pageMain}\n${content}`
  }]), []);
});

test('native prices and GMGN quotes are explicitly keyed by chain', () => {
  const nativePrice = between('function ensureNativePrice(', 'function ensureTokenQuote(');
  const quoteTick = between('async function performQuoteTick()', 'const tickQuote =');
  assert.match(source, /nativePrices:\s*new Map\(\)/);
  assert.match(source, /nativePriceObservedAt:\s*new Map\(\)/);
  assert.match(source, /persistentNativePrices:\s*new Map\(\)/);
  assert.match(source, /persistentNativePriceObservedAt:\s*new Map\(\)/);
  assert.match(source, /persistentGmgnQuotes:\s*new Map\(\)/);
  assert.match(nativePrice, /freshNativePrice\(chain\.id\)/);
  assert.match(source, /TANGO_GET_NATIVE_PRICE/);
  assert.match(source, /gmgnQuoteKey\(chain, address\)/);
  assert.doesNotMatch(source, /TANGO_GET_SOL_PRICE/);
  assert.doesNotMatch(nativePrice, /!context/);
  assert.match(quoteTick, /runtime\.current\.quote\.nativePriceUsd = freshNativePrice\(chain\.id\)/);
  assert.doesNotMatch(quoteTick, /lastNativePriceUsd|runtime\.nativePrices\.get/);
  assert.match(quoteTick, /resolvePaperTradeQuote\(runtime\.current\?\.token, runtime\.current\?\.quote, \{[\s\S]*persistenceOnly: true/);
  assert.match(quoteTick, /const executable = executableQuote\(runtime\.current\?\.token, paperQuote, \{ persistenceOnly: true \}\)/);
  assert.doesNotMatch(quoteTick, /executableQuote\(runtime\.current\?\.token, runtime\.current\?\.quote\)/);
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
  assert.match(
    start,
    /syncQuickBuyButtons\(roots,\s*\{\s*fast:\s*false,\s*addedRoots:\s*\[\],\s*removedRoots:\s*\[\],\s*policyKey:\s*quickBuyPolicyKey\(\)\s*\}\)/
  );
});

test('quick-buy lifecycle has a cheap 750ms drift probe and observes presentation mutations', () => {
  const start = between('async function start()', "document.addEventListener('input'");
  assert.match(source, /function probeQuickBuyHealth\(\)/);
  assert.match(source, /Tango\.GMGN\.quickBuyNeedsReconcile\?\.\(\)/);
  assert.match(source, /setInterval\(probeQuickBuyHealth, 750\)/);
  assert.match(start, /attributeFilter:\s*\['href', 'class', 'style', 'data-testid'\]/);
});


test('paper quick-buy fills the native-sized rectangle with a safe fallback', () => {
  const declarationsFor = (wanted) => {
    for (const match of cssSource.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = match[1].split(',').map((selector) => selector.trim());
      if (selectors.includes(wanted)) return match[2];
    }
    return '';
  };
  const slotRule = declarationsFor('.BuyButton-continer.tango-native-buy-overridden');
  const hostRule = declarationsFor('.BuyButton-continer.tango-native-buy-overridden .tango-quick-buy-action-host');
  const structuralRule = declarationsFor('.BuyButton-continer.tango-native-buy-overridden .tango-quick-buy-structural-host');
  const buttonRule = declarationsFor('.tango-list-quick-buy');
  const wrapperRule = declarationsFor('.tango-quick-buy-content');
  const hintRule = declarationsFor('.tango-paper-hint');
  const amountRule = declarationsFor('.tango-buy-amount');
  const hoverRule = declarationsFor('.tango-list-quick-buy:hover .tango-quick-buy-content');
  const focusRule = declarationsFor('.tango-list-quick-buy:focus-visible .tango-quick-buy-content');
  assert.ok(slotRule && hostRule && structuralRule && buttonRule && wrapperRule
    && hintRule && amountRule && hoverRule && focusRule);

  const assertExactUpstream = (name, sourceRule) => {
    assert.match(sourceRule, /box-sizing:\s*border-box\s*!important/, `${name}: border box`);
    assert.match(sourceRule, /height:\s*var\(--tango-quick-buy-height,\s*36px\)\s*!important/, `${name}: height`);
    assert.match(sourceRule, /min-height:\s*var\(--tango-quick-buy-height,\s*36px\)\s*!important/, `${name}: min height`);
    assert.match(sourceRule, /max-height:\s*var\(--tango-quick-buy-height,\s*36px\)\s*!important/, `${name}: max height`);
    assert.match(sourceRule, /width:\s*(?:100%|var\(--tango-quick-buy-width,\s*100%\))\s*!important/, `${name}: width`);
    assert.match(sourceRule, /min-width:\s*0\s*!important/, `${name}: min width`);
    assert.match(sourceRule, /padding:\s*0\s*!important/, `${name}: padding`);
    assert.match(sourceRule, /margin:\s*0\s*!important/, `${name}: margin`);
    assert.match(sourceRule, /border:\s*0\s*!important/, `${name}: border`);
    assert.match(sourceRule, /transform:\s*none\s*!important/, `${name}: transform`);
  };
  assertExactUpstream('slot', slotRule);
  assertExactUpstream('action host', hostRule);
  assertExactUpstream('structural host', structuralRule);

  assert.match(buttonRule, /height:\s*var\(--tango-quick-buy-height,\s*36px\)\s*!important/);
  assert.match(buttonRule, /min-height:\s*var\(--tango-quick-buy-height,\s*36px\)\s*!important/);
  assert.match(buttonRule, /max-height:\s*var\(--tango-quick-buy-height,\s*36px\)\s*!important/);
  assert.match(buttonRule, /width:\s*100%\s*!important/);
  assert.match(buttonRule, /align-self:\s*stretch\s*!important/);
  assert.match(buttonRule, /flex:\s*0\s+0\s+100%\s*!important/);
  assert.match(buttonRule, /border-radius:\s*6px\s*!important/);
  assert.match(wrapperRule, /var\(--tango-quick-buy-display-text,\s*14px\)/);
  assert.match(wrapperRule, /align-self:\s*stretch\s*!important/);
  assert.match(wrapperRule, /flex:\s*1\s+1\s+auto\s*!important/);
  assert.match(wrapperRule, /height:\s*100%\s*!important/);
  assert.match(wrapperRule, /width:\s*100%\s*!important/);
  assert.match(wrapperRule, /background:\s*color-mix\(in srgb,\s*var\(--tango-quick-buy-accent\)\s*16%,\s*transparent\)\s*!important/i);
  assert.match(hintRule, /font-size:\s*var\(--tango-quick-buy-label-text,\s*10px\)\s*!important/);
  assert.match(amountRule, /font-size:\s*1em\s*!important/);
  assert.match(hoverRule, /var\(--tango-quick-buy-accent\)\s*24%/);
  assert.match(focusRule, /var\(--tango-quick-buy-accent\)/);
  assert.doesNotMatch(
    [slotRule, hostRule, structuralRule, buttonRule, wrapperRule, hintRule, amountRule].join('\n'),
    /customize-button-ultra-color/
  );
});

test('quick-buy activation fail-closes any live GMGN native leaf until the paper shell takes over', () => {
  const sync = between('function syncQuickBuyButtons(', 'function clearQuickBuyButtons()');
  const clear = between('function clearQuickBuyButtons()', 'function queueQuickBuySync(root)');
  const safetyRule = cssSource.match(
    /html\.tango-paper-quick-buy-active\s+\[data-testid=["']quickbuy["']\]\s*\{([^}]*)\}/
  )?.[1] || '';
  assert.match(sync, /setContentClass\(document\.documentElement, 'tango-paper-quick-buy-active', true\)/);
  assert.match(clear, /setContentClass\(document\.documentElement, 'tango-paper-quick-buy-active', false\)/);
  assert.doesNotMatch(
    cssSource,
    /html\.tango-paper-quick-buy-active\s+\.BuyButton-continer\s+\[data-testid=["']quickbuy["']\]/
  );
  assert.match(safetyRule, /\bpointer-events:\s*none\s*!important/);
  assert.match(safetyRule, /\bvisibility:\s*hidden\s*!important/);
});

test('document-start safety CSS hides native quick buy unless settings explicitly allow it', () => {
  const guardedRule = safetyCssSource.match(
    /html:not\(\.tango-paper-native-quick-buy-allowed\)\s+\[data-testid=["']quickbuy["']\]\s*\{([^}]*)\}/
  )?.[1] || '';
  const slotRule = safetyCssSource.match(
    /html:not\(\.tango-paper-native-quick-buy-allowed\)\s+\.BuyButton-continer\s*\{([^}]*)\}/
  )?.[1] || '';
  const buyButtonsRule = safetyCssSource.match(
    /html:not\(\.tango-paper-native-quick-buy-allowed\)\s+\[data-sentry-component=["']BuyButtons["']\]\s*\{([^}]*)\}/
  )?.[1] || '';
  const slotPaperRule = safetyCssSource.match(
    /html:not\(\.tango-paper-native-quick-buy-allowed\)\s+\.BuyButton-continer\[data-tango-quick-buy=["']1["']\]\s+\.tango-list-quick-buy\s*\{([^}]*)\}/
  )?.[1] || '';
  const protectedSlotRule = safetyCssSource.match(
    /html:not\(\.tango-paper-native-quick-buy-allowed\)\s+\.BuyButton-continer\[data-tango-quick-buy=["']1["']\]\s*\{([^}]*)\}/
  )?.[1] || '';
  const buyButtonsPaperRule = safetyCssSource.match(
    /html:not\(\.tango-paper-native-quick-buy-allowed\)\s+\[data-sentry-component=["']BuyButtons["']\]\s+\.tango-list-quick-buy\s*\{([^}]*)\}/
  )?.[1] || '';
  assert.match(guardedRule, /\bpointer-events:\s*none\s*!important/);
  assert.match(guardedRule, /\bvisibility:\s*hidden\s*!important/);
  assert.match(slotRule, /\bpointer-events:\s*none\s*!important/);
  assert.match(slotRule, /\bvisibility:\s*hidden\s*!important/);
  assert.match(buyButtonsRule, /\bpointer-events:\s*none\s*!important/);
  assert.match(buyButtonsRule, /\bvisibility:\s*hidden\s*!important/);
  assert.match(slotPaperRule, /\bpointer-events:\s*auto\s*!important/);
  assert.match(slotPaperRule, /\bvisibility:\s*visible\s*!important/);
  assert.match(buyButtonsPaperRule, /\bpointer-events:\s*auto\s*!important/);
  assert.match(buyButtonsPaperRule, /\bvisibility:\s*visible\s*!important/);
  for (const rule of [protectedSlotRule, slotPaperRule, buyButtonsPaperRule]) {
    assert.doesNotMatch(rule, /\b(?:display|align-items|align-self|height|min-height|width|min-width|padding|flex)\s*:/);
  }
  assert.doesNotMatch(safetyCssSource, /--tango-quick-buy-height/);
  assert.doesNotMatch(safetyCssSource, /\.BuyButton-continer:not\(\.tango-native-buy-overridden\)/);
});

test('document-start safety CSS keeps a bound slot in the hit path while native leaves stay hidden', () => {
  const boundSlotRule = safetyCssSource.match(
    /html:not\(\.tango-paper-native-quick-buy-allowed\)\s+\.BuyButton-continer\[data-tango-quick-buy=["']1["']\]\s*\{([^}]*)\}/
  )?.[1] || '';
  const boundNativeLeafRule = safetyCssSource.match(
    /html:not\(\.tango-paper-native-quick-buy-allowed\)\s+\.BuyButton-continer\[data-tango-quick-buy=["']1["']\]\s+:where\(button,\s*\[role=["']button["']\],\s*a\[href\],\s*\[data-testid=["']quickbuy["']\]\):not\(\.tango-list-quick-buy\)\s*\{([^}]*)\}/
  )?.[1] || '';
  const boundPaperRule = safetyCssSource.match(
    /html:not\(\.tango-paper-native-quick-buy-allowed\)\s+\.BuyButton-continer\[data-tango-quick-buy=["']1["']\]\s+\.tango-list-quick-buy\s*\{([^}]*)\}/
  )?.[1] || '';
  assert.match(boundSlotRule, /\bpointer-events:\s*auto\s*!important/);
  assert.match(boundSlotRule, /\bvisibility:\s*visible\s*!important/);
  assert.match(boundNativeLeafRule, /\bpointer-events:\s*none\s*!important/);
  assert.match(boundNativeLeafRule, /\bvisibility:\s*hidden\s*!important/);
  assert.match(boundPaperRule, /\bpointer-events:\s*auto\s*!important/);
  assert.match(boundPaperRule, /\bvisibility:\s*visible\s*!important/);
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
