# GMGN Locked Giant Quick-Buy Full-Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every verified GMGN trench paper quick-buy fill one exact 36 px by 100% Tango-owned Giant slot, independent of every GMGN button-size setting, without changing paper-trading behavior.

**Architecture:** Keep the existing adapter topology discovery and isolated Guard unchanged. Strengthen the Tango-owned CSS contract across the already marked `slot -> overflow wrapper -> group/btn -> paper button -> painted content` chain, and make the current headless browser gate require identical rectangles instead of accepting taller upstream hosts. Rebuild `dist` only through the project build script, then perform non-destructive live GMGN checks after the user reloads the unpacked extension.

**Tech Stack:** Chrome Manifest V3, plain JavaScript, CSS, Node.js `node:test`, headless Chrome geometry telemetry, PowerShell, Git

## Global Constraints

- Work from design commit `f281957` or a descendant in a new isolated worktree named `.worktrees/gmgn-locked-giant-full-fill` on branch `codex/gmgn-locked-giant-full-fill`; do not reuse the dirty `.worktrees/gmgn-native-size-match` worktree.
- Preserve the user's untracked `.backups/`, `docs/superpowers/plans/2026-07-18-gmgn-multichain-paper-trading.md`, and `docs/superpowers/plans/2026-07-22-gmgn-paper-ui-quote-onboarding-resilience.md` files.
- The verified slot, every marked structural wrapper, the action host, `.tango-list-quick-buy`, and `.tango-quick-buy-content` must share one exact 36 px-high rectangle and use 100% of the available slot width.
- Preserve Giant typography exactly: 14 px amount text and 10 px Paper hint text.
- Preserve the Tango surface policy exactly: 16% normal and 24% hover accent mixing, 6 px radius, and the existing focus, active, pending, ready, and in-flight presentation.
- Never infer, cache, observe, or copy GMGN Small, Large, Extra large, or Giant geometry into Tango. All native settings must resolve to `data-tango-quick-buy-size="giant"`.
- Do not change quick-buy amounts, callbacks, action IDs, binding nonces, generations, Guard authority, token identity, quotes, supply inference, fills, balances, positions, fees, or native restoration.
- One trusted activation must continue to yield exactly one paper callback and zero native callbacks.
- Do not change chart production code in this plan. BUY/SELL lines remain fail-closed until a factual target is within a trustworthy current plot range.
- Do not edit `dist/tango-paper-trader` manually. Generate it only with `npm.cmd run build` (or `npm run build` in a shell where that resolves correctly).

## File Structure

- `tests/content-structure.test.js`: statically enforces exact 36 px ownership and native box-model neutralization for every Tango-owned layer.
- `tests/gmgn-adapter.test.js`: runs the real five-layer topology in headless Chrome and protects action identity across GMGN presentation mutations.
- `src/content/content.css`: owns the fixed Giant geometry, full painted surface, typography, and interaction presentation.
- `dist/tango-paper-trader/src/content/content.css`: build-generated copy of the changed runtime stylesheet.

## Execution Workspace Preflight

Run the `superpowers:using-git-worktrees` skill before Task 1. Confirm `.worktrees` is ignored, create the new worktree from the plan-bearing main commit, install no dependencies because this repository has none, and establish a clean baseline:

```powershell
git check-ignore .worktrees
git worktree add .worktrees/gmgn-locked-giant-full-fill -b codex/gmgn-locked-giant-full-fill
Set-Location .worktrees/gmgn-locked-giant-full-fill
npm.cmd test
npm.cmd run check
```

Expected: `.worktrees` is ignored; the new worktree is on `codex/gmgn-locked-giant-full-fill`; all baseline tests pass; validation reports a valid manifest. If the baseline fails, stop and report the exact pre-existing failure before editing.

---

### Task 1: Enforce One Exact Full-Fill Giant Rectangle

**Files:**
- Modify: `tests/content-structure.test.js:251-283`
- Modify: `tests/gmgn-adapter.test.js:110-165`
- Modify: `tests/gmgn-adapter.test.js:490-654`
- Modify: `src/content/content.css:19-104`

**Interfaces:**
- Consumes: existing adapter-applied classes `.tango-native-buy-overridden`, `.tango-quick-buy-structural-host`, `.tango-quick-buy-action-host`, `.tango-list-quick-buy`, and `.tango-quick-buy-content`.
- Produces: a CSS-only exact-Giant layout contract; no JavaScript API, callback, dataset, or state transition changes.

- [ ] **Step 1: Strengthen the static CSS contract test**

In `tests/content-structure.test.js`, replace the current `paper quick-buy owns one exact locked Giant presentation` test with the following test. It deliberately requires exact upstream heights and box-model neutralization that the current CSS does not provide:

```js
test('paper quick-buy owns one exact full-fill locked Giant rectangle', () => {
  const declarationsFor = (wanted) => {
    for (const match of cssSource.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = match[1].split(',').map((selector) => selector.trim());
      if (selectors.includes(wanted)) return match[2];
    }
    return '';
  };
  const slotRule = declarationsFor('.BuyButton-continer.tango-native-buy-overridden');
  const hostRule = declarationsFor('.BuyButton-continer.tango-native-buy-overridden .tango-quick-buy-action-host');
  const structuralRule = declarationsFor('.BuyButton-continer.tango-native-buy-overridden .tango-quick-buy-structural-host');
  const buttonRule = declarationsFor('.tango-list-quick-buy');
  const wrapperRule = declarationsFor('.tango-quick-buy-content');
  const hintRule = declarationsFor('.tango-paper-hint');
  const amountRule = declarationsFor('.tango-buy-amount');
  const hoverRule = declarationsFor('.tango-list-quick-buy:hover .tango-quick-buy-content');
  const focusRule = declarationsFor('.tango-list-quick-buy:focus-visible .tango-quick-buy-content');
  assert.ok(slotRule && hostRule && structuralRule && buttonRule && wrapperRule
    && hintRule && amountRule && hoverRule && focusRule);

  const assertExactUpstream = (name, sourceRule) => {
    assert.match(sourceRule, /box-sizing:\s*border-box\s*!important/, `${name}: border box`);
    assert.match(sourceRule, /height:\s*36px\s*!important/, `${name}: height`);
    assert.match(sourceRule, /min-height:\s*36px\s*!important/, `${name}: min height`);
    assert.match(sourceRule, /max-height:\s*36px\s*!important/, `${name}: max height`);
    assert.match(sourceRule, /width:\s*100%\s*!important/, `${name}: width`);
    assert.match(sourceRule, /padding:\s*0\s*!important/, `${name}: padding`);
    assert.match(sourceRule, /margin:\s*0\s*!important/, `${name}: margin`);
    assert.match(sourceRule, /border:\s*0\s*!important/, `${name}: border`);
    assert.match(sourceRule, /transform:\s*none\s*!important/, `${name}: transform`);
  };
  assertExactUpstream('slot', slotRule);
  assertExactUpstream('action host', hostRule);
  assertExactUpstream('structural host', structuralRule);

  assert.match(buttonRule, /height:\s*36px\s*!important/);
  assert.match(buttonRule, /min-height:\s*36px\s*!important/);
  assert.match(buttonRule, /max-height:\s*36px\s*!important/);
  assert.match(buttonRule, /width:\s*100%\s*!important/);
  assert.match(buttonRule, /align-self:\s*stretch\s*!important/);
  assert.match(buttonRule, /flex:\s*0\s+0\s+100%\s*!important/);
  assert.match(buttonRule, /border-radius:\s*6px\s*!important/);
  assert.match(buttonRule, /--tango-quick-buy-display-text:\s*14px/);
  assert.match(buttonRule, /--tango-quick-buy-label-text:\s*10px/);
  assert.match(wrapperRule, /align-self:\s*stretch\s*!important/);
  assert.match(wrapperRule, /flex:\s*1\s+1\s+auto\s*!important/);
  assert.match(wrapperRule, /height:\s*100%\s*!important/);
  assert.match(wrapperRule, /width:\s*100%\s*!important/);
  assert.match(wrapperRule, /background:\s*color-mix\(in srgb,\s*var\(--tango-quick-buy-accent\)\s*16%,\s*transparent\)\s*!important/i);
  assert.match(hintRule, /font-size:\s*var\(--tango-quick-buy-label-text\)\s*!important/);
  assert.match(amountRule, /font-size:\s*1em\s*!important/);
  assert.match(hoverRule, /var\(--tango-quick-buy-accent\)\s*24%/);
  assert.match(focusRule, /var\(--tango-quick-buy-accent\)/);
  assert.doesNotMatch(
    [slotRule, hostRule, structuralRule, buttonRule, wrapperRule, hintRule, amountRule].join('\n'),
    /customize-button-ultra-color/
  );
});
```

- [ ] **Step 2: Strengthen native-size mutation identity coverage**

Change `native presentation mutation preserves giant geometry and action identity` to an async test. Use one stable `onQuickBuy` callback, cycle all four GMGN profiles plus a hostile profile, and invoke the registered action once after the cycle:

```js
test('native presentation mutation preserves giant geometry and action identity', async () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const guard = guardHarness();
  const orders = [];
  const onQuickBuy = (order) => orders.push(order);
  return withQuickBuyGlobals(harness, { guard }, async () => {
    assert.equal(GMGN.discoverTokenCards(onQuickBuy), 1);
    const binding = harness.slot.__tangoQuickBuyBinding;
    const initial = {
      replacement: binding.replacement,
      binding,
      action: binding.action,
      generation: binding.generation,
      actionId: binding.actionId,
      nonce: binding.bindingNonce
    };
    const presentations = [
      [LIVE_QUICK_BUY_SMALL, 'height:24px;color:red;padding:7px;'],
      [LIVE_QUICK_BUY_LARGE, 'height:28px;color:green;margin:5px;'],
      [LIVE_QUICK_BUY_XL, 'height:32px;color:blue;transform:translateY(6px);'],
      [LIVE_QUICK_BUY_GIANT, 'height:36px;color:white;border:3px solid red;'],
      ['!h-[113px] !p-[17px] !translate-y-[9px]', 'height:113px;padding:17px;transform:translateY(9px);']
    ];
    for (const [className, styleText] of presentations) {
      harness.setNativePresentation(className, styleText);
      assert.equal(GMGN.discoverTokenCards(onQuickBuy, 1, 'PAPER', [harness.card]), 0);
      assert.equal(harness.slot.__tangoQuickBuyBinding, initial.binding);
      assert.equal(binding.replacement, initial.replacement);
      assert.equal(binding.action, initial.action);
      assert.equal(binding.generation, initial.generation);
      assert.equal(binding.actionId, initial.actionId);
      assert.equal(binding.bindingNonce, initial.nonce);
      assert.equal(binding.replacement.dataset.tangoQuickBuySize, 'giant');
      assert.equal(binding.replacement.className, 'tango-list-quick-buy');
      assert.equal(binding.replacement.style.cssText, '');
    }
    await guard.invokeRegistered(binding.replacement);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].token.address, EVM_ADDRESS);
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  });
});
```

- [ ] **Step 3: Replace the permissive headless geometry gate with exact-chain telemetry**

In `headlessLockedGiantQuickBuyLayoutReport()`, place hostile page-owned CSS before `${safetyCss}` and `${contentCss}`, set `.fixture` to 120 px, and use the current live class topology:

```js
const page = `<!doctype html><html><head><meta charset="utf-8"><title>${HEADLESS_LAYOUT_PENDING_TITLE}</title><style>
html, body { margin: 0; padding: 0; }
body { background: #0c0d12; font: 13px/1 Arial, sans-serif; }
#cases { display: flex; flex-wrap: wrap; gap: 16px; padding: 12px; }
.fixture { width: 120px; }
.hostile-slot, .hostile-wrapper, .hostile-host {
  align-items: flex-end !important;
  border: 3px solid red !important;
  box-sizing: border-box !important;
  height: var(--requested-height) !important;
  max-height: var(--requested-height) !important;
  min-height: var(--requested-height) !important;
  margin: 5px !important;
  padding: 7px !important;
  transform: translateY(6px) !important;
  width: 120px !important;
}
.hostile-wrapper { overflow: hidden !important; }
${safetyCss}
${contentCss}
</style></head><body><main id="cases"></main><script>
```

Inside the fixture script, use six native heights and retain the three direct/nested/real-wrapper fallback shapes, with `real-wrapper` matching the confirmed GMGN path:

```js
const heights = [24, 28, 32, 36, 48, 113];
const rect = (element) => {
  const value = element.getBoundingClientRect();
  return {
    left: value.left, top: value.top, right: value.right, bottom: value.bottom,
    width: value.width, height: value.height
  };
};
const geometryStyle = (element, kind) => {
  const value = getComputedStyle(element);
  return {
    kind,
    marginTop: value.marginTop,
    paddingTop: value.paddingTop,
    borderTopWidth: value.borderTopWidth,
    transform: value.transform,
    overflow: value.overflow
  };
};
const build = (id, requestedHostHeight) => {
  const fixture = document.createElement('section');
  fixture.className = 'fixture';
  fixture.id = id + '-' + requestedHostHeight;
  fixture.style.setProperty('--requested-height', requestedHostHeight + 'px');
  const slot = document.createElement('div');
  slot.className = 'relative !w-full !h-full !box-border group-btns max-w-[200px] border BuyButton-continer tango-native-buy-overridden hostile-slot';
  slot.dataset.tangoQuickBuy = '1';
  slot.dataset.tangoQuickBuySize = 'giant';
  const nested = id !== 'direct';
  const overflow = id === 'real-wrapper' ? document.createElement('div') : null;
  if (overflow) {
    overflow.className = 'w-full h-full overflow-hidden hostile-wrapper tango-quick-buy-structural-host';
  }
  const host = nested ? document.createElement('div') : slot;
  if (nested) {
    host.className = 'relative w-fit !w-full !h-full !box-border border-none z-10 group/btn hostile-host tango-quick-buy-action-host tango-quick-buy-structural-host';
  } else {
    host.classList.add('tango-quick-buy-action-host');
  }
  const paper = document.createElement('button');
  paper.className = 'tango-list-quick-buy';
  paper.dataset.tangoQuickBuySize = 'giant';
  paper.dataset.tangoPublished = '1';
  const content = document.createElement('span');
  content.className = 'tango-quick-buy-content';
  const hint = document.createElement('span');
  hint.className = 'tango-paper-hint';
  hint.textContent = 'PAPER';
  const amount = document.createElement('span');
  amount.className = 'tango-buy-amount';
  amount.textContent = '0.1 ETH';
  content.append(hint, amount);
  paper.append(content);
  host.append(paper);
  if (overflow) {
    overflow.append(host);
    slot.append(overflow);
  } else if (nested) {
    slot.append(host);
  }
  fixture.append(slot);
  document.querySelector('#cases').append(fixture);
  return { fixture, slot, overflow, host, paper, content, hint, amount, requestedHostHeight };
};
const controls = heights.flatMap((height) => [
  build('direct', height), build('nested', height), build('real-wrapper', height)
]);
```

Replace the existing `states` telemetry with exact rectangles and upstream computed styles:

```js
const states = controls.map(({ fixture, slot, overflow, host, paper, content, hint, amount, requestedHostHeight }) => ({
  fixture: fixture.id.split('-')[0],
  requestedHostHeight,
  rects: {
    slot: rect(slot),
    overflow: overflow ? rect(overflow) : null,
    host: rect(host),
    paper: rect(paper),
    content: rect(content)
  },
  upstreamStyles: [
    geometryStyle(slot, 'slot'),
    ...(overflow ? [geometryStyle(overflow, 'overflow')] : []),
    ...(host !== slot ? [geometryStyle(host, 'host')] : [])
  ],
  amountFont: Number.parseFloat(getComputedStyle(amount).fontSize),
  hintFont: Number.parseFloat(getComputedStyle(hint).fontSize),
  paperRadius: getComputedStyle(paper).borderRadius,
  paperColor: getComputedStyle(paper).color,
  contentBackground: getComputedStyle(content).backgroundColor,
  contentAlign: getComputedStyle(content).alignItems,
  contentJustify: getComputedStyle(content).justifyContent,
  textInsideContent: [hint, amount].every((child) => {
    const childRect = child.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return childRect.left >= contentRect.left - 0.5
      && childRect.right <= contentRect.right + 0.5
      && childRect.top >= contentRect.top - 0.5
      && childRect.bottom <= contentRect.bottom + 0.5;
  })
}));
```

Update the two existing focus-telemetry references from `controls[0].wrapper` to `controls[0].content`; keep the bounded 30-attempt focus condition, title protocol, and temporary-directory cleanup unchanged.

Rename the headless test to `headless Chrome fills the exact Giant slot through the live wrapper chain` and replace its geometry assertions with:

```js
test('headless Chrome fills the exact Giant slot through the live wrapper chain', () => {
  const report = headlessLockedGiantQuickBuyLayoutReport();
  assert.equal(report.states.length, 18, 'three topologies x six hostile native heights');
  const near = (actual, expected, message) => {
    assert.ok(Math.abs(actual - expected) <= 0.5, `${message}: ${actual} vs ${expected}`);
  };
  for (const state of report.states) {
    const expected = state.rects.slot;
    assert.equal(expected.height, 36, `${state.fixture}:${state.requestedHostHeight}: slot height`);
    assert.equal(expected.width, 120, `${state.fixture}:${state.requestedHostHeight}: slot width`);
    for (const [layer, layerRect] of Object.entries(state.rects)) {
      if (!layerRect) continue;
      for (const edge of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
        near(layerRect[edge], expected[edge],
          `${state.fixture}:${state.requestedHostHeight}:${layer}:${edge}`);
      }
    }
    for (const style of state.upstreamStyles) {
      assert.equal(style.marginTop, '0px', `${state.fixture}:${style.kind}: margin`);
      assert.equal(style.paddingTop, '0px', `${state.fixture}:${style.kind}: padding`);
      assert.equal(style.borderTopWidth, '0px', `${state.fixture}:${style.kind}: border`);
      assert.equal(style.transform, 'none', `${state.fixture}:${style.kind}: transform`);
      if (style.kind !== 'slot') assert.equal(style.overflow, 'visible');
    }
    assert.equal(state.amountFont, 14, `${state.fixture}: amount font`);
    assert.equal(state.hintFont, 10, `${state.fixture}: hint font`);
    assert.equal(state.paperRadius, '6px', `${state.fixture}: Tango radius`);
    assert.equal(state.paperColor, 'rgb(125, 211, 252)', `${state.fixture}: Tango accent`);
    assert.notEqual(state.contentBackground, 'rgba(0, 0, 0, 0)', `${state.fixture}: painted surface`);
    assert.equal(state.contentAlign, 'center');
    assert.equal(state.contentJustify, 'center');
    assert.equal(state.textInsideContent, true, `${state.fixture}: unclipped centered text`);
  }
  assert.equal(report.focus.active, true);
  assert.equal(report.focus.focusVisible, true);
  assert.ok(Number.isInteger(report.focus.attempts)
    && report.focus.attempts >= 1 && report.focus.attempts <= 30);
  assert.equal(report.focus.wrapperOutlineStyle, 'solid');
  assert.ok(report.focus.wrapperOutlineWidth >= 1);
});
```

Keep all other focus telemetry and temporary-directory cleanup unchanged.

- [ ] **Step 4: Run the focused tests and verify RED**

```powershell
node --test --test-name-pattern="paper quick-buy owns one exact full-fill|native presentation mutation preserves|headless Chrome fills the exact Giant" tests/content-structure.test.js tests/gmgn-adapter.test.js
```

Expected: the mutation identity test still passes; the static CSS test fails because the upstream rules lack exact `height/max-height`, native box-model resets, and stretch ownership; the headless test fails for taller/hostile cases because upstream rectangles remain larger or offset. Confirm the failure is behavioral, not a syntax or telemetry-protocol error.

- [ ] **Step 5: Implement the minimal scoped CSS fix**

In `src/content/content.css`, replace the three current slot/action/structural rules with the following scoped rules:

```css
.BuyButton-continer.tango-native-buy-overridden {
  align-items: center !important;
  border: 0 !important;
  box-sizing: border-box !important;
  display: flex !important;
  height: 36px !important;
  isolation: isolate;
  justify-content: center !important;
  margin: 0 !important;
  max-height: 36px !important;
  max-width: 100% !important;
  min-height: 36px !important;
  min-width: 0 !important;
  overflow: hidden;
  padding: 0 !important;
  position: relative !important;
  transform: none !important;
  width: 100% !important;
}
.BuyButton-continer.tango-native-buy-overridden .tango-quick-buy-action-host,
.BuyButton-continer.tango-native-buy-overridden .tango-quick-buy-structural-host {
  align-items: center !important;
  border: 0 !important;
  box-sizing: border-box !important;
  display: flex !important;
  flex: 0 0 100% !important;
  height: 36px !important;
  justify-content: center !important;
  margin: 0 !important;
  max-height: 36px !important;
  max-width: 100% !important;
  min-height: 36px !important;
  min-width: 0 !important;
  overflow: visible !important;
  padding: 0 !important;
  transform: none !important;
  width: 100% !important;
}
```

In `.tango-list-quick-buy`, change only the two ownership declarations and add a maximum width:

```css
  align-self: stretch !important;
  flex: 0 0 100% !important;
  max-width: 100% !important;
```

Remove the old `align-self: center !important` and `flex: 0 0 auto !important` declarations. Keep its exact 36 px height, padding, interaction, color, radius, and other rules unchanged.

In `.tango-quick-buy-content`, add deterministic stretch ownership and replace the percentage flex basis:

```css
  align-self: stretch !important;
  flex: 1 1 auto !important;
```

Remove the old `flex: 1 1 100% !important`. Keep `height: 100%`, `width: 100%`, the two-line column layout, 16% background, 2 px Tango-owned inner padding, and pointer-inert behavior unchanged.

- [ ] **Step 6: Run the focused tests and verify GREEN**

```powershell
node --test --test-name-pattern="paper quick-buy owns one exact full-fill|native presentation mutation preserves|real slot-local wrapper chain|headless Chrome fills the exact Giant" tests/content-structure.test.js tests/gmgn-adapter.test.js
```

Expected: all selected tests pass. The headless report contains 18 cases; every non-null layer rectangle matches the slot at exactly 120 px by 36 px; upstream margin, padding, border, and transform are neutralized; the painted content is nontransparent and text remains inside it.

- [ ] **Step 7: Run adjacent Guard and runtime regressions**

```powershell
node --test tests/gmgn-adapter.test.js tests/native-quick-buy-guard.test.js tests/gmgn-quick-buy-world-integration.test.js tests/content-structure.test.js tests/content-runtime.test.js
```

Expected: all tests pass; there is no duplicate paper callback, no native callback, and no change to Guard registration or runtime trade behavior.

- [ ] **Step 8: Review the focused diff and commit Task 1**

```powershell
git diff --check -- src/content/content.css tests/content-structure.test.js tests/gmgn-adapter.test.js
git diff -- src/content/content.css tests/content-structure.test.js tests/gmgn-adapter.test.js
git add -- src/content/content.css tests/content-structure.test.js tests/gmgn-adapter.test.js
git commit -m "fix: fill locked giant quick-buy slot"
```

Expected: exactly the stylesheet and two test files are committed. No adapter, Guard, chart, trade, quote, or user-owned untracked file is included.

---

### Task 2: Verify the Release and Regenerate the Unpacked Extension

**Files:**
- Generate: `dist/tango-paper-trader/src/content/content.css`
- Verify: all project source, tests, manifest references, and generated package files

**Interfaces:**
- Consumes: Task 1's source CSS and tests.
- Produces: a source-identical unpacked extension stylesheet under `dist/tango-paper-trader`.

- [ ] **Step 1: Run the complete source verification before building**

```powershell
npm.cmd test
npm.cmd run check
git diff --check HEAD^..HEAD
```

Expected: the complete test suite passes with zero failures; extension validation succeeds; the Task 1 commit has no whitespace errors.

- [ ] **Step 2: Build the unpacked extension through the canonical script**

```powershell
npm.cmd run build
```

Expected: output ends with `Built unpacked extension at` and points to `dist/tango-paper-trader`. Do not edit any generated file by hand.

- [ ] **Step 3: Prove source/package byte parity for the changed runtime asset**

```powershell
$sourceCss = (Get-FileHash -Algorithm SHA256 -LiteralPath 'src/content/content.css').Hash
$distCss = (Get-FileHash -Algorithm SHA256 -LiteralPath 'dist/tango-paper-trader/src/content/content.css').Hash
if ($sourceCss -ne $distCss) { throw "content.css source/dist mismatch: $sourceCss != $distCss" }
Write-Output "content.css SHA256 $sourceCss"
```

Expected: the hashes are identical and the command prints one SHA-256 value.

- [ ] **Step 4: Re-run verification against the built tree**

```powershell
npm.cmd test
npm.cmd run check
git diff --check -- dist/tango-paper-trader/src/content/content.css
git status --short
```

Expected: all tests and validation pass again. Git shows the build-generated CSS change plus only the previously known user-owned untracked files.

- [ ] **Step 5: Commit only the generated package asset**

```powershell
git add -- dist/tango-paper-trader/src/content/content.css
git commit -m "build: package locked giant full-fill"
```

Expected: the commit contains only the generated `dist` stylesheet.

---

### Task 3: Perform Live GMGN and Chart Verification

**Files:**
- Inspect: unpacked extension at `.worktrees/gmgn-locked-giant-full-fill/dist/tango-paper-trader`
- Modify: none

**Interfaces:**
- Consumes: the built unpacked extension and the user's signed-in Chrome GMGN session.
- Produces: live evidence for fixed Giant geometry and a non-mutating chart marker observation.

- [ ] **Step 1: Ask the user to reload the exact unpacked build**

Give the user the absolute worktree `dist/tango-paper-trader` path. Ask them to open `chrome://extensions`, enable Developer mode if needed, reload the already loaded Tango extension or load that exact unpacked directory, refresh the GMGN trench tab, and reply when ready. Do not install, reload, or accept an extension permission prompt through browser automation without the user's action-time confirmation.

- [ ] **Step 2: Measure visible trench controls in Chrome**

After the user confirms reload, use the Chrome browser skill and evaluate the following read-only measurement on the BSC trench page:

```js
() => [...document.querySelectorAll('.BuyButton-continer.tango-native-buy-overridden[data-tango-quick-buy="1"]')]
  .filter((slot) => {
    const rect = slot.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  })
  .slice(0, 12)
  .map((slot) => {
    const paper = slot.querySelector('.tango-list-quick-buy');
    const content = paper?.querySelector('.tango-quick-buy-content');
    const chain = [slot, ...slot.querySelectorAll('.tango-quick-buy-structural-host'), paper, content]
      .filter(Boolean);
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left, top: value.top, right: value.right, bottom: value.bottom,
        width: value.width, height: value.height
      };
    };
    return {
      size: paper?.dataset.tangoQuickBuySize,
      actionId: paper?.dataset.tangoActionId,
      bindingNonce: paper?.dataset.tangoBindingNonce,
      generation: paper?.dataset.tangoCardGeneration,
      state: paper?.dataset.tangoPaperState,
      rects: chain.map((element) => ({
        className: String(element.className || ''),
        rect: rect(element),
        background: getComputedStyle(element).backgroundColor
      }))
    };
  })
```

Expected: at least one visible Tango control exists; every result has `size: "giant"`; each chain rectangle is 36 px high and shares the same edges and width within 0.5 px; the content background is nontransparent.

- [ ] **Step 3: Toggle all GMGN native button-size settings and remeasure**

Use visible GMGN controls, not guessed selectors, to switch Small, Large, Extra large, and Giant one at a time. After each switch, repeat Step 2 for the same visible token card and compare `actionId`, `bindingNonce`, `generation`, `size`, and rectangles.

Expected: the GMGN native setting changes, but Tango remains `giant`, 36 px by 100%, centered and fully painted. The action ID, binding nonce, and generation for the same non-recycled card do not change. Do not click the paper buy button as part of this visual verification.

- [ ] **Step 4: Recheck detail-page BUY/SELL line behavior without creating a trade**

Open a GMGN detail page for a token that already has Tango paper trade history. Confirm the Tango panel exists, then inspect `#tango-chart-axis-markers > div` while zooming or panning the K-line so the recorded factual BUY or SELL price moves outside and then inside the visible right-axis range.

Expected: no line exists while the factual target is outside the plot; a correctly aligned line appears only after that target enters the visible range; it disappears again after leaving. During iframe reload, viewport change, or sparse-axis reconstruction, temporary hiding is valid and no line may be clamped to an edge. If there is no existing trade-bearing token, do not create a paper trade without separate user approval; report the live chart case as unavailable and retain the passing automated marker suite as the verification evidence.

- [ ] **Step 5: Run final verification immediately before completion**

Invoke `superpowers:verification-before-completion`, then run fresh commands rather than relying on prior output:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
$sourceCss = (Get-FileHash -Algorithm SHA256 -LiteralPath 'src/content/content.css').Hash
$distCss = (Get-FileHash -Algorithm SHA256 -LiteralPath 'dist/tango-paper-trader/src/content/content.css').Hash
if ($sourceCss -ne $distCss) { throw 'content.css source/dist mismatch' }
$mergeBase = git merge-base main HEAD
git diff --check "$mergeBase..HEAD"
git status --short
```

Expected: tests, validation, build, parity, and range-qualified whitespace checks all pass. The branch is clean except for the known user-owned untracked paths if they are visible from this worktree.

- [ ] **Step 6: Finish the development branch**

Invoke `superpowers:finishing-a-development-branch`. Present the verified integration options to the user; do not merge, push, or delete the worktree without their choice.

## Plan Self-Review Result

- Spec coverage: Task 1 covers exact 36 px full-fill geometry, real wrapper topology, typography, paint, native-size isolation, action identity, and lifecycle regressions; Task 2 covers full verification and generated package parity; Task 3 covers live trench and chart observations.
- Scope: production changes are restricted to `src/content/content.css`; adapter, Guard, trade, quote, and chart production code remain unchanged unless the RED evidence contradicts the confirmed root cause, in which case implementation stops for a design revision.
- Type/name consistency: every class, dataset field, test name, command, source path, and generated path matches the current repository.
- Placeholder scan: the plan contains no deferred implementation placeholders; the only conditional path is the explicit no-existing-trade live-chart limitation, which forbids unapproved state mutation.
