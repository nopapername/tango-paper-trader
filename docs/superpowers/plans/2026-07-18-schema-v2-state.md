# Schema-v2 State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validated schema-v2 multichain state boundary, migration, and persistence integration while preserving the existing engine API.

**Architecture:** `src/core/state.js` owns canonical state construction, normalization, migration, and resets using `Tango.Chains`. Storage becomes a thin persistence wrapper that delegates state semantics to that module; legacy engine callers continue through a Solana-only compatibility constructor.

**Tech Stack:** Browser JavaScript, Node built-in test runner, Chrome extension manifest.

## Global Constraints

- Enumerate the canonical six-chain registry via `Tango.Chains.all()`.
- All persisted/read state must be schema version `2`.
- Preserve `Tango.createInitialState(balance)` as a schema-v2 Solana compatibility alias.
- Reject invalid imported positions before any storage write.
- Load chains, constants, state, helpers, engine, then storage in every isolated context.

---

### Task 1: State contracts and migration

**Files:**
- Create: `src/core/state.js`
- Create: `tests/state.test.js`
- Modify: `src/shared/constants.js`

- [ ] Write state creation, legacy migration, idempotence, reset, and invalid-import tests.
- [ ] Run `node --test tests/state.test.js` and confirm the module-missing RED failure.
- [ ] Implement state constructors, settings normalization, strict state validation, v1 migration, resets, and the compatibility alias.
- [ ] Run `node --test tests/state.test.js` and confirm GREEN.

### Task 2: Storage and load order integration

**Files:**
- Modify: `src/core/storage.js`
- Modify: `tests/storage.test.js`
- Modify: `manifest.json`
- Modify: `popup.html`
- Modify: `dashboard.html`
- Modify: `scripts/validate-extension.js`
- Modify: `tests/validate-extension.test.js`

- [ ] Write failing tests for storage delegation, strict import atomicity, reset methods, and state-script validation.
- [ ] Run the focused affected tests and confirm RED failures.
- [ ] Delegate storage normalization and resets to `Tango.State`; insert state.js in all required script orders and validation contract.
- [ ] Run `node --test tests/state.test.js tests/storage.test.js tests/validate-extension.test.js` and confirm GREEN.

### Task 3: Verification and handoff

- [ ] Run `npm.cmd test` and `npm.cmd run check`.
- [ ] Review the diff for scope, compatibility, and validation coverage.
- [ ] Write `.superpowers/sdd/task-2-report.md` with RED/GREEN and verification evidence.
- [ ] Commit the scoped files using `feat: add multichain state migration`.
