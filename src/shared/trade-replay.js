(function initTradeReplay(global) {
  'use strict';
  const Tango=global.Tango=global.Tango||{};
  const KEY='tangoPaperReplayCacheV1', MAX_POINTS=600, MAX_TOKENS=8, PAGE_SIZE=50;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=v=>v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0;
  function identity(chain,address){const c=Tango.Chains.get(chain);if(!c||!Tango.Chains.validateAddress(c.id,address))throw Error('invalidReplayToken');return {chain:c.id,address:Tango.Chains.normalizeAddress(c.id,address)};}
  function cleanPoints(points,metric){
    if(!['price','marketCap'].includes(metric)||!Array.isArray(points))return [];
    const byTime=new Map(),now=Date.now();
    for(const p of points.slice(-5000)){
      let time=Number(p?.time);if(time>0&&time<1e11)time*=1000;
      if(!Number.isFinite(time)||time<1e12||time>now+60000||!finite(p?.close))continue;
      const close=Number(p.close),ohlc=['open','high','low'].every(k=>finite(p[k]));
      if(ohlc&&(Number(p.high)<Math.max(Number(p.open),close)||Number(p.low)>Math.min(Number(p.open),close)))continue;
      if(!ohlc&&['open','high','low'].some(k=>p[k]!=null))continue;
      byTime.set(time,{time,close,...(ohlc?{open:Number(p.open),high:Number(p.high),low:Number(p.low)}:{})});
    }
    return [...byTime.values()].sort((a,b)=>a.time-b.time).slice(-MAX_POINTS);
  }
  function extractCandles(payload,url){
    try{
      const u=new URL(url);if(u.protocol!=='https:'||!/(^|\.)gmgn\.ai$/i.test(u.hostname))return null;
      const m=u.pathname.match(/^\/api\/v1\/token_mcap_candles\/([^/]+)\/([^/]+)\/?$/);if(!m)return null;
      // Never guess the unit of an endpoint that can return native-denominated bars.
      const unit=u.searchParams.get('quote_symbol')||u.searchParams.get('currency')||payload?.data?.currency;
      if(String(unit).toLowerCase()!=='usd')return null;
      const token=identity(decodeURIComponent(m[1]),decodeURIComponent(m[2]));
      const raw=payload?.data?.list||payload?.data?.candles||payload?.data;
      const points=cleanPoints(raw,'marketCap');
      return points.length?{...token,metric:'marketCap',points}:null;
    }catch{return null;}
  }
  function mergeCache(cache,batch){
    let token;try{token=identity(batch?.chain,batch?.address);}catch{return cache&&typeof cache==='object'?cache:{};}
    if(!['price','marketCap'].includes(batch.metric))return cache||{};
    const key=`${token.chain}:${token.address}:${batch.metric}`,points=cleanPoints(batch.points,batch.metric);
    if(!points.length)return cache||{};
    const next={...cache,[key]:{...token,metric:batch.metric,updatedAt:Date.now(),points:cleanPoints([...(cache?.[key]?.points||[]),...points],batch.metric)}};
    const entries=Object.entries(next).filter(([,v])=>v&&Array.isArray(v.points)).sort((a,b)=>Number(b[1].updatedAt)-Number(a[1].updatedAt)).slice(0,MAX_TOKENS);
    while(entries.length&&JSON.stringify(Object.fromEntries(entries)).length>450000)entries.pop();
    return Object.fromEntries(entries);
  }
  function derived(t){return t.syntheticTokenPrice===true||t.provisionalTokenPrice===true||/MARKET_CAP|MIXED_DERIVED|SYNTHETIC|FALLBACK/i.test(String(t.priceProvenance||''))||/^TANGO_FALLBACK/.test(String(t.quoteSource||''));}
  function observedCardCap(t){
    const upper=v=>String(v||'').trim().toUpperCase();
    const source=upper(t.source),capSource=upper(t.marketCapSource),valuation=upper(t.valuationSource);
    const supply=Number(Tango.Supply?.UNKNOWN_TOTAL_SUPPLY||1e9),observedAt=Number(t.quoteObservedAtOriginal);
    return upper(t.quoteSource)==='TANGO_FALLBACK_CARD_MARKET_CAP'
      && (!source||source==='TANGO_FALLBACK_CARD_MARKET_CAP')
      && (!capSource||['GMGN','GMGN_TRENCH','GMGN_DETAIL','GMGN_NETWORK'].includes(capSource))
      && (!valuation||valuation==='CARD_MARKET_CAP_FALLBACK_SUPPLY')
      && t.paperFallback===true && t.provisional===true && t.syntheticTokenPrice===true
      && upper(t.valuationMode)==='MARKET_CAP' && upper(t.priceProvenance)==='SYNTHETIC_PRICE'
      && t.supplySource==='UNKNOWN_FALLBACK'
      && t.provisionalSupplyProvenance==='TANGO_INTERNAL_UNKNOWN_FALLBACK_V1'
      && Number(t.totalSupply)===supply && Number(t.marketCapDivisor)===supply && Number(t.provisionalSupply)===supply
      && Number.isSafeInteger(observedAt) && observedAt>0 && observedAt<=Number(t.executedAt)
      && finite(t.observedPriceUsd) && finite(t.marketCapUsd)
      && Math.abs(Number(t.marketCapUsd)/Number(t.observedPriceUsd)-supply)<=supply*.001;
  }
  // A synthetic unit price can still carry a separately observed card cap.
  // Never promote the arbitrary launch placeholder or a history-only mark.
  function capCoordinate(t){
    const source=String(t.quoteSource||'').trim().toUpperCase();
    if(!finite(t.marketCapUsd)||source==='TANGO_POSITION_HISTORY')return null;
    return !source.startsWith('TANGO_FALLBACK')||observedCardCap(t)?Number(t.marketCapUsd):null;
  }
  function model(state,chain,address,cache={},requestedMetric=null){
    const token=identity(chain,address),c=Tango.Chains.get(chain);
    const trades=(state?.trades||[]).filter(t=>{
      try{return t.chain===token.chain&&identity(t.chain,t.tokenAddress).address===token.address&&['BUY','SELL'].includes(t.side)&&finite(t.executedAt)&&Number(t.executedAt)<=Date.now()+60000;}catch{return false;}
    }).map(t=>({...t,time:Number(t.executedAt),price:!derived(t)&&finite(t.executionPriceUsd)?Number(t.executionPriceUsd):null,cap:capCoordinate(t)})).sort((a,b)=>a.time-b.time);
    const capSeries=cleanPoints(cache?.[`${token.chain}:${token.address}:marketCap`]?.points,'marketCap');
    const metric=['price','marketCap'].includes(requestedMetric)?requestedMetric:trades.length&&trades.every(t=>t.cap!==null)?'marketCap':trades.some(t=>t.price!==null)?'price':'marketCap';
    const series=cleanPoints(cache?.[`${token.chain}:${token.address}:${metric}`]?.points,metric);
    return {...token,nativeSymbol:c.nativeSymbol,chainName:c.name,symbol:String(trades[0]?.symbol||address),trades,metric,series};
  }
  function text(language){return Tango.I18n.resolveLanguage(language)==='zh-CN'?{
    title:'买卖记录',close:'关闭',empty:'暂无该代币的成交记录',missing:'成交点连线（非真实行情）：虚线仅连接实际成交时间与记录值，不代表期间走势；已采集报价另以实线显示。',scope:'价格点为含滑点的成交价；市值点为记录中的当时报价市值。明细按保留记录显示。',price:'价格 · USD',cap:'市值 · USD',buy:'买入',sell:'卖出',quantity:'数量',amount:'金额',pnl:'已实现盈亏',time:'时间',prev:'上一页',next:'下一页',paper:'模拟交易 · 无真实资金',limit:'图中最多显示最近 500 笔，完整保留明细可翻页查看。',point:'点击买卖点或明细查看该笔成交。',loading:'正在读取本地记录…',error:'行情缓存暂不可用，成交记录仍可查看。'
  }:{title:'Trade replay',close:'Close',empty:'No retained trades for this token',missing:'Fill-to-fill line (not market data): dashed lines connect recorded fills, not the intervening market. Captured quotes appear separately as solid lines.',scope:'Price markers include slippage; cap markers use recorded observed market cap. Details use retained history.',price:'Price · USD',cap:'Market cap · USD',buy:'Buy',sell:'Sell',quantity:'Quantity',amount:'Amount',pnl:'Realized PnL',time:'Time',prev:'Previous',next:'Next',paper:'SIMULATED TRADING · NO REAL FUNDS',limit:'Chart shows up to the latest 500 fills; paginate to see all retained details.',point:'Select a fill marker or a record to inspect it.',loading:'Reading local records…',error:'Market cache unavailable; fills are still available.'};}
  function html(m,language,page=0){
    const l=text(language),num=v=>Tango.Format.number(v,language,8),usd=v=>v==null?'—':Tango.Format.usd(v,language),dt=v=>new Date(v).toLocaleString(Tango.I18n.resolveLanguage(language));
    const value=t=>m.metric==='price'?t.price:t.cap;
    const shown=m.trades.slice(-500),plottable=shown.filter(t=>finite(value(t)));
    const series=m.series.filter(p=>p.time>=(shown[0]?.time??0)-120000&&p.time<=(shown.at(-1)?.time??Infinity)+120000);
    const history=series.some(p=>p.open!=null);
    const values=[...shown.map(value),...series.flatMap(p=>[p.close,p.high,p.low])].filter(finite).map(Number);
    const times=[...shown.map(t=>t.time),...series.map(p=>p.time)],minT=Math.min(...times),maxT=Math.max(...times),minV=Math.min(...values),maxV=Math.max(...values);
    const span=Math.max(maxV-minV,maxV*.05,1e-12),x=t=>60+(maxT===minT?.5:(t-minT)/(maxT-minT))*710,y=v=>245-(v-minV+span*.1)/(span*1.2)*200;
    const coord=v=>Number.isFinite(v)?v.toFixed(2):'0';
    const market=series.map((p,i,a)=>{
      if(p.open!=null){const color=p.close>=p.open?'#c6fa74':'#ff9c9c';return `<path d="M${coord(x(p.time))} ${coord(y(p.high))}V${coord(y(p.low))}" stroke="${color}"/><rect x="${coord(x(p.time)-2)}" y="${coord(y(Math.max(p.open,p.close)))}" width="4" height="${coord(Math.max(1,Math.abs(y(p.open)-y(p.close))))}" fill="${color}"/>`;}
      const prev=a[i-1];return prev&&p.time-prev.time<=120000?`<path data-market-path d="M${coord(x(prev.time))} ${coord(y(prev.close))}L${coord(x(p.time))} ${coord(y(p.close))}" fill="none" stroke="#c6fa74" stroke-width="2"/>`:'';
    }).join('');
    const executionPath=!history&&plottable.length>1?`<path data-execution-path d="${plottable.map((t,i)=>`${i?'L':'M'}${coord(x(t.time))} ${coord(y(value(t)))}`).join('')}" fill="none" stroke="#a5afa4" stroke-width="2" stroke-dasharray="6 5"/>`:'';
    const inconsistent=m.trades.some(t=>finite(t.observedPriceUsd)&&finite(t.marketCapUsd)&&finite(t.totalSupply)&&Math.abs(Number(t.observedPriceUsd)*Number(t.totalSupply)-Number(t.marketCapUsd))>Number(t.marketCapUsd)*.02);
    const warning=inconsistent?(Tango.I18n.resolveLanguage(language)==='zh-CN'?'价格与市值记录不一致：两种视图可能呈现不同方向；此图不重新计算或修正账户盈亏。':'Recorded price and market cap disagree: views may show different directions. This chart does not recalculate or repair account PnL.') : '';
    const dots=shown.map((t,i)=>finite(value(t))?`<g role="button" tabindex="0" data-fill="${m.trades.length-shown.length+i}" aria-label="${esc(`${t.side} ${dt(t.time)}`)}" style="cursor:pointer;pointer-events:bounding-box"><circle cx="${coord(x(t.time))}" cy="${coord(y(value(t)))}" r="7" fill="${t.side==='BUY'?'#c6fa74':'#ffbe98'}" stroke="#101311" stroke-width="2"/><text x="${coord(x(t.time))}" y="${coord(y(value(t))+(t.side==='BUY'?24:-14))}" text-anchor="middle" fill="${t.side==='BUY'?'#c6fa74':'#ffbe98'}" font-size="11">${t.side==='BUY'?'B':'S'}</text><title>${esc(`${t.side} ${dt(t.time)} · ${usd(value(t))}`)}</title></g>`:'').join('');
    const unplottable=shown.filter(t=>!finite(value(t))).length;
    const pages=Math.max(1,Math.ceil(m.trades.length/PAGE_SIZE)),current=Math.max(0,Math.min(page,pages-1));
    const rows=m.trades.map((t,i)=>({t,i})).reverse().slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE).map(({t,i})=>`<tr><td><button type="button" data-fill="${i}" class="replay-control">${esc(dt(t.time))}</button></td><td style="color:${t.side==='BUY'?'var(--green,#c6fa74)':'var(--red,#ff9c9c)'}">${t.side==='BUY'?l.buy:l.sell}</td><td>${esc(num(t.quantity))}</td><td>${esc(Tango.Format.native(t.amountNative,m.nativeSymbol,language))}</td><td>${esc(usd(m.metric==='price'?t.price:t.cap))}</td><td>${t.side==='SELL'?esc(Tango.Format.native(t.realizedPnlNative,m.nativeSymbol,language,true)):'—'}</td></tr>`).join('');
    return `<h2 style="font-size:20px;margin:8px 0">${esc(m.symbol)} · ${l.title}</h2><p style="font-size:12px;color:var(--muted,#a5afa4);overflow-wrap:anywhere">${esc(m.chainName)} · ${esc(m.address)}<br>${esc(l.paper)}</p><div style="display:flex;gap:8px;margin-bottom:12px"><button type="button" class="replay-control" data-replay-metric="marketCap" aria-pressed="${m.metric==='marketCap'}">${l.cap}</button><button type="button" class="replay-control" data-replay-metric="price" aria-pressed="${m.metric==='price'}">${l.price}</button></div>${m.trades.length?`<div style="border:1px solid var(--line,#303a31);border-radius:12px;padding:10px;overflow:auto"><div style="font-size:12px;color:var(--muted,#a5afa4)">${m.metric==='price'?l.price:l.cap} · <span style="color:var(--green,#c6fa74)">B ${l.buy}</span> / <span style="color:var(--red,#ff9c9c)">S ${l.sell}</span></div><svg viewBox="0 0 800 290" role="img" aria-label="${esc(l.title)}" style="width:100%;min-width:640px;display:block;background:#101311;border-radius:8px"><path d="M60 45H770M60 145H770M60 245H770" stroke="#303a31"/>${market}${executionPath}${dots}<text x="5" data-axis-max y="${coord(y(maxV))}" fill="#a5afa4" font-size="10">${esc(usd(maxV))}</text><text x="5" data-axis-min y="${coord(y(minV))}" fill="#a5afa4" font-size="10">${esc(usd(minV))}</text><text x="60" y="283" fill="#a5afa4" font-size="10">${esc(dt(minT))}</text><text x="770" y="283" text-anchor="end" fill="#a5afa4" font-size="10">${esc(dt(maxT))}</text></svg><p style="font-size:12px;color:var(--muted,#a5afa4)">${esc(l.scope)}${history?'':`<br>${esc(l.missing)}`}${warning?`<br><strong data-replay-warning>${esc(warning)}</strong>`:''}${unplottable?`<br>${unplottable} ${Tango.I18n.resolveLanguage(language)==='zh-CN'?'笔缺少可信坐标，未绘点；仍可在明细查看。':'fills not plotted: no trustworthy coordinates; details remain available.'}`:''}</p></div><p data-replay-selection style="font-size:13px;overflow-wrap:anywhere">${l.point}</p><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap"><thead><tr>${[l.time,'B / S',l.quantity,l.amount,m.metric==='price'?l.price:l.cap,l.pnl].map(s=>`<th style="text-align:left;padding:10px">${s}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div><div style="display:flex;gap:12px;align-items:center;margin-top:14px"><button class="replay-control" data-replay-page="-1" ${current===0?'disabled':''}>${l.prev}</button><span>${current+1} / ${pages} · ${m.trades.length}</span><button class="replay-control" data-replay-page="1" ${current===pages-1?'disabled':''}>${l.next}</button></div>${m.trades.length>500?`<p>${l.limit}</p>`:''}`:`<p>${l.empty}</p>`}`;
  }
  let opened=null,returnFocus=null,openSequence=0,writeQueue=Promise.resolve();const sent=new Map();
  function close(){openSequence++;if(opened){opened.remove();opened=null;}if(global.document)global.document.removeEventListener('keydown',onEscape);if(returnFocus?.isConnected&&typeof returnFocus.focus==='function')returnFocus.focus();returnFocus=null;}
  function onEscape(e){
    if(e.key==='Escape'){e.stopPropagation();close();return;}
    if(e.key==='Tab'&&opened){
      const items=[...opened.querySelectorAll('button:not([disabled]),[tabindex="0"]')],current=e.composedPath?.()[0]||global.document.activeElement;
      const first=items[0],last=items[items.length-1];
      if(e.shiftKey&&(current===first||!items.includes(current))){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&current===last){e.preventDefault();first?.focus();}
    }
  }
  async function open(root,state,chain,address,language){
    close();const seq=openSequence;returnFocus=root.activeElement||global.document?.activeElement;
    const overlay=global.document.createElement('div');overlay.className='tango-shell';opened=overlay;
    overlay.innerHTML=`<style>.replay-control{font:inherit;color:var(--text,#f4f6ef);background:var(--panel,#253020);border:1px solid var(--line,#435534);border-radius:8px;padding:7px 12px;cursor:pointer}.replay-control:disabled{opacity:.4;cursor:default}.replay-control:focus-visible,[data-fill]:focus-visible{outline:2px solid var(--brand,#c6fa74);outline-offset:2px}[data-replay-body] td{padding:9px;border-top:1px solid var(--line,#303a31)}</style><div data-replay-backdrop style="position:fixed;inset:0;z-index:2147483647;background:#000a;display:grid;place-items:center;padding:16px;pointer-events:auto;box-sizing:border-box"><section role="dialog" aria-modal="true" aria-label="${text(language).title}" style="box-sizing:border-box;background:var(--bg,#101311);color:var(--text,#f4f6ef);font:14px/1.5 system-ui,sans-serif;border:1px solid var(--line,#435534);border-radius:16px;padding:20px;width:960px;max-width:calc(100vw - 32px);min-width:0;max-height:calc(100vh - 32px);overflow:auto"><button type="button" class="replay-control" data-replay-close style="float:right">${text(language).close}</button><div data-replay-body>${text(language).loading}</div></section></div>`;
    root.appendChild(overlay);const closeButton=overlay.querySelector('[data-replay-close]');closeButton.addEventListener('click',()=>close());closeButton.focus();
    global.document.addEventListener('keydown',onEscape);
    overlay.querySelector('[data-replay-backdrop]').addEventListener('click',e=>{if(e.target===e.currentTarget)close();});
    let cache={},failed=false,timer;
    try{const response=await Promise.race([global.chrome.runtime.sendMessage({type:'TANGO_REPLAY_READ'}),new Promise(resolve=>{timer=global.setTimeout(()=>resolve(null),3000);})]);cache=response?.cache||{};failed=!response?.ok;}catch{failed=true;}finally{global.clearTimeout(timer);}
    if(seq!==openSequence)return;
    let m;try{m=model(state,chain,address,cache);}catch{close();return;}
    const body=overlay.querySelector('[data-replay-body]');let page=0;
    const render=()=>{body.innerHTML=html(m,language,page)+(failed?`<p>${esc(text(language).error)}</p>`:'');};render();
    const act=e=>{const metricButton=e.target.closest?.('[data-replay-metric]');if(metricButton){m=model(state,chain,address,cache,metricButton.dataset.replayMetric);render();return;}const pageButton=e.target.closest?.('[data-replay-page]');if(pageButton&&!pageButton.disabled){page+=Number(pageButton.dataset.replayPage);render();return;}const fill=e.target.closest?.('[data-fill]');if(!fill)return;const t=m.trades[Number(fill.dataset.fill)];if(!t)return;body.querySelector('[data-replay-selection]').textContent=`${new Date(t.time).toLocaleString(Tango.I18n.resolveLanguage(language))} · ${t.side} · ${Tango.Format.native(t.amountNative,m.nativeSymbol,language)} · ${text(language).quantity} ${Tango.Format.number(t.quantity,language,8)} · ${text(language).price} ${t.price==null?'—':Tango.Format.usd(t.price,language)} · observed USD ${finite(t.observedPriceUsd)?Tango.Format.number(t.observedPriceUsd,language,12):'—'} · MCAP USD ${finite(t.marketCapUsd)?Tango.Format.number(t.marketCapUsd,language,8):'—'} · ${String(t.quoteSource||'—')} · supply ${finite(t.totalSupply)?Tango.Format.number(t.totalSupply,language,0):'—'} · ${String(t.priceProvenance||'—')} · ${String(t.valuationMode||'—')} · slippage ${Number(t.slippageBps)||0} bps${t.side==='SELL'?` · ${text(language).pnl} ${Tango.Format.native(t.realizedPnlNative,m.nativeSymbol,language,true)}`:''}`;};
    body.addEventListener('click',act);body.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-fill]')){e.preventDefault();act(e);}});
  }
  function recordQuote(q){
    if(!q||!finite(q.priceUsd)||!finite(q.priceObservedAt||q.observedAt)||derived(q))return;
    const time=Number(q.priceObservedAt||q.observedAt),key=`${q.chain}:${q.address}`;
    if(time<(sent.get(key)||0)+30000||Date.now()-time>15000||time>Date.now()+1000)return;
    sent.set(key,time);if(sent.size>50)sent.delete(sent.keys().next().value);
    try{global.chrome?.runtime?.sendMessage({type:'TANGO_REPLAY_RECORD',batch:{chain:q.chain,address:q.address,metric:'price',points:[{time,close:Number(q.priceUsd)}]}})?.catch?.(()=>{});}catch{}
  }
  function recordBatch(batch){try{global.chrome?.runtime?.sendMessage({type:'TANGO_REPLAY_RECORD',batch})?.catch?.(()=>{});}catch{}}
  function write(batch){const job=writeQueue.catch(()=>{}).then(async()=>{const stored=await global.chrome.storage.local.get(KEY),cache=mergeCache(stored[KEY],batch);await global.chrome.storage.local.set({[KEY]:cache});return {ok:true};});writeQueue=job;return job;}
  Tango.TradeReplay={KEY,cleanPoints,extractCandles,mergeCache,model,html,text,open,close,recordQuote,recordBatch,write};
  if(typeof module!=='undefined'&&module.exports)module.exports=Tango.TradeReplay;
})(globalThis);
