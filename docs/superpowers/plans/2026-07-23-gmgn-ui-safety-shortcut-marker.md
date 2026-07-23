# GMGN UI Safety, Shortcut, Onboarding, and Marker Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tango quick-buy controls resilient to every GMGN button size and virtual-card lifecycle, add safe onboarding/link/shortcut behavior, and place paper-trade chart markers only from current trustworthy axis data.

**Architecture:** The GMGN adapter will derive an inert visual shell from the live native control and reconcile bindings by identity plus a sanitized presentation signature instead of inferred height classes. Shared constants and background messages will own generic GMGN navigation and the master toggle, while onboarding and popup stay synchronized through storage. The chart bridge will version and expire captured axis labels so stale canvas scales cannot place markers.

**Tech Stack:** Manifest V3 Chrome extension, dependency-free browser JavaScript, Node.js built-in test runner, custom extension validator/build scripts.

## Global Constraints

- Apply to Solana, Ethereum, BNB Chain, Base, Robinhood Chain, and X Layer.
- Generic GMGN links must be exactly `https://gmgn.ai/r/X9cuc5jd?chain=bsc`; token-specific links must remain exact token URLs.
- The shortcut is `Alt+Shift+P` and toggles only `settings.enabled`.
- Never call a GMGN native trade listener, wallet, signature, approval, swap, RPC broadcast, or any real-money path.
- Keep quote, supply, quantity, fee, and fallback valuation rules unchanged.
- Use test-driven development: observe each new regression test fail before changing production code.

---

### Task 1: Safe quick-buy presentation and card lifecycle

**Files:**
- Modify: `src/adapters/gmgn.js`
- Modify: `src/content/content.js`
- Modify: `src/content/content.css`
- Modify: `src/content/page-main.js`
- Test: `tests/gmgn-adapter.test.js`
- Test: `tests/content-runtime.test.js`
- Test: `tests/page-main.test.js`

**Interfaces:**
- Produces: `presentationSignature(control): string`, `applyInertPresentation(replacement, nativeControl): string`, `quickBuyHealth(): { drifted: boolean }`, and strengthened `discoverTokenCards(...)` reconciliation.
- Preserves: `discoverTokenCards(onQuickBuy, defaultAmountNative, paperLabel, roots): number` and `PAPER_QUICK_BUY_CLICK` message contract.

- [ ] **Step 1: Write failing adapter tests**

Add tests that construct native controls with four distinct class/style presentations and assert the replacement copies each presentation without `quickBuySize`, fixed pixel height, `data-testid`, `href`, `formaction`, `target`, `id`, inline `on*` attributes, child nodes, or native listeners. Add a 22 px then 113 px transition test that changes native class/style, recreates the native leaf, and expects the existing paper binding to adopt the new presentation signature and remove the recreated native control.

- [ ] **Step 2: Write failing lifecycle and safety tests**

Add cases for React replacing Tango classes while leaving `data-*`, zero-size recovery, a newly inserted card, whole-card replacement, and virtual-list reuse with a changed address. Attach sentinel listeners to the native leaf and card ancestor; dispatch pointer, click, Enter, and Space at the Tango control and assert exactly one paper action per activation window and zero sentinel calls.

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/page-main.test.js`

Expected: FAIL because presentation signatures, reconciliation health checks, current-card rebinding, or keyboard interception are absent.

- [ ] **Step 4: Implement the minimal inert-shell contract**

In `src/adapters/gmgn.js`, replace height-based `quickBuySize` and `syncQuickBuyGeometry` with helpers that copy only `className` and visual inline style text, sanitize action-capable attributes, force `button.type = 'button'`, add Tango-owned classes/data after copying, and build fresh Tango child spans. Store the presentation signature on each binding, reassert Tango lifecycle classes/data on every discovery, refresh presentation when signature changes, observe the slot plus immediate wrapper, and remove any native `[data-testid="quickbuy"]` before considering a binding healthy.

- [ ] **Step 5: Implement drift-triggered recovery and capture safety**

In `src/content/content.js`, retain incremental mutation roots and add a 750 ms cheap health probe that invokes a full discovery only if a native leaf reappears, a tracked replacement disconnects, or an eligible visible slot lacks a valid binding. In `src/content/page-main.js`, intercept `pointerdown`, `pointerup`, `click`, and keyboard activation in capture phase with `preventDefault`, `stopPropagation`, and `stopImmediatePropagation`, publishing only a validated Tango action ID. In CSS, keep inner Tango text responsive with `font: inherit`, `min-width: 0`, and overflow rules while removing fixed outer geometry overrides.

- [ ] **Step 6: Run focused and full tests; commit**

Run: `node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/page-main.test.js`

Expected: PASS, including zero native sentinel calls and all lifecycle cases.

Run: `npm.cmd test`

Expected: all tests PASS.

Commit: `git add src/adapters/gmgn.js src/content/content.js src/content/content.css src/content/page-main.js tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/page-main.test.js && git commit -m "fix: harden GMGN paper quick buy controls"`

### Task 2: Shared GMGN referral entry and verified onboarding completion

**Files:**
- Modify: `src/shared/constants.js`
- Modify: `src/shared/i18n.js`
- Modify: `src/background.js`
- Modify: `src/dashboard/dashboard.js`
- Modify: `src/popup/popup.js`
- Test: `tests/background.test.js`
- Test: `tests/dashboard-runtime.test.js`
- Test: `tests/popup-runtime.test.js`

**Interfaces:**
- Produces: `Tango.GMGN_ENTRY_URL`, background message `TANGO_OPEN_GMGN`, localized `onboardingCapitalAllocation` text.
- Preserves: `TANGO_OPEN_TOKEN` for token-specific deep links.

- [ ] **Step 1: Write failing link and onboarding tests**

Assert every generic entry sends `TANGO_OPEN_GMGN`, the background opens only `Tango.GMGN_ENTRY_URL`, and `TANGO_OPEN_TOKEN` still accepts exact supported token URLs. Render onboarding with 10 then input 12.5 and assert the localized note lists `10/12.5 SOL`, Ethereum `ETH`, `BNB`, Base `ETH`, Robinhood `ETH`, and `OKB`. Assert successful verified reset sends `TANGO_OPEN_GMGN` before `close()`, while invalid input, failed reset, or failed read-back opens nothing and does not close.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/background.test.js tests/dashboard-runtime.test.js tests/popup-runtime.test.js`

Expected: FAIL because the shared URL/message, live allocation note, and open-before-close sequence do not exist.

- [ ] **Step 3: Implement shared navigation and dynamic onboarding copy**

Define `Tango.GMGN_ENTRY_URL = 'https://gmgn.ai/r/X9cuc5jd?chain=bsc'` in `src/shared/constants.js`. Add a background `TANGO_OPEN_GMGN` allowlisted handler that opens that exact constant. Update popup, dashboard generic action, and onboarding completion to use the message. Add a pure formatter using `Tango.Chains.all()` and update the onboarding note on both capital `input` and language `change` without resetting the typed value.

- [ ] **Step 4: Implement verified completion order**

After `resetAllWithBalance`, re-read storage, require all six initial/cash/settings balances to equal the finite positive value, await `TANGO_OPEN_GMGN`, then call `close()`. If the tab remains open, render the localized completion/open status. Surface verification/open failures without opening or closing early.

- [ ] **Step 5: Run focused and full tests; commit**

Run: `node --test tests/background.test.js tests/dashboard-runtime.test.js tests/popup-runtime.test.js`

Expected: PASS.

Run: `npm.cmd test`

Expected: all tests PASS.

Commit: `git add src/shared/constants.js src/shared/i18n.js src/background.js src/dashboard/dashboard.js src/popup/popup.js tests/background.test.js tests/dashboard-runtime.test.js tests/popup-runtime.test.js && git commit -m "feat: unify GMGN entry and onboarding handoff"`

### Task 3: Master keyboard shortcut and live switch synchronization

**Files:**
- Modify: `manifest.json`
- Modify: `src/background.js`
- Modify: `src/popup/popup.js`
- Test: `tests/background.test.js`
- Test: `tests/popup-runtime.test.js`
- Test: `tests/content-runtime.test.js`

**Interfaces:**
- Produces: command name `toggle-paper-trading`, suggested key `Alt+Shift+P`/`Alt+Shift+P`, serialized coordinator mutation of `{ type: 'PATCH_SETTINGS', patch: { enabled } }`.

- [ ] **Step 1: Write failing shortcut synchronization tests**

Assert manifest command registration, ignore unknown command names, toggle enabled true-to-false and false-to-true through the coordinator, serialize rapid invocations, and verify popup storage subscription rerenders the switch. Verify content storage subscription removes controls and emits empty chart markers when disabled, then reconstructs current route controls when enabled without reload.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/background.test.js tests/popup-runtime.test.js tests/content-runtime.test.js`

Expected: FAIL because the command and popup live storage listener are missing.

- [ ] **Step 3: Implement the command and subscriptions**

Add `commands.toggle-paper-trading.suggested_key.default = 'Alt+Shift+P'` and a localized description to `manifest.json`. In background, handle only `toggle-paper-trading`, read current normalized state through the coordinator, then mutate only `settings.enabled`. In popup, subscribe to local storage changes and reload normalized settings so the switch label/check state follows the shortcut while open; remove the listener on unload. Reuse the existing content settings transition lifecycle.

- [ ] **Step 4: Run focused and full tests; commit**

Run: `node --test tests/background.test.js tests/popup-runtime.test.js tests/content-runtime.test.js`

Expected: PASS.

Run: `npm.cmd test`

Expected: all tests PASS.

Commit: `git add manifest.json src/background.js src/popup/popup.js tests/background.test.js tests/popup-runtime.test.js tests/content-runtime.test.js && git commit -m "feat: add paper trading master shortcut"`

### Task 4: Current-generation chart axis fitting

**Files:**
- Modify: `src/content/chart-main.js`
- Test: `tests/markers.test.js`

**Interfaces:**
- Produces: per-canvas generation records, a 1,500 ms current-label window, bounded right-axis samples, and trustworthy scale rejection.
- Preserves: `CHART_MARKERS` payload and historical marker market-cap/price values.

- [ ] **Step 1: Write failing chart bridge tests**

Capture one stale scale followed by a new generation whose visible right-axis labels include approximately `$6.02K`; assert a `$6.028K` buy marker lands near that tick and not the stale scale. Add insufficient-label, excessive-residual, old-generation, left-axis, and more-than-one-tick extrapolation cases that expect no visible marker until a trustworthy current scale exists.

- [ ] **Step 2: Run the marker tests and verify RED**

Run: `node --test tests/markers.test.js`

Expected: FAIL because axis samples currently remain eligible for 120 seconds and are not generation/right-axis scoped.

- [ ] **Step 3: Implement bounded current-generation fitting**

Track a generation counter per canvas and bump it on meaningful redraw/clear boundaries. Store generation, x, y, value, and update time for each sample; retain only bounded unique recent right-axis positions. During selection, accept only the newest generation or samples refreshed within 1,500 ms, require enough unique labels, reject high residual fits, reset stable scale on a material mapping change, and allow at most one observed tick interval of extrapolation. If no candidate passes, clear/hide marker overlay rather than retaining stale Y positions.

- [ ] **Step 4: Run marker and full tests; commit**

Run: `node --test tests/markers.test.js`

Expected: PASS.

Run: `npm.cmd test`

Expected: all tests PASS.

Commit: `git add src/content/chart-main.js tests/markers.test.js && git commit -m "fix: anchor paper markers to current chart scale"`

### Task 5: Release validation and unpacked Chrome build

**Files:**
- Modify: `scripts/validate-extension.js`
- Modify: `tests/validate-extension.test.js`
- Modify: `docs/multichain-smoke-test.md`
- Generate: `dist/tango-paper-trader/**`

**Interfaces:**
- Verifies: shortcut manifest schema, shared referral URL, and continued absence of wallet/sign/swap/broadcast capabilities.

- [ ] **Step 1: Write failing static validation tests**

Assert the release validator requires the exact command and referral URL, rejects unsafe action attributes/listeners on the paper quick-buy path, and continues rejecting wallet/RPC/signature/approval/swap/broadcast code.

- [ ] **Step 2: Run validator tests and verify RED**

Run: `node --test tests/validate-extension.test.js`

Expected: FAIL because the new command/referral invariants are not statically validated.

- [ ] **Step 3: Implement validation and update the smoke checklist**

Extend `scripts/validate-extension.js` with exact command/referral checks. Add smoke steps for all four GMGN sizes, two-stage resizing, new and recycled cards, zero native-handler sentinel expectation, live onboarding amounts, `Alt+Shift+P` synchronization, GMGN-open-before-close, stale-axis rejection, disable cleanup, and six-chain independence.

- [ ] **Step 4: Run the complete pre-build gate**

Run: `npm.cmd test`

Expected: all tests PASS with no warnings/errors.

Run: `npm.cmd run check`

Expected: validator PASS and no real-money capability findings.

- [ ] **Step 5: Build and verify the unpacked directory**

Run: `npm.cmd run build`

Expected: `dist/tango-paper-trader` is regenerated successfully.

Run: `npm.cmd test`

Expected: all post-build tests PASS.

Compare every source file listed by `scripts/build.js` with its counterpart under `dist/tango-paper-trader` using SHA-256 and require no mismatch. Inspect `dist/tango-paper-trader/manifest.json` and require permissions remain limited to `storage`, the declared `commands`, and existing GMGN/CoinGecko/DexScreener hosts.

- [ ] **Step 6: Commit the release build**

Commit: `git add scripts/validate-extension.js tests/validate-extension.test.js docs/multichain-smoke-test.md dist/tango-paper-trader && git commit -m "build: refresh safe GMGN extension package"`

