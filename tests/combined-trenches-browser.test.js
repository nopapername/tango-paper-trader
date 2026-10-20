const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');

test('captured mixed GMGN cards render both native-preset buttons and rebind only the changed chain',()=>{
  const root=path.resolve(__dirname,'..');
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/combined-trenches-20261017.json'),'utf8'));
  assert.equal(fixture.cards.length,2,'captured SOL and BSC cards are required');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tango-mixed-dom-'));
  const moduleFiles=['src/core/chains.js','src/core/supply.js','src/shared/constants.js','src/adapters/gmgn.js'];
  const scripts=moduleFiles.map(file=>fs.readFileSync(path.join(root,file),'utf8')
    .replace(/\}\)\(globalThis\);?\s*$/,'})(fixtureApp);').replaceAll('</script','<\\/script'));
  const setup = `
    const fixtureApp={location:{href:'https://gmgn.ai/',origin:'https://gmgn.ai'}};
    const trusted=new WeakMap();
    fixtureApp.Tango={NativeQuickBuyGuard:{
      registerPaperAction(e,_id,action){trusted.set(e,action);return true;},
      isPaperActionTrusted(e){return trusted.has(e);},
      revokePaperAction(e){trusted.delete(e);}
    }};
  `;
  const probe = `
    (async()=>{
      const api=fixtureApp.Tango.GMGN;
      let presets={sol:[.1,.2],bsc:[.01,.02]};
      const orders=[];
      const options={readChainPresets:id=>presets[id]};
      const check=(condition,message)=>{if(!condition)throw Error(message);};
      api.discoverTokenCards(c=>orders.push(c),1,'PAPER',undefined,options);
      const cards=[...document.querySelectorAll('[class~="group/a"]')];
      let labels=[];
      for(const card of cards){
        const chain=card.getAttribute('data-trenches-token-chain');
        const slots=[...card.querySelectorAll('.BuyButton-continer')];
        check(slots.length===2,chain+' dual slots');
        const bindings=slots.map(s=>s.__tangoQuickBuyBinding);
        check(bindings.every(b=>b&&b.state==='ready'),chain+' ready bindings');
        const actual=bindings.map(b=>b.amountNative).sort((a,b)=>a-b);
        check(JSON.stringify(actual)===JSON.stringify(presets[chain]),chain+' per-chain presets');
        for(const b of bindings){
          check(b.amountChain===chain,chain+' native currency');
          check(b.replacement.dataset.tangoPublished==='1',chain+' published');
          labels.push(b.replacement.textContent);
          await b.action.invoke();
        }
      }
      check(orders.length===4,'four independent paper actions');
      check(orders.every(o=>o.amountChain===o.token.chain),'no cross-chain input units');
      const before=[...document.querySelectorAll('.BuyButton-continer')].map(s=>s.__tangoQuickBuyBinding);
      presets.bsc=[.03,.04];
      check(before.filter(b=>b.chain==='bsc').every(b=>!b.validate()),'old BSC actions fail closed');
      api.discoverTokenCards(c=>orders.push(c),1,'PAPER',undefined,options);
      check(before.filter(b=>b.chain==='sol').every(b=>b.slot.__tangoQuickBuyBinding===b),'SOL actions remain stable');
      check([...document.querySelectorAll('.BuyButton-continer')].filter(s=>s.__tangoQuickBuyBinding.chain==='bsc').every(s=>s.__tangoQuickBuyBinding.amountNative>=.03),'BSC presets refresh');
      document.getElementById('result').textContent=JSON.stringify({ok:true,orders:orders.length,labels});
      document.title='TANGO_MIXED_PASS';
    })().catch(e=>{document.getElementById('result').textContent=JSON.stringify({ok:false,error:e.stack});document.title='TANGO_MIXED_FAIL';});
  `;
  const html='<!doctype html><html><head><meta charset="utf-8"><title>PENDING</title><style>'+fs.readFileSync(path.join(root,'src/content/content.css'),'utf8')+'</style></head><body><main><section data-sentry-component="TrenchColumn">new creation\n'+fixture.headers[0]+fixture.cards.join('')+'</section></main><pre id="result"></pre><script>'+setup+'</script>'+scripts.map(s=>'<script>'+s+'</script>').join('')+'<script>'+probe+'</script></body></html>';
  const filename=path.join(temp,'fixture.html');fs.writeFileSync(filename,html);
  const chrome=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(f=>f&&fs.existsSync(f));
  assert.ok(chrome,'Chrome/Chromium required; set CHROME_PATH to its executable.');
  const result=spawnSync(chrome,['--headless','--no-sandbox','--disable-extensions','--disable-background-networking','--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+path.join(temp,'profile'),'--virtual-time-budget=2000','--dump-dom',pathToFileURL(filename).href],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  fs.writeFileSync(path.join(root,'combined-dom-result.html'),result.stdout||'');
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/<title>TANGO_MIXED_PASS<\/title>/,result.stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]||'probe did not complete');
});
