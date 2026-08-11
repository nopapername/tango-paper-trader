# GMGN Paper Trade Integration Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the trusted quick-buy, locked Giant UI, chart-coordinate, CSV, and storage-budget changes without cross-module regressions, then produce a byte-identical unpacked extension.

**Architecture:** This is the final gate over four independently testable implementation plans. Integrate them in dependency order where files overlap, run focused and full regression suites, rebuild the tracked unpacked extension, compare every packaged source asset by SHA-256, and inspect the final diff for paper-only and permission invariants.

**Tech Stack:** Chrome Manifest V3, browser JavaScript, Node.js built-in test runner, PowerShell, Git

## Global Constraints

- Run this plan only after all tasks in the four dated 2026-08-11 subsystem plans have completed their RED-to-GREEN cycles and commits.
- Preserve GMGN native trading isolation: one trusted paper callback and zero native callbacks.
- A chart marker is visible only when a current trustworthy mapping places its factual value inside current plot bounds; never clamp or guess.
- Keep the canonical chart marker payload free of iframe-derived context.
- Enforce an exact `8 * 1024 * 1024` UTF-8-byte runtime state budget and reject oversized imports losslessly.
- Keep `manifest.json` permissions exactly `["storage"]`; never add `unlimitedStorage`.
- Do not modify or stage `.backups/` or unrelated pre-existing plan files.
- Build with `npm.cmd run build`; do not hand-edit `dist/tango-paper-trader`.

---

### Task 1: Integrate subsystem commits in overlap-safe order

**Files:**
- Verify: `docs/superpowers/plans/2026-08-11-gmgn-trusted-quick-buy-and-locked-giant.md`
- Verify: `docs/superpowers/plans/2026-08-11-gmgn-chart-axis-marker-correctness.md`
- Verify: `docs/superpowers/plans/2026-08-11-dashboard-csv-export-safety.md`
- Verify: `docs/superpowers/plans/2026-08-11-storage-byte-budget.md`
- Inspect: `src/content/content.js`
- Inspect: `src/dashboard/dashboard.js`

**Interfaces:**
- Consumes: Completed subsystem commits and the message envelopes, callback registration, CSV encoder, and typed storage errors defined by those plans.
- Produces: One linear branch whose overlapping `content.js` and `dashboard.js` edits preserve both sets of behavior.

- [ ] **Step 1: Confirm the worktree starts at the approved design and contains no unrelated tracked edits**

```powershell
git log -1 --oneline
git status --short
```

Expected: the history contains `68a1952 docs: design GMGN paper-trade hardening`; any listed tracked file belongs to a completed subsystem commit or is investigated before proceeding.

- [ ] **Step 2: Confirm subsystem commits are ordered around shared files**

```powershell
git log --oneline --decorate -20
```

Expected order from older to newer:

```text
quick-buy authority and locked UI commits
chart parent and child context/geometry commits
CSV export safety commit
storage budget and typed-error commits
```

The chart plan follows quick-buy work because both modify `src/content/content.js`. The storage plan follows CSV work because both modify `src/dashboard/dashboard.js`.

- [ ] **Step 3: Inspect the two shared files for retained interfaces**

```powershell
rg -n "requireTrustedUserEvent|handlePageMessage|chartDeliveryContext|CHART_MARKERS" src/content/content.js
rg -n "CSV_FORMULA_PREFIX|encodeCsvCell|importTooLarge|measuredBytes|budgetBytes" src/dashboard/dashboard.js
```

Expected: all named interfaces occur in their shared file; resolving an overlap did not discard either subsystem.

- [ ] **Step 4: Verify the integrated shared-file suites**

```powershell
node --test tests/content-runtime.test.js tests/dashboard-runtime.test.js
```

Expected: PASS with zero failed, cancelled, or skipped tests caused by the integration.

- [ ] **Step 5: Commit only an actual conflict-resolution edit, if one was necessary**

First inspect the exact diff:

```powershell
git diff -- src/content/content.js src/dashboard/dashboard.js tests/content-runtime.test.js tests/dashboard-runtime.test.js
```

If the diff is empty, do not create an empty commit. If it contains a required integration correction whose focused tests passed:

```powershell
git add src/content/content.js src/dashboard/dashboard.js tests/content-runtime.test.js tests/dashboard-runtime.test.js
git commit -m "fix: preserve paper trade integration boundaries"
```

### Task 2: Run focused security, coordinate, export, and storage gates

**Files:**
- Test: `tests/native-quick-buy-guard.test.js`
- Test: `tests/gmgn-quick-buy-world-integration.test.js`
- Test: `tests/page-main.test.js`
- Test: `tests/gmgn-adapter.test.js`
- Test: `tests/content-runtime.test.js`
- Test: `tests/content-structure.test.js`
- Test: `tests/markers.test.js`
- Test: `tests/dashboard-runtime.test.js`
- Test: `tests/state-coordinator.test.js`
- Test: `tests/background.test.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: The public and internal contracts established by every subsystem plan.
- Produces: Evidence that each acceptance boundary passes before the slower project-wide gate.

- [ ] **Step 1: Run the trusted-activation and native-isolation suites**

```powershell
node --test tests/native-quick-buy-guard.test.js tests/gmgn-quick-buy-world-integration.test.js tests/page-main.test.js
```

Expected: PASS; forged datasets, messages, and synthetic events cannot invoke a paper action, while trusted pointer and keyboard clicks invoke exactly one opaque callback.

- [ ] **Step 2: Run the locked Giant UI and shell suites**

```powershell
node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/content-structure.test.js
```

Expected: PASS; every verified slot has an exact 36 px Tango control, native presentation mutations do not alter it, and mutation-capable shell handlers reject untrusted events.

- [ ] **Step 3: Run the frame-context and marker-coordinate suite**

```powershell
node --test tests/markers.test.js tests/content-runtime.test.js
```

Expected: PASS; frame generation and axis hints are correlated, stale mappings clear, and out-of-plot factual values create no marker node.

- [ ] **Step 4: Run the CSV and storage suites**

```powershell
node --test tests/dashboard-runtime.test.js tests/state-coordinator.test.js tests/background.test.js tests/storage.test.js
```

Expected: PASS; the final Blob path neutralizes dangerous strings, negative numbers remain unchanged, compaction is deterministic and dependency-safe, and typed failures survive every extension context.

- [ ] **Step 5: Confirm the permission and forbidden-relay invariants directly**

```powershell
node -e "const m=require('./manifest.json'); if(JSON.stringify(m.permissions)!=='[\"storage\"]'||m.permissions.includes('unlimitedStorage')) process.exit(1); console.log('permissions:',m.permissions.join(','))"
$forbiddenMatches = rg -n "quickBuyActions|publishPaperActivation|PAPER_QUICK_BUY_(?:CLICK|INTENT)|TANGO_PAPER_QUICK_BUY_ACTIVATE|unlimitedStorage" src manifest.json
if ($LASTEXITCODE -eq 0) {
  $forbiddenMatches | ForEach-Object { Write-Error $_ }
  exit 1
}
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
Write-Output 'No forbidden relay or permission names remain.'
```

Expected: the Node command prints `permissions: storage`, then the script prints `No forbidden relay or permission names remain.` If a compatibility name is intentionally retained by a test-only diagnostic, remove it from the production-source search before continuing rather than weakening this gate.

### Task 3: Run project-wide regression and structural validation

**Files:**
- Test: `tests/*.test.js`
- Verify: `manifest.json`
- Verify: `scripts/validate-extension.js`
- Verify: all JavaScript under `src/`

**Interfaces:**
- Consumes: The fully integrated source and tests.
- Produces: A complete passing test result plus manifest, script-order, syntax, and paper-only validation evidence.

- [ ] **Step 1: Run the complete Node test suite**

```powershell
npm.cmd test
```

Expected: exit code 0 with no failed tests.

- [ ] **Step 2: Run extension structure and safety validation**

```powershell
npm.cmd run check
```

Expected: exit code 0 and a `Manifest 0.3.0 valid` result.

- [ ] **Step 3: Check whitespace and patch integrity**

```powershell
git diff --check
```

Expected: exit code 0 with no output.

- [ ] **Step 4: Inspect the complete source and test diff**

```powershell
git diff --stat 68a1952..HEAD
git diff --name-status 68a1952..HEAD
```

Expected: changes are limited to the approved runtime, tests, documentation, and later generated `dist` counterparts. No wallet, swap, signing, RPC, host-permission, or unrelated feature file is introduced.

### Task 4: Build and prove source/package byte parity

**Files:**
- Generate: `dist/tango-paper-trader/**`
- Verify: `scripts/build.js`
- Verify: `src/**`
- Verify: `manifest.json`
- Verify: `popup.html`
- Verify: `dashboard.html`
- Verify: `README.md`
- Verify: `PRIVACY.md`
- Verify: `docs/multichain-smoke-test.md`

**Interfaces:**
- Consumes: The verified source tree.
- Produces: A rebuilt unpacked extension whose copied assets are byte-identical to their source counterparts.

- [ ] **Step 1: Rebuild the unpacked extension from source**

```powershell
npm.cmd run build
```

Expected: exit code 0 and `Built unpacked extension at ...\dist\tango-paper-trader`.

- [ ] **Step 2: Compare every source asset with its packaged counterpart by SHA-256**

```powershell
$repoRoot = (Resolve-Path '.').Path
$packageRoot = Join-Path $repoRoot 'dist\tango-paper-trader'
$copyRoots = @('src', 'manifest.json', 'popup.html', 'dashboard.html', 'README.md', 'PRIVACY.md', 'docs\multichain-smoke-test.md')
$sourceFiles = foreach ($copyRoot in $copyRoots) {
  $absolute = Join-Path $repoRoot $copyRoot
  if (Test-Path -LiteralPath $absolute -PathType Container) {
    Get-ChildItem -LiteralPath $absolute -Recurse -File
  } else {
    Get-Item -LiteralPath $absolute
  }
}
$mismatches = foreach ($sourceFile in $sourceFiles) {
  $relative = [System.IO.Path]::GetRelativePath($repoRoot, $sourceFile.FullName)
  $builtFile = Join-Path $packageRoot $relative
  if (-not (Test-Path -LiteralPath $builtFile -PathType Leaf)) {
    "MISSING $relative"
    continue
  }
  $sourceHash = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash
  $builtHash = (Get-FileHash -LiteralPath $builtFile -Algorithm SHA256).Hash
  if ($sourceHash -ne $builtHash) { "MISMATCH $relative" }
}
if ($mismatches) {
  $mismatches | ForEach-Object { Write-Error $_ }
  exit 1
}
Write-Output "All $($sourceFiles.Count) packaged files match source SHA-256 hashes."
```

Expected: exit code 0 and one line stating that every packaged file matches its source hash.

- [ ] **Step 3: Re-run validation against the post-build tree and inspect generated changes**

```powershell
npm.cmd run check
git status --short
git diff -- dist/tango-paper-trader
```

Expected: validation passes; only packaged counterparts of approved source changes differ under `dist/tango-paper-trader`.

- [ ] **Step 4: Commit the generated package refresh when the build produced a diff**

```powershell
$packageChanged = $false
git diff --quiet -- dist/tango-paper-trader
if ($LASTEXITCODE -eq 1) { $packageChanged = $true }
elseif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($packageChanged) {
  git add dist/tango-paper-trader
  git diff --cached --check
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  git commit -m "build: refresh hardened paper trader extension"
} else {
  Write-Output 'Package already matches the committed source; no build commit needed.'
}
```

Expected: either a package-only commit succeeds or the command reports that an earlier subsystem build already committed byte-identical package assets.

### Task 5: Final clean-room verification and handoff evidence

**Files:**
- Verify: entire repository

**Interfaces:**
- Consumes: Source commits and the generated-package commit.
- Produces: Final reproducible evidence suitable for completion review.

- [ ] **Step 1: Run all required commands from the committed tree**

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
git diff --check
```

Expected: all commands exit 0; rebuilding produces no content drift.

- [ ] **Step 2: Confirm the build is reproducible and the worktree has no unexpected tracked edits**

```powershell
git status --short
git diff --exit-code -- dist/tango-paper-trader
```

Expected: no tracked source or package diff. Ignored or known user-owned artifacts are not staged.

- [ ] **Step 3: Record the exact verification evidence for review**

```powershell
git log --oneline --decorate 68a1952..HEAD
git show --stat --oneline HEAD
```

Expected: the log exposes the independent RED-to-GREEN subsystem commits and the final generated-package commit, allowing each boundary to be reviewed separately.

- [ ] **Step 4: Request the required completion review**

Use `superpowers:requesting-code-review` with the approved design, all five implementation plans, the commit range `68a1952..HEAD`, and the final command outputs. Resolve any actionable finding with a new focused RED-to-GREEN cycle, rerun Tasks 2 through 5, and only then report completion.
