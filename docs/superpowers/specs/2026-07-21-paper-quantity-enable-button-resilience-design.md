# Paper Quantity, Re-enable, and Quick-Buy Size Resilience Design

## Goal

Make every supported GMGN chain produce a plausible immediate paper quantity, guarantee exact 100% paper closes, reactivate all injected features without a page refresh, and keep Tango quick-buy controls aligned with all GMGN custom button sizes.

## Safety boundary

All execution remains local paper trading. The change must not add or call wallets, signatures, approvals, swap routes, RPC transaction methods, broadcasts, or any real-funds operation. Browser verification may inspect GMGN state and Tango controls, but must not click GMGN real-trade or wallet controls.

## Root causes

1. Trench cards expose launchpad identity through links such as Four.meme and Flap, but `verifiedCardMetadata` currently returns only token identity and logo. Without a price, exact supply, or launchpad rule, a market-cap quote falls back to the guaranteed-fill price of 1 USD. A 1 BNB buy therefore records only hundreds of tokens instead of `net native value / (market cap / supply)`.
2. A 100% sell calculates `existingQuantity * 100 / 100`. For some calibrated fractional quantities this leaves floating-point dust. The remaining cost rounds to zero while the remaining quantity stays positive, so the engine correctly raises `invalidArithmetic` for an impossible positive-cost position.
3. A storage notification from disabled to enabled reloads settings and renders the shell, but does not immediately rebuild the route context, request cached page quotes, run a quote tick, or rescan existing trench cards.
4. Tango records the native button height only when it replaces the control. GMGN can later switch among small, large, extra-large, and giant layouts, while the Tango control retains the original inline height and only has two coarse layout classes.

## Quantity and supply resolution

The paper quote pipeline keeps the following priority:

1. GMGN exact supply.
2. Supply inferred from a coherent same-observation market-cap/price ratio.
3. Verified launchpad rules, including Pump.fun 1B, Pump Mayhem 2B, Bankr/Clanker 100B, and the existing 1B Four.meme, Flap, Zora, DYOR, and Bow rules.
4. A provisional 1B supply only when the card has no exact, ratio, or recognized launchpad supply.

The adapter will extract launchpad identity only from an address-bound card scope and supported launchpad URLs. The address in the launchpad URL must match the card token address when the URL exposes an address. This prevents a neighboring card or unrelated link from supplying provenance.

The last-resort 1B value is explicitly provisional rather than factual. It may derive an immediate token price from market cap and must keep `needsCalibration` set. A later stronger GMGN observation recalculates quantity while preserving the paper position's native value, using the existing calibration audit path. Exact and inferred observations always replace the provisional value; the provisional value never overwrites stronger data.

When neither token price nor market cap exists, the existing guaranteed local fill remains available and stays synthetic until real data arrives.

## Exact full-close semantics

An order with `percent === 100` is a full-close instruction, not a fractional arithmetic request. The engine will use the entire existing quantity, allocate the entire remaining cost basis, set both remaining quantity and remaining cost to zero, and delete the position after recording proceeds and realized PnL.

Percentages below 100 keep the existing guarded proportional calculation. This preserves the arithmetic protections for genuine partial sells while removing floating-point dust from an exact full close.

## Re-enable lifecycle

The settings refresh path will detect a transition from disabled to enabled. After authoritative state and settings are loaded it will:

1. Re-establish the current detail-route placeholder when applicable.
2. Synchronize the current GMGN chain.
3. Request a replay of quotes already observed by the MAIN-world page tap.
4. Immediately scan existing trench cards for Tango quick-buy controls.
5. Start one coalesced quote tick to enrich the current detail context.
6. Queue the normal render.

The transition reuses existing timers, observers, locks, and coalescers. It must not register duplicate listeners, duplicate intervals, or duplicate paper orders. Disabling still clears Tango markup and restores native GMGN quick-buy controls.

## Responsive quick-buy geometry

The replacement control will no longer treat its initial pixel height as permanent. Injection and every resize observation will synchronize the Tango button with the current slot geometry and any re-rendered native control geometry. The control keeps `width: 100%`, follows the live slot height, and recalculates its compact/expanded and narrow layout classes from the current dimensions.

If GMGN reconciles a new native quick-buy control after a custom-size change, Tango first refreshes its geometry from that control and then removes the real-trade control again. The PAPER badge and amount remain visible without overflow at small, large, extra-large, and giant sizes. Restoration must still return the original GMGN control intact when Tango is disabled.

## Testing

The implementation will be test-first and include:

- Adapter tests for address-bound Four.meme/Flap and other registered launchpad detection, rule supply, and the unknown-platform provisional 1B fallback.
- Engine tests showing a calibrated fractional position can be sold at 100% without `invalidArithmetic`, with no residual position or cost.
- Content runtime tests showing OFF to ON immediately renders the shell, requests quote replay, scans existing cards, and runs without reloading or duplicating work.
- Adapter resize tests covering four distinct slot heights and a re-rendered native control, asserting the replacement geometry and size classes update each time.
- Existing supply-priority, calibration, guaranteed-fill, quick-buy latency, and paper-only release safety tests.
- Full `npm test`, `npm run check`, `npm run build`, source/build hash comparison, and Chrome plugin-directory hash comparison before completion.

## Release behavior

After verification, rebuild `dist/tango-paper-trader`, synchronize it to the main Chrome unpacked-extension directory, and verify every packaged file by SHA-256. The user will still need to click Reload on `chrome://extensions`; no browser automation will attempt to bypass Chrome's extension-page restrictions.
