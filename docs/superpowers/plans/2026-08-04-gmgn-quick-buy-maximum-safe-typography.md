# GMGN Quick-Buy Maximum-Safe Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enlarge both rows of the paper quick-buy text to the maximum approved safe profile while retaining GMGN-owned geometry and every existing trading/safety behavior.

**Architecture:** Keep `.tango-list-quick-buy` as the unchanged full-slot click owner and change only the Tango-owned inner typography CSS. Extend the existing real-Chrome direct/nested fixtures and pixel oracle first, then generate the unpacked extension from the verified source.

**Tech Stack:** Chrome MV3 extension, plain CSS/JavaScript, Node.js `node:test`, headless Google Chrome, PowerShell SHA-256 verification.

## Global Constraints

- Production edits are limited to `src/content/content.css` and its generated copy at `dist/tango-paper-trader/src/content/content.css`; no production JavaScript changes.
- Target label/amount font sizes are `8/11px`, `9/12px`, `9/13px`, and `10/14px` for small, large, extra-large, and giant.
- Both rows use `line-height: 0.9`; the owned wrapper uses exactly `0 2px` padding and therefore no vertical padding.
- If actual Chrome glyph ink clips or overlaps, reduce only the failing profile in `0.5px` increments to the largest passing value; never enlarge GMGN geometry.
- Preserve the GMGN card, operation row, host, slot, full paper hit area, and following-card geometry.
- Preserve quick-buy discovery, publication, identity, quote, amount, balance, position, chain, navigation, click, hover, focus, in-flight, and real-funds protection behavior.
- Keep the inner content pointer-inert, the paper outer button clickable, and the real GMGN control hidden and non-interactive.
- Do not click any real or paper trading control during verification.
- Do not create an implementation commit automatically: the touched files already contain prior approved accumulated changes and require a final scoped review before commit.

---

### Task 1: Maximum-safe two-line typography

**Files:**
- Modify: `tests/gmgn-adapter.test.js:234-658`
- Modify: `tests/content-structure.test.js:245-269`
- Modify: `src/content/content.css:66-147`
- Generate: `dist/tango-paper-trader/src/content/content.css`
- Verify: `src/content/quick-buy-safety.css` remains unchanged by this task

**Interfaces:**
- Consumes: Existing `.tango-list-quick-buy[data-tango-quick-buy-size]`, `.tango-quick-buy-content`, `.tango-paper-hint`, and `.tango-buy-amount` DOM/CSS contracts.
- Produces: Four literal computed typography profiles and a real-Chrome pixel proof that both rendered text rows remain complete and non-overlapping inside the unchanged paper hit area.

- [ ] **Step 1: Extend the real-Chrome telemetry with independently derived visual expectations**

In `tests/gmgn-adapter.test.js`, keep every existing geometry and safety assertion. Add computed line-height and wrapper-padding telemetry beside the current font telemetry:

```js
const wrapperStyle = getComputedStyle(wrapper);
return {
  // retain every existing field
  fontSize: Number.parseFloat(wrapperStyle.fontSize),
  hintFontSize: Number.parseFloat(hintStyle.fontSize),
  amountFontSize: Number.parseFloat(amountStyle.fontSize),
  hintLineHeight: Number.parseFloat(hintStyle.lineHeight),
  amountLineHeight: Number.parseFloat(amountStyle.lineHeight),
  wrapperPadding: [
    Number.parseFloat(wrapperStyle.paddingTop),
    Number.parseFloat(wrapperStyle.paddingRight),
    Number.parseFloat(wrapperStyle.paddingBottom),
    Number.parseFloat(wrapperStyle.paddingLeft)
  ]
};
```

Replace the old literal font maps with the approved values and derive only the line-height pixels from those independent literals:

```js
const expectedAmountFont = { small: 11, large: 12, 'extra-large': 13, giant: 14 };
const expectedHintFont = { small: 8, large: 9, 'extra-large': 9, giant: 10 };
const closeTo = (actual, expected) => Math.abs(actual - expected) <= 0.01;

assert.equal(control.fontSize, expectedAmountFont[state.profile]);
assert.equal(control.amountFontSize, expectedAmountFont[state.profile]);
assert.equal(control.hintFontSize, expectedHintFont[state.profile]);
assert.equal(closeTo(control.amountLineHeight, expectedAmountFont[state.profile] * 0.9), true);
assert.equal(closeTo(control.hintLineHeight, expectedHintFont[state.profile] * 0.9), true);
assert.deepEqual(control.wrapperPadding, [0, 2, 0, 2]);
```

The production mutations these assertions catch are a profile reverting to its smaller font, a row reverting to natural line height, or horizontal padding being removed/replaced with vertical padding.

- [ ] **Step 2: Add a real glyph-ink overlap gate**

Add an image helper next to `missingColoredInk` that compares separately rendered label and amount layers at identical coordinates:

```js
function overlappingColoredInk(labelImage, amountImage) {
  assert.equal(labelImage.width, amountImage.width, 'ink layers share a viewport');
  assert.equal(labelImage.height, amountImage.height, 'ink layers share a viewport');
  let overlap = 0;
  for (let index = 0; index < labelImage.pixels.length; index += 4) {
    const [labelR, labelG, labelB] = labelImage.pixels.subarray(index, index + 3);
    const [amountR, amountG, amountB] = amountImage.pixels.subarray(index, index + 3);
    const labelInk = labelR > 180 && labelG < 100 && labelB > 180;
    const amountInk = amountG > 140 && amountR < 100 && amountB < 100;
    if (labelInk && amountInk) overlap += 1;
  }
  return overlap;
}
```

Extend only the test-page paint CSS so `label-ink` hides the amount and `amount-ink` hides the label without removing either element from layout. Add a positive-control amount layer shifted upward in the test page only:

```css
body.tango-pixel-label-ink .tango-buy-amount { visibility: hidden !important; }
body.tango-pixel-amount-ink .tango-paper-hint,
body.tango-pixel-amount-overlap .tango-paper-hint { visibility: hidden !important; }
body.tango-pixel-amount-overlap .tango-buy-amount {
  transform: translateY(calc(-.45em - 4px)) !important;
}
```

Add this browser-level test with literal profile inputs:

```js
test('headless Chrome keeps enlarged label and amount glyph ink on separate rows', () => {
  const geometry = (report) => report.layout.states.flatMap((state) => state.controls.map((control) => [
    control.paper, control.wrapper, control.hint, control.amount
  ]));
  for (const profile of ['small', 'large', 'extra-large', 'giant']) {
    const label = headlessGmgnOwnedQuickBuyLayoutReport({ paintMode: 'label-ink', paintProfile: profile });
    const amount = headlessGmgnOwnedQuickBuyLayoutReport({ paintMode: 'amount-ink', paintProfile: profile });
    const positive = headlessGmgnOwnedQuickBuyLayoutReport({ paintMode: 'amount-overlap', paintProfile: profile });
    assert.deepEqual(geometry(label), geometry(amount), `${profile}: ink layers use identical geometry`);
    assert.equal(overlappingColoredInk(label.image, amount.image), 0,
      `${profile}: real label and amount glyph ink must not overlap`);
    assert.ok(overlappingColoredInk(label.image, positive.image) > 0,
      `${profile}: shifted test-only amount proves the overlap detector is sensitive`);
  }
});
```

The responsive test-only transform aligns the amount toward the label across all four amount fonts. It exists only inside the isolated test HTML and never enters extension CSS.

- [ ] **Step 3: Update the existing static safety contract before production CSS**

In `tests/content-structure.test.js`, change only the owned inner typography expectations:

```js
assert.match(wrapperRule, /\bfont-size:\s*var\(--tango-quick-buy-display-text,\s*11px\)\s*!important/);
assert.match(wrapperRule, /\bline-height:\s*\.9\s*!important/);
assert.match(wrapperRule, /\bpadding:\s*0\s+2px\s*!important/);
assert.match(hintRule, /\bfont-size:\s*var\(--tango-quick-buy-label-text,\s*8px\)\s*!important/);
assert.match(hintRule, /\bline-height:\s*\.9\s*!important/);
assert.match(amountRule, /\bline-height:\s*\.9\s*!important/);
```

Retain the existing rules that forbid profile height from controlling GMGN geometry and that keep the inner layer pointer-inert.

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="headless Chrome matches|headless Chrome keeps enlarged" tests/gmgn-adapter.test.js
node --test --test-name-pattern="paper quick-buy content fills" tests/content-structure.test.js
```

Expected: the first command fails because current computed font profiles remain `7/10`, `8/11`, `8/12`, and `9/13`; the second fails because the current wrapper still has `line-height: 1`, `padding: 0`, and smaller fallback fonts. A syntax error, missing Chrome executable, timeout, or fixture crash is not an acceptable RED result.

- [ ] **Step 5: Implement the minimal CSS-only change**

Update only the Tango-owned inner rules in `src/content/content.css`:

```css
.tango-quick-buy-content {
  /* keep all unrelated declarations unchanged */
  font-size: var(--tango-quick-buy-display-text, 11px) !important;
  line-height: .9 !important;
  padding: 0 2px !important;
}
.tango-list-quick-buy[data-tango-quick-buy-size="small"] {
  --tango-quick-buy-display-text: 11px;
  --tango-quick-buy-label-text: 8px;
}
.tango-list-quick-buy[data-tango-quick-buy-size="large"] {
  --tango-quick-buy-display-text: 12px;
  --tango-quick-buy-label-text: 9px;
}
.tango-list-quick-buy[data-tango-quick-buy-size="extra-large"] {
  --tango-quick-buy-display-text: 13px;
  --tango-quick-buy-label-text: 9px;
}
.tango-list-quick-buy[data-tango-quick-buy-size="giant"] {
  --tango-quick-buy-display-text: 14px;
  --tango-quick-buy-label-text: 10px;
}
.tango-paper-hint {
  /* keep all unrelated declarations unchanged */
  font-size: var(--tango-quick-buy-label-text, 8px) !important;
  line-height: .9 !important;
}
.tango-buy-amount,
.tango-buy-amount > span {
  /* retain their existing separate rules and change only this value */
  line-height: .9 !important;
}
```

Do not edit `.tango-list-quick-buy` geometry, `src/content/quick-buy-safety.css`, or any production JavaScript. If and only if the real-Chrome ink gate identifies one unsafe profile, reduce that profile's label and/or amount literal by `0.5px`, rerun that single profile, and retain the highest passing values.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="headless Chrome matches|headless Chrome pixel gate|headless Chrome keeps enlarged" tests/gmgn-adapter.test.js
node --test tests/content-structure.test.js tests/validate-extension.test.js
```

Expected: all focused tests exit `0`; every direct/nested profile preserves GMGN geometry, complete text, separate real glyph ink, outer clickability, and native-control isolation.

- [ ] **Step 7: Run adapter and full behavior regression suites**

Run:

```powershell
node --test tests/gmgn-adapter.test.js
npm.cmd test
npm.cmd run check
```

Expected: all commands exit `0` with zero failed tests and no extension validation errors.

- [ ] **Step 8: Build the unpacked extension and verify source/package parity**

Run:

```powershell
npm.cmd run build
$sourceFiles = Get-ChildItem -LiteralPath 'src' -Recurse -File
$mismatches = foreach ($sourceFile in $sourceFiles) {
  $relative = [System.IO.Path]::GetRelativePath((Resolve-Path 'src'), $sourceFile.FullName)
  $builtFile = Join-Path 'dist/tango-paper-trader/src' $relative
  if (-not (Test-Path -LiteralPath $builtFile)) { "missing: $relative"; continue }
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceFile.FullName).Hash
  $builtHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $builtFile).Hash
  if ($sourceHash -ne $builtHash) { "mismatch: $relative" }
}
if ($mismatches) { $mismatches; throw 'Source/dist hash verification failed.' }
"Verified $($sourceFiles.Count)/$($sourceFiles.Count) source files against dist."
```

Expected: build exits `0`, every source file exists in `dist/tango-paper-trader/src`, and all SHA-256 hashes match.

- [ ] **Step 9: Repeat post-build verification and audit exact scope**

Run:

```powershell
npm.cmd test
npm.cmd run check
git diff --check -- src/content/content.css dist/tango-paper-trader/src/content/content.css tests/gmgn-adapter.test.js tests/content-structure.test.js
git diff --stat -- src/content/content.css dist/tango-paper-trader/src/content/content.css tests/gmgn-adapter.test.js tests/content-structure.test.js
git diff -- src/content/content.css dist/tango-paper-trader/src/content/content.css tests/gmgn-adapter.test.js tests/content-structure.test.js
```

Expected: tests and validation exit `0`, whitespace check is clean, no production JavaScript appears in this task's scope, and the implementation diff is ready for user review without committing the accumulated file changes.
