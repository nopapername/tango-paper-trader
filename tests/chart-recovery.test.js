const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/content/page-main.js'), 'utf8');
const TEMPLATE = '<html><head><base href="https://gmgn.ai/_next/static/trading-view/32.0.6/"><script src="bundles/runtime.123.js"></script><script src="bundles/library.123.js"></script></head><body></body></html>';

function harness({ enabled = true, healthy = false, title = 'Financial Chart', html = TEMPLATE, text } = {}) {
  let now = 1000, observerCallback, nextUrl = 0, reads = 0;
  const timers = new Map(), frames = [], listeners = new Map();
  let timerId = 0;
  class TestURL extends URL { static createObjectURL() { return `blob:https://gmgn.ai/test-${++nextUrl}`; } }
  const attrs = new Map([['title', title]]);
  const doc = { readyState: 'complete', body: { childNodes: healthy ? [{}] : [] }, head: { childNodes: [] } };
  const frame = {
    isConnected: true, contentDocument: doc,
    getAttribute: name => attrs.get(name) ?? null,
    setAttribute(name, value) { attrs.set(name, String(value)); },
    removeAttribute(name) { attrs.delete(name); },
    matches() { return ['Financial Chart', 'TradingView'].includes(attrs.get('title')); },
    addEventListener(type, listener) { listeners.set(type, listener); },
    querySelector() { return null; }
  };
  frames.push(frame);
  const host = { getAttribute: name => name === 'data-tango-active' ? String(enabled) : null };
  const document = {
    querySelector: selector => selector === '#tango-paper-trader-host' ? host : null,
    querySelectorAll: () => frames,
    documentElement: {},
  };
  class Xhr { open() {} send() {} }
  const context = { URL: TestURL, Map, WeakMap, Set, Promise, console, document,
    location: { href: 'https://gmgn.ai/bsc/token/0x1111111111111111111111111111111111111111', origin: 'https://gmgn.ai' },
    XMLHttpRequest: Xhr, Tango: {},
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class { constructor(callback) { observerCallback = callback; } observe() {} },
    addEventListener() {}, postMessage() {}
  };
  context.window = context; context.top = context;
  vm.runInNewContext(source.replace('  const captured = new Map();', '  const captured = new Map(); window.__capturedTest = captured;'), context);
  const blob = { type: 'text/html', text: () => { reads += 1; return text ? text() : Promise.resolve(html); } };
  const url = context.URL.createObjectURL(blob);
  frame.setAttribute('src', url);
  const flush = async ms => {
    now += ms;
    for (let rounds = 0; rounds < 20; rounds++) {
      const ready = [...timers].filter(([, timer]) => timer.at <= now);
      if (!ready.length) break;
      for (const [id, timer] of ready) { timers.delete(id); await timer.callback(); }
    }
    await Promise.resolve(); await Promise.resolve();
  };
  return { context, frame, doc, attrs, flush, get reads() { return reads; },
    get pendingTimers() { return timers.size; },
    notify: records => observerCallback?.(records),
    mutate: () => observerCallback?.([{ type: 'attributes', attributeName: 'src', target: frame }]),
    load: () => listeners.get('load')?.() };
}

test('persistent empty GMGN blob chart recovers once from its captured original HTML', async () => {
  const loaded = harness();
  await loaded.flush(50); await loaded.flush(1900);
  assert.equal(loaded.attrs.has('srcdoc'), false, 'normal load has time to finish');
  await loaded.flush(200);
  assert.equal(loaded.attrs.get('srcdoc'), TEMPLATE);
  assert.equal(loaded.reads, 1);
  loaded.mutate(); await loaded.flush(5000);
  assert.equal(loaded.reads, 1, 'no endless reload loop');
});

test('healthy, disabled and unrelated iframe documents are never replaced', async () => {
  for (const options of [{ healthy: true }, { enabled: false }, { title: 'other' }, { html: '<html>unrelated</html>' }]) {
    const loaded = harness(options);
    await loaded.flush(50); await loaded.flush(2500);
    assert.equal(loaded.attrs.has('srcdoc'), false, JSON.stringify(options));
  }
});

test('a chart with scripts already loading is not considered an empty failed blob document', async () => {
  const loaded = harness(); loaded.doc.head.childNodes.push({});
  await loaded.flush(50); await loaded.flush(2500);
  assert.equal(loaded.attrs.has('srcdoc'), false);
  assert.equal(loaded.reads, 0);
});

test('navigation during asynchronous HTML reading cannot overwrite the newer chart', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const loaded = harness({ text: () => pending });
  await loaded.flush(50);
  const due = loaded.flush(2500);
  await Promise.resolve();
  loaded.frame.setAttribute('src', 'blob:https://gmgn.ai/newer-chart');
  finish(TEMPLATE); await due;
  assert.equal(loaded.attrs.has('srcdoc'), false);
});

test('GMGN reusing a recovered iframe for a new URL clears only our obsolete srcdoc', async () => {
  const loaded = harness(); await loaded.flush(50); await loaded.flush(2500);
  assert.equal(loaded.attrs.get('srcdoc'), TEMPLATE);
  loaded.frame.setAttribute('src', 'blob:https://gmgn.ai/newer-chart');
  loaded.mutate(); await loaded.flush(50);
  assert.equal(loaded.attrs.has('srcdoc'), false);
});

test('recovery observer ignores unrelated content and expires its own old blob references',async()=>{
 const loaded=harness({healthy:true});await loaded.flush(50);await loaded.flush(2500);
 const count=loaded.pendingTimers;
 loaded.notify([{type:'childList',target:{},addedNodes:[{nodeType:3}],removedNodes:[]}]);
 assert.equal(loaded.pendingTimers,count);
 await loaded.flush(120001);loaded.mutate();await loaded.flush(50);
 assert.equal(loaded.context.__capturedTest.size,0);
});

test('expiry of captured blobs does not prevent removing stale recovery srcdoc after navigation',async()=>{
 const loaded=harness();await loaded.flush(50);await loaded.flush(2500);
 assert.equal(loaded.attrs.get('srcdoc'),TEMPLATE);
 await loaded.flush(120001);loaded.mutate();await loaded.flush(50);
 assert.equal(loaded.context.__capturedTest.size,0);
 loaded.frame.setAttribute('src','blob:https://gmgn.ai/reused-after-expiry');loaded.mutate();await loaded.flush(50);
 assert.equal(loaded.attrs.has('srcdoc'),false);
});

test('chart recovery stays in the site MAIN world and never executes site HTML in extension pages', () => {
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'),'utf8'));
 const entry=manifest.content_scripts.find(x=>x.js.includes('src/content/page-main.js'));
 assert.equal(entry.world,'MAIN');assert.deepEqual(entry.matches,['https://gmgn.ai/*']);
 const recovery=source.slice(source.indexOf('(function initTangoChartLoadingRecovery()'));
 assert.doesNotMatch(recovery,/chrome\.|browser\.|eval\s*\(|new\s+Function|document\.write|createElement\(['"]script/);
 assert.match(recovery,/frame\.setAttribute\('srcdoc', html\)/);
 for(const file of ['popup.html','dashboard.html','privacy.html'])assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),/srcdoc|page-main\.js|chart-main\.js/);
});

test('chart recovery rejects external script origins and mismatched static paths', async () => {
 const invalid=[TEMPLATE.replace('bundles/runtime.123.js','https://evil.example/runtime.js'),TEMPLATE.replace('https://gmgn.ai/_next/','https://gmgn.ai.evil.example/_next/'),TEMPLATE.replace('bundles/library.123.js','/unrelated/library.123.js')];
 for(const html of invalid){const loaded=harness({html});await loaded.flush(50);await loaded.flush(2500);assert.equal(loaded.attrs.has('srcdoc'),false);}
});