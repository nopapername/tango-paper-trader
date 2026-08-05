# GMGN Chart Marker Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the single average-entry BUY line react to every real average-cost change and make BUY/SELL lines follow the newest GMGN price-axis snapshot without stale-axis jumps.

**Architecture:** Keep `Tango.Markers.buildPayload()` and the paper-trade engine unchanged: one BUY line represents the open position's average entry, while SELL lines remain per execution. Fix only the iframe renderer by separating economic marker-value changes from axis jitter suppression and by treating a narrow right-axis clear as a real axis generation boundary.

**Tech Stack:** Chrome MV3 content scripts, plain JavaScript, Node `node:test` VM fixtures.

## Global Constraints

- Never click or dispatch GMGN native buy/sell controls and never call wallets, signatures, swaps, RPC broadcasts, or real-funds paths.
- Preserve the dirty shared worktree; do not reset, clean, stash, checkout, stage, commit, or rewrite unrelated changes.
- Do not run a browser, network request, or live GMGN test. Use deterministic Node tests only.
- Keep one BUY marker per token position; multiple buys update that average-entry marker rather than adding one line per BUY trade.
- Preserve exact chain/address marker isolation, late iframe replay, empty-payload clearing, disconnected-canvas cleanup, and the current SELL marker behavior.
- Rebuild `dist/tango-paper-trader` only after source tests and independent review pass.

---

### Task 1: Real average-entry updates bypass the visual deadband

**Files:**
- Modify: `src/content/chart-main.js`
- Test: `tests/markers.test.js`

**Interfaces:**
- Consumes: `CHART_MARKERS` payload marker objects with stable `id` and numeric `marketCap`/`price`.
- Produces: the same overlay DOM, but a changed economic value for the same marker ID is rendered at its new exact target Y immediately.

- [ ] **Step 1: Write the failing behavior test**

Add a chart-bridge test using a linear `$1/$2/$3` axis at `400/300/200px`. Send marker ID `buy` at price `2`, then send the same ID at price `2.02`. Assert the payload value changes and the overlay top changes from `300px` to `298px`; current code incorrectly keeps `300px` because the delta is below 3px.

- [ ] **Step 2: Run the RED test**

Run: `node --test --test-name-pattern="same marker id follows a changed economic value below the jitter deadband" tests/markers.test.js`

Expected: FAIL because the second top remains `300px`.

- [ ] **Step 3: Implement the minimal renderer change**

Track the rendered economic coordinate independently from `markerPositions`, for example:

```js
const markerValueSignatures = new Map();
const valueSignature = `${scale.type}:${scale.factor}:${rawValue}`;
const valueChanged = markerValueSignatures.has(marker.id)
  && markerValueSignatures.get(marker.id) !== valueSignature;
const y = !valueChanged && Number.isFinite(previousY) && Math.abs(previousY - targetY) < 3
  ? previousY : targetY;
markerValueSignatures.set(marker.id, valueSignature);
```

Clear/prune this map everywhere the corresponding marker-position state is cleared or removed. Do not remove the deadband for an unchanged marker value.

- [ ] **Step 4: Verify GREEN and unchanged-value stability**

Run the focused RED test again, then run the existing idle-axis stability test. Both must pass.

- [ ] **Step 5: Run the full marker suite**

Run: `node --test tests/markers.test.js`

Expected: all tests pass.

---

### Task 2: A narrow right-axis redraw starts a fresh axis snapshot

**Files:**
- Modify: `src/content/chart-main.js`
- Test: `tests/markers.test.js`

**Interfaces:**
- Consumes: intercepted Canvas 2D `clearRect(x, y, width, height)` calls and per-canvas axis-label records.
- Produces: a new axis generation when either most of the canvas is cleared or a tall right-side price-axis strip is cleared.

- [ ] **Step 1: Write the failing behavior test**

Record axis A (`5.8K/6K/6.2K` at `400/300/200px`) and render marker `6028`. Advance 400ms, call `clearRect(900, 0, 100, 700)` on the 1000x700 canvas, record complete axis B (`5.9K/6.1K/6.3K` at `420/320/220px`), and render immediately. Assert the line follows axis B rather than retaining axis A.

- [ ] **Step 2: Run the RED test**

Run: `node --test --test-name-pattern="newest complete axis snapshot after a narrow right-axis clear" tests/markers.test.js`

Expected: FAIL because the narrow clear is below the existing 45% area threshold and stale labels remain.

- [ ] **Step 3: Implement the minimal clear-boundary rule**

Extract a small predicate used by the existing `clearRect` wrapper. Preserve the current large-area rule and additionally accept only a tall clear that reaches the right side, for example:

```js
const clearsMostCanvas = clearWidth * clearHeight > canvas.width * canvas.height * 0.45;
const clearsRightAxis = clearHeight >= canvas.height * 0.7
  && clearWidth > 0
  && clearX + clearWidth >= canvas.width * 0.8;
```

On either condition, keep the existing exact-canvas cleanup: increment its generation, delete only that canvas's labels, and invalidate `stableScale` only if it uses that canvas ID.

- [ ] **Step 4: Verify GREEN and canvas isolation**

Run the focused test plus the existing unrelated-canvas clear and full-canvas clear tests.

- [ ] **Step 5: Run combined regression**

Run: `node --test tests/markers.test.js tests/content-runtime.test.js`

Expected: all tests pass.

---

### Task 3: Review, package, and source/dist parity

**Files:**
- Update generated package: `dist/tango-paper-trader`
- Record evidence: `.superpowers/sdd/2026-08-04-gmgn-chart-marker-stability/`

- [ ] **Step 1: Independent review**

Review for axis false positives, stale scale reuse, changed-value rendering, unbounded marker caches, route/token isolation, and paper-only safety.

- [ ] **Step 2: Run source verification**

Run the complete non-browser test selection, the safe GMGN adapter detail filter, `npm.cmd run check`, and `git diff --check`.

- [ ] **Step 3: Build the unpacked extension**

Run: `npm.cmd run build`

Expected: `dist/tango-paper-trader` is rebuilt from local source only.

- [ ] **Step 4: Compare source and dist**

Compare every packaged file with SHA-256 and require zero missing, extra, or different files.
