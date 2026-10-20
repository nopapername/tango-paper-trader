const test=require('node:test'),assert=require('node:assert/strict');global.Tango={};require('../src/core/chains.js');const Notes=require('../src/core/review-notes.js');const Journal=require('../src/shared/review-journal.js');
const token={chain:'bsc',address:'0x1111111111111111111111111111111111111111',symbol:'<CAT>',name:'Cat'};
test('journal editor is a single escaped textarea with explicit local date and save',()=>{const html=Journal.editorMarkup({token,date:'2026-10-18',text:'</textarea><script>bad()</script>',original:'',busy:false},'zh-CN');assert.equal((html.match(/<textarea\b/g)||[]).length,1);assert.ok(html.includes('代币复盘'));assert.ok(html.includes('2026-10-18'));assert.ok(!html.includes('<script>bad'));assert.ok(html.includes('&lt;/textarea&gt;'));assert.ok(html.includes('data-journal="save"'));});
test('daily cards filter date and chain, sort by update and include no-trade notes',()=>{let store=Notes.upsert(null,{...token,date:'2026-10-18',text:'first',expectedEpoch:0,expectedRevision:0},1000);store=Notes.upsert(store,{...token,chain:'eth',date:'2026-10-18',text:'second',expectedEpoch:0,expectedRevision:0},2000);const html=Journal.dailyMarkup({store,date:'2026-10-18',chain:'',page:0},'zh-CN');assert.ok(html.indexOf('second')<html.indexOf('first'));assert.ok(html.includes('2'));assert.ok(!Journal.dailyMarkup({store,date:'2026-10-19',chain:'',page:0},'zh-CN').includes('first'));assert.ok(!Journal.dailyMarkup({store,date:'2026-10-18',chain:'bsc',page:0},'zh-CN').includes('second'));});

test('real journal controls preserve drafts, reject conflicts, guard closing and fit a narrow viewport', () => {
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tango-journal-ui-'));
 try {
 const scripts=['src/core/chains.js','src/core/review-notes.js','src/shared/review-journal.js'].map(file=>{
   let source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
   if(file.endsWith('review-journal.js'))source=source.replace('return { openEditor,openDaily,refresh,status,','return { __test:{action,getState:()=>state,getRoot:()=>root,close},openEditor,openDaily,refresh,status,');
   return 'Function('+JSON.stringify(source)+')();';
 }).join('\n');
 const scenario=async function(){
  const expect=(condition,message)=>{if(!condition)throw Error(message);};
  let data=Tango.ReviewNotes.normalize(null),fail=false,gate=null,changed=()=>{},writes=0;
  const store={getReviewNotes:()=>gate||Promise.resolve(data),saveReviewNote:async input=>{if(fail)throw Error('journalConflict');data=Tango.ReviewNotes.upsert(data,input,1000);writes++;return data.records[Tango.ReviewNotes.key(input.chain,input.address,input.date)];},subscribeReviews:fn=>{changed=fn;return()=>{};}};
  const token={chain:'bsc',address:'0x1111111111111111111111111111111111111111',symbol:'一只名字很长的测试猫',name:'Cat'};
  const api=Tango.ReviewJournal.create({store,document});const t=api.__test;
  await api.openEditor(token,'2026-10-18');let field=t.getRoot().querySelector('textarea');
  field.value='买前理由：先观察\n认错后及时复盘';field.dispatchEvent(new Event('input',{bubbles:true}));
  await api.refresh();expect(t.getRoot().querySelector('textarea')===field,'background refresh must retain the exact textarea and focus');expect(field.value.includes('先观察'),'draft retained');
  await t.action('close');expect(t.getState().discardAsked,'dirty close guarded');await t.action('continue');
  fail=true;await t.action('save');expect(t.getState().text.includes('先观察'),'conflict retains text');expect(t.getState().error.includes('其他页面'),'conflict shown');expect(writes===0,'no failed writes');
  fail=false;await t.action('save');expect(t.getRoot()===null,'successful save closes');expect(api.status(token,'2026-10-18'),'recorded indicator');
  await api.openDaily('2026-10-18');expect(t.getRoot().innerHTML.includes('先观察'),'daily card visible');
  const key=Tango.ReviewNotes.key(token.chain,token.address,'2026-10-18');await t.action('edit',key);
  let finishBack;gate=new Promise(resolve=>{finishBack=resolve;});const backPending=t.action('back');await Promise.resolve();
  expect(t.getRoot().querySelector('textarea').disabled,'pending list load must disable the editor to prevent newly typed draft loss');
  finishBack(data);await backPending;gate=null;await t.action('edit',key);
  field=t.getRoot().querySelector('textarea');field.value='different';field.dispatchEvent(new Event('input',{bubbles:true}));
  await t.action('back');expect(t.getState().discardAsked,'back guarded');await t.action('discard');expect(t.getState().type==='daily','discard returns to correct day');
  let resolve;gate=new Promise(done=>{resolve=done;});const pending=api.openEditor(token,'2026-10-18');await Promise.resolve();t.close();resolve(data);await pending;expect(t.getRoot()===null,'late load cannot reopen closed editor');gate=null;
  await api.openEditor(token,'2026-10-18');const dialog=t.getRoot().querySelector('.dialog'),rect=dialog.getBoundingClientRect();expect(rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=0&&rect.bottom<=innerHeight+1,'narrow dialog inside viewport');expect(dialog.scrollWidth<=dialog.clientWidth+1,'no horizontal content clipping');
  const openHost=document.documentElement.lastElementChild;api.setEnabled(false);expect(openHost.hidden,'master disable hides journal without losing draft');expect(getComputedStyle(openHost).display==='none','disabled journal must really be hidden, not merely have a hidden attribute');api.setEnabled(true);expect(!openHost.hidden,'master enable restores journal');expect(openHost.shadowRoot===null,'notes use a closed shadow root');
  let mode;const holder=document.createElement('div');Tango.ReviewJournal.privateBackup({ownerDocument:document,attachShadow:opts=>{mode=opts.mode;return holder;}},'{"reviewNotes":"secret"}');expect(mode==='closed','backup uses closed root');expect(holder.querySelector('textarea').readOnly&&holder.querySelector('textarea').value.includes('secret'),'backup remains selectable and complete');
  t.close();
  const frame=document.createElement('iframe');frame.style.cssText='width:360px;height:640px;border:0';document.body.appendChild(frame);
  const narrow=Tango.ReviewJournal.create({store,document:frame.contentDocument});await narrow.openEditor(token,'2026-10-18');
  const nr=narrow.__test.getRoot().querySelector('.dialog').getBoundingClientRect();expect(nr.left>=0&&nr.right<=360&&nr.bottom<=640,'real 360px iframe viewport must fit editor');
  await narrow.__test.action('close');await narrow.openDaily('2026-10-18');
  const dr=narrow.__test.getRoot().querySelector('.dialog');expect(dr.getBoundingClientRect().right<=360&&dr.scrollWidth<=dr.clientWidth+1,'real 360px viewport must fit daily list');
  narrow.destroy();
  document.title='JOURNAL_OK:'+btoa(unescape(encodeURIComponent(JSON.stringify({writes,width:innerWidth,height:innerHeight,rootClosed:true,draftRetained:true}))));
 };
 const html='<!doctype html><meta charset="utf-8"><title>JOURNAL_PENDING</title><div id="trading"></div><script>'+scripts+'('+scenario.toString()+')().catch(error=>{document.title="JOURNAL_ERROR:"+error.message;});</script>';
 const file=path.join(dir,'journal.html');fs.writeFileSync(file,html);
 const chrome=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(f=>f&&fs.existsSync(f));assert.ok(chrome);
 const result=spawnSync(chrome,['--headless','--disable-gpu','--no-sandbox','--no-first-run','--disable-background-networking','--window-size=400,760','--virtual-time-budget=2000','--dump-dom','--user-data-dir='+path.join(dir,'profile'),pathToFileURL(file).href],{encoding:'utf8',timeout:60000,windowsHide:true});
 assert.equal(result.status,0,result.stderr);const title=result.stdout.match(/<title>([^<]+)<\/title>/)?.[1];assert.ok(title?.startsWith('JOURNAL_OK:'),title);const report=JSON.parse(Buffer.from(title.slice(11),'base64').toString('utf8'));assert.equal(report.writes,1);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
