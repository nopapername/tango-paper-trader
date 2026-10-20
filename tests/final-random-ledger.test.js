const test=require('node:test');
const assert=require('node:assert/strict');
global.Tango={};
const Chains=require('../src/core/chains');
require('../src/core/supply');require('../src/shared/constants');
const State=require('../src/core/state');
const Engine=require('../src/core/engine');

test('six-chain seeded random buys, exits and FX marks agree with an independent cash and cost ledger',()=>{
 let seed=349;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-7,`${label}: ${a} versus ${b}`);
 for(const chain of Chains.all()){
  const settings=State.normalizeSettings({slippageBps:80,platformFeeBps:100,chains:Object.fromEntries(Chains.all().map(c=>[c.id,{networkFeeNative:.001}]))});
  let state=State.createInitialState({now:1700000000000,initialBalances:Object.fromEntries(Chains.all().map(c=>[c.id,100]))});state.initialized=true;
  const token={chain:chain.id,address:chain.id==='sol'?'So11111111111111111111111111111111111111112':'0x1111111111111111111111111111111111111111',symbol:'RANDOM',metadataVerified:true,metadataSource:'GMGN_NETWORK'};
  const key=Engine.positionKey(chain.id,token.address);
  let cash=100,qty=0,cost=0,pnl=0,price=2,native=100;
  const step=(sell,percent,index)=>{
   const now=1700000000000+index*1000;
   const quote={chain:chain.id,address:token.address,priceUsd:price,marketCapUsd:price*1000000,nativePriceUsd:native,observedAt:now,nativePriceObservedAt:now,source:'GMGN_NETWORK'};
   const prior=structuredClone(state.accounts);
   if(sell){
    const fraction=percent/100,quantity=qty*fraction,allocated=cost*fraction;
    const gross=quantity*price*(1-.008)/native,net=Math.max(0,gross*(1-.01)-.001);
    state=Engine.executeSell(state,{token,quote,percent},settings,now).state;
    cash+=net;pnl+=net-allocated;qty-=quantity;cost-=allocated;
   }else{
    const amount=.1+Math.floor(random()*5)*.1;
    state=Engine.executeBuy(state,{token,quote,amountNative:amount},settings,now).state;
    cash-=amount;cost+=amount;qty+=(amount*(1-.01)-.001)*native/(price*(1+.008));
   }
   near(state.accounts[chain.id].cashBalanceNative,cash,chain.id+' cash');
   near(state.accounts[chain.id].realizedPnlNative,pnl,chain.id+' realized');
   for(const other of Chains.all().filter(c=>c.id!==chain.id))assert.deepEqual(state.accounts[other.id],prior[other.id]);
   const pos=state.positions[key];
   if(qty>1e-9){near(pos.quantity,qty,chain.id+' quantity');near(pos.costBasisNative,cost,chain.id+' remaining cost');const mark=Engine.markPosition(pos,quote,native);near(mark.valueNative,qty*price/native,chain.id+' valuation');near(mark.unrealizedPnlNative,qty*price/native-cost,chain.id+' unrealized');}
  };
  for(let i=0;i<25;i++){price*=.75+random()*.5;native*=.95+random()*.1;const sell=qty>0&&random()>.55;step(sell,[10,25,50,75][Math.floor(random()*4)],i);}
  if(qty>0)step(true,100,26);
  assert.equal(state.positions[key],undefined);near(cash-100,pnl,chain.id+' closed account PnL');
  near(Object.values(state.dailyRealizedByChain[chain.id]).reduce((a,d)=>a+d.native,0),pnl,chain.id+' calendar');
 }
});
