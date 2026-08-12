# Storage byte-budget final fix report

Date: 2026-08-12

Branch: `codex/gmgn-paper-hardening`

Fix baseline: `f5aca9c`

Verified HEAD before this report: `581a6e2`

## Status

The final storage hardening findings are resolved. Mutations over raw-v1 data now perform one atomic final write, newly created history survives compaction even when IDs collide and history is already at its 10,000-entry cap, and typed storage byte details are accepted only when their structure and semantics are valid.

The manifest permission remains exactly `['storage']`; `unlimitedStorage` was not added. CSV behavior was not changed.

## Finding 1: raw-v1 mutation atomicity

### Root cause

`INITIALIZE`, `SAVE_SETTINGS`, and `PATCH_SETTINGS` could durably migrate a raw-v1 snapshot before completing their requested mutation. Successful commands could therefore write twice, while a quota failure during the later request write could leave a preliminary migration persisted even though the command failed.

### RED evidence

Command:

```text
node --test --test-name-pattern="raw v1 (INITIALIZE|SAVE_SETTINGS|PATCH_SETTINGS)" tests/state-coordinator.test.js
```

The six success/quota-failure regressions failed before the production change. Success cases observed two writes (`2 !== 1`), and failure cases observed a preliminary migration write despite the rejected command.

### Fix

- `mutate()` performs raw-v1 migration in memory.
- Migration, requested state/settings changes, and compaction are folded into one payload.
- A successful mutation writes at most once; a failed mutation writes nothing.
- `getAll()` retains its existing durable-migration behavior.
- Existing per-command revision semantics remain intact.

### GREEN evidence

The focused raw-v1 suite passed 6/6 after the fix. The full coordinator suite at that point passed 46/46.

### Commit

`a71d5cc fix: make raw v1 mutations atomic`

## Finding 2: duplicate-ID current-history protection

### Root cause

Compaction inferred newly created history by comparing IDs. With duplicate IDs, an earlier forward match could protect an old occurrence instead of the new prepended trade or calibration. A first correction matched occurrences from the tail, which handled ordinary and near-budget collisions but remained ambiguous at the 10,000-entry history cap: Engine prepended the new record and truncated a same-ID tail record, leaving the before/after ID counts unchanged. The coordinator could then misclassify the current record as old and compact it away.

### RED evidence

Initial focused regressions showed:

- a near-budget duplicate trade mutation failed with `storageFull` because the current trade was not protected;
- a near-budget duplicate calibration mutation retained the old occurrence rather than the current one.

An independent review then identified the full-history ambiguity. Two additional RED regressions using 10,000 entries showed:

- the current trade was removed when tail truncation consumed its duplicate ID;
- the current calibration was removed while the old duplicate candidate remained.

### Fix

- The occurrence-count logic remains O(n) for ordinary history detection.
- Engine execution results now explicitly identify mutation-created calibration records; trade results were already explicit.
- `Engine.updatePositionQuoteResult()` exposes state plus calibration metadata while the public `updatePositionQuote()` state-returning contract remains unchanged.
- The coordinator passes explicit protected prepend indexes for buy, sell, close-all, and quote-update mutations, so current records do not depend on ambiguous ID reconstruction.

### GREEN evidence

The five focused duplicate/history regressions passed 5/5, including both 10,000-entry cases. The latest affected-suite run passed 271/271:

```text
node --test tests/state-coordinator.test.js tests/background.test.js tests/storage.test.js tests/dashboard-runtime.test.js tests/engine.test.js tests/state.test.js
271 tests, 271 pass, 0 fail
```

### Commits

- `3c499ae fix: protect prepended duplicate history`
- `c7c65b4 fix: protect full-history mutations`

## Finding 3: typed storage-detail trust boundary

### Root cause

Background, Store, and Dashboard accepted typed storage failure details without consistently validating their code/message relationship, numeric domains, or the semantic relationship between measured and budget bytes. Malformed or spoofed fields could therefore be reconstructed or displayed as trusted byte-specific errors, including negative or zero-invalid values.

### RED evidence

Focused regressions failed before the production change because:

- Background accepted a negative `measuredBytes` value;
- Store reconstructed spoofed or malformed typed detail fields;
- Dashboard rendered an invalid `importTooLarge` byte toast such as `-0.00/0.00`.

### Fix

All three boundaries now require:

- an allowed typed error code;
- exact message/code agreement;
- finite `measuredBytes >= 0`;
- finite `budgetBytes > 0`;
- for `importTooLarge`, `measuredBytes > budgetBytes`.

Invalid detail objects fall back to the legacy generic error/toast path.

### GREEN evidence

The four focused typed-detail regressions passed 4/4. The combined Background, Store, and Dashboard suites passed 69/69.

### Commit

`37c9312 fix: validate typed storage details`

## Package parity

Build commits:

- `05aba02 build: refresh storage final fixes`
- `581a6e2 build: sync full-history mutation artifacts`

Fresh build command:

```text
npm.cmd run build
```

Result: exit 0; unpacked extension created at `dist/tango-paper-trader`.

Fresh SHA-256 comparison confirmed exact source/package parity for all seven relevant runtime assets:

```text
MATCH src/shared/constants.js
MATCH src/core/engine.js
MATCH src/core/state-coordinator.js
MATCH src/background.js
MATCH src/core/storage.js
MATCH src/shared/i18n.js
MATCH src/dashboard/dashboard.js
```

## Final verification

Fresh verification was run from the latest implementation and rebuilt package:

```text
npm.cmd test
# tests 935
# pass 935
# fail 0

npm.cmd run check
Manifest 0.3.0 valid; 22 referenced files found.

node -e "const manifest=require('./manifest.json'); if(manifest.permissions?.includes('unlimitedStorage')) throw new Error('unlimitedStorage is forbidden'); if(JSON.stringify(manifest.permissions)!==JSON.stringify(['storage'])) throw new Error('unexpected permission change');"
permissions exact: ["storage"]

git diff --check
exit 0
```

No known Critical or Important issue remains in this storage final-fix scope. The branch was not merged or pushed, and the worktree was not removed.
