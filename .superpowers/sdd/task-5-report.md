# Task 5 Report: Generic Paper Valuation and Economic-Neutral Calibration

## Status

Implemented from baseline `e16b644b1dd3e3c50332ce16e0b4399687021ded` with test-first RED/GREEN evidence. Generic paper market-cap valuation now uses a trusted resolved supply instead of the legacy fixed Pump divisor, provisional fills remain auditable, stronger quotes calibrate open positions without changing their economic boundary, and coordinator quote mutations use their injected clock.

During full verification, the original task file list proved incomplete: generic `MARKET_CAP_DERIVED` engine output could not survive the existing Pump-only strict state validator. After explicit authorization, `src/core/state.js` and `tests/state.test.js` were added to scope. The strict validator now accepts only coherent trusted-supply market-cap records and continues to reject unknown or inconsistent provenance.

## Files

- `src/core/engine.js`
- `src/core/state.js` (authorized plan-gap correction)
- `src/core/state-coordinator.js`
- `tests/engine.test.js`
- `tests/state.test.js` (authorized plan-gap regression coverage)
- `tests/state-coordinator.test.js`
- `.superpowers/sdd/task-5-report.md`

## RED evidence

### Generic valuation and calibration

Command:

```powershell
node --test tests/engine.test.js
```

Initial result: 34 passed, 4 failed.

- Base exact 100B market-cap fill failed with `invalidQuote`, proving trust was still Pump-only.
- Nominal synthetic fill lacked `trade.provisional` and position calibration state.
- First trusted quote left quantity at `1` instead of economically neutral `1500`.
- Fallback launchpad-supply market-cap fill failed with `invalidQuote`, preventing partial-sell supply correction coverage.
- The full-close no-op test already passed, confirming the existing deleted-position boundary before implementation.

### Coordinator time and revision

Command:

```powershell
node --test --test-name-pattern "quote calibration uses the coordinator clock" tests/state-coordinator.test.js
```

Initial result: 0 passed, 1 failed. Expected one calibration event but received zero, proving the update path neither calibrated nor forwarded coordinator time.

### Strict state roundtrip plan gap

Command:

```powershell
node --test --test-name-pattern "trusted Base market-cap fills|strict state rejects unknown supply" tests/state.test.js
```

Initial result: 1 passed, 1 failed. The trusted Base engine state failed at strict position normalization with `invalidPosition`, while forged supply provenance continued to be rejected.

### Stronger-supply edge audit

Two additional test-first cycles were added during self-review:

- A PRICE-mode synthetic position with a real token/native quote and incidental exact supply initially produced `PRICE_NATIVE_AND_SUPPLY`; the expected `PRICE_AND_NATIVE` RED proved supply calibration was too broad.
- A legacy market-cap position receiving a changed exact supply initially lost half its position value because `needsCalibration` was false; the neutral-equity assertion failed.
- A fallback supply confirmed by an exact source at the same quantity initially retained `needsCalibration: true`; the test required clearing the flag without adding an event or neutralizing a real market move.

GREEN now limits quantity-changing supply calibration to MARKET_CAP positions whose supply quantity changed under a stronger source. A same-quantity source confirmation updates provenance and clears fallback calibration without an audit event.

### Full-suite legacy fixture regression

The first full `npm.cmd test` run produced 324 passes and 3 failures. All three were legacy Pump content fixtures. Root-cause tracing showed that `tests/content-runtime.test.js` loads the real Engine without initializing `Tango.Supply`; the new resolver therefore returned no legacy supply. The minimal compatibility path accepts only an explicit recognized supply source or the existing coherent legacy Pump marker when the shared Supply module is unavailable. It does not synthesize generic ratio or launchpad supply in that environment.

## GREEN implementation

### Trusted generic supply

- `trustedSupply` delegates to `Tango.Supply.resolve` and accepts only `Tango.Supply.isTrustedSource` sources.
- Quote supply priority is exact, ratio, launchpad rule, then legacy Pump rule. A stronger persisted supply is not downgraded by a weaker quote.
- Market-cap price is `marketCapUsd / resolved totalSupply`; the Base test derives `0.000002` from `200,000 / 100,000,000,000`.
- Trades and positions retain provisional flags, synthetic dimensions, supply/source, launchpad/mode, valuation mode, and price provenance.
- Legacy Pump behavior and defensive forged-divisor tests remain green.

### Strict schema compatibility

- Generic derived market-cap positions require a positive finite `totalSupply`, a recognized `supplySource`, an equal `marketCapDivisor`, and a coherent last market-cap/price/supply ratio.
- Generic derived market-cap trades require the same trusted source plus a coherent observed market-cap/price/supply ratio.
- Chain and normalized address validation still occurs before these relationships are accepted.
- Unknown supply sources, forged legacy market-cap provenance, mismatched divisors, incoherent ratios, and wrong-chain identities remain rejected.
- Coherent legacy Pump provenance remains import-compatible.

### Neutral calibration

For an eligible open position:

```text
preservedValueNative = old quantity × old USD mark / old native USD mark
nextQuantity = preservedValueNative × new native USD mark / new token USD mark
nextAverageEntryPriceUsd = costBasisNative × new native USD mark / nextQuantity
```

The calibration clone changes the remaining position quantity and entry/last marks, updates trusted supply identity, clears only replaced provisional dimensions, and prepends one bounded audit event. It does not change accounts, cash, `costBasisNative`, realized PnL, state revision, daily realized values, or historical trades.

`executeBuy` and `executeSell` calibrate an existing position before calculating the new order quantity. A same-strength provisional/fallback quote is a no-op; an exact quote supersedes a launchpad fallback. Deleted or zero-quantity positions are never recreated.

### Deterministic coordination

`UPDATE_POSITION_QUOTE` forwards the coordinator's injected `now()` value to the Engine. A calibration event uses that value as `createdAt`, and the coordinator performs exactly one normal commit/revision increment.

## Verification and invariant audit

Focused command:

```powershell
node --test tests/engine.test.js tests/state.test.js tests/state-coordinator.test.js
```

Result: 102 passed, 0 failed.

Legacy content regression command:

```powershell
node --test --test-name-pattern "content Engine mark fixture|content validates a persisted Pump|trade confirmation displays market cap" tests/content-runtime.test.js
```

Result: 3 passed, 0 failed.

Final required command:

```powershell
npm.cmd test
```

Result: 331 passed, 0 failed, 0 skipped/cancelled/todo; exit code 0.

An independent assertion script additionally verified:

- Input state remains deeply unchanged after calibration.
- Accounts, cash, historical trades, state revision, cost basis, and realized PnL are identical across a standalone calibration.
- Position native value is identical at the calibration boundary.
- A second non-provisional quote after calibration returns the original state from `calibratePosition`.
- Zero quantity is a no-op.
- Calibration events remain capped at `Tango.MAX_TRADES` (`10,000`).
- A stronger quote is applied before a subsequent buy; the synthetic example becomes quantity `3000`, cost basis `2`, and cash `8` after the second one-native buy.
- Numeric position/event outputs are finite.
- An untrusted market-cap-only supply source is rejected.
- Existing six-chain/address-isolation and paper-only static tests remain green; no wallet signing, transaction construction, submission, or real-funds capability was introduced.

## Remaining concerns

No blocking correctness concern remains within Task 5 scope. The strict state compatibility gap was fixed rather than deferred. The Engine's no-`Supply` compatibility branch is deliberately limited to explicit recognized sources and coherent legacy Pump state; normal packaged execution continues to use the shared Supply resolver.
