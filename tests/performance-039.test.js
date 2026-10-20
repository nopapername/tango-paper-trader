const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function core(){const c={console,URL,structuredClone,Date,Intl,JSON:{...JSON,parse:JSON.parse,stringify:JSON.stringify}};c.globalThis=c;for(const f of ['core/chains','core/supply','shared/constants','core/state','core/engine','core/state-coordinator','content/chain-view','content/markers','shared/format','dashboard/model'])vm.runInNewContext(fs.readFileSync(path.join(root,'src',f+'.js'),'utf8'),c);return c;}
function fixture(c,n=200){const T=c.Tango,settings=T.State.normalizeSettings({platformFeeBps:0,slippageBps:0,chains:{eth:{networkFeeNative:0}}});let state=T.State.createInitialState({now:1});state.initialized=true;const result=T.Engine.executeBuy(state,{token:{chain:'eth',address:'0x1111111111111111111111111111111111111111',symbol:'TEST',metadataVerified:true,metadataSource:'GMGN_NETWORK'},quote:{priceUsd:2,marketCapUsd:2e9,nativePriceUsd:2000,observedAt:1000,nativePriceObservedAt:1000},amountNative:1},settings,1000);state=result.state;state.trades=Array.from({length:n},(_,i)=>({...result.trade,id:'test-'+i,executedAt:1000+i}));return{state,settings};}
test('under-budget compaction avoids per-record JSON and candidate sorting but still strictly validates',()=>{const c=core(),{state,settings}=fixture(c);let serializations=0,strict=0;const stringify=c.JSON.stringify,normalize=c.Tango.State.normalizeState;c.JSON.stringify=(...a)=>{serializations++;return stringify(...a)};c.Tango.State.normalizeState=(...a)=>{if(a[2]?.strict)strict++;return normalize(...a)};const output=c.Tango.StateCoordinator.compactStateForStorage(state,settings);assert.ok(serializations<=2);assert.equal(strict,1);assert.equal(output.removedTradeIds.length,0);assert.equal(JSON.stringify(output.state),JSON.stringify(normalize(state,settings)));});
test('overlapping coordinator reads share I/O but independent results and mutation barriers remain',async()=>{const c=core(),{state,settings}=fixture(c);let reads=0;const raw={[c.Tango.STORAGE_KEY]:state,[c.Tango.SETTINGS_KEY]:settings};const coordinator=c.Tango.StateCoordinator.create({readRaw:async()=>{reads++;return structuredClone(raw)},writeRaw:async v=>Object.assign(raw,structuredClone(v))});const [a,b,d]=await Promise.all([coordinator.getAll(),coordinator.getAll(),coordinator.getAll()]);assert.equal(reads,1);a.state.accounts.eth.cashBalanceNative=0;assert.notEqual(b.state.accounts.eth.cashBalanceNative,0);const previous=coordinator.getAll();const mutation=coordinator.mutate({type:'PATCH_SETTINGS',patch:{soundEnabled:false}});const after=coordinator.getAll();await previous;await mutation;assert.equal((await after).settings.soundEnabled,false);assert.notEqual(b,d);});
test('marker builder stops when all required facts have been found, with baseline-equivalent output',()=>{const c=core(),address='0x1111111111111111111111111111111111111111';let reads=0;const trades=Array.from({length:5000},(_,i)=>({get chain(){reads++;return 'eth'},tokenAddress:address,id:'t'+i,side:i%2?'SELL':'BUY',executedAt:1000+i,observedPriceUsd:1,marketCapUsd:1e9,totalSupply:1e9,supplySource:'GMGN_EXACT',priceProvenance:'OBSERVED_PRICE',quoteSource:'GMGN_NETWORK'}));const input={current:{token:{chain:'eth',address},quote:{priceUsd:1,marketCapUsd:1e9}},position:null,trades,labels:{entry:'BUY',exit:'SELL',hide:'hide'}};const actual=c.Tango.Markers.buildPayload(input);assert.ok(reads<50,'history should not be walked after all five markers and known supply are resolved');const base={Tango:{...c.Tango}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'fixtures/markers-0.3.8-baseline.js'),'utf8'),base);assert.equal(JSON.stringify(actual),JSON.stringify(base.Tango.Markers.buildPayload(input)));});
test('per-render date formatter matches native strings across languages, invalid dates and DST dates',()=>{const c=core();for(const locale of ['en','en-US','zh-CN']){const format=c.Tango.Format.dateTimeFormatter(locale);for(const value of [0,Date.UTC(2026,2,8,6,59),Date.UTC(2026,10,1,6),Date.UTC(2026,11,31,23,59),NaN])assert.equal(format(value),new Date(value).toLocaleString(locale));}});
test('tab-specific model omits statistics and history from settings without changing its fields',()=>{const c=core(),{state,settings}=fixture(c);c.Tango.Engine.portfolioSummary=()=>{throw Error('unneeded summary')};c.Tango.ChainView.trades=()=>{throw Error('unneeded history')};const view=c.Tango.DashboardModel.forTab(state,settings,'eth',{}, {},'settings');assert.equal(view.chain.id,'eth');assert.equal(view.chainSettings,settings.chains.eth);});

test('generic quote extraction avoids per-object Sets and retains baseline conflict handling',()=>{
 const c=core();let sets=0;c.Set=class extends Set{constructor(...a){super(...a);sets++}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'src/adapters/gmgn-quotes.js'),'utf8'),c);
 const payload={data:Array.from({length:300},(_,i)=>({time:i,price:1,value:i}))};assert.equal(c.Tango.GMGNQuotes.extract(payload,'eth',1000).length,0);assert.ok(sets<5);
 const address='0x1111111111111111111111111111111111111111';const examples=[{data:[{address,price_usd:2,total_supply:1000,totalSupply:2000,market_cap:2000}]},{data:[{address,token_address:'0x2222222222222222222222222222222222222222',price_usd:1}]},{data:[{address,price_usd:1},{address,market_cap:1000,total_supply:1000}]}];
 const base={Tango:{...c.Tango}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'fixtures/gmgn-quotes-0.3.8-baseline.js'),'utf8'),base);
 for(const input of examples)assert.equal(JSON.stringify(c.Tango.GMGNQuotes.extract(input,'eth',1000)),JSON.stringify(base.Tango.GMGNQuotes.extract(input,'eth',1000)));
});

test('read coalescing recovers after a failed read and external invalidation bypasses an old pending read',async()=>{
 const c=core(),{state,settings}=fixture(c);let reads=0,release;
 let raw={[c.Tango.STORAGE_KEY]:state,[c.Tango.SETTINGS_KEY]:settings};
 const coordinator=c.Tango.StateCoordinator.create({readRaw:async()=>{
  reads++;if(reads===1)throw Error('read failed');
  const snapshot=structuredClone(raw);if(reads===2)await new Promise(r=>release=r);return snapshot;
 },writeRaw:async v=>Object.assign(raw,structuredClone(v))});
 await assert.rejects(coordinator.getAll(),/read failed/);
 const old=coordinator.getAll();await new Promise(r=>setImmediate(r));
 raw[c.Tango.SETTINGS_KEY]={...settings,soundEnabled:false};coordinator.invalidateReads();
 const fresh=coordinator.getAll();release();
 assert.equal((await old).settings.soundEnabled,true);
 assert.equal((await fresh).settings.soundEnabled,false);assert.equal(reads,3);
});

test('failed mutation never lets a later coalesced read observe its uncommitted settings',async()=>{
 const c=core(),{state,settings}=fixture(c);
 const raw={[c.Tango.STORAGE_KEY]:state,[c.Tango.SETTINGS_KEY]:settings};
 const coordinator=c.Tango.StateCoordinator.create({readRaw:async()=>structuredClone(raw),writeRaw:async()=>{throw Error('write failed')}});
 const write=coordinator.mutate({type:'PATCH_SETTINGS',patch:{soundEnabled:false}});
 const reads=Promise.all([coordinator.getAll(),coordinator.getAll()]);
 await assert.rejects(write,/write failed/);assert.ok((await reads).every(v=>v.settings.soundEnabled));
});
