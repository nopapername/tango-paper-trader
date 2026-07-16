(async function initPopup(global){
  const Tango=global.Tango;const app=document.querySelector('#app');const {state,settings}=await Tango.Store.getAll();const language=Tango.I18n.resolveLanguage(settings.language);const t=(key)=>Tango.I18n.t(key,settings.language);
  if(!state.initialized){app.innerHTML=`<div class="popup"><div class="brand"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div><div class="empty">${t('welcome')}</div><button class="button" id="dashboard">${t('startPaperTrading')}</button></div>`;}
  else{const summary=Tango.Engine.portfolioSummary(state);const cls=(value)=>value>0?'up':value<0?'down':'';app.innerHTML=`<div class="popup"><div class="brand"><span class="dot"></span>TANGO <span class="badge">${t('paper')}</span></div><div class="stats">
    <div class="stat"><span>${t('balance')}</span><strong>${Tango.Format.sol(summary.cashBalanceSol,language)}</strong></div><div class="stat"><span>${t('equity')}</span><strong>${Tango.Format.sol(summary.equitySol,language)}</strong></div>
    <div class="stat"><span>${t('totalPnl')}</span><strong class="${cls(summary.totalPnlSol)}">${Tango.Format.sol(summary.totalPnlSol,language,true)}</strong></div><div class="stat"><span>${t('positions')}</span><strong>${summary.positionCount}</strong></div></div>
    <button class="button" id="dashboard">${t('openDashboard')}</button><button class="button secondary" id="gmgn">GMGN ↗</button></div>`;}
  document.querySelector('#dashboard').addEventListener('click',()=>chrome.runtime.openOptionsPage());const gmgn=document.querySelector('#gmgn');if(gmgn)gmgn.addEventListener('click',()=>chrome.tabs.create({url:'https://gmgn.ai/trend?chain=sol'}));
})(globalThis);
