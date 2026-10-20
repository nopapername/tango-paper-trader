const test=require('node:test'),assert=require('node:assert/strict');
global.Tango={};require('../src/core/chains.js');require('../src/shared/i18n.js');require('../src/shared/format.js');
const R=require('../src/shared/trade-replay.js');
const address='0x1111111111111111111111111111111111111111',other='0x2222222222222222222222222222222222222222';
const now=Date.now(),trade=(extra={})=>({id:'buy',chain:'bsc',tokenAddress:address,symbol:'TEST',side:'BUY',executedAt:now-60000,executionPriceUsd:2,marketCapUsd:2000,amountNative:.1,quantity:40,...extra});
test('replay preserves all same-token fills after closing and isolates chain/address',()=>{const s={trades:[trade(),trade({id:'sell',side:'SELL',executedAt:now,realizedPnlNative:.01}),trade({chain:'eth'}),trade({tokenAddress:other})]},before=JSON.stringify(s);const m=R.model(s,'bsc',address);assert.equal(m.trades.length,2);assert.equal(m.trades[0].side,'BUY');assert.equal(JSON.stringify(s),before);});
test('replay does not fabricate a price path from execution fills',()=>{const m=R.model({trades:[trade(),trade({side:'SELL',executedAt:now})]},'bsc',address);assert.equal(m.series.length,0);assert.match(R.html(m,'en'),/not market data/);assert.doesNotMatch(R.html(m,'en'),/data-market-path/);});
test('replay treats market-cap derived and synthetic prices as non-price coordinates',()=>{const m=R.model({trades:[trade({syntheticTokenPrice:true}),trade({priceProvenance:'MARKET_CAP_DERIVED'})]},'bsc',address);assert.ok(m.trades.every(t=>t.price===null));assert.equal(m.metric,'marketCap');});
test('replay rejects invalid token identity',()=>{assert.throws(()=>R.model({},'bsc','bad'));assert.throws(()=>R.model({},'invalid',address));});
test('candles require explicit USD units and an exact token-mcap API identity',()=>{const data={data:{list:[{time:Math.floor(now/1000)-60,open:'10',high:'14',low:'8',close:'12'}]}};const url=`https://gmgn.ai/api/v1/token_mcap_candles/bsc/${address}?quote_symbol=usd`;const c=R.extractCandles(data,url);assert.equal(c.points.length,1);assert.equal(c.metric,'marketCap');assert.equal(c.points[0].close,12);assert.equal(R.extractCandles(data,url.replace('=usd','=bnb')),null);assert.equal(R.extractCandles(data,url.replace('gmgn.ai','evil.example')),null);assert.equal(R.extractCandles(data,url.split('?')[0]),null);});
test('invalid OHLC, NaN and future timestamps are rejected',()=>{const base={time:now-1000,open:10,high:14,low:8,close:12};assert.equal(R.cleanPoints([{...base,high:9},base,{...base,time:now+999999}, {...base,close:Infinity}],'marketCap').length,1);});
test('cache merges by timestamp, preserves token boundaries and enforces bounds',()=>{let c={};for(let i=0;i<15;i++){const addr=`0x${String(i).padStart(40,'0')}`;c=R.mergeCache(c,{chain:'bsc',address:addr,metric:'price',points:[{time:now-1000,close:2}]});}assert.ok(Object.keys(c).length<=8);const a=R.mergeCache({}, {chain:'bsc',address,metric:'price',points:[{time:now-1000,close:2},{time:now-1000,close:3}]});assert.equal(a[`bsc:${address}:price`].points.length,1);assert.equal(a[`bsc:${address}:price`].points[0].close,3);});
test('replay escapes imported token labels and row IDs and has a readable fill ledger',()=>{const m=R.model({trades:[trade({symbol:'<img src=x onerror=alert(1)>',id:'" onclick="bad'})]},'bsc',address);const html=R.html(m,'zh-CN');assert.doesNotMatch(html,/<img|onclick=/);assert.match(html,/买卖记录/);assert.match(html,/0.1 BNB/);});
test('known observations retain market path independently of the execution path',()=>{const cache=R.mergeCache({}, {chain:'bsc',address,metric:'price',points:[{time:now-120000,close:1},{time:now,close:3}]});const m=R.model({trades:[trade(),trade({id:'sell',side:'SELL',executedAt:now})]},'bsc',address,cache,'price');const html=R.html(m,'en');assert.match(html,/data-market-path/);assert.match(html,/data-execution-path/);assert.match(html,/data-fill="0"/);assert.match(html,/data-fill="1"/);assert.doesNotMatch(html,/NaN|Infinity/);});
test('flat and single trades render finite coordinates without losing markers',()=>{for(const t of [[trade()],[trade(),trade({id:'sell',side:'SELL'})]])assert.doesNotMatch(R.html(R.model({trades:t},'bsc',address),'en'),/NaN|Infinity/);});

test('replay capture cannot interrupt live quote handling when extension is reloaded',()=>{
 const before=global.chrome;global.chrome={runtime:{sendMessage(){throw Error('Extension context invalidated');}}};
 try{assert.doesNotThrow(()=>R.recordQuote({chain:'bsc',address,priceUsd:1,observedAt:Date.now()}));assert.doesNotThrow(()=>R.recordBatch({}));}finally{global.chrome=before;}
});
test('OHLC history renders candles in the correct market-cap unit',()=>{
 const cache=R.mergeCache({}, {chain:'bsc',address,metric:'marketCap',points:[{time:now-60000,open:1000,close:2000,high:2200,low:900}]});
 const m=R.model({trades:[trade()]},'bsc',address,cache);assert.equal(m.metric,'marketCap');assert.match(R.html(m,'en'),/Market cap/);assert.match(R.html(m,'en'),/<rect/);
});
test('large histories page all retained records while bounding chart marker cost',()=>{
 const trades=Array.from({length:1000},(_,i)=>trade({id:String(i),executedAt:now-i*1000})),m=R.model({trades},'bsc',address);
 const first=R.html(m,'en',0),last=R.html(m,'en',19);assert.equal((first.match(/<circle /g)||[]).length,500);assert.equal((first.match(/<tr>/g)||[]).length,51);assert.match(last,/20 \/ 20/);assert.match(last,/data-fill="0"/);
});

test('a fill missing coordinates does not hide other factual fills',()=>{const m=R.model({trades:[trade({marketCapUsd:0}),trade({id:'fallback',side:'SELL',syntheticTokenPrice:true,marketCapUsd:0})]},'bsc',address);assert.equal(m.metric,'price');const html=R.html(m,'en');assert.match(html,/data-fill="0"/);assert.match(html,/not plotted/);});

test('record-only replay connects real fills chronologically and labels the path as non-market data',()=>{
 const m=R.model({trades:[trade({executedAt:now-60000,marketCapUsd:30160,observedPriceUsd:.0000031626,executionPriceUsd:.0000031879,totalSupply:1e9}),trade({id:'sell',side:'SELL',executedAt:now,marketCapUsd:8070,executionPriceUsd:.0000080054})]},'bsc',address);
 assert.equal(m.metric,'marketCap');const html=R.html(m,'zh-CN');assert.match(html,/data-execution-path/);assert.match(html,/非真实行情/);assert.match(html,/data-replay-metric="price"/);assert.match(html,/价格与市值记录不一致/);assert.doesNotMatch(html,/data-market-path/);
 const price=R.model({trades:m.trades},'bsc',address,{},'price');assert.equal(price.metric,'price');assert.equal(price.trades[0].price,.0000031879);
});

test('replay axis tick labels share the exact fill coordinate mapping',()=>{
 const m=R.model({trades:[trade({marketCapUsd:1000}),trade({side:'SELL',executedAt:now,marketCapUsd:2000})]},'bsc',address),html=R.html(m,'en');
 assert.match(html,/data-axis-max y="61.67"/);assert.match(html,/data-axis-min y="228.33"/);
});

const cardCapTrade=(extra={})=>trade({quoteSource:'TANGO_FALLBACK_CARD_MARKET_CAP',paperFallback:true,provisional:true,syntheticTokenPrice:true,valuationMode:'MARKET_CAP',priceProvenance:'SYNTHETIC_PRICE',supplySource:'UNKNOWN_FALLBACK',provisionalSupplyProvenance:'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1',totalSupply:1e9,marketCapDivisor:1e9,provisionalSupply:1e9,observedPriceUsd:.0000046,marketCapUsd:4600,quoteObservedAtOriginal:now-61000,...extra});
test('replay plots independently observed card market caps without claiming synthetic prices are factual',()=>{
 for(const chain of ['bsc','sol','eth','base','robinhood','xlayer']){
  const tokenAddress=chain==='sol'?'9xbcoYZb6xVrDSFtmvgknBGJyxu9on4PRbrEEKceSsJG':address;
  const trades=[cardCapTrade({chain,tokenAddress}),cardCapTrade({chain,tokenAddress,id:'second',executedAt:now-30000})];
  const before=JSON.stringify(trades),m=R.model({trades},chain,tokenAddress);
  assert.equal(m.metric,'marketCap');assert.equal(m.trades[0].cap,4600);assert.equal(m.trades[0].price,null);
  assert.match(R.html(m,'en'),/data-fill="0"/);assert.match(R.html(m,'en'),/data-execution-path/);
  assert.equal(JSON.stringify(trades),before);
 }
});
test('replay still rejects placeholder or incoherent card market caps',()=>{
 const invalid=[{quoteSource:'TANGO_FALLBACK'},{quoteSource:'TANGO_POSITION_HISTORY'},{quoteObservedAtOriginal:0},{quoteObservedAtOriginal:now},{paperFallback:false},{provisional:false},{syntheticTokenPrice:false},{valuationMode:'PRICE'},{priceProvenance:'OBSERVED_PRICE'},{supplySource:'UNKNOWN'},{provisionalSupplyProvenance:'forged'},{totalSupply:1e8},{marketCapDivisor:1e8},{provisionalSupply:1e8},{observedPriceUsd:.000046},{marketCapSource:'DEXSCREENER'},{valuationSource:'UNKNOWN_INITIAL_MARKET_CAP'},{source:'TANGO_FALLBACK'}];
 for(const extra of invalid){const m=R.model({trades:[cardCapTrade(extra)]},'bsc',address);assert.equal(m.trades[0].cap,null,JSON.stringify(extra));}
});
