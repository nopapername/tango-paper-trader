# Dashboard CSV Export Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Dashboard CSV download spreadsheet-safe while preserving numeric values, ordinary CSV escaping, JSON export, and in-memory state.

**Architecture:** Keep trade-row selection in `Tango.DashboardModel` unchanged and enforce spreadsheet safety only at the final CSV cell encoder in `src/dashboard/dashboard.js`. The runtime regression exercises the real `export-csv` action, generated `Blob`, object URL, and downloaded anchor so the test covers the user-visible artifact rather than a source helper alone.

**Tech Stack:** JavaScript, Chrome Extension Manifest V3 runtime code, Node.js built-in test runner, `node:assert/strict`, VM-based Dashboard runtime harness.

## Global Constraints

- Numbers remain numbers at the encoder boundary; a numeric `-42` exports as `"-42"`, never `"'-42"`.
- A string whose first non-whitespace/control character is `=`, `+`, `-`, or `@` receives exactly one leading ASCII apostrophe before ordinary CSV quote escaping.
- Apply the rule to every exported string cell rather than a selected list of columns.
- Preserve the UTF-8 BOM, header order, selected-chain filtering, commas, quotes, embedded newlines, ordinary URLs, JSON export, Dashboard display, and source objects.
- Do not change imports, trade normalization, Dashboard model semantics, or any paper-trading behavior.
- No production code may be written before the focused runtime test has been observed failing for the missing apostrophe.

---

## File Map

- Modify: `tests/dashboard-runtime.test.js` — exercise the final downloaded CSV `Blob` and verify unchanged JSON/state behavior.
- Modify: `src/dashboard/dashboard.js:526-536` — type-aware spreadsheet neutralization followed by existing RFC-style quote escaping.

### Task 1: Neutralize Formula-Leading CSV Strings at the Download Boundary

**Files:**
- Modify: `tests/dashboard-runtime.test.js`
- Modify: `src/dashboard/dashboard.js:526-536`

**Interfaces:**
- Consumes: `Tango.DashboardModel.tradesCsvRows(state, chainId) -> Array<Record<string, unknown>>`.
- Produces: `CSV_FORMULA_PREFIX = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u` at the CSV boundary.
- Produces: `encodeCsvCell(value: unknown) -> string`, used only by `tradesCsv(chainId)` before the `Blob` download.
- Preserves: `action('export-csv') -> download(name, csv, 'text/csv;charset=utf-8')` and `action('export-json')` behavior.

- [ ] **Step 1: Add one failing end-to-end CSV download regression**

Append this test after the existing CSV runtime tests in `tests/dashboard-runtime.test.js`:

```js
test('CSV download neutralizes spreadsheet formulas without changing numbers, escaping, JSON, or state', async () => {
  const state = stateFixture();
  const dangerous = [
    '=HYPERLINK("https://evil.example","x")',
    '+SUM(1,1)',
    '-1+1',
    '@SUM(1,1)',
    ' \t\u0000=CMD()'
  ];
  state.trades = dangerous.map((symbol, index) => ({
    ...state.trades[0],
    id: `danger-${index}`,
    symbol,
    sourceUrl: index === 0
      ? '\r\n@SUM(2,2)'
      : `https://gmgn.ai/eth/token/safe-${index}?a=1,b=2`,
    realizedPnlNative: -42
  }));
  const before = structuredClone(state);
  const dashboard = await loadDashboard({ initialState: state });

  await dashboard.api.action('export-csv');

  const csvAnchor = dashboard.anchors.at(-1);
  const csvBlob = dashboard.urls.get(csvAnchor.href);
  const csv = await csvBlob.text();
  assert.equal(csvBlob.type, 'text/csv;charset=utf-8');
  assert.ok(csv.startsWith('\ufeffexecutedAt,'));
  for (const value of dangerous) {
    const escaped = `'${value}`.replaceAll('"', '""');
    assert.ok(csv.includes(`"${escaped}"`), value);
  }
  assert.ok(csv.includes(`"'\r\n@SUM(2,2)"`));
  assert.ok(csv.includes('"https://gmgn.ai/eth/token/safe-1?a=1,b=2"'));
  assert.ok(csv.includes('"-42"'));
  assert.equal(csv.includes(`"'-42"`), false);
  assert.equal(JSON.stringify(dashboard.api.runtime.state), JSON.stringify(before));

  await dashboard.api.action('export-json');
  const jsonAnchor = dashboard.anchors.at(-1);
  const backup = JSON.parse(await dashboard.urls.get(jsonAnchor.href).text());
  assert.deepEqual(backup.state, before);
});
```

This test deliberately combines the new security expectation with the invariants most likely to regress when replacing the cell encoder. It goes through `action('export-csv')`, `download`, `Blob`, object URL, and anchor rather than calling `tradesCsv` directly.

- [ ] **Step 2: Run the focused test and verify the expected RED failure**

Run:

```powershell
node --test --test-name-pattern="CSV download neutralizes spreadsheet formulas" tests/dashboard-runtime.test.js
```

Expected: `FAIL` at the first `csv.includes(...)` assertion because the current encoder emits `"=HYPERLINK..."` without the required leading ASCII apostrophe. If the test errors before that assertion, correct the fixture or harness and rerun until it fails only because neutralization is absent.

- [ ] **Step 3: Add the minimal type-aware CSV encoder**

Replace the local `encode` declaration and its use at `src/dashboard/dashboard.js:535-536` with this code:

```js
    const CSV_FORMULA_PREFIX = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u;
    const encodeCsvCell = (value) => {
      const raw = value ?? '';
      const text = typeof raw === 'string' && CSV_FORMULA_PREFIX.test(raw)
        ? `'${raw}`
        : String(raw);
      return `"${text.replaceAll('"', '""')}"`;
    };
    return '\ufeff' + [
      headers.join(','),
      ...rows.map((row) => headers.map((key) => encodeCsvCell(row[key])).join(','))
    ].join('\n');
```

The `typeof raw === 'string'` branch is the type boundary that keeps negative PnL numeric. Prefixing happens before doubled-quote escaping, so formulas containing quotes, commas, or newlines remain valid CSV fields.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="CSV download neutralizes spreadsheet formulas" tests/dashboard-runtime.test.js
```

Expected: `PASS`; the resulting `Blob` contains apostrophe-prefixed dangerous strings, `"-42"`, the existing BOM, ordinary URL punctuation, and the unmodified JSON state.

- [ ] **Step 5: Run the complete Dashboard suites**

Run:

```powershell
node --test tests/dashboard-runtime.test.js tests/dashboard-model.test.js
```

Expected: all Dashboard tests pass with no warnings or unhandled rejections.

- [ ] **Step 6: Commit the independently reviewable CSV fix**

```powershell
git add tests/dashboard-runtime.test.js src/dashboard/dashboard.js
git commit -m "fix: neutralize spreadsheet formulas in CSV exports"
```

The commit must contain only the Dashboard runtime regression and final-boundary encoder change.
