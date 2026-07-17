(function initDashboard(global) {
  const Tango = global.Tango;
  const app = document.querySelector('#app');
  const fileInput = document.querySelector('#import-file');
  const initialTab = ['overview', 'positions', 'history', 'calendar', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  const runtime = { state: null, settings: null, tab: initialTab, month: new Date(), filters: { search: '', side: 'ALL', result: 'ALL', date: '' }, toast: '', solPriceUsd: 0 };
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const lang = () => Tango.I18n.resolveLanguage(runtime.settings?.language);
  const t = (key) => Tango.I18n.t(key, runtime.settings?.language);
  const cls = (value) => Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : 'flat';
  const money = (value, signed = false) => {
    if (runtime.settings?.displayCurrency !== 'USD' || !(runtime.solPriceUsd > 0)) return Tango.Format.sol(value, lang(), signed);
    const numeric = Number(value || 0); const sign = signed && numeric > 0 ? '+' : numeric < 0 ? '-' : '';
    return `${sign}${Tango.Format.usd(Math.abs(numeric) * runtime.solPriceUsd, lang())}`;
  };

  async function load() {
    const data = await Tango.Store.getAll(); runtime.state = data.state; runtime.settings = data.settings;
    runtime.solPriceUsd = Number(Object.values(runtime.state.positions || {}).find((position) => position.lastSolPriceUsd)?.lastSolPriceUsd || runtime.solPriceUsd || 0);
    if (!(runtime.solPriceUsd > 0) && global.chrome?.runtime?.sendMessage) {
      try { runtime.solPriceUsd = Number((await chrome.runtime.sendMessage({ type: 'TANGO_GET_SOL_PRICE' }))?.price || 0); } catch { /* dashboard remains SOL-denominated */ }
    }
    render();
  }

  function render() {
    document.documentElement.lang = lang();
    document.documentElement.dataset.theme = runtime.settings?.theme === 'light' ? 'light' : 'dark';
    if (!runtime.state.initialized) return renderSetupRequired();
    const summary = Tango.Engine.portfolioSummary(runtime.state);
    const titles = { overview: t('overview'), positions: t('positions'), history: t('tradeHistory'), calendar: t('calendar'), settings: t('settings') };
    app.innerHTML = `<div class="app"><aside class="sidebar">
      <div class="brand"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div>
      <nav class="nav">${Object.entries(titles).map(([id,label]) => `<button data-tab="${id}" class="${runtime.tab===id?'active':''}">${label}</button>`).join('')}</nav>
      <div class="sidebar-bottom">Tango Paper Trader v${Tango.VERSION}<br>${t('paperOnly')}</div>
    </aside><main class="main"><div class="topbar"><div><h1>${titles[runtime.tab]}</h1><p>${t('welcome')}</p></div>
      <button class="button primary" data-action="open-gmgn">GMGN ↗</button></div>
      ${renderTab(summary)}
    </main></div>${runtime.toast ? `<div class="toast">${esc(runtime.toast)}</div>` : ''}`;
    bind();
  }

  function renderSetupRequired() {
    app.innerHTML = `<div class="onboarding-page"><section class="onboarding card">
      <div class="brand" style="justify-content:center;padding:0"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div>
      <h1>${t('setup')}</h1><p>${t('setupInPopup')}</p>
    </section></div>`;
  }

  function renderTab(summary) {
    if (runtime.tab === 'positions') return positionsPanel();
    if (runtime.tab === 'history') return historyPanel();
    if (runtime.tab === 'calendar') return calendarPanel();
    if (runtime.tab === 'settings') return settingsPanel();
    return overviewPanel(summary);
  }

  function overviewPanel(summary) {
    const stats = [
      [t('equity'), money(summary.equitySol), ''],
      [t('totalPnl'), money(summary.totalPnlSol, true), cls(summary.totalPnlSol)],
      [t('realizedPnl'), money(summary.realizedPnlSol, true), cls(summary.realizedPnlSol)],
      [t('unrealizedPnl'), money(summary.unrealizedPnlSol, true), cls(summary.unrealizedPnlSol)],
      [t('balance'), money(summary.cashBalanceSol), ''],
      [t('positions'), String(summary.positionCount), ''], [t('totalTrades'), String(summary.totalTrades), ''],
      [t('winRate'), Tango.Format.percent(summary.winRate, lang()), cls(summary.winRate)],
      [t('profitFactor'), Number.isFinite(summary.profitFactor) ? Tango.Format.number(summary.profitFactor, lang(), 2) : '∞', cls(summary.profitFactor)]
    ];
    return `<div class="stats">${stats.map(([label,value,c]) => `<div class="stat card"><span>${label}</span><strong class="${c}">${value}</strong></div>`).join('')}</div>
      ${positionsPanel(true)}${historyPanel(true)}`;
  }

  function positionsPanel(compact = false) {
    const positions = Object.values(runtime.state.positions || {});
    const rows = positions.map((position) => {
      const mark = Tango.Engine.markPosition(position);
      return `<tr><td class="token-cell">${esc(position.symbol)}</td><td>${position.chain.toUpperCase()}</td><td>${money(position.costBasisSol)}</td>
        <td>${money(mark.valueSol)}</td><td class="${cls(mark.unrealizedPnlSol)}">${money(mark.unrealizedPnlSol,true)} (${Tango.Format.percent(mark.roi,lang(),true)})</td>
        <td>${Tango.Format.usd(position.averageEntryMarketCap,lang(),true)}</td><td>${Tango.Format.usd(position.lastMarketCapUsd,lang(),true)}</td><td>${Tango.Format.duration(Date.now()-position.openedAt,lang())}</td></tr>`;
    }).join('');
    return `<section class="panel card"><div class="panel-header"><h2>${t('positions')}</h2>${compact?`<button class="button" data-tab="positions">${t('positions')} →</button>`:''}</div>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>${t('token')}</th><th>Chain</th><th>${t('cost')}</th><th>${t('value')}</th><th>${t('pnl')}</th><th>${t('entryMc')}</th><th>${t('currentMc')}</th><th>${t('held')}</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${t('noPositions')}</div>`}</section>`;
  }

  function filteredTrades() {
    return (runtime.state.trades || []).filter((trade) => {
      const matchesSearch = !runtime.filters.search || `${trade.symbol} ${trade.tokenAddress}`.toLowerCase().includes(runtime.filters.search.toLowerCase());
      const matchesSide = runtime.filters.side === 'ALL' || trade.side === runtime.filters.side;
      const matchesDate = !runtime.filters.date || new Date(trade.executedAt).toLocaleDateString('en-CA') === runtime.filters.date;
      const matchesResult = runtime.filters.result === 'ALL' || (runtime.filters.result === 'WIN' && Number(trade.realizedPnlSol) > 0) || (runtime.filters.result === 'LOSS' && Number(trade.realizedPnlSol) < 0);
      return matchesSearch && matchesSide && matchesDate && matchesResult;
    });
  }

  function historyPanel(compact = false) {
    const trades = filteredTrades().slice(0, compact ? 8 : 500);
    const rows = trades.map((trade) => `<tr><td>${new Date(trade.executedAt).toLocaleString(lang())}</td><td class="token-cell">${esc(trade.symbol)}</td>
      <td class="${trade.side==='BUY'?'up':'down'}">${trade.side}</td><td>${money(trade.amountSol)}</td><td>${Tango.Format.usd(trade.executionPriceUsd,lang())}</td>
      <td>${Tango.Format.usd(trade.marketCapUsd,lang(),true)}</td><td class="${cls(trade.realizedPnlSol)}">${trade.side==='SELL'?money(trade.realizedPnlSol,true):'—'}</td>
      <td>${trade.side==='SELL'?`<button class="button" data-share="${esc(trade.id)}">PNG</button> <button class="button" data-copy-share="${esc(trade.id)}">${t('copyImage')}</button>`:''}</td></tr>`).join('');
    return `<section class="panel card"><div class="panel-header"><h2>${t('tradeHistory')}</h2><div class="actions">
      ${compact?`<button class="button" data-tab="history">${t('history')} →</button>`:`<button class="button" data-action="export-csv">${t('exportCsv')}</button><button class="button" data-action="export-json">${t('exportJson')}</button>`}</div></div>
      ${compact?'':`<div class="filters"><input class="input" id="trade-search" value="${esc(runtime.filters.search)}" placeholder="${t('token')} / CA"><input class="input" id="trade-date" type="date" value="${esc(runtime.filters.date)}"><select class="select" id="trade-side"><option value="ALL">ALL</option><option value="BUY" ${runtime.filters.side==='BUY'?'selected':''}>BUY</option><option value="SELL" ${runtime.filters.side==='SELL'?'selected':''}>SELL</option></select><select class="select" id="trade-result"><option value="ALL">ALL PnL</option><option value="WIN" ${runtime.filters.result==='WIN'?'selected':''}>WIN</option><option value="LOSS" ${runtime.filters.result==='LOSS'?'selected':''}>LOSS</option></select></div>`}
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>${t('date')}</th><th>${t('token')}</th><th>${t('side')}</th><th>${t('amount')}</th><th>${t('executionPrice')}</th><th>${t('marketCap')}</th><th>${t('realizedPnl')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${t('noTrades')}</div>`}</section>`;
  }

  function calendarPanel() {
    const date = runtime.month; const year = date.getFullYear(); const month = date.getMonth();
    const firstDay = new Date(year,month,1); const days = new Date(year,month+1,0).getDate();
    const offset = (firstDay.getDay()+6)%7; const labels = lang()==='zh-CN'?['一','二','三','四','五','六','日']:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const cells = Array.from({length:offset},()=>'<div class="calendar-day empty-day"></div>');
    for(let day=1;day<=days;day+=1){
      const key=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`; const pnl=Number(runtime.state.dailyRealized[key]||0);
      cells.push(`<button class="calendar-day ${pnl>0?'win':pnl<0?'loss':''}" data-calendar-date="${key}"><span class="day">${day}</span><strong class="day-pnl ${cls(pnl)}">${pnl?money(pnl,true):'—'}</strong></button>`);
    }
    const monthTrades=(runtime.state.trades||[]).filter((trade)=>{const d=new Date(trade.executedAt);return d.getFullYear()===year&&d.getMonth()===month&&trade.side==='SELL';});
    const monthPnl=monthTrades.reduce((sum,trade)=>sum+Number(trade.realizedPnlSol||0),0);const monthWins=monthTrades.filter((trade)=>Number(trade.realizedPnlSol)>0);
    const best=monthTrades.reduce((value,trade)=>Math.max(value,Number(trade.realizedPnlSol||0)),0);const worst=monthTrades.reduce((value,trade)=>Math.min(value,Number(trade.realizedPnlSol||0)),0);
    return `<div class="stats"><div class="stat card"><span>${t('totalPnl')}</span><strong class="${cls(monthPnl)}">${money(monthPnl,true)}</strong></div><div class="stat card"><span>${t('totalTrades')}</span><strong>${monthTrades.length}</strong></div><div class="stat card"><span>${t('winRate')}</span><strong>${Tango.Format.percent(monthTrades.length?monthWins.length/monthTrades.length*100:0,lang())}</strong></div><div class="stat card"><span>Best / Worst</span><strong class="${cls(best+worst)}">${money(best,true)} / ${money(worst,true)}</strong></div></div><section class="panel card"><div class="calendar-head"><button class="button" data-month="-1">←</button><h2>${date.toLocaleDateString(lang(),{month:'long',year:'numeric'})}</h2><button class="button" data-month="1">→</button></div>
      <div class="calendar-grid">${labels.map((label)=>`<div class="calendar-label">${label}</div>`).join('')}${cells.join('')}</div></section>`;
  }

  function settingsPanel() {
    const s=runtime.settings;
    return `<section class="panel card"><div class="settings-section"><h3>${t('settings')}</h3><div class="settings-grid">
      <div class="field"><label>${t('language')}</label><select class="select" id="setting-language"><option value="auto" ${s.language==='auto'?'selected':''}>${t('auto')}</option><option value="zh-CN" ${s.language==='zh-CN'?'selected':''}>简体中文</option><option value="en" ${s.language==='en'?'selected':''}>English</option></select></div>
      <div class="field"><label>${t('displayCurrency')}</label><select class="select" id="setting-currency"><option value="SOL" ${s.displayCurrency==='SOL'?'selected':''}>SOL</option><option value="USD" ${s.displayCurrency==='USD'?'selected':''}>USD</option></select></div>
      <div class="field"><label>Theme</label><select class="select" id="setting-theme"><option value="dark" ${s.theme==='dark'||s.theme==='auto'?'selected':''}>Dark</option><option value="light" ${s.theme==='light'?'selected':''}>Light</option></select></div>
      <div class="field"><label>Buy presets · SOL</label><input class="input" id="setting-buy-presets" value="${esc(s.buyPresets.join(', '))}"></div>
      <div class="field"><label>Sell presets · %</label><input class="input" id="setting-sell-presets" value="${esc(s.sellPresets.join(', '))}"></div>
      <div class="field"><label>${t('slippage')} (bps)</label><input class="input" id="setting-slippage" type="number" min="0" max="5000" value="${s.slippageBps}"></div>
      <div class="field"><label>${t('tradingFee')} (bps)</label><input class="input" id="setting-platform-fee" type="number" min="0" max="5000" value="${s.platformFeeBps}"></div>
      <div class="field"><label>${t('networkFee')} (SOL)</label><input class="input" id="setting-network-fee" type="number" min="0" step="0.0001" value="${s.networkFeeSol}"></div>
      <div class="field"><label>PnL Bar</label><select class="select" id="setting-bar-position"><option value="bottom" ${s.pnlBarPosition==='bottom'?'selected':''}>Bottom</option><option value="top" ${s.pnlBarPosition==='top'?'selected':''}>Top</option></select></div>
      <label class="checkbox"><input id="setting-fast" type="checkbox" ${s.fastMode?'checked':''}> ${t('fastMode')}</label>
      <label class="checkbox"><input id="setting-confirm" type="checkbox" ${s.confirmationEnabled?'checked':''}> ${t('confirmTrades')}</label>
      <label class="checkbox"><input id="setting-sound" type="checkbox" ${s.soundEnabled?'checked':''}> ${t('sound')}</label>
      <label class="checkbox"><input id="setting-list-buy" type="checkbox" ${s.showListQuickBuy?'checked':''}> ${t('quickBuy')}</label>
    </div><div class="actions" style="margin-top:15px"><button class="button primary" data-action="save-settings">${t('confirm')}</button></div></div>
    <div class="settings-section"><h3>Data</h3><div class="actions"><button class="button" data-action="export-json">${t('exportJson')}</button><button class="button" data-action="import-json">${t('importJson')}</button><button class="button danger" data-action="reset">${t('resetAccount')}</button></div><p class="muted">${t('resetWarning')}</p></div></section>`;
  }

  function bind() {
    app.querySelectorAll('[data-tab]').forEach((button)=>button.addEventListener('click',()=>{runtime.tab=button.dataset.tab;render();}));
    app.querySelectorAll('[data-month]').forEach((button)=>button.addEventListener('click',()=>{runtime.month=new Date(runtime.month.getFullYear(),runtime.month.getMonth()+Number(button.dataset.month),1);render();}));
    app.querySelectorAll('[data-calendar-date]').forEach((button)=>button.addEventListener('click',()=>{runtime.filters.date=button.dataset.calendarDate;runtime.tab='history';render();}));
    app.querySelectorAll('[data-share]').forEach((button)=>button.addEventListener('click',()=>shareTrade(button.dataset.share)));
    app.querySelectorAll('[data-copy-share]').forEach((button)=>button.addEventListener('click',()=>shareTrade(button.dataset.copyShare,'copy')));
    app.querySelectorAll('[data-action]').forEach((button)=>button.addEventListener('click',()=>action(button.dataset.action)));
    const search=app.querySelector('#trade-search'); if(search)search.addEventListener('input',()=>{runtime.filters.search=search.value;render();});
    const side=app.querySelector('#trade-side'); if(side)side.addEventListener('change',()=>{runtime.filters.side=side.value;render();});
    const result=app.querySelector('#trade-result'); if(result)result.addEventListener('change',()=>{runtime.filters.result=result.value;render();});
    const date=app.querySelector('#trade-date'); if(date)date.addEventListener('change',()=>{runtime.filters.date=date.value;render();});
  }

  async function action(name) {
    if(name==='open-gmgn')return chrome.tabs.create({url:'https://gmgn.ai/trend?chain=sol'});
    if(name==='export-json')return download(`tango-backup-${dateStamp()}.json`,JSON.stringify(await Tango.Store.exportData(),null,2),'application/json');
    if(name==='export-csv')return download(`tango-trades-${dateStamp()}.csv`,tradesCsv(),'text/csv;charset=utf-8');
    if(name==='import-json')return fileInput.click();
    if(name==='reset'){if(confirm(t('resetConfirm'))){runtime.state=await Tango.Store.reset();render();}}
    if(name==='save-settings'){
      const parsePresets=(value,fallback)=>String(value).split(',').map(Number).filter((item)=>item>0).slice(0,12).length?String(value).split(',').map(Number).filter((item)=>item>0).slice(0,12):fallback;
      runtime.settings={...runtime.settings,language:app.querySelector('#setting-language').value,displayCurrency:app.querySelector('#setting-currency').value,theme:app.querySelector('#setting-theme').value,
        buyPresets:parsePresets(app.querySelector('#setting-buy-presets').value,runtime.settings.buyPresets),sellPresets:parsePresets(app.querySelector('#setting-sell-presets').value,runtime.settings.sellPresets),
        slippageBps:Number(app.querySelector('#setting-slippage').value),platformFeeBps:Number(app.querySelector('#setting-platform-fee').value),
        networkFeeSol:Number(app.querySelector('#setting-network-fee').value),pnlBarPosition:app.querySelector('#setting-bar-position').value,
        fastMode:app.querySelector('#setting-fast').checked,confirmationEnabled:app.querySelector('#setting-confirm').checked,soundEnabled:app.querySelector('#setting-sound').checked,showListQuickBuy:app.querySelector('#setting-list-buy').checked};
      runtime.settings=await Tango.Store.saveSettings(runtime.settings);showToast(t('confirm'));render();
    }
  }

  function tradesCsv(){
    const headers=['executedAt','chain','tokenAddress','symbol','side','amountSol','quantity','observedPriceUsd','executionPriceUsd','marketCapUsd','slippageBps','platformFeeSol','networkFeeSol','realizedPnlSol','sourceUrl'];
    const encode=(v)=>`"${String(v??'').replaceAll('"','""')}"`;
    return '\ufeff'+[headers.join(','),...(runtime.state.trades||[]).map((trade)=>headers.map((key)=>encode(key==='executedAt'?new Date(trade[key]).toISOString():trade[key])).join(','))].join('\n');
  }
  function dateStamp(){return new Date().toISOString().slice(0,10);}
  function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function showToast(message){runtime.toast=message;render();setTimeout(()=>{runtime.toast='';render();},1800);}

  function shareTrade(id,mode='download'){
    const trade=runtime.state.trades.find((item)=>item.id===id);if(!trade)return;
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=630;const c=canvas.getContext('2d');
    const gradient=c.createLinearGradient(0,0,1200,630);gradient.addColorStop(0,'#090a0f');gradient.addColorStop(1,'#28165c');c.fillStyle=gradient;c.fillRect(0,0,1200,630);
    c.fillStyle='#9b7cff';c.beginPath();c.arc(75,72,12,0,Math.PI*2);c.fill();c.fillStyle='#fff';c.font='800 30px sans-serif';c.fillText('TANGO PAPER TRADE',105,82);
    c.font='900 72px sans-serif';c.fillText(trade.symbol,70,200);c.fillStyle=trade.realizedPnlSol>=0?'#3ee6a0':'#ff647c';c.font='900 64px sans-serif';c.fillText(Tango.Format.sol(trade.realizedPnlSol,lang(),true),70,290);
    c.fillStyle='#9ca0b3';c.font='24px sans-serif';c.fillText(`${t('entryMc')}  ${Tango.Format.usd(trade.entryMarketCapUsd,lang(),true)}`,70,385);c.fillText(`${t('exitMc')}  ${Tango.Format.usd(trade.marketCapUsd,lang(),true)}`,70,430);c.fillText(`${t('held')}  ${Tango.Format.duration(trade.heldMs,lang())}`,70,475);
    c.fillStyle='#fff';c.font='700 22px sans-serif';c.fillText(t('simulatedTrade'),70,570);canvas.toBlob(async(blob)=>{
      if(mode==='copy'&&navigator.clipboard?.write&&globalThis.ClipboardItem){try{await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);showToast(t('copyImage'));return;}catch{/* fall back to download */}}
      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`tango-${trade.symbol}-${dateStamp()}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    },'image/png');
  }

  fileInput.addEventListener('change',async()=>{try{const payload=JSON.parse(await fileInput.files[0].text());const data=await Tango.Store.importData(payload);runtime.state=data.state;runtime.settings=data.settings;showToast(t('dataImported'));}catch{showToast(t('importFailed'));}finally{fileInput.value='';}});
  Tango.Store.subscribe(load);load();
})(globalThis);
