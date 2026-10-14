// Read-only audit reproductions. No extension/account/browser-session state is changed.
// Reuses repository harnesses with their test-registration function disabled.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
function harness(file, exports) {
  const target = path.join(root, 'tests', file);
  const actualRequire = createRequire(target);
  const wrappedRequire = (name) => name === 'node:test' ? () => {} : actualRequire(name);
  const source = fs.readFileSync(target, 'utf8');
  const module = { exports: {} };
  Function('require', '__dirname', 'module', source + '\nmodule.exports = {' + exports + '};')(
    wrappedRequire, path.dirname(target), module
  );
  return module.exports;
}
function mutationFeedbackReport() {
  const adapter = harness('gmgn-adapter.test.js', 'localChromeExecutable');
  const taskTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'tango-audit-feedback-'));
  const pagePath = path.join(taskTemp, 'feedback.html');
  const sources = ['src/core/chains.js', 'src/core/supply.js', 'src/adapters/gmgn.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
  const content = fs.readFileSync(path.join(root, 'src/content/content.js'), 'utf8');
  const rootHelpers = content.slice(content.indexOf('  function paperQuickBuyMutationNode'), content.indexOf('  function nativeQuickBuyMutationRoots'));
  const page = `<!doctype html><html><head><title>PENDING</title></head><body>
<div data-sentry-component="TrenchColumn">New creation\n
 <div class="group/a" href="https://gmgn.ai/base/token/0x1111111111111111111111111111111111111111">0x1111111111111111111111111111111111111111<br>TEST Test Token<br>MC<br>$10K
  <div class="BuyButton-continer"><div class="group/btn"><button data-testid="quickbuy">0.1 ETH</button></div></div>
 </div>
</div><script>
const fakeLocation={href:'https://gmgn.ai/?chain=base',origin:'https://gmgn.ai'};
const fakeContext={location:fakeLocation,document,Tango:{NativeQuickBuyGuard:{registerPaperAction:()=>true,isPaperActionTrusted:()=>true,revokePaperAction:()=>true}}};
${sources.map((source) => `Function('globalThis','location',${JSON.stringify(source)})(fakeContext,fakeLocation);`).join('\n')}
${rootHelpers}
const gmgn=fakeContext.Tango.GMGN, slot=document.querySelector('.BuyButton-continer');
gmgn.discoverTokenCards(()=>{},0.1,'PAPER');
let callbacks=0,rediscoveries=0,relevantClassRecords=0,timer;
const examples=[];
const observer=new MutationObserver((records)=>{
 callbacks++;
 const roots=new Set();
 for(const record of records){
  const found=quickBuyMutationRoots(record.target);
  if(found.length){ relevantClassRecords++; found.forEach(root=>roots.add(root));
   if(examples.length<6)examples.push({target:record.target.className,oldValue:record.oldValue}); }
 }
 if(roots.size&&!timer){timer=setTimeout(()=>{timer=null;rediscoveries++;gmgn.discoverTokenCards(()=>{},0.1,'PAPER',[...roots]);},160);}
});
observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class','style'],attributeOldValue:true});
gmgn.discoverTokenCards(()=>{},0.1,'PAPER',[slot]);
setTimeout(()=>{observer.disconnect();if(timer)clearTimeout(timer);document.title='AUDIT:'+btoa(JSON.stringify({callbacks,rediscoveries,relevantClassRecords,examples}));},1000);
</script></body></html>`;
  try {
    fs.writeFileSync(pagePath, page, 'utf8');
    const result = spawnSync(adapter.localChromeExecutable(), ['--headless', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--no-sandbox', '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost', '--virtual-time-budget=1500', '--dump-dom', `--user-data-dir=${path.join(taskTemp, 'chrome-profile')}`, pathToFileURL(pagePath).href], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
    const encoded = result.stdout?.match(/<title>AUDIT:([^<]+)<\/title>/)?.[1];
    if (!encoded) return { error: result.error?.message || result.stderr || result.stdout };
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } finally { fs.rmSync(taskTemp, { recursive: true, force: true }); }
}
async function main() {
  const markerHarness = harness('markers.test.js', 'loadChartBridge, State, Engine, buildPayload');
  const { State, Engine, buildPayload, loadChartBridge } = markerHarness;
  const address = '0x1111111111111111111111111111111111111111';
  const token = { chain: 'base', address, symbol: 'FALLBACK', metadataVerified: true, metadataSource: 'GMGN_NETWORK' };
  const settings = State.normalizeSettings({ slippageBps: 0, platformFeeBps: 0, chains: { base: { networkFeeNative: 0 } } });
  const initial = State.createInitialState({ now: 1, initialBalances: { base: 10 } });
  initial.initialized = true;
  const valuation = global.Tango.Supply.fallbackValuation({ chain: 'base', launchpad: '' });
  const fallback = {
    ...valuation, chain: 'base', address, marketCapDivisor: valuation.totalSupply,
    provisionalSupply: valuation.totalSupply, nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000, source: 'TANGO_FALLBACK',
    valuationMode: 'MARKET_CAP', priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP',
    syntheticTokenPrice: true, provisional: true, paperFallback: true
  };
  const bought = Engine.executeBuy(initial, { token, quote: fallback, amountNative: 1 }, settings, 1_000);
  const labels = { entry: 'Paper Buy', exit: 'Paper Sell', hide: 'Hide line' };
  const current = { token, quote: {
    priceUsd: 0.002, marketCapUsd: 200_000_000, totalSupply: 100_000_000_000,
    supplySource: 'GMGN_EXACT', priceProvenance: 'OBSERVED_PRICE', source: 'GMGN_NETWORK',
    observationId: 'gmgn-live-1', priceObservationId: 'gmgn-live-1',
    marketCapObservationId: 'gmgn-live-1', observedAt: 2_000
  } };
  const fallbackPayload = buildPayload({ current, position: bought.position, trades: bought.state.trades, labels });
  const chart = loadChartBridge({ href: `https://gmgn.ai/base/token/${address}` });
  for (const [text, y] of [['0.000000040', 100], ['0.000000032', 300], ['0.000000024', 500]]) {
    chart.canvasContext.fillText(text, 900, y);
  }
  chart.markers(fallbackPayload, { axisHint: 'PRICE', frameGeneration: 1, probeId: 'audit:1' });
  const wrongOverlay = chart.api.snapshot();
  const factualBuy = { chain: 'base', tokenAddress: address, id: 'real-buy', side: 'BUY', marketCapUsd: 8_000, observedPriceUsd: 0.000008, priceProvenance: 'OBSERVED_PRICE', quoteSource: 'GMGN_NETWORK' };
  const emptyCurrent = { token, quote: { priceUsd: 0, marketCapUsd: 0 } };
  const firstBuyBlocked = buildPayload({ current: emptyCurrent, position: null, trades: [...bought.state.trades, factualBuy], labels });
  const fallbackSells = [1, 2].map((i) => ({ ...bought.trade, id: `fallback-sell-${i}`, side: 'SELL' }));
  const factualSells = [1, 2, 3, 4, 5].map((i) => ({ ...factualBuy, id: `factual-sell-${i}`, side: 'SELL', marketCapUsd: 10_000 + i }));
  const sellSlotsBlocked = buildPayload({ current: emptyCurrent, position: null, trades: [...fallbackSells, ...factualSells], labels });
  const adapter = harness('gmgn-adapter.test.js', 'headlessLockedGiantQuickBuyLayoutReport');
  const giantLayout = adapter.headlessLockedGiantQuickBuyLayoutReport();
  const content = harness('content-runtime.test.js', 'loadContent, quoteContext, ADDRESS_A, eventElement');
  const loaded = content.loadContent();
  const offActions = [];
  for (const action of ['sell', 'closeAll']) {
    const offLoaded = content.loadContent();
    offLoaded.api.runtime.current = content.quoteContext();
    offLoaded.api.rememberNativePrice('eth', 3_000, offLoaded.clock.now);
    const context = content.quoteContext();
    offLoaded.api.runtime.state.positions[`eth:${content.ADDRESS_A}`] = {
      chain: 'eth', tokenAddress: content.ADDRESS_A, symbol: 'TEST', quantity: 2,
      costBasisNative: 1, averageEntryPriceUsd: 1, lastPriceUsd: 1,
      lastMarketCapUsd: 1_000, lastNativePriceUsd: 3_000, quoteObservedAt: offLoaded.clock.now
    };
    if (action === 'sell') await offLoaded.api.sell(50, context);
    else {
      offLoaded.context.Tango.ChainView.closeOrders = (state, chain, resolver) => (
        Object.values(state.positions).map((position) => ({
          token: { chain, address: position.tokenAddress, symbol: position.symbol },
          quote: resolver(position), percent: 100
        }))
      );
      offLoaded.api.requestCloseAll();
    }
    const modal = offLoaded.api.runtime.modal;
    const confirm = content.eventElement({ dataset: { action: 'confirm-modal' } });
    offLoaded.shellLists.set('[data-action]', [confirm]);
    offLoaded.api.bindEvents();
    offLoaded.dispatchStorageChange({
      [offLoaded.context.Tango.SETTINGS_KEY || 'tangoPaperTraderSettingsV1']: { newValue: { ...offLoaded.api.runtime.settings, enabled: false } }
    });
    const blocked = { pending: offLoaded.api.runtime.quickBuySettingsPending, disabled: offLoaded.api.runtime.quickBuyAuthoritativelyDisabled };
    await confirm.emit('click', { isTrusted: true, stopPropagation() {} });
    offActions.push({ action, modalBeforeOff: modal.type, blocked, sellCalls: offLoaded.calls.sell, closeAllCalls: offLoaded.calls.closeAll, orderQuote: offLoaded.calls.sellOrders[0]?.quote });
  }
  const authorityGlobal = { Tango: {}, crypto: global.crypto };
  for (const file of ['src/shared/constants.js', 'src/core/chains.js', 'src/core/supply.js', 'src/core/state.js', 'src/core/engine.js', 'src/core/state-coordinator.js']) {
    Function('globalThis', 'module', fs.readFileSync(path.join(root, file), 'utf8'))(authorityGlobal, undefined);
  }
  const authorityTango = authorityGlobal.Tango;
  const sellState = authorityTango.State.createInitialState({ now: 1, initialBalances: { base: 10 } });
  sellState.initialized = true;
  const exactQuote = { chain: 'base', address, priceUsd: 1, marketCapUsd: 0, liquidityUsd: 0, nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000, source: 'GMGN', priceProvenance: 'OBSERVED_PRICE' };
  const priorBuy = authorityTango.Engine.executeBuy(sellState, { token, quote: exactQuote, amountNative: 1 }, settings, 1_000);
  const disabledSettings = authorityTango.State.normalizeSettings({ ...settings, enabled: false });
  const values = { [authorityTango.STORAGE_KEY]: structuredClone(priorBuy.state), [authorityTango.SETTINGS_KEY]: structuredClone(disabledSettings) };
  const writes = [];
  const authority = authorityTango.StateCoordinator.create({
    readRaw: async (keys) => Object.fromEntries(keys.map((key) => [key, structuredClone(values[key])])),
    writeRaw: async (next) => { writes.push(structuredClone(next)); Object.assign(values, structuredClone(next)); },
    now: () => 1_000
  });
  const priorQuantity = priorBuy.position.quantity;
  const offSale = await authority.mutate({ type: 'EXECUTE_SELL', order: { token, quote: exactQuote, percent: 50 } });
  const coordinatorOffSell = { enabledInStorage: values[authorityTango.SETTINGS_KEY].enabled, quantityBefore: priorQuantity, quantityAfter: offSale.state.positions[`base:${address}`]?.quantity, tradeSide: offSale.trade.side, writes: writes.length };
  const malformedMessages = [];
  for (const data of [
    { source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: {} },
    { source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [null] },
    { source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES', prices: {} },
    { source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES', prices: [null] }
  ]) {
    try { loaded.api.dispatchPageMessage(data); malformedMessages.push({ data, result: 'accepted without error' }); }
    catch (error) { malformedMessages.push({ data, result: `${error.name}: ${error.message}` }); }
  }
  const evidence = {
    generatedAt: new Date().toISOString(),
    fallbackTrade: bought.trade,
    fallbackPayload,
    fallbackRendered: { overlayChildren: wrongOverlay.overlayChildren, overlayTops: wrongOverlay.overlayTops, diagnostic: wrongOverlay.diagnostic },
    firstBuyBlocked: firstBuyBlocked.markers,
    sellSlotsBlocked: sellSlotsBlocked.markers,
    giantLayout,
    mutationFeedback: mutationFeedbackReport(),
    offActions,
    coordinatorOffSell,
    malformedMessages
  };
  fs.writeFileSync(path.join(__dirname, 'gmgn-reproduction.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
