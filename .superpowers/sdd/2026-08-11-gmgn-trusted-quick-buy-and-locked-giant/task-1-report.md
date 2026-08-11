# Task 1 Report: Move Quick-Buy Authority Into the Isolated Guard

## Status

DONE_WITH_CONCERNS

## Implementation

- Added `NativeQuickBuyGuard.registerPaperAction(element, identity, activate)` with an opaque callback held only in the Guard `WeakMap`.
- Extended identity validation to require the exact callback to equal `binding.action.invoke`.
- Guard now stops trusted precursor events, blocks every untrusted or auxiliary click, and invokes the opaque callback exactly once for a trusted primary click.
- Removed the adapter action Map, same-window transaction listener, `_invokeQuickBuyAction`, and `slot.__tangoQuickBuyHandler` publication path.
- Removed MAIN-world transaction event listeners and `PAPER_QUICK_BUY_INTENT` / `PAPER_QUICK_BUY_CLICK` publication.
- Updated cross-world tests so public message payloads cannot mutate paper assets and trusted Guard activation produces no MAIN transaction message.

## Files

- `src/content/native-quick-buy-guard.js`
- `src/adapters/gmgn.js`
- `src/content/page-main.js`
- `tests/native-quick-buy-guard.test.js`
- `tests/gmgn-quick-buy-world-integration.test.js`
- `tests/page-main.test.js`
- `tests/gmgn-adapter.test.js`
- `tests/content-runtime.test.js` (explicit parent-authorized scope exception; its old test harness directly called the deleted public adapter API)

## TDD Evidence

RED command:

```powershell
node --test --test-name-pattern="isolated guard rejects forged|trusted pointer and browser keyboard" tests/native-quick-buy-guard.test.js
```

It failed as expected: synthetic `pointerdown` was allowed and registered trusted precursor events were not stopped, proving the callback path and event barrier did not yet exist.

RED command:

```powershell
node --test --test-name-pattern="trusted isolated activation|forged public identity|MAIN quote tap registers no paper" tests/gmgn-quick-buy-world-integration.test.js tests/page-main.test.js
```

It failed as expected: trusted activation invoked no local callback and MAIN registered transaction listeners. The forged-message case was already inert in that fixture, so it was retained as a regression proof rather than a new RED failure.

The Step 7 focused command initially failed because `tests/content-runtime.test.js` still directly called the deliberately removed `RealGMGN._invokeQuickBuyAction`. Parent authorized the minimal test-double-only update; the test double now captures the opaque callback and exposes a test-only `invokeRegistered` helper.

## GREEN / Verification

```powershell
node --test tests/native-quick-buy-guard.test.js tests/gmgn-quick-buy-world-integration.test.js tests/page-main.test.js
```

Result: 49 passed, 0 failed, 5 skipped (54 total).

```powershell
node --test --test-name-pattern="Guard registration failure|resolving publication|in-flight paper|identity intent|native callbacks" tests/gmgn-adapter.test.js tests/content-runtime.test.js
```

Result: 19 passed, 0 failed.

Also ran `git diff --check` successfully and confirmed no production references remain to `quickBuyActions`, `_invokeQuickBuyAction`, `__tangoQuickBuyHandler`, or `PAPER_QUICK_BUY_INTENT` / `PAPER_QUICK_BUY_CLICK` in the adapter or MAIN world.

## Self-review

- Guard identity remains fail-closed on callback, binding, dataset, DOM containment, and native-ancestor drift.
- Only trusted primary browser clicks can invoke the callback; synthetic, forged, auxiliary, and public-message paths invoke none.
- Native event propagation remains stopped and no native callbacks are exercised by the verified matrices.
- No real-funds capability or GMGN native transaction forwarding was added.

## Concerns

- Five obsolete `page-main` tests that asserted the removed MAIN-world pointer/key relay are marked skipped rather than physically deleted. They do not execute, and the replacement `MAIN quote tap registers no paper activation relay` test covers the intended boundary, but deletion would be cleaner in a follow-up cleanup.
