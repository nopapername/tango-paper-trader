const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');const path=require('node:path');
const root=path.resolve(__dirname,'..');global.Tango={};const Chains=require('../src/core/chains.js');require('../src/core/supply.js');require('../src/shared/constants.js');const State=require('../src/core/state.js');const Engine=require('../src/core/engine.js');require('../src/content/chain-view.js');const Model=require('../src/dashboard/model.js');
const legacyContext={Tango:{...Tango}};vm.runInNewContext(fs.readFileSync(path.join(root,'tests/fixtures/dashboard-model-0.3.7-baseline.js'),'utf8'),legacyContext);
function measure(builder){
 let tradeChainReads=0,positionCollectionReads=0,summaryCalls=0,usdCalls=0,globalCalls=0;
 const state=State.createInitialState({now:1});const chains=Chains.all(),positions={};
 for(let i=0;i<30;i++){const chain=chains[i%6].id;positions[chain+':'+i]={chain,quantity:i+1,costBasisNative:.1,lastPriceUsd:i+2,lastNativePriceUsd:700};}
 Object.defineProperty(state,'positions',{get(){positionCollectionReads++;return positions;},enumerable:true});
 state.trades=Array.from({length:5000},(_,i)=>({get chain(){tradeChainReads++;return chains[i%6].id;},symbol:'TOKEN'+i,tokenAddress:String(i),side:i%3?'SELL':'BUY',realizedPnlNative:((i%97)-48)/1000,executedAt:1}));
 const summary=Engine.portfolioSummary,usd=Engine.chainUsdSummary,globalUsd=Engine.globalUsdSummary;
 Engine.portfolioSummary=(...a)=>{summaryCalls++;return summary(...a)};Engine.chainUsdSummary=(...a)=>{usdCalls++;return usd(...a)};Engine.globalUsdSummary=(...a)=>{globalCalls++;return globalUsd(...a)};
 try{const output=builder(state,State.normalizeSettings({}),'bsc',Object.fromEntries(chains.map(c=>[c.id,700])),{search:'TOKEN'});return {output,metrics:{summaryCalls,usdSummaryCalls:usdCalls+globalCalls*6,tradeChainReads,positionCollectionReads}};}finally{Engine.portfolioSummary=summary;Engine.chainUsdSummary=usd;Engine.globalUsdSummary=globalUsd;}
}
const before=measure(legacyContext.Tango.DashboardModel.build),after=measure(Model.build),history=measure((s,_cfg,c,_p,f)=>Model.history(s,c,f));
assert.deepEqual(JSON.parse(JSON.stringify(after.output)),JSON.parse(JSON.stringify(before.output)));
assert.deepEqual(history.output.trades.map(t=>t.symbol),after.output.trades.map(t=>t.symbol));
console.log(JSON.stringify({scope:'Isolated current-code call counts, synthetic 5000 trades and 30 positions, not browser FPS or order latency',overview:{baseline:before.metrics,optimized:after.metrics,outputsEqual:true},historySearch:{baseline:before.metrics,optimized:history.metrics,filteredOrderEqual:true}},null,2));
