# GMGN Quick-Buy Integrity Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:systematic-debugging. Preserve all existing staged and unstaged changes; do not commit, reset, clean, switch branches, or trigger any GMGN/wallet trading control.

**Goal:** Fix trench quick-buy hit geometry, no-chart quote arithmetic, and late/inaccurate chart markers without adding any real-funds capability.

**Architecture:** Keep launchpad/fallback valuation authoritative while no trustworthy K-line price exists. Treat the Tango quick-buy control as a stable, full-slot paper-only hit target independent of GMGN transient presentation classes. Register chart-frame lifecycle replay and use known execution supply when converting market-cap entries onto a price axis.

**Tech Stack:** Chrome MV3 content scripts, plain JavaScript, Node.js built-in test runner.

## Global Constraints

- Never click or dispatch GMGN native buy/sell controls, wallet prompts, signatures, approvals, swaps, RPC broadcasts, or real-money actions.
- Known launchpads use their registered supply: Pump.fun 1B, Mayhem 2B, Bankr/Banker/Clanker 100B, other registered launchpads 1B.
- Unknown launchpads use 1B total supply and `$3,200` initial market cap until a trustworthy GMGN/K-line observation replaces the fallback.
- A simulated buy or sell must not mint native balance from a price/supply dimension mismatch.
- Source files are authoritative; generated `dist/` and the Chrome loading directory are updated only after all source tests pass.

---

### Task 1: Stable trench quick-buy geometry and hit target

**Files:**
- Modify: `src/content/content.css`
- Modify: `tests/content-structure.test.js`
- Modify: `tests/gmgn-adapter.test.js`

- [x] Add failing tests proving every paper quick-buy remains centered, pointer-enabled, and fills its overridden GMGN slot even when the native leaf disappears or transient layout classes change.
- [x] Run the focused tests and confirm they fail for missing stable geometry.
- [x] Add the minimum paper-only CSS/layout invariant without changing GMGN button-size dimensions.
- [x] Re-run the focused tests and confirm they pass.

### Task 2: No-chart quote dimensional integrity

**Files:**
- Modify: `src/adapters/gmgn.js`
- Modify: `tests/gmgn-adapter.test.js`
- Modify: `tests/content-runtime.test.js`

- [x] Add a failing adapter test proving a detail page with no chart cannot promote an uncorroborated bare `Price` value to `OBSERVED_PRICE`.
- [x] Add a failing content/Engine integration test for Bankr 100B and unknown 1B: buy with fallback, then sell 100% against the polluted no-chart DOM candidate; ending cash must remain the original balance in the zero-fee fixture.
- [x] Run both tests and confirm the wrong tiny quantity / huge native proceeds reproduce.
- [x] Gate the DOM price by trustworthy chart/price evidence while preserving deterministic launchpad or unknown fallback execution.
- [x] Re-run focused arithmetic and supply tests.

### Task 3: Quick-buy marker parsing, replay, and coordinate conversion

**Files:**
- Modify: `src/adapters/gmgn.js`
- Modify: `src/content/content.js`
- Modify: `src/content/markers.js`
- Modify: `tests/gmgn-adapter.test.js`
- Modify: `tests/content-runtime.test.js`
- Modify: `tests/markers.test.js`

- [x] Add failing tests for real trench MC label variants that retain USD semantics.
- [x] Add a failing test where the same chart iframe loads after an earlier cached payload and must receive the current payload again.
- [x] Add a failing marker test proving a market-cap execution with known total supply maps to `entryMarketCap / totalSupply` on a price-only chart reference.
- [x] Implement the smallest parser, frame-load replay, and supply-aware marker changes.
- [x] Re-run focused marker/runtime/adapter tests.

### Task 4: Review, release gates, and package sync

**Files:**
- Update generated package through `npm.cmd run build` only after source verification.

- [x] Independently review the complete diff for dimensional arithmetic, dynamic DOM races, and real-funds isolation.
- [x] Run `npm.cmd test`, `npm.cmd run check`, and `git diff --check`.
- [x] Run the build, re-run tests/check, compare the 32-file source/package hashes, and sync the verified package to `D:\web3\code_project\tango-paper-trade\dist\tango-paper-trader`.
- [x] Confirm no source/package hash mismatch and report the Chrome reload step.
