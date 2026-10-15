(function initDailyReport(global) {
  const Tango = global.Tango = global.Tango || {};
  const labels = language => Tango.I18n.resolveLanguage(language) === 'zh-CN' ? {
    title:'盈亏日报', net:'当日已实现净盈亏', profit:'盈利金额', loss:'亏损金额', counts:'盈利 / 亏损卖出',
    retained:'盈利、亏损及笔数按保留的卖出记录统计', incomplete:'部分历史明细已裁剪，净盈亏仍按完整日账本计算',
    paper:'模拟交易 · 无真实资金', history:'查看当天记录', close:'关闭', download:'下载 PNG', copy:'复制图片',
    usdMissing:'历史美元盈亏暂不可用', native:'原生币', total:'笔'
  } : {
    title:'Daily PnL', net:'Realized daily net PnL', profit:'Profit', loss:'Loss', counts:'Winning / losing sells',
    retained:'Profit, loss and counts use retained SELL records', incomplete:'Some details were trimmed; net PnL uses the complete daily ledger',
    paper:'SIMULATED TRADING · NO REAL FUNDS', history:'View day trades', close:'Close', download:'Download PNG', copy:'Copy image',
    usdMissing:'Historical USD PnL unavailable', native:'Native', total:' total'
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function dateKey(timestamp) {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function validDate(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key))) return false;
    const d = new Date(`${key}T12:00:00`);
    return Number.isFinite(d.getTime()) && dateKey(d.getTime()) === key;
  }
  function summarize(state, chainId, date) {
    const chain = Tango.Chains.get(chainId);
    if (!chain || !validDate(date)) throw new Error('invalidDailyReport');
    const day = state?.dailyRealizedByChain?.[chain.id]?.[date];
    let profitNative=0, lossNative=0, profitUsd=0, lossUsd=0, wins=0, losses=0, sells=0, retainedNet=0, retainedUsd=0, detailsUsd=true;
    for (const trade of state?.trades || []) {
      if (trade.chain !== chain.id || trade.side !== 'SELL' || !Number.isFinite(Number(trade.executedAt)) || dateKey(Number(trade.executedAt)) !== date) continue;
      const pnl=Number(trade.realizedPnlNative), usd=Number(trade.realizedPnlUsd);
      if (!Number.isFinite(pnl)) continue;
      sells++; retainedNet+=pnl;
      if (trade.realizedPnlUsd == null || !Number.isFinite(usd)) detailsUsd=false;
      else retainedUsd+=usd;
      if (pnl>0) { wins++; profitNative+=pnl; if(Number.isFinite(usd)) profitUsd+=usd; }
      if (pnl<0) { losses++; lossNative+=pnl; if(Number.isFinite(usd)) lossUsd+=usd; }
    }
    const hasDay=day != null && Number.isFinite(Number(day.native));
    const netNative=hasDay ? Number(day.native) : retainedNet;
    const ledgerUsd=hasDay && day.usdAtExecution != null && Number.isFinite(Number(day.usdAtExecution))
      && (netNative===0 || Number(day.usdAtExecution)!==0
        || (sells>0 && detailsUsd && Math.abs(retainedUsd)<=1e-10 && Math.abs(retainedNet-netNative)<=1e-10));
    const netUsd=hasDay ? (ledgerUsd ? Number(day.usdAtExecution) : null) : (detailsUsd ? retainedUsd : null);
    const different=(a,b)=>Math.abs(a-b)>Math.max(1e-10,Math.abs(a)*1e-10);
    return {chain:chain.id,chainName:chain.name,nativeSymbol:chain.nativeSymbol,date,netNative,netUsd,
      profitNative,lossNative,profitUsd:detailsUsd?profitUsd:null,lossUsd:detailsUsd?lossUsd:null,wins,losses,sells,
      detailsIncomplete:hasDay && (different(netNative,retainedNet) || (ledgerUsd && different(netUsd,retainedUsd)))};
  }
  function money(report, field, currency, language) {
    const value=report[`${field}${currency==='USD'?'Usd':'Native'}`];
    if (value==null || !Number.isFinite(value)) return '--';
    if (currency==='USD') return `${value>0?'+':value<0?'-':''}${Tango.Format.usd(Math.abs(value),language)}`;
    return Tango.Format.native(value,report.nativeSymbol,language,true);
  }
  const netColor=(report,currency)=>{const value=currency==='USD'?report.netUsd:report.netNative;return value>0?'#3ee6a0':value<0?'#ff647c':'#f4f5fa';};
  function html(report,currency,language) {
    const l=labels(language), color=netColor(report,currency);
    const row=(title,value,tint='#f4f5fa')=>`<div style="display:flex;justify-content:space-between;gap:16px;align-items:center"><span style="color:#9ca3b8">${esc(title)}</span><strong style="color:${tint};overflow-wrap:anywhere;text-align:right">${esc(value)}</strong></div>`;
    return `<article class="tango-report-card" aria-label="${esc(l.title)}" style="box-sizing:border-box;background:#11141e;color:#f4f5fa;border:1px solid #2b3041;border-radius:16px;padding:24px;font:14px/1.5 system-ui,sans-serif;min-width:0">
      <div style="display:flex;justify-content:space-between;gap:12px;color:#a5adca;font-weight:700"><span>TANGO · ${esc(l.title)}</span><span>${esc(report.chainName)}</span></div>
      <div style="margin-top:22px;color:#c8cede">${esc(report.date)}</div><div style="margin-top:8px;color:#9ca3b8;font-size:12px">${esc(l.net)}</div>
      <strong style="display:block;font-size:clamp(24px,5vw,42px);line-height:1.3;color:${color};overflow-wrap:anywhere;margin:4px 0 24px">${esc(money(report,'net',currency,language))}</strong>
      <div style="display:grid;gap:10px">${row(l.profit,money(report,'profit',currency,language),'#3ee6a0')}${row(l.loss,money(report,'loss',currency,language),'#ff647c')}${row(l.counts,`${report.wins} / ${report.losses} · ${report.sells}${l.total}`)}</div>
      <div style="border-top:1px solid #2b3041;margin-top:22px;padding-top:14px;font-size:11px;color:#8d96ae">${esc(l.paper)}<br>${esc(l.retained)}${report.detailsIncomplete?`<br>${esc(l.incomplete)}`:''}${currency==='USD'&&report.netUsd==null?`<br>${esc(l.usdMissing)}`:''}</div></article>`;
  }
  function canvas(report,currency,language,doc=global.document) {
    const result=doc.createElement('canvas'); result.width=1080; result.height=640;
    const ctx=result.getContext('2d'); if(!ctx) throw new Error('imageExportFailed');
    const l=labels(language),text=(value,x,y,size,color='#f4f5fa',weight=500,max=952)=>{
      ctx.font=`${weight} ${size}px sans-serif`;
      const measured=ctx.measureText(String(value)).width;
      if(measured>max)ctx.font=`${weight} ${Math.max(10,Math.floor(size*max/measured))}px sans-serif`;
      ctx.fillStyle=color;ctx.fillText(String(value),x,y,max);
    };
    ctx.fillStyle='#11141e';ctx.fillRect(0,0,1080,640);
    text(`TANGO · ${l.title}`,64,72,28,'#b7c0dd',700);text(report.chainName,760,72,23,'#b7c0dd',600,256);
    text(report.date,64,141,24,'#c8cede');text(l.net,64,190,20,'#9ca3b8');
    text(money(report,'net',currency,language),64,274,70,netColor(report,currency),800);
    text(l.profit,64,353,23,'#9ca3b8');text(money(report,'profit',currency,language),540,353,28,'#3ee6a0',700,476);
    text(l.loss,64,405,23,'#9ca3b8');text(money(report,'loss',currency,language),540,405,28,'#ff647c',700,476);
    text(l.counts,64,457,23,'#9ca3b8');text(`${report.wins} / ${report.losses} · ${report.sells}${l.total}`,540,457,28,'#f4f5fa',700,476);
    text(l.paper,64,533,19,'#b7c0dd',700);text(l.retained,64,570,17,'#8d96ae');
    if(report.detailsIncomplete)text(l.incomplete,64,603,15,'#8d96ae');
    else if(currency==='USD'&&report.netUsd==null)text(l.usdMissing,64,603,15,'#8d96ae');
    return result;
  }
  async function exportImage(report,currency,language,mode='download',env=global) {
    const image=canvas(report,currency,language,env.document);
    const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));
    if(!blob)throw new Error('imageExportFailed');
    if(mode==='copy' && env.navigator?.clipboard?.write && env.ClipboardItem){
      try {await env.navigator.clipboard.write([new env.ClipboardItem({'image/png':blob})]);return 'copied';}catch{}
    }
    const url=env.URL.createObjectURL(blob);
    try {const anchor=env.document.createElement('a');anchor.href=url;anchor.download=`tango-${report.chain}-${report.date}-daily-pnl.png`;anchor.click();}
    finally {env.setTimeout(()=>env.URL.revokeObjectURL(url),1000);}
    return mode==='copy'?'fallback':'downloaded';
  }
  function dialog(report,currency,language,busy=false) {
    const l=labels(language);
    const button=(action,title,selected=false)=>`<button type="button" data-report-action="${action}" ${busy?'disabled':''} ${action==='native'||action==='usd'?`aria-pressed="${selected}"`:''} style="border:1px solid ${selected?'#9b85ff':'#353b50'};border-radius:8px;padding:8px 12px;background:${selected?'#342957':'#202635'};color:#f4f5fa;cursor:pointer;font:13px system-ui,sans-serif">${esc(title)}</button>`;
    return `<div class="tango-report-overlay" style="position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);padding:16px;box-sizing:border-box;pointer-events:auto"><section role="dialog" aria-modal="true" aria-label="${esc(l.title)}" style="box-sizing:border-box;max-width:560px;width:100%;max-height:calc(100vh - 32px);overflow:auto;background:#191e2c;border:1px solid #353b50;border-radius:18px;padding:14px;box-shadow:0 16px 60px #0008">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px"><div style="display:flex;gap:6px">${button('native',l.native,currency!=='USD')}${button('usd','USD',currency==='USD')}</div>${button('close',l.close)}</div>
      ${html(report,currency,language)}<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">${button('download',l.download)}${button('copy',l.copy)}${button('history',l.history)}</div></section></div>`;
  }

  Tango.DailyReport={summarize,money,labels,html,canvas,exportImage,dialog,validDate};
  if(typeof module!=='undefined'&&module.exports)module.exports=Tango.DailyReport;
})(globalThis);
