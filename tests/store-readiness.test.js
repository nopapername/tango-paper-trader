const test=require('node:test');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('store icons are packaged and declared for their consumers',()=>{
 const m=JSON.parse(read('manifest.json'));
 for(const size of [16,32,48,128]){const b=fs.readFileSync(path.join(root,m.icons?.[size]||'MISSING'));assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);assert.equal(m.action.default_icon[size],m.icons[size]);}
});
test('referral navigation and privacy links remain after removing commission explanatory text',()=>{
 assert.ok(read('src/shared/constants.js').includes('https://gmgn.ai/r/X9cuc5jd?chain=bsc'));
 for(const f of ['src/popup/popup.js','src/dashboard/dashboard.js']){assert.doesNotMatch(read(f),/affiliateDisclosure/);assert.match(read(f),/privacy.html/);}
 const d=read('src/dashboard/dashboard.js');const setup=d.slice(d.indexOf('function renderSetupRequired'),d.indexOf('function renderOnboardingComplete'));assert.doesNotMatch(setup,/affiliateDisclosure/);assert.match(setup,/startWithReferral/);
});
test('privacy documents cover bilingual local data deletion providers limited use and referral',()=>{
 for(const f of ['PRIVACY.md','privacy.html']){const s=read(f);assert.match(s,/隐私/);assert.match(s,/Limited Use/);assert.match(s,/CoinGecko/);assert.match(s,/DEX Screener/);assert.match(s,/X9cuc5jd/);assert.ok(s.includes('github.com/nopapername/tango-paper-trader/issues'));}
});

test('privacy button wording matches current UI in both documents',()=>{
 for(const file of ['PRIVACY.md','privacy.html']) {
  const text=read(file); assert.match(text,/The “Open GMGN” buttons use code X9cuc5jd/);
  assert.doesNotMatch(text,/Save setup|open GMGN referral link|labeled GMGN referral button/);
 }
});
test('Chinese-first manifest metadata resolves in Chinese and English',()=>{
 const m=JSON.parse(read('manifest.json')); assert.equal(m.default_locale,'zh_CN');
 const fields=[m.name,m.description,m.action.default_title,m.commands['toggle-paper-trading-master'].description];
 for(const locale of ['zh_CN','en']) {
  const messages=JSON.parse(read('_locales/'+locale+'/messages.json'));
  for(const field of fields) {const match=field.match(/^__MSG_(\w+)__$/); assert.ok(match,field); assert.ok(messages[match[1]]?.message);}
  assert.ok(messages.extensionName.message.length<=75); assert.ok(messages.extensionDescription.message.length<=132);
 }
 assert.match(read('_locales/zh_CN/messages.json'),/模拟交易/);
});
