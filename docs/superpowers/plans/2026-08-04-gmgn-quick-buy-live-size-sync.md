# GMGN Trench Paper Quick-Buy Live Size Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make protected GMGN trench paper quick-buy controls immediately and visibly follow all four GMGN button sizes, including new meme cards, without changing any trading or real-funds-isolation behavior.

**Architecture:** Keep visual presentation and size-profile discovery separate. Read only exact canonical size signals from slot-local connected nodes, cache the latest profile per chain, and update CSS variables on the existing protected binding; keep all host classes, styles, action attributes, and event behavior outside the paper control. Expand only the protected slot's minimum visual height and keep the inner semi-transparent surface shrinkable, rounded, and unclipped.

**Tech Stack:** Chrome Extension Manifest V3, plain JavaScript, CSS, Node.js `node:test`, headless Chrome geometry fixture, PowerShell build/hash verification.

## Global Constraints

- Modify only `src/adapters/gmgn.js`, `src/content/content.css`, `src/content/quick-buy-safety.css`, `tests/gmgn-adapter.test.js`, and `tests/content-structure.test.js`, followed by the generated copies under `dist/tango-paper-trader` through the existing build script.
- Do not change action IDs, binding nonces, adapter generations, click handlers, quote selection, Engine calls, balances, positions, orders, markers, storage, permissions, or network behavior.
- Never click, dispatch to, reveal, or call a GMGN native trading control; do not operate a live browser during implementation tests.
- Preserve the full-slot paper hit target, `NativeQuickBuyGuard`, and the invariant of one paper callback and zero native capture/bubble callbacks.
- Accept only canonical connected-host size values: `24/12`, `28/13`, `32/14`, and `36/16`; reject arbitrary host dimensions such as `18`, `35`, `64`, or `100` pixels.
- Preserve all pre-existing staged and unstaged work. Because the implementation files already contain mixed user changes, do not stage or commit implementation files during these tasks; use scoped diffs and test evidence as checkpoints.
- Build `dist/tango-paper-trader` only after source tests and validation pass.

---

### Task 1: Connected canonical profile discovery and propagation

**Files:**
- Modify: `tests/gmgn-adapter.test.js` near the existing four-size, detached-source, peer-propagation, and ResizeObserver tests
- Modify: `src/adapters/gmgn.js:1180-1405`
- Modify: `src/adapters/gmgn.js:1752-1871`
- Modify: `src/adapters/gmgn.js:2028-2059`
- Modify: `src/adapters/gmgn.js:2080-2122`
- Modify: `src/adapters/gmgn.js:2218-2234`
- Modify: `src/adapters/gmgn.js:2320-2350`
- Modify: `src/adapters/gmgn.js:2534-2611`
- Modify: `src/adapters/gmgn.js:2629-2658`

**Interfaces:**
- Consumes: existing `QUICK_BUY_SIZE_PROFILES`, `quickBuyProfileSignalFromPresentation`, `cachedQuickBuyPresentation`, `syncQuickBuyPresentation`, and binding lifecycle helpers.
- Produces: `canonicalQuickBuyProfileFromNode(node) -> profile|null`, `quickBuyConnectedProfileSources(slot, binding, nativeControl?) -> Element[]`, `readConnectedQuickBuyProfile(slot, binding, nativeControl?) -> { node, profile }|null`, `observeQuickBuyProfileSources(slot, binding, nativeControl?)`, and a chain-local canonical profile cache.
- Preserves: the exact replacement element, binding identity, `actionId`, `bindingNonce`, `generation`, handler, Guard identity, and paper state during profile changes.

- [ ] **Step 1: Add a failing connected-host regression test**

Add a test next to `detached source resize retains its column presentation after another card changes`. Model the native leaf as detached and the action host as connected. Capture identity before changing the host and assert every canonical transition updates only size state:

```js
test('connected GMGN action host drives all four sizes after the native leaf detaches', () => {
  // Install FakeMutationObserver and FakeResizeObserver arrays using the pattern
  // already used by the detached-source tests.
  let paperBuyCalls = 0;
  const onPaperBuy = () => { paperBuyCalls += 1; };
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const actionHost = connectedActionHost(LIVE_QUICK_BUY_GIANT, harness.slot);
  harness.slot.querySelector = (selector) => selector === '[class~="group/btn"]'
    ? actionHost : originalQuerySelector(selector);

  assert.equal(freshGmgn.discoverTokenCards(onPaperBuy), 1);
  harness.nativeControl.isConnected = false;
  const binding = harness.slot.__tangoQuickBuyBinding;
  const profileObserver = mutationObservers.find((observer) =>
    observer.targets.includes(actionHost));
  assert.ok(profileObserver);
  const unchanged = {
    replacement: binding.replacement,
    binding,
    actionId: binding.actionId,
    bindingNonce: binding.bindingNonce,
    generation: binding.generation,
    handler: harness.slot.__tangoQuickBuyHandler,
    state: binding.state
  };

  for (const [className, id, height, text] of [
    [LIVE_QUICK_BUY_SMALL, 'small', '24px', '12px'],
    [LIVE_QUICK_BUY_LARGE, 'large', '28px', '13px'],
    [LIVE_QUICK_BUY_XL, 'extra-large', '32px', '14px'],
    [LIVE_QUICK_BUY_GIANT, 'giant', '36px', '16px']
  ]) {
    actionHost.className = `group/btn ${className}`;
    profileObserver.callback([{ type: 'attributes', target: actionHost, attributeName: 'class' }]);
    assert.equal(binding.replacement.dataset.tangoQuickBuySize, id);
    assert.equal(binding.replacement.style.getPropertyValue('--tango-quick-buy-height'), height);
    assert.equal(binding.replacement.style.getPropertyValue('--tango-quick-buy-text'), text);
    assert.equal(harness.slot.style.getPropertyValue('--tango-quick-buy-height'), height);
    assert.equal(harness.slot.__tangoQuickBuyBinding, unchanged.binding);
    assert.equal(binding.replacement, unchanged.replacement);
    assert.equal(binding.actionId, unchanged.actionId);
    assert.equal(binding.bindingNonce, unchanged.bindingNonce);
    assert.equal(binding.generation, unchanged.generation);
    assert.equal(harness.slot.__tangoQuickBuyHandler, unchanged.handler);
    assert.equal(binding.state, unchanged.state);
  }
  assert.equal(harness.nativeControl.realHandlerCalls, 0);
  assert.equal(paperBuyCalls, 0);
});
```

Add this local helper beside the existing quick-buy harness helpers so it behaves like the real slot-local host rather than a detached presentation leaf:

```js
function connectedActionHost(className, slot) {
  const properties = new Map();
  const style = {
    cssText: '',
    getPropertyValue: (name) => properties.get(name) || '',
    setProperty(name, value) { properties.set(name, String(value)); },
    removeProperty(name) { const value = properties.get(name) || ''; properties.delete(name); return value; }
  };
  return {
    className,
    style,
    isConnected: true,
    parentElement: slot,
    children: [],
    getAttribute(name) {
      if (name === 'class') return this.className;
      if (name === 'style') return this.style.cssText;
      return null;
    },
    closest: (selector) => selector === '.BuyButton-continer' ? slot : null,
    appendChild(node) {
      this.children.push(node);
      node.parentNode = this;
      node.parentElement = this;
      node.isConnected = true;
      return node;
    }
  };
}
```

- [ ] **Step 2: Add failing priority, rejection, late-host, and new-card tests**

Cover these cases in the same file:

```js
const liveNative = {
  ...harness.nativeControl,
  isConnected: true,
  connectedElsewhere: false,
  className: LIVE_QUICK_BUY_SMALL,
  style: { cssText: '' },
  textContent: '0.1 ETH'
};
harness.setLiveNativeControl(liveNative);
actionHost.className = `group/btn ${LIVE_QUICK_BUY_XL}`;
assert.equal(freshGmgn.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.slot]), 0);
assert.equal(binding.replacement.dataset.tangoQuickBuySize, 'small');
assert.equal(liveNative.isConnected, false, 'the coherent leaf is detached after safe replacement');
profileObserver.callback([{ type: 'attributes', target: actionHost, attributeName: 'class' }]);
assert.equal(binding.replacement.dataset.tangoQuickBuySize, 'extra-large');

const lastVerifiedSize = binding.quickBuyProfile.id;
for (const hostile of ['!h-[35px]', '!text-[15px]', '!h-[100px] !text-[64px]']) {
  actionHost.className = `group/btn ${hostile}`;
  profileObserver.callback([{ type: 'attributes', target: actionHost, attributeName: 'class' }]);
  assert.equal(binding.quickBuyProfile.id, lastVerifiedSize);
  assert.doesNotMatch(binding.replacement.className, /35px|15px|100px|64px/);
}
```

Also assert:

- a replaced action host becomes observed while mutations from the old host no longer update the binding;
- `quickBuyNeedsReconcile()` returns `true` when a connected canonical host differs from `binding.quickBuyProfile`;
- a same-chain peer and a subsequently inserted leafless card receive the latest profile but keep their own border/radius/color presentation;
- `id`, `href`, `role`, `data-testid`, inline `onclick`, layout classes, and pointer/visibility attributes from a host never appear on the replacement;
- `clearQuickBuy()` disconnects profile and resize observers and removes the slot-owned `--tango-quick-buy-height` variable;
- native callback count remains zero.

- [ ] **Step 3: Run focused tests and verify RED for the live-page reason**

Run:

```powershell
node --test --test-name-pattern="connected GMGN action host|connected canonical host|replaced action host|leafless card receives latest chain size|profile drift" tests/gmgn-adapter.test.js
```

Expected: the connected-host tests fail because `syncQuickBuyPresentation()` still reads `binding.presentationSource`, the host is not observed, the slot variable is absent, or the health probe misses profile drift. Existing detached-leaf tests should remain green.

- [ ] **Step 4: Add strict connected-node profile helpers**

Keep the existing tolerant native presentation parser for backward compatibility. Add a strict wrapper for connected hosts that accepts an exact pair or one exact canonical dimension and rejects nearest-value guessing:

```js
function canonicalQuickBuyProfileFromNode(node) {
  if (!node?.isConnected) return null;
  const className = typeof node.className === 'string'
    ? node.className : String(node.className?.baseVal || '');
  const styleText = node.getAttribute?.('style') || node.style?.cssText || '';
  const height = Number(
    className.match(/(?:^|\s)!?h-\[(\d+(?:\.\d+)?)px\](?=\s|$)/)?.[1]
    || styleText.match(/(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px\b/i)?.[1]
    || 0
  );
  const text = Number(
    className.match(/(?:^|\s)!?text-\[(\d+(?:\.\d+)?)px\](?=\s|$)/)?.[1]
    || styleText.match(/(?:^|;)\s*font-size\s*:\s*(\d+(?:\.\d+)?)px\b/i)?.[1]
    || 0
  );
  if (!height && !text) return null;
  return QUICK_BUY_SIZE_PROFILE_LIST.find((profile) =>
    (!height || profile.heightPx === height)
    && (!text || profile.textPx === text)
  ) || null;
}
```

Build a deduplicated, slot-local candidate list in this order: connected native leaf, `replacement.parentElement`, `slot.querySelector('[class~="group/btn"]')`, connected ancestors between replacement and slot, then slot. Reject any node outside the exact `.BuyButton-continer`.

- [ ] **Step 5: Separate the chain size cache from visual presentation caches**

Add a small chain-only cache so new cards inherit size without inheriting another column's colors or borders:

```js
const quickBuyProfilesByChain = new Map();
let quickBuyProfileRevision = 0;

function rememberQuickBuyProfile(chain, profile) {
  const current = quickBuyProfilesByChain.get(chain);
  if (!chain || !profile) return current || null;
  if (current?.profile?.id === profile.id) return current;
  const next = { profile, revision: ++quickBuyProfileRevision };
  quickBuyProfilesByChain.set(chain, next);
  return next;
}
```

Use `livePresentation.profile`, then the latest connected canonical profile, then the chain cache, then the existing presentation cache, and finally Large when creating a replacement. Clear this cache in `clearQuickBuy()`.

- [ ] **Step 6: Apply a profile without rebinding any action**

Extend `applyQuickBuyProfile` with an optional slot and write only extension-owned variables/dataset values when they actually change:

```js
function applyQuickBuyProfile(replacement, profile, slot = null) {
  const selected = profile || QUICK_BUY_SIZE_PROFILES.large;
  const height = `${selected.heightPx}px`;
  const text = `${selected.textPx}px`;
  setStylePropertyIfChanged(replacement?.style, '--tango-quick-buy-height', height);
  setStylePropertyIfChanged(replacement?.style, '--tango-quick-buy-text', text);
  setStylePropertyIfChanged(slot?.style, '--tango-quick-buy-height', height);
  if (replacement?.dataset?.tangoQuickBuySize !== selected.id) {
    replacement.dataset.tangoQuickBuySize = selected.id;
  }
  if (slot?.dataset?.tangoQuickBuySize !== selected.id) {
    slot.dataset.tangoQuickBuySize = selected.id;
  }
  return selected;
}
```

Define the idempotent writer immediately above it:

```js
function setStylePropertyIfChanged(style, name, value) {
  if (!style?.setProperty || style.getPropertyValue?.(name) === value) return;
  style.setProperty(name, value);
}
```

In `syncQuickBuyPresentation`, select a connected canonical profile before any detached `presentationSource` profile. A changed connected profile calls `rememberQuickBuyProfile`, applies to the same replacement, and propagates only the profile to same-chain tracked slots. Do not call `createQuickBuyGeneration`, `commitPaperQuickBuy`, or replace the binding.

- [ ] **Step 7: Observe and refresh only connected size sources**

Add `profileObserver` and `profileSources` to every binding initializer and reset them on pending-to-ready binding replacement. `observeQuickBuyProfileSources` observes only `class` and `style`; its callback calls `syncQuickBuyPresentation(slot)` and never passes the host as a visual presentation source.

Refresh ResizeObserver targets to:

```js
[slot, binding.replacement, slot.parentElement, ...binding.profileSources]
```

Unobserve removed hosts before observing new hosts. Disconnect `profileObserver` in `retirePreviousPaperBinding` and `restoreQuickBuySlot`. Refresh profile observation during ordinary reconciliation so a late or replaced `group/btn` host is adopted without rebinding.

- [ ] **Step 8: Make the health probe detect connected profile drift**

Before the existing presentation-signature checks in `quickBuyNeedsReconcile`, add:

```js
const connected = readConnectedQuickBuyProfile(slot, binding);
if (connected?.profile?.id
  && connected.profile.id !== binding.quickBuyProfile?.id) return true;
```

This is a bounded slot-local read and must not add a document-wide scan.

- [ ] **Step 9: Run adapter tests and inspect the scoped diff**

Run:

```powershell
node --test tests/gmgn-adapter.test.js
git diff --check -- src/adapters/gmgn.js tests/gmgn-adapter.test.js
git diff -- src/adapters/gmgn.js tests/gmgn-adapter.test.js
```

Expected: adapter tests pass; the diff contains only canonical profile parsing, slot-local source observation/cache/application, lifecycle cleanup, health probing, and the new tests. It contains no changes to `createQuickBuyHandler`, Engine calls, quote construction, or native Guard invocation.

---

### Task 2: Unclipped profile-sized visual surface

**Files:**
- Modify: `tests/content-structure.test.js:240-320`
- Modify: `tests/gmgn-adapter.test.js:180-350`
- Modify: `tests/gmgn-adapter.test.js` existing hostile native presentation expectations
- Modify: `src/content/content.css:15-95`
- Modify: `src/content/quick-buy-safety.css:20-70`
- Modify: `src/adapters/gmgn.js:1208-1249`
- Modify: `src/adapters/gmgn.js:1314-1345`

**Interfaces:**
- Consumes: slot-owned `--tango-quick-buy-height`, replacement-owned `--tango-quick-buy-text`, and the existing `.tango-list-quick-buy > .tango-quick-buy-content` structure.
- Produces: an unclipped 24/28/32/36 px inner surface inside an unchanged full-slot protected hit target.
- Preserves: quick-buy safety CSS, pointer routing, Paper hint/amount DOM, theme color variable, hover opacity model, and outer border/radius/shadow tokens.

- [ ] **Step 1: Add static CSS assertions that fail on current rules**

Extend the existing structure tests with exact ownership rules:

```js
assert.match(slotRule,
  /min-height:\s*var\(--tango-quick-buy-height,\s*28px\)\s*!important/);
assert.match(hostRule,
  /min-height:\s*var\(--tango-quick-buy-height,\s*28px\)\s*!important/);
assert.match(buttonRule,
  /min-height:\s*var\(--tango-quick-buy-height,\s*28px\)\s*!important/);
assert.match(wrapperRule, /box-sizing:\s*border-box/);
assert.match(wrapperRule, /flex:\s*0\s+1\s+100%\s*!important/);
assert.match(wrapperRule, /min-width:\s*0\s*!important/);
assert.match(wrapperRule, /overflow:\s*hidden/);
assert.match(wrapperRule, /border-radius:\s*inherit/);
```

Extract the protected slot, action-host, and both published-paper selectors from `quick-buy-safety.css` and assert that each geometry-bearing rule uses the same canonical minimum height. Keep assertions that the outer button remains `height: 100%`, `width: 100%`, `pointer-events: auto`, and `background: transparent`; native controls remain `pointer-events: none` and `visibility: hidden`.

- [ ] **Step 2: Turn the headless fixture into a clipping gate**

Remove `tango-paper-native-quick-buy-allowed` from the fixture `<html>` so the production safety cascade participates in computed geometry. Change the baseline fixture slot from a generous fixed height to a hostile undersized height and report the actual visible intersection:

```js
.layout-slot { flex: 0 0 auto; height: 16px; width: 120px; }

const visibleIntersectionHeight = (inner, outer) => Math.max(
  0,
  Math.min(inner.top + inner.height, outer.top + outer.height) - Math.max(inner.top, outer.top)
);

return {
  // existing telemetry
  wrapperVisibleHeight: visibleIntersectionHeight(wrapperRect, slotRect),
  wrapperWidth: wrapperRect.width,
  wrapperOverflow: wrapperStyle.overflow,
  wrapperMinWidth: wrapperStyle.minWidth,
  wrapperBorderRadius: wrapperStyle.borderRadius
};
```

For every direct/nested profile assert:

```js
assert.ok(result.slot.height + 0.5 >= result.profileHeight);
assert.ok(Math.abs(result.wrapperVisibleHeight - result.wrapper.height) <= 0.5);
assert.ok(result.wrapperWidth <= result.button.width + 0.5);
assert.equal(result.wrapperOverflow, 'hidden');
assert.equal(result.wrapperMinWidth, '0px');
assert.equal(result.pointerEvents, 'auto');
assert.equal(result.visibility, 'visible');
```

The existing full-slot equality, centering, pointer-events, transparent outer surface, visible inner surface, and mutation-resistance assertions remain in place.

- [ ] **Step 3: Add a hostile inline-background sanitization test**

Update the native presentation test to use both classes and inline `!important` declarations:

```js
harness.setNativePresentation(
  `${LIVE_QUICK_BUY_LARGE} bg-red-500 from-red-500 via-green-500 to-blue-500 rounded-lg shadow-lg text-white`,
  '--customize-button-ultra-color: #7dd3fc; background: red !important; background-color: blue !important; background-image: linear-gradient(red, blue) !important; border-radius: 8px; color: white;'
);

assert.doesNotMatch(harness.replacement.className, /(?:^|\s)(?:bg-|from-|via-|to-)/);
assert.doesNotMatch(harness.replacement.style.cssText, /background(?:-color|-image)?\s*:/i);
assert.match(harness.replacement.style.cssText, /--customize-button-ultra-color:\s*#7dd3fc/i);
assert.match(harness.replacement.style.cssText, /border-radius:\s*8px/i);
assert.match(harness.replacement.style.cssText, /color:\s*white/i);
```

This guarantees the semi-transparent inner surface remains the only painted background even when GMGN supplies inline `!important` background declarations.

- [ ] **Step 4: Run the focused CSS/layout tests and verify RED**

Run:

```powershell
node --test tests/content-structure.test.js
node --test --test-name-pattern="headless Chrome measures quick-buy geometry|hostile native presentation|painted background" tests/gmgn-adapter.test.js
```

Expected: static tests fail on `min-height: 0` and missing wrapper containment; the hostile 16 px fixture reports clipping; the inline background test reports copied background styles/classes.

- [ ] **Step 5: Apply the scoped CSS correction**

Change only these declarations in `src/content/content.css`:

```css
.BuyButton-continer.tango-native-buy-overridden {
  min-height: var(--tango-quick-buy-height, 28px) !important;
}
.BuyButton-continer.tango-native-buy-overridden [class~="group/btn"] {
  min-height: var(--tango-quick-buy-height, 28px) !important;
}
.tango-list-quick-buy {
  min-height: var(--tango-quick-buy-height, 28px) !important;
}
.tango-quick-buy-content {
  border-radius: inherit;
  box-sizing: border-box;
  flex: 0 1 100% !important;
  min-width: 0 !important;
  overflow: hidden;
}
```

Retain slot `overflow: hidden`, outer `height/width: 100%`, outer `pointer-events: auto`, current `16%` theme mix, current `24%` hover mix, and every pointer/visibility/native-isolation rule in `quick-buy-safety.css`.

Mirror only the canonical minimum-height ownership in `src/content/quick-buy-safety.css` because it loads later with higher specificity:

```css
html:not(.tango-paper-native-quick-buy-allowed) .BuyButton-continer[data-tango-quick-buy="1"],
html:not(.tango-paper-native-quick-buy-allowed) .BuyButton-continer[data-tango-quick-buy="1"] [class~="group/btn"],
html:not(.tango-paper-native-quick-buy-allowed) .BuyButton-continer[data-tango-quick-buy="1"] .tango-list-quick-buy,
html:not(.tango-paper-native-quick-buy-allowed) [data-sentry-component="BuyButtons"] .tango-list-quick-buy {
  min-height: var(--tango-quick-buy-height, 28px) !important;
}
```

It is acceptable to place the declaration inside the existing four rules instead of adding a grouped rule. Do not alter any `pointer-events`, `visibility`, native selector, publication selector, width, height, alignment, or padding declaration in the safety file.

- [ ] **Step 6: Prevent native backgrounds from overriding the owned surface**

In `safeQuickBuyPresentationClass` and `isStableQuickBuyPresentationClass`, remove `bg`, `from`, `via`, and `to` from allowed shared presentation classes. In `safeQuickBuyStyleProperty`, remove `background`, `background-color`, and `background-image`; continue allowing `--customize-button-ultra-color`, text color, border, radius, outline, shadow, fill, and stroke.

Do not clear all inline styles. `applyInertPresentation` must continue to preserve the filtered radius/border/color/theme-variable presentation and call `ensureInertQuickBuy`.

- [ ] **Step 7: Run structure, geometry, adapter, and safety tests**

Run:

```powershell
node --test tests/content-structure.test.js tests/gmgn-adapter.test.js tests/native-quick-buy-guard.test.js tests/gmgn-quick-buy-world-integration.test.js
git diff --check -- src/content/content.css src/content/quick-buy-safety.css src/adapters/gmgn.js tests/content-structure.test.js tests/gmgn-adapter.test.js
```

Expected: all selected tests pass; the safety cascade still gives the published paper control `pointer-events:auto` and native controls zero reachability; no test invokes a live browser page or real trade.

---

### Task 3: Full regression, build, and package identity

**Files:**
- Verify: `src/adapters/gmgn.js`
- Verify: `src/content/content.css`
- Verify: `src/content/quick-buy-safety.css`
- Generate: `dist/tango-paper-trader/**` through `npm.cmd run build`
- Verify: all `tests/*.test.js` and `scripts/validate-extension.js`

**Interfaces:**
- Consumes: the source implementation and the repository's existing validator/build scripts.
- Produces: a loadable unpacked extension whose packaged source is byte-identical to the verified source tree.
- Preserves: every feature outside the approved live-size UI correction.

- [ ] **Step 1: Run the focused no-real-funds regression set**

Run:

```powershell
node --test tests/native-quick-buy-guard.test.js tests/gmgn-quick-buy-world-integration.test.js tests/gmgn-adapter.test.js tests/content-structure.test.js
```

Expected: all pass, including one paper callback/zero native callbacks, action identity stability, four-size propagation, late/new-card behavior, clipping geometry, and hostile-background filtering.

- [ ] **Step 2: Run repository validation before building**

Run:

```powershell
npm.cmd run check
git diff --check
```

Expected: validator exits `0`; the static paper-only safety scan finds no wallet/RPC/signing/approval/swap/WebSocket capability; `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Run the complete source test suite**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass. If Windows headless Chrome reproduces the known GPU startup failure, capture the exact failing test count and stderr, then rerun all non-headless tests plus the focused headless test separately; do not report the suite as fully green unless its exit code is `0`.

- [ ] **Step 4: Build the unpacked extension**

Run only after Steps 1-3 are acceptable:

```powershell
npm.cmd run build
```

Expected output:

```text
Built unpacked extension at D:\web3\code_project\tango-paper-trade\.worktrees\codex-gmgn-ui-safety\dist\tango-paper-trader
```

- [ ] **Step 5: Re-run validation and tests against the built state**

Run:

```powershell
npm.cmd run check
node --test tests/native-quick-buy-guard.test.js tests/gmgn-quick-buy-world-integration.test.js tests/gmgn-adapter.test.js tests/content-structure.test.js
```

Expected: all commands exit `0` after the build.

- [ ] **Step 6: Verify every packaged source file is byte-identical**

Run:

```powershell
$sourceFiles = Get-ChildItem -LiteralPath 'src' -Recurse -File
$mismatches = foreach ($sourceFile in $sourceFiles) {
  $relative = [System.IO.Path]::GetRelativePath((Resolve-Path 'src'), $sourceFile.FullName)
  $builtFile = Join-Path 'dist/tango-paper-trader/src' $relative
  if (-not (Test-Path -LiteralPath $builtFile)) {
    "missing: $relative"
    continue
  }
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceFile.FullName).Hash
  $builtHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $builtFile).Hash
  if ($sourceHash -ne $builtHash) { "mismatch: $relative" }
}
if ($mismatches) { $mismatches; throw 'Source/dist hash verification failed.' }
"Verified $($sourceFiles.Count)/$($sourceFiles.Count) source files against dist."
```

Expected: every source file is present and SHA-256 identical in `dist/tango-paper-trader/src`.

- [ ] **Step 7: Perform the final scope and safety audit**

Run:

```powershell
git status --short
git diff --stat
git diff -- src/adapters/gmgn.js src/content/content.css src/content/quick-buy-safety.css tests/gmgn-adapter.test.js tests/content-structure.test.js
```

Confirm manually from the diff:

- only connected profile discovery/observation/cache/application, visual sanitization, scoped CSS, and tests changed;
- no click/order/quote/Engine/Guard/position/marker code changed;
- no native event dispatch, wallet operation, permission, endpoint, or WebSocket was added;
- all pre-existing unrelated staged and unstaged changes remain present;
- the load directory is `D:\web3\code_project\tango-paper-trade\.worktrees\codex-gmgn-ui-safety\dist\tango-paper-trader`.
