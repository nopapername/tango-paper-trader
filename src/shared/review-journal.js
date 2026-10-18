(function initReviewJournal(global) {
  const Tango = global.Tango = global.Tango || {};
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const zh = lang => /^zh/i.test(lang || '');
  const label = (lang,cn,en) => zh(lang)?cn:en;
  const button = (action,text,attrs='') => `<button type="button" data-journal="${action}" ${attrs}>${text}</button>`;
  const title = (text,lang) => `<header><h2>${esc(text)}</h2>${button('close','×',`class="icon" aria-label="${label(lang,'关闭','Close')}"`)}</header>`;
  function editorMarkup(state,lang) {
    return `${title(`${state.token.symbol || state.token.name} · ${label(lang,'代币复盘','Token review')}`,lang)}
      <div class="meta">${esc(Tango.Chains.get(state.token.chain)?.name)} · ${esc(state.date)}<br><span title="${esc(state.token.address)}">${esc(state.token.address.slice(0,8))}…${esc(state.token.address.slice(-6))}</span></div>
      <label class="sr-only" for="review-text">${label(lang,'复盘笔记','Review note')}</label>
      <textarea id="review-text" maxlength="${Tango.ReviewNotes.MAX_TEXT}" placeholder="${label(lang,'记下买入想法、判断失误或交易心得……','Your entry idea, mistakes or trading lessons…')}" ${state.busy?'disabled':''}>${esc(state.text)}</textarea>
      <div class="meta hint">${label(lang,'仅保存在本浏览器 · 每个代币每天一份笔记','Saved in this browser · one note per token per day')}</div>
      ${state.error?`<p class="warning" role="alert">${esc(state.error)}</p>`:''}
      ${state.discardAsked?`<div class="warning" role="alert">${label(lang,'有尚未保存的内容。','You have unsaved changes.')}<div class="actions">${button('discard',label(lang,'放弃修改','Discard'))}${button('continue',label(lang,'继续编辑','Keep editing'))}</div></div>`:''}
      <footer>${state.returnToDaily?button('back',label(lang,'返回每日复盘','Back to daily review')):'<span></span>'}${button('save',label(lang,state.busy?(state.loading?'读取中…':'保存中…'):'保存',state.busy?(state.loading?'Loading…':'Saving…'):'Save'),`class="primary" ${state.busy?'disabled':''}`)}</footer>`;
  }
  function dailyMarkup(state,lang) {
    const notes=Tango.ReviewNotes.list(state.store,state.date,state.chain),page=Math.max(0,Math.min(state.page||0,Math.ceil(notes.length/20)-1));
    const cards=notes.slice(page*20,page*20+20).map(note=>`<article data-journal="edit" data-key="${esc(note.key)}"><div class="card-title">${button('edit',`${esc(note.symbol || note.name)} <span>${esc(Tango.Chains.get(note.chain)?.name)}</span>`,`class="card-edit" data-key="${esc(note.key)}"`)}${button('open-token',label(lang,'详情 ↗','Details ↗'),`class="link" data-key="${esc(note.key)}"`)}</div><p class="note">${esc(note.text)}</p></article>`).join('');
    return `${title(label(lang,'每日复盘','Daily review'),lang)}
      <nav>${button('prev','‹',`aria-label="${label(lang,'前一天','Previous day')}"`)}<label class="sr-only" for="review-date">${label(lang,'复盘日期','Review date')}</label><input id="review-date" type="date" min="2000-01-01" max="9999-12-31" value="${esc(state.date)}">${button('next','›',`aria-label="${label(lang,'后一天','Next day')}"`)}${button('today',label(lang,'今天','Today'))}</nav>
      <div class="filter"><label for="review-chain">${label(lang,'链','Chain')}</label><select id="review-chain"><option value="">${label(lang,'全部链','All chains')}</option>${Tango.Chains.all().map(c=>`<option value="${c.id}" ${c.id===state.chain?'selected':''}>${esc(c.name)}</option>`).join('')}</select><span class="meta">${label(lang,`${notes.length} 个代币`,`${notes.length} tokens`)}</span></div>
      ${state.error?`<p class="warning" role="alert">${esc(state.error)}</p>`:''}
      <div class="cards">${cards || `<p class="empty">${label(lang,'这一天还没有复盘记录','No notes for this day yet')}</p>`}</div>
      ${notes.length>20?`<footer>${button('page-prev','‹',page===0?'disabled':'')}<span>${page+1} / ${Math.ceil(notes.length/20)}</span>${button('page-next','›',(page+1)*20>=notes.length?'disabled':'')}</footer>`:''}`;
  }
  const CSS = `:host{all:initial;color-scheme:light}:host([hidden]){display:none!important}*{box-sizing:border-box}.backdrop{grid-template-columns:minmax(0,1fr);position:fixed;inset:0;background:rgb(0 0 0/.42);z-index:2147483647;display:grid;place-items:center;padding:16px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#20352b}.dialog{min-width:0;background:#fafcfb;border:1px solid #d7e4dc;border-radius:14px;padding:20px;width:min(480px,100%);max-height:calc(100dvh - 32px);overflow:auto;box-shadow:0 20px 64px #0004}.daily{width:min(620px,100%)}header,footer,.actions,.card-title,.filter,nav{display:flex;align-items:center;gap:10px}header,footer,.card-title{justify-content:space-between}header{margin-bottom:10px}h2{font-size:17px;margin:0;overflow-wrap:anywhere}button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer;background:transparent;border:1px solid #d5dfd8;border-radius:7px;padding:7px 12px}button:hover{background:#edf6ef}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #00ad65;outline-offset:2px}.primary{background:#008b50;border-color:#008b50;color:#fff;font-weight:650}.primary:hover{background:#007342}.icon{border:0;font-size:22px;line-height:1;padding:4px 8px}.meta{font-size:12px;color:#64756b;overflow-wrap:anywhere}.hint{margin-top:8px}textarea{display:block;width:100%;min-height:180px;max-height:45vh;resize:vertical;border:1px solid #cddbd2;border-radius:8px;padding:12px;margin-top:15px;background:#fff;line-height:1.65}footer{margin-top:16px}.warning{background:#fff3d6;color:#765515;padding:10px;border-radius:7px}.warning .actions{margin-top:8px}.filter{margin:14px 0;flex-wrap:wrap}input,select{border:1px solid #cedbd3;background:#fff;border-radius:6px;padding:6px;min-width:0}nav{flex-wrap:wrap}nav input{flex:1}article{cursor:pointer;border:1px solid #dbe5de;border-radius:9px;padding:12px;margin-top:10px}.card-edit{min-width:0;flex:1;border:0;font-weight:650;padding:0;text-align:left;overflow-wrap:anywhere;color:#008b50}.card-edit span{font-size:11px;color:#64756b;margin-left:5px}.link{border:0;padding:3px 0;font-size:12px;white-space:nowrap}.note{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0}.empty{text-align:center;color:#64756b;padding:30px 8px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.dark{color:#e0eee5;color-scheme:dark}.dark .dialog{background:#14221a;border-color:#344b3c}.dark button,.dark textarea,.dark input,.dark select{border-color:#3c5144}.dark textarea,.dark input,.dark select{background:#102016}.dark button:hover{background:#243f2d}.dark .meta,.dark .card-edit span{color:#9db1a5}.dark article{border-color:#334b3c}.dark .card-edit{color:#49d78e}.dark .primary{background:#008b50}.dark .warning{background:#41351d;color:#ffdc91}@media(max-width:440px){.dialog{padding:14px}h2{font-size:15px}button{padding:6px 9px}.card-title{align-items:flex-start}}`;
  function create({ store = Tango.Store,document = global.document,language = ()=>'zh-CN',theme = ()=>'light',openToken = async()=>{},onChange = ()=>{} } = {}) {
    let cached = null, load = null, state = null, container = null, root = null, pendingTransition = null;
    let returnFocus = null, closed = false, viewEpoch = 0, enabled = true;
    const dirty = () => state?.type==='editor' && state.text !== state.original;
    const focus = element => { if(typeof element?.focus==='function') element.focus(); };
    function status(token,date=Tango.ReviewNotes.localDate()) {
      try { return Boolean(cached?.records[Tango.ReviewNotes.key(token.chain,token.address,date)]?.text.trim()); } catch {return false;}
    }
    async function refresh() {
      if (!load) load = Promise.resolve().then(()=>store.getReviewNotes()).then(value=>{
        if(closed)return null;
        cached=Tango.ReviewNotes.normalize(value); onChange();
        if (state?.type==='daily') {state.store=cached;render();}
        return cached;
      }).finally(()=>{load=null;});
      return load;
    }
    function mount() {
      if(root)return;
      returnFocus=document.activeElement;
      container=document.createElement('div');
      // Notes never enter GMGN's open DOM or the MAIN-world quote bridge.
      root=container.attachShadow({mode:'closed'});
      container.hidden=!enabled;
      document.documentElement.appendChild(container);
      root.addEventListener('click',async event=>{
        const target=event.target.closest?.('[data-journal]');
        if(!target || !event.isTrusted || state?.busy)return;
        event.stopPropagation();
        await action(target.dataset.journal,target.dataset.key);
      });
      root.addEventListener('input',event=>{if(state?.type==='editor' && !state.busy && event.target.id==='review-text'){state.text=event.target.value;state.error='';}});
      root.addEventListener('change',event=>{
        if(state?.type!=='daily')return;
        if(event.target.id==='review-date' && Tango.ReviewNotes.validDate(event.target.value)){state.date=event.target.value;state.page=0;render();}
        if(event.target.id==='review-chain'){state.chain=event.target.value;state.page=0;render();}
      });
      root.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!state?.busy)requestTransition(close);}
        if(event.key==='Tab'){
          const elements=Array.from(root.querySelectorAll('button:not([disabled]),input,select,textarea:not([disabled])'));
          const first=elements[0],last=elements[elements.length-1];
          if(event.shiftKey && root.activeElement===first){event.preventDefault();focus(last);}
          if(!event.shiftKey && root.activeElement===last){event.preventDefault();focus(first);}
        }
      });
    }
    function render() {
      if(!state)return;mount();
      const body=state.type==='editor'?editorMarkup(state,language()):dailyMarkup(state,language());
      root.innerHTML=`<style>${CSS}</style><div class="backdrop ${theme()==='dark'?'dark':''}"><section class="dialog ${state.type==='daily'?'daily':''}" role="dialog" aria-modal="true" aria-label="${label(language(),state.type==='editor'?'代币复盘':'每日复盘',state.type==='editor'?'Token review':'Daily review')}">${body}</section></div>`;
      focus(root.querySelector(state.type==='editor' && !state.discardAsked?'textarea':'button'));
    }
    function close() {
      viewEpoch += 1;
      container?.remove();container=null;root=null;state=null;pendingTransition=null;
      focus(returnFocus);returnFocus=null;
    }
    function requestTransition(fn) {
      if(dirty()){pendingTransition=fn;state.discardAsked=true;render();return;}
      return fn();
    }
    function freezeEditor() {if(state?.type==='editor'){state.busy=true;state.loading=true;render();}}
    async function edit(token,date,returnToDaily=null) {
      freezeEditor();
      const epoch=++viewEpoch;
      let notes;
      try {notes=await refresh();} catch(error){if(!closed && epoch===viewEpoch)showLoadFailure(error);return;}
      if(closed || epoch!==viewEpoch)return;
      const id=Tango.ReviewNotes.key(token.chain,token.address,date),existing=notes.records[id];
      state={type:'editor',token:{chain:token.chain,address:token.address,symbol:token.symbol||existing?.symbol||'TOKEN',name:token.name||existing?.name||''},date,
        text:existing?.text||'',original:existing?.text||'',expectedEpoch:notes.epoch,expectedRevision:existing?.revision||0,returnToDaily,error:'',busy:false};
      render();
    }
    async function openEditor(token,date=Tango.ReviewNotes.localDate()) {
      return requestTransition(()=>edit(token,date));
    }
    async function showDaily(date=Tango.ReviewNotes.localDate(),chain='') {
      freezeEditor();
      const epoch=++viewEpoch;
      try {const notes=await refresh();if(closed || epoch!==viewEpoch)return;state={type:'daily',date,chain,page:0,store:notes,error:''};render();}
      catch(error){if(!closed && epoch===viewEpoch)showLoadFailure(error);}
    }
    function openDaily(date=Tango.ReviewNotes.localDate()) {return requestTransition(()=>showDaily(date));}
    function message(error) {
      return label(language(),error?.message==='journalConflict'?'其他页面已修改这份笔记，或已导入备份。你的文字仍保留，请复制后重新打开再核对。':error?.message==='journalFull'?'本地笔记空间已满，请先导出备份。':'保存或读取失败，请重试；未保存的文字仍保留。',error?.message==='journalConflict'?'This note changed in another tab or a backup was imported. Your draft is preserved; copy it and reopen to compare.':error?.message==='journalFull'?'Local journal storage is full. Export a backup first.':'Could not save or load. Please retry; your draft is preserved.');
    }
    function showLoadFailure(error) {
      if(state){state.busy=false;state.loading=false;state.error=message(error);render();return;}
      state={type:'daily',date:Tango.ReviewNotes.localDate(),chain:'',page:0,store:Tango.ReviewNotes.normalize(null),error:message(error)};render();
    }
    async function save() {
      if(state?.type!=='editor' || state.busy)return;
      const current=state;current.busy=true;render();
      try {
        const record=await store.saveReviewNote({...current.token,date:current.date,text:current.text,expectedEpoch:current.expectedEpoch,expectedRevision:current.expectedRevision});
        if(state!==current)return;
        current.original=current.text;current.expectedRevision=record.revision;
        if(cached)cached={...cached,records:{...cached.records,[record.key]:record}};
        onChange();
        const next=pendingTransition;pendingTransition=null;
        if(next){close();await next();}else if(current.returnToDaily){await showDaily(current.returnToDaily.date,current.returnToDaily.chain);}else close();
      } catch(error){if(state===current){current.error=message(error);current.busy=false;render();}}
    }
    async function action(name,key) {
      if(name==='save')return save();
      if(name==='close')return requestTransition(close);
      if(name==='continue'){state.discardAsked=false;pendingTransition=null;render();return;}
      if(name==='discard'){const next=pendingTransition;pendingTransition=null;if(next){close();return next();}return close();}
      if(name==='back'){const back=state.returnToDaily;return requestTransition(()=>showDaily(back.date,back.chain));}
      if(state?.type!=='daily')return;
      if(name==='edit'){const note=state.store.records[key];if(note)return edit(note,note.date,{date:state.date,chain:state.chain});}
      if(name==='open-token'){const note=state.store.records[key];if(note){try{await openToken(note);}catch(error){state.error=label(language(),'无法打开代币详情，请稍后重试。','Could not open token details. Please retry.');render();}}return;}
      if(name==='today'){state.date=Tango.ReviewNotes.localDate();state.page=0;}
      if(name==='prev'||name==='next'){const d=new Date(state.date+'T12:00:00');d.setDate(d.getDate()+(name==='prev'?-1:1));const date=Tango.ReviewNotes.localDate(d);if(Tango.ReviewNotes.validDate(date))state.date=date;state.page=0;}
      if(name==='page-prev')state.page=Math.max(0,state.page-1);
      if(name==='page-next')state.page+=1;
      render();
    }
    const unsubscribe=store.subscribeReviews?.(()=>{if(!closed)refresh().catch(()=>{});});
    return { openEditor,openDaily,refresh,status,setEnabled(value){enabled=Boolean(value);if(container)container.hidden=!enabled;},destroy(){closed=true;unsubscribe?.();close();} };
  }
  const privateBackups = new WeakMap();
  function privateBackup(element,text) {
    if(!element)return;
    let root=privateBackups.get(element);
    if(!root){root=element.attachShadow({mode:'closed'});privateBackups.set(element,root);}
    root.replaceChildren();
    const field=element.ownerDocument.createElement('textarea');
    field.readOnly=true;field.setAttribute('aria-label','JSON backup');
    field.style.cssText='width:100%;min-height:120px;box-sizing:border-box;font:12px/1.5 monospace;resize:vertical';
    field.value=String(text);root.appendChild(field);
  }
  Tango.ReviewJournal={create,editorMarkup,dailyMarkup,privateBackup};
  if(typeof module!=='undefined' && module.exports)module.exports=Tango.ReviewJournal;
})(globalThis);
