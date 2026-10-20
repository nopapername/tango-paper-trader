const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const vm = require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/content/content.js'),'utf8');
function text(value){return {nodeType:3,nodeValue:value};}
function element(tag,children=[],attributes={}){return {nodeType:1,nodeName:tag,childNodes:children,attributes:Object.entries(attributes).map(([name,value])=>({name,value})),getAttribute(name){return attributes[name]??null;},setAttribute(name,value){attributes[name]=value;}};}
function load(before,after){
 const start=source.indexOf('  function patchShellText('); const end=source.indexOf('  function render() {',start);
 assert.ok(start>=0,'text-only patch helper exists');
 const context={shell:{childNodes:before},document:{createElement(){return {set innerHTML(value){},content:{childNodes:after}};}}};
 vm.runInNewContext(source.slice(start,end)+';this.patch=patchShellText',context);return context.patch;
}
test('quote-only text patches preserve buttons and update values atomically',()=>{
 const price=text('1 BNB'),button=element('BUTTON',[text('Buy')],{'data-buy':'1'});
 const before=[element('DIV',[price,button],{class:'panel'})];
 const after=[element('DIV',[text('2 BNB'),element('BUTTON',[text('Buy')],{'data-buy':'1'})],{class:'panel'})];
 assert.equal(load(before,after)('new markup'),true);assert.equal(price.nodeValue,'2 BNB');assert.equal(before[0].childNodes[1],button);
});
test('structural or action changes abandon patch before changing any existing text',()=>{
 for(const change of ['attribute','structure']){
  const price=text('1 BNB');const before=[element('DIV',[price,element('BUTTON',[],{'data-buy':'1'})])];
  const after=[element('DIV',[text('2 BNB'),element(change==='structure'?'SPAN':'BUTTON',[],{'data-buy':'2'})])];
  assert.equal(load(before,after)('new markup'),false);assert.equal(price.nodeValue,'1 BNB');
 }
});

test('cosmetic PnL class updates keep action nodes but action class changes still fall back',()=>{
 const before=[element('STRONG',[text('1')],{class:'tango-up'})];const after=[element('STRONG',[text('-1')],{class:'tango-down'})];
 assert.equal(load(before,after)('markup'),true);assert.equal(before[0].getAttribute('class'),'tango-down');
 const a=[element('BUTTON',[text('Buy')],{class:'buy-action'})],b=[element('BUTTON',[text('Sell')],{class:'sell-action'})];
 assert.equal(load(a,b)('markup'),false);
});

test('dashboard text and PnL refresh keeps existing buttons and validates all actions first',()=>{
 const dashboard=fs.readFileSync(require('node:path').join(__dirname,'../src/dashboard/dashboard.js'),'utf8');
 const start=dashboard.indexOf('  function patchDashboardText('),end=dashboard.indexOf('  function render() {',start);assert.ok(start>=0);
 const button=element('BUTTON',[text('History')],{'data-tab':'history'}),value=element('STRONG',[text('1')],{class:'up'});
 const app={childNodes:[value,button]},template={content:{childNodes:[element('STRONG',[text('-1')],{class:'down'}),element('BUTTON',[text('History')],{'data-tab':'history'})]}};
 const context={app};vm.runInNewContext(dashboard.slice(start,end)+';this.patch=patchDashboardText',context);
 assert.equal(context.patch(template),true);assert.equal(value.childNodes[0].nodeValue,'-1');assert.equal(app.childNodes[1],button);
 template.content.childNodes[1]=element('BUTTON',[text('History')],{'data-tab':'settings'});assert.equal(context.patch(template),false);
});
