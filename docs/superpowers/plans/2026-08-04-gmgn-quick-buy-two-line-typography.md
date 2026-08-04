# GMGN Quick-Buy Two-Line Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enlarge the paper quick-buy text by placing the localized paper label and native amount on two centered lines without changing any existing behavior.

**Architecture:** Keep GMGN as the sole owner of card, action-row, slot, and host geometry. Change only the Tango-owned inner content CSS, and protect the behavior with the existing real-Chrome layout fixture plus static safety contracts.

**Tech Stack:** Chrome MV3 extension, plain JavaScript, CSS, Node.js `node:test`, headless Chrome.

## Global Constraints

- Production changes are limited to `src/content/content.css` and the generated copy in `dist/tango-paper-trader`; do not modify JavaScript.
- Preserve all quick-buy binding, quote, amount, balance, position, execution, chain, lifecycle, publication, click, hover, focus, and in-flight behavior.
- Preserve native GMGN controls as `visibility: hidden` and `pointer-events: none` while paper quick buy is active.
- Do not impose width or height on GMGN slot, host, action row, or card geometry.
- Do not use absolute positioning, negative margins, transforms, or visible overflow to enlarge content.
- Do not click real or paper trade controls during verification.
- The full existing test suite must finish with zero failures before delivery.

---

### Task 1: Two-line quick-buy typography

**Files:**
- Modify: `tests/gmgn-adapter.test.js:250-540`
- Modify: `tests/content-structure.test.js:245-310`
- Modify: `src/content/content.css:65-150`
- Generate: `dist/tango-paper-trader/src/content/content.css`

**Interfaces:**
- Consumes: Existing `.tango-list-quick-buy[data-tango-quick-buy-size]`, `.tango-quick-buy-content`, `.tango-paper-hint`, and `.tango-buy-amount` DOM/CSS contracts.
- Produces: Two non-overlapping centered rows whose size profile is `label 7/8/8/9px` and `amount 10/11/12/13px` for small/large/extra-large/giant.

- [ ] **Step 1: Extend the real-Chrome regression fixture before changing production CSS**

Add the following telemetry beside the existing wrapper, hint, and amount rectangles in `tests/gmgn-adapter.test.js`:

```js
const hintStyle = getComputedStyle(hint);
const amountStyle = getComputedStyle(amount);
return {
  // retain every existing field
  hint: hintRect,
  amount: amountRect,
  hintFontSize: Number.parseFloat(hintStyle.fontSize),
  amountFontSize: Number.parseFloat(amountStyle.fontSize),
  rowsDoNotOverlap: hintRect.bottom <= amountRect.top + 0.5,
  textLayerPointerEvents: getComputedStyle(wrapper).pointerEvents
};
```

Change the expected visible font profiles and add the two-line assertions:

```js
const expectedAmountFont = { small: 10, large: 11, 'extra-large': 12, giant: 13 };
const expectedHintFont = { small: 7, large: 8, 'extra-large': 8, giant: 9 };

assert.equal(control.fontSize, expectedAmountFont[state.profile]);
assert.equal(control.amountFontSize, expectedAmountFont[state.profile]);
assert.equal(control.hintFontSize, expectedHintFont[state.profile]);
assert.equal(control.rowsDoNotOverlap, true,
  `${state.fixture}/${state.profile}: paper label and amount use separate rows`);
assert.equal(control.textLayerPointerEvents, 'none',
  `${state.fixture}/${state.profile}: inner text cannot steal the outer paper click`);
```

Retain all existing assertions for text Range containment, `scrollWidth <= clientWidth`, wrapper/outer equal dimensions, GMGN geometry, virtual clickability, and native-control isolation.

- [ ] **Step 2: Update the static CSS contract before production CSS**

In `tests/content-structure.test.js`, require the owned wrapper to use column layout and inert inner content, and require the label to use its profile variable:

```js
assert.match(wrapperRule, /\bflex-direction:\s*column\s*!important/);
assert.match(wrapperRule, /\bpointer-events:\s*none\s*!important/);
assert.match(wrapperRule, /\bgap:\s*0\s*!important/);
assert.match(hintRule, /\bfont-size:\s*var\(--tango-quick-buy-label-text,\s*7px\)\s*!important/);
```

Keep the existing assertions that the wrapper is `100%` wide/high and that no profile height becomes GMGN layout geometry.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="headless Chrome matches" tests/gmgn-adapter.test.js
node --test --test-name-pattern="paper quick-buy content fills" tests/content-structure.test.js
```

Expected: both commands fail because the current wrapper is a horizontal row, the first three amount fonts are `9/10/11px`, and the inner text layer still receives pointer events.

- [ ] **Step 4: Implement the minimal CSS-only two-line layout**

Update only the Tango-owned rules in `src/content/content.css`:

```css
.tango-quick-buy-content {
  flex-direction: column !important;
  gap: 0 !important;
  padding: 0 !important;
  pointer-events: none !important;
}

.tango-list-quick-buy[data-tango-quick-buy-size="small"] {
  --tango-quick-buy-display-text: 10px;
  --tango-quick-buy-label-text: 7px;
}
.tango-list-quick-buy[data-tango-quick-buy-size="large"] {
  --tango-quick-buy-display-text: 11px;
  --tango-quick-buy-label-text: 8px;
}
.tango-list-quick-buy[data-tango-quick-buy-size="extra-large"] {
  --tango-quick-buy-display-text: 12px;
  --tango-quick-buy-label-text: 8px;
}
.tango-list-quick-buy[data-tango-quick-buy-size="giant"] {
  --tango-quick-buy-display-text: 13px;
  --tango-quick-buy-label-text: 9px;
}

.tango-paper-hint {
  border: 0;
  font-size: var(--tango-quick-buy-label-text, 7px) !important;
  line-height: 1 !important;
  padding: 0 1px;
}
```

Do not touch `.tango-list-quick-buy` hit-area geometry or `quick-buy-safety.css`. If headless Chrome reports a one-pixel vertical Range overflow, reduce only the affected line-height or font by `0.5px`; do not change GMGN-owned geometry.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="headless Chrome matches" tests/gmgn-adapter.test.js
node --test tests/content-structure.test.js tests/validate-extension.test.js
```

Expected: all focused tests pass; all four profiles retain complete text, separate rows, full wrapper dimensions, and unchanged native-control safety.

- [ ] **Step 6: Verify the complete adapter and extension behavior**

Run:

```powershell
node --test tests/gmgn-adapter.test.js
npm.cmd test
npm.cmd run check
```

Expected: `gmgn-adapter.test.js` passes, the full suite reports zero failures, and extension validation reports a valid manifest with all referenced files present.

- [ ] **Step 7: Build and prove the unpacked extension matches source**

Run:

```powershell
npm.cmd run build
```

Then compare every file below `src` with its generated counterpart below `dist/tango-paper-trader/src` using SHA-256. Expected: no missing files and no hash mismatches. Run `npm.cmd test` and `npm.cmd run check` once more after the build.

- [ ] **Step 8: Review the exact scope before handoff**

Run:

```powershell
git diff --check -- src/content/content.css dist/tango-paper-trader/src/content/content.css tests/content-structure.test.js tests/gmgn-adapter.test.js
git diff --stat -- src/content/content.css dist/tango-paper-trader/src/content/content.css tests/content-structure.test.js tests/gmgn-adapter.test.js
```

Expected: no whitespace errors, no JavaScript production file in this task's diff, and only the CSS source, generated CSS, and regression-test files changed for implementation.

- [ ] **Step 9: Commit only after the overlapping worktree scope is reviewed**

Because these files already contain prior approved uncommitted fixes, do not create an implementation commit automatically. First show the exact diff to the user; commit only if the user explicitly asks to include the accumulated changes in this branch.
