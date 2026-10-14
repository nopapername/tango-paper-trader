const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function localChromeExecutable() {
  const candidates = [process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    process.platform !== 'win32' && '/usr/bin/google-chrome',
    process.platform !== 'win32' && '/usr/bin/chromium',
    process.platform !== 'win32' && '/usr/bin/chromium-browser'].filter(Boolean);
  const executable = candidates.find((file) => fs.existsSync(file));
  assert.ok(executable, `Local Chrome is required for the UI CSS gate; checked: ${candidates.join(', ')}`);
  return executable;
}

test('every UI translation has both languages, matching variables, and real system-theme resolution', () => {
  const context = { navigator: { language: 'zh-CN' }, matchMedia: () => ({ matches: true }) };
  vm.runInNewContext(source('src/shared/i18n.js'), context);
  const i18n = context.Tango.I18n;
  assert.deepEqual(Object.keys(i18n.messages.en).sort(), Object.keys(i18n.messages['zh-CN']).sort());
  for (const [key, english] of Object.entries(i18n.messages.en)) {
    const chinese = i18n.messages['zh-CN'][key];
    assert.ok(english.trim() && chinese.trim(), key);
    const variables = (text) => [...text.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(variables(english), variables(chinese), key);
  }
  assert.equal(i18n.resolveLanguage('auto'), 'zh-CN');
  assert.equal(i18n.resolveTheme('auto'), 'light');
  assert.equal(i18n.resolveTheme('dark'), 'dark');
  assert.equal(i18n.resolveTheme('light'), 'light');
  context.matchMedia = () => ({ matches: false });
  assert.equal(i18n.resolveTheme('auto'), 'dark');
});

function renderUiReport(kind) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tango-ui-theme-'));
  try {
    const files = ['src/core/chains.js', 'src/core/supply.js', 'src/shared/constants.js',
      'src/core/state.js', 'src/shared/i18n.js', 'src/shared/format.js', 'src/core/engine.js',
      'src/content/chain-view.js', `src/${kind}/model.js`];
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>TANGO_UI_PENDING</title>
      <style>${source(`src/${kind}/${kind}.css`)}</style></head><body><div id="app"></div>
      <input id="import-file" type="file" hidden>
      <script>let systemLight = true; const themeListeners = [];
      window.matchMedia = () => ({ matches: systemLight, addEventListener: (_, fn) => themeListeners.push(fn) });
      </script>${files.map((file) => `<script>${source(file)}</script>`).join('\n')}
      <script>const uiState = Tango.State.createInitialState(); uiState.initialized = true;
      const uiSettings = Tango.State.normalizeSettings({ language: 'zh-CN', theme: 'auto', selectedChain: 'eth' });
      Tango.Store = { getAll: async () => ({ state: uiState, settings: uiSettings }), subscribe() {} };
      window.chrome = { runtime: { sendMessage: async () => ({ ok: false }) },
        tabs: { query: async () => [] }, storage: { onChanged: { addListener() {} } } };
      </script><script>${source(`src/${kind}/${kind}.js`)}</script>
      <script>(async () => {
        try {
          await new Promise(resolve => setTimeout(resolve, 30));
          const isPopup = ${kind === 'popup'};
          if (!isPopup) document.querySelector('[data-tab="settings"]').click();
          const selectors = isPopup
            ? ['.stat', '.stat span', '.badge', '#dashboard', '.button.secondary', '.input', '.field span', '.partial-data', '.reset-note']
            : ['.sidebar', '.badge', '.button.primary', '.button.danger', '.card', '.field label', '.input', '.partial-data'];
          const rgba = text => {
            if (text.startsWith('#')) { const value = text.slice(1); const full = value.length === 3 ? [...value].map(c => c+c).join('') : value;
              return [parseInt(full.slice(0,2),16), parseInt(full.slice(2,4),16), parseInt(full.slice(4,6),16), 1]; }
            const values = text.match(/[\\d.]+/g).map(Number); return [...values.slice(0,3), values[3] ?? 1];
          };
          const blend = (front, back) => front.slice(0,3).map((value, i) => value * front[3] + back[i] * (1-front[3]));
          const background = element => {
            const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
            return ancestors.reduce((color, node) => blend(rgba(getComputedStyle(node).backgroundColor), color), [255,255,255]);
          };
          const luminance = color => color.slice(0,3).map(value => value/255).map(value => value <= 0.04045 ? value/12.92 : ((value+0.055)/1.055)**2.4)
            .reduce((sum, value, i) => sum + value * [0.2126,0.7152,0.0722][i], 0);
          const ratio = (front, back) => { const values = [luminance(front), luminance(back)].sort((a,b) => b-a); return (values[0]+0.05)/(values[1]+0.05); };
          const inspect = () => ({ theme: document.documentElement.dataset.theme,
            surfaces: selectors.map(selector => {
              const element = document.querySelector(selector); if (!element) throw new Error('Missing surface: '+selector);
              const style = getComputedStyle(element), back = background(element), front = blend(rgba(style.color), back);
              const gradient = style.backgroundImage.startsWith('linear-gradient')
                ? ['--button-start','--button-end'].map(key => ratio(front, rgba(getComputedStyle(document.documentElement).getPropertyValue(key).trim()))) : [];
              return { selector, contrast: ratio(front, back), gradient, text: element.textContent.trim() };
            }) });
          const light = inspect();
          const input = document.querySelector(isPopup ? '#common-capital-balance' : '#setting-buy-presets');
          input.value = isPopup ? '77' : '77, 88';
          if (isPopup) document.querySelector('.account-settings').open = true;
          input.focus();
          if (!isPopup) input.setSelectionRange(2,4);
          systemLight = false; themeListeners.forEach(fn => fn({ matches: false }));
          const restored = document.querySelector('#'+input.id);
          const draft = { value: restored.value, focused: document.activeElement === restored,
            open: isPopup ? document.querySelector('.account-settings').open : null,
            selection: isPopup ? null : [restored.selectionStart, restored.selectionEnd] };
          const dark = inspect();
          const report = { light, dark, draft, language: document.documentElement.lang };
          document.title = 'TANGO_UI_COMPLETE:' + btoa(unescape(encodeURIComponent(JSON.stringify(report))));
        } catch(error) { document.title = 'TANGO_UI_ERROR:' + error.message; }
      })();</script></body></html>`;
    const pagePath = path.join(tempRoot, `${kind}.html`);
    fs.writeFileSync(pagePath, html, 'utf8');
    const result = spawnSync(localChromeExecutable(), [
      '--headless', '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--no-sandbox',
      '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost', '--virtual-time-budget=1000', '--dump-dom',
      `--user-data-dir=${path.join(tempRoot, 'profile')}`, pathToFileURL(pagePath).href
    ], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    const title = result.stdout.match(/<title>([^<]+)<\/title>/)?.[1] || '';
    assert.ok(title.startsWith('TANGO_UI_COMPLETE:'), title);
    return JSON.parse(Buffer.from(title.slice('TANGO_UI_COMPLETE:'.length), 'base64').toString('utf8'));
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
}

for (const kind of ['popup', 'dashboard']) {
  test(`local Chrome ${kind} uses readable CSS in both themes and preserves edits on a system-theme change`, () => {
    const report = renderUiReport(kind);
    assert.equal(report.language, 'zh-CN');
    assert.equal(report.light.theme, 'light');
    assert.equal(report.dark.theme, 'dark');
    for (const mode of ['light', 'dark']) {
      for (const surface of report[mode].surfaces) {
        const contrasts = surface.gradient.length ? surface.gradient : [surface.contrast];
        assert.ok(contrasts.every(value => value >= 4.5), `${kind}/${mode}/${surface.selector}: ${contrasts.join(', ')}`);
      }
    }
    assert.equal(report.draft.value, kind === 'popup' ? '77' : '77, 88');
    assert.equal(report.draft.focused, true);
    if (kind === 'popup') assert.equal(report.draft.open, true);
    else assert.deepEqual(report.draft.selection, [2, 4]);
  });
}

function renderContentThemeReport() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tango-shadow-theme-'));
  try {
    const fixture = `<div class="tango-shell"><section class="tango-card" style="padding:16px">
      <span class="tango-paper-badge">模拟盘</span><div class="tango-assets-inline"><strong>10 ETH</strong></div>
      <button class="tango-button primary">模拟买入</button><button class="tango-button sell">模拟卖出</button>
      <input class="tango-input" value="1.5"><button class="tango-button tango-preset buy-preset">买入</button>
      <button class="tango-button tango-preset sell-preset">卖出</button>
      <input class="tango-preset-editor buy" value="1"><input class="tango-preset-editor sell" value="25">
      <div class="tango-trade-title buy-title">买入 <span class="tango-title-balance">10 ETH</span></div>
      <div class="tango-trade-title sell-title">卖出</div><button class="tango-button tango-edit-all">编辑</button>
      <div class="tango-position-total"><span>持仓总额</span><strong>10 ETH</strong><small>更新时间</small></div>
      <div class="tango-summary-item tango-paper-balance-summary"><span>虚拟余额</span><strong>10 ETH</strong></div>
      <div class="tango-bottom-details"><span>成本<strong>1 ETH</strong></span></div>
      <div class="tango-calendar-summary"><div><span>月盈亏</span><strong class="tango-up">+1 ETH</strong></div></div>
      <button class="tango-calendar-day win"><span>13</span><strong class="tango-up">+1 ETH</strong></button>
      <button class="tango-calendar-day loss"><span>14</span><strong class="tango-down">-1 ETH</strong></button>
      <button class="tango-button tango-calendar-dashboard">打开数据面板</button>
      <div class="tango-toast success">模拟买入成功</div><div class="tango-toast error">操作失败</div>
      <button class="tango-button tango-close-all">一键清仓</button><button class="tango-button sell-position">平仓</button>
      <div class="tango-position-note">临时模拟估值</div><div class="tango-warning">行情提示</div>
      <button class="tango-breakeven-link">一键回本</button><div class="tango-trade-meta"><span class="safe">安全</span></div>
      <span class="tango-position-fallback">T</span><span class="tango-token-logo">T</span>
      <div class="tango-bar-main"><span class="tango-bar-hint">点击查看持仓</span></div>
    </section></div>`;
    const selectors = ['.tango-paper-badge', '.tango-assets-inline strong', '.tango-button.primary',
      '.tango-button.sell', '.tango-input', '.tango-preset.buy-preset', '.tango-preset.sell-preset',
      '.tango-preset-editor.buy', '.tango-preset-editor.sell', '.tango-trade-title.buy-title',
      '.buy-title .tango-title-balance', '.tango-trade-title.sell-title', '.tango-edit-all',
      '.tango-position-total span', '.tango-position-total strong', '.tango-position-total small',
      '.tango-paper-balance-summary span', '.tango-paper-balance-summary strong', '.tango-bottom-details strong',
      '.tango-calendar-summary span', '.tango-calendar-summary strong', '.tango-calendar-day.win span',
      '.tango-calendar-day.win strong', '.tango-calendar-day.loss span', '.tango-calendar-day.loss strong',
      '.tango-calendar-dashboard', '.tango-toast.success', '.tango-toast.error', '.tango-close-all',
      '.tango-button.sell-position', '.tango-position-note', '.tango-warning', '.tango-breakeven-link',
      '.tango-trade-meta .safe', '.tango-position-fallback', '.tango-token-logo', '.tango-bar-hint'];
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>TANGO_SHADOW_PENDING</title></head>
      <body><div id="tango-host"></div><script>
      try {
        const host = document.querySelector('#tango-host'); const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<style>' + ${JSON.stringify(source('src/content/content.css'))} + '</style>' + ${JSON.stringify(fixture)};
        // Exercise the browser cascade for hover rules with an equivalent-specificity class.
        // This is CSS state coverage, not a native pointer-event test.
        const sheet = shadow.querySelector('style').sheet;
        for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
          const rule = sheet.cssRules[index];
          if (rule.selectorText?.includes(':hover')) sheet.insertRule(rule.cssText.replaceAll(':hover', '.tango-test-hover'), index + 1);
        }
        const rgba = text => {
          const values = text.match(/[\\d.]+/g).map(Number); return [...values.slice(0,3), values[3] ?? 1];
        };
        const blend = (front, back) => front.slice(0,3).map((value, index) => value * front[3] + back[index] * (1-front[3]));
        const luminance = color => color.map(value => value/255).map(value => value <= 0.04045 ? value/12.92 : ((value+0.055)/1.055)**2.4)
          .reduce((sum, value, index) => sum + value * [0.2126,0.7152,0.0722][index], 0);
        const ratio = (front, back) => { const values = [luminance(front), luminance(back)].sort((a,b) => b-a); return (values[0]+0.05)/(values[1]+0.05); };
        const backgrounds = element => {
          const ancestors = []; for (let node = element; node; node = node.parentElement || node.getRootNode().host) ancestors.unshift(node);
          return ancestors.reduce((colors, node) => {
            const style = getComputedStyle(node);
            const bases = colors.map(color => blend(rgba(style.backgroundColor), color));
            const endpoints = style.backgroundImage.startsWith('linear-gradient')
              ? [...style.backgroundImage.matchAll(/rgba?\\([^)]+\\)/g)].map(match => rgba(match[0])) : [];
            return endpoints.length ? bases.flatMap(base => endpoints.map(endpoint => blend(endpoint, base))) : bases;
          }, [[255,255,255]]);
        };
        const report = {};
        for (const theme of ['light','dark']) {
          host.dataset.theme = theme; document.body.style.backgroundColor = theme === 'light' ? '#f5f6fa' : '#0c0d12';
          report[theme] = ${JSON.stringify(selectors)}.map(selector => {
            const element = shadow.querySelector(selector); if (!element) throw new Error('Missing shadow surface: '+selector);
            const style = getComputedStyle(element), front = rgba(style.color);
            return { selector, color: style.color, background: style.backgroundColor, gradient: style.backgroundImage,
              contrast: Math.min(...backgrounds(element).map(back => ratio(blend(front, back), back))) };
          });
          shadow.querySelector('.tango-bar-main').classList.add('tango-test-hover');
          const hovered = shadow.querySelector('.tango-bar-hint');
          const hoveredStyle = getComputedStyle(hovered); const hoveredFront = rgba(hoveredStyle.color);
          report[theme].push({ selector: '.tango-bar-main:hover .tango-bar-hint', color: hoveredStyle.color,
            contrast: Math.min(...backgrounds(hovered).map(back => ratio(blend(hoveredFront, back), back))) });
          shadow.querySelector('.tango-bar-main').classList.remove('tango-test-hover');
        }
        report.shadowRoot = host.shadowRoot === shadow;
        document.title = 'TANGO_SHADOW_COMPLETE:' + btoa(JSON.stringify(report));
      } catch(error) { document.title = 'TANGO_SHADOW_ERROR:' + error.message; }
      </script></body></html>`;
    const pagePath = path.join(tempRoot, 'content.html');
    fs.writeFileSync(pagePath, html, 'utf8');
    const result = spawnSync(localChromeExecutable(), [
      '--headless', '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--no-sandbox',
      '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost', '--virtual-time-budget=1000', '--dump-dom',
      `--user-data-dir=${path.join(tempRoot, 'profile')}`, pathToFileURL(pagePath).href
    ], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    const title = result.stdout.match(/<title>([^<]+)<\/title>/)?.[1] || '';
    assert.ok(title.startsWith('TANGO_SHADOW_COMPLETE:'), title);
    return JSON.parse(Buffer.from(title.slice('TANGO_SHADOW_COMPLETE:'.length), 'base64').toString('utf8'));
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
}

test('local Chrome shadow DOM content controls and summaries remain readable in light and dark themes', () => {
  const report = renderContentThemeReport();
  assert.equal(report.shadowRoot, true);
  const failures = ['light','dark'].flatMap(theme => report[theme].filter(surface => surface.contrast < 4.5)
    .map(surface => `${theme}/${surface.selector}: ${surface.contrast.toFixed(3)} (${surface.color})`));
  assert.deepEqual(failures, [], 'All sampled shadow surfaces must reach 4.5:1 contrast');
});
