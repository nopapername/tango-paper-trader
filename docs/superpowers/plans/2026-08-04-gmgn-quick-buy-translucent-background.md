# GMGN Paper Quick-Buy Translucent Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every trench paper quick-buy button a consistent semitransparent accent background while leaving all behavior and geometry unchanged.

**Architecture:** A canonical CSS rule overrides copied GMGN solid/gradient backgrounds on `.tango-list-quick-buy` with a 38% accent color and raises only the background mixture to 50% on hover. Existing DOM replacement, button profiles, pointer handling, paper-action guards, and active/in-flight state behavior remain untouched.

**Tech Stack:** Chrome Extension Manifest V3, CSS Color 5 `color-mix()`, Node.js `node:test` static structure tests.

## Global Constraints

- Only `src/content/content.css`, its generated `dist` copy, and the directly corresponding CSS structure test may change for this requirement.
- Normal background opacity is approximately 38%; hover background opacity is approximately 50%.
- Do not apply whole-element opacity in the base or hover rule; text and icons remain fully opaque.
- Do not change dimensions, layout, typography, alignment, hit area, pointer events, button lifecycle, action binding, or native-control safety.
- Do not modify any quote, trade, position, balance, PnL, marker, popup, dashboard, or detail-panel behavior.
- The worktree contains pre-existing source and index changes. Preserve them and do not create a source commit that would absorb unrelated changes.

---

### Task 1: Lock the translucent visual contract with a failing CSS test

**Files:**
- Modify: `tests/content-structure.test.js:241-300`
- Test: `tests/content-structure.test.js`

**Interfaces:**
- Consumes: Existing `cssSource` and the canonical `.tango-list-quick-buy` / hover rules.
- Produces: A static regression test that detects solid backgrounds, missing hover contrast, or whole-button opacity.

- [ ] **Step 1: Add the failing CSS contract test**

Add beside the existing quick-buy presentation tests:

```js
test('paper quick-buy uses only a translucent accent background without fading its content', () => {
  const buttonRule = cssSource.match(/(?:^|\n)\.tango-list-quick-buy\s*\{([^}]*)\}/)?.[1] || '';
  const hoverRule = cssSource.match(/\.tango-list-quick-buy:hover\s*\{([^}]*)\}/)?.[1] || '';
  const fallbackRule = cssSource.match(/\.tango-quick-buy-fallback\s*\{([^}]*)\}/)?.[1] || '';
  assert.ok(buttonRule && hoverRule && fallbackRule);
  assert.match(
    buttonRule,
    /background:\s*color-mix\(in srgb,\s*var\(--customize-button-ultra-color,\s*#[0-9a-f]{6}\)\s*38%,\s*transparent\)\s*!important/i
  );
  assert.match(
    hoverRule,
    /background:\s*color-mix\(in srgb,\s*var\(--customize-button-ultra-color,\s*#[0-9a-f]{6}\)\s*50%,\s*transparent\)\s*!important/i
  );
  assert.doesNotMatch(buttonRule, /(?:^|;)\s*opacity\s*:/);
  assert.doesNotMatch(hoverRule, /(?:^|;)\s*opacity\s*:/);
  assert.doesNotMatch(fallbackRule, /background\s*:/);
});
```

Update the existing fallback presentation assertion from requiring `background: transparent` to requiring no fallback-specific background declaration. Keep its color, geometry, border, and typography assertions unchanged.

- [ ] **Step 2: Run the structure test and verify RED**

Run:

```powershell
node --test tests/content-structure.test.js
```

Expected: FAIL because the canonical base/hover semitransparent backgrounds are absent and the fallback still declares a transparent background.

---

### Task 2: Apply the CSS-only translucent background

**Files:**
- Modify: `src/content/content.css:39-71`
- Test: `tests/content-structure.test.js`

**Interfaces:**
- Consumes: `--customize-button-ultra-color` copied by the existing safe presentation sanitizer, with a fixed blue fallback.
- Produces: Canonical base and hover background rules shared by all quick-buy size profiles.

- [ ] **Step 1: Add the canonical 38% base background**

Add only this declaration inside the existing `.tango-list-quick-buy` rule:

```css
background: color-mix(in srgb, var(--customize-button-ultra-color, #288cff) 38%, transparent) !important;
```

Do not alter any adjacent geometry, flex, pointer, position, transform, width, height, padding, overflow, or z-index declaration.

- [ ] **Step 2: Make hover change only the background strength**

Replace the current hover rule with:

```css
.tango-list-quick-buy:hover {
  background: color-mix(in srgb, var(--customize-button-ultra-color, #288cff) 50%, transparent) !important;
  filter: brightness(1.12);
}
```

Keep the existing active and in-flight opacity rules unchanged because they represent interaction state, not the base background.

- [ ] **Step 3: Remove the fallback-specific transparent background**

Change:

```css
.tango-quick-buy-fallback { background: transparent; color: inherit; }
```

to:

```css
.tango-quick-buy-fallback { color: inherit; }
```

This makes fallback and fully copied buttons share the same canonical background without changing fallback geometry or text color.

- [ ] **Step 4: Run the structure test and verify GREEN**

Run:

```powershell
node --test tests/content-structure.test.js
```

Expected: all structure tests PASS, including size, centering, full hit-area, and native-control fail-closed assertions.

- [ ] **Step 5: Run focused quick-buy behavior tests**

Run:

```powershell
node --test tests/gmgn-adapter.test.js tests/native-quick-buy-guard.test.js tests/gmgn-quick-buy-world-integration.test.js
```

Expected: all tests PASS; a CSS-only change has not altered action binding, replacement lifecycle, size profiles, or real-button isolation.

- [ ] **Step 6: Inspect the CSS task diff without changing the existing index**

Run:

```powershell
git diff --check -- src/content/content.css tests/content-structure.test.js
git diff -- src/content/content.css tests/content-structure.test.js
```

Expected: only two background declarations, fallback background removal, and the directly corresponding assertions are new relative to the pre-task worktree.

---

### Task 3: Verify and build with the quote plan

**Files:**
- Regenerate: `dist/tango-paper-trader/src/content/content.css`
- Verify: all project tests and extension validation

**Interfaces:**
- Consumes: Tasks 1-2 and the separate click-time detail quote implementation plan.
- Produces: The final unpacked extension with both approved changes.

- [ ] **Step 1: Run the combined full suite**

Run:

```powershell
npm test
npm run check
```

Expected: all tests and safety validation pass with no wallet or transaction capabilities.

- [ ] **Step 2: Regenerate and revalidate the unpacked extension**

Run:

```powershell
npm run build
npm run check
```

Expected: the built CSS contains the same 38%/50% rules and `dist/tango-paper-trader` passes validation.

- [ ] **Step 3: Confirm final scope**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; the final handoff calls out the CSS-only UI scope and the existing Chrome “Load unpacked” directory.
