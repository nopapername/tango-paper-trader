# GMGN UI Safety, Shortcut, Onboarding, and Marker Accuracy Design

## Goal

Fix GMGN quick-buy layout and lifecycle failures, improve paper-trade marker accuracy, make first-install capital guidance explicit and dynamic, unify generic GMGN entry links, and add an `Alt+Shift+P` master toggle without ever invoking GMGN's native real-money buy path.

## Scope

This change applies to all six supported chains: Solana, Ethereum, BNB Chain, Base, Robinhood Chain, and X Layer. It changes only extension UI, local paper-account settings, and chart overlays. It must not add wallet access, signatures, approvals, swaps, RPC broadcasts, or any other real-money operation.

Token-specific links from positions and history remain exact GMGN token-detail links. Generic extension entry points that merely open GMGN use exactly:

`https://gmgn.ai/r/X9cuc5jd?chain=bsc`

## Confirmed Root Causes

Live inspection on the BSC trench page showed that GMGN performs a multi-stage DOM transition when its custom button size changes. The same slot first measured about 22 px high and later about 113 px high. Existing code inferred four named GMGN sizes from height thresholds, so multiple modes collapsed into the `giant` presentation.

GMGN's React reconciliation also rewrote class attributes after Tango injection. Tango `data-*` binding attributes could remain while Tango's structural class disappeared, leaving a slot that looked bound but no longer received the intended layout CSS. Newly created and virtual-list-reused Meme cards use the same intermediate states, which explains both malformed UI and intermittently missing controls.

The chart bridge retained canvas axis labels for up to 120 seconds unless a sufficiently large `clearRect` call was observed. GMGN chart redraws do not guarantee that invalidation signal, so stale labels from a previous scale could contaminate the regression used to place a paper-trade line.

## Quick-Buy Architecture

### Inert presentation shell

Tango will no longer guess GMGN's named size from slot height. For each eligible quick-buy leaf, Tango creates an inert presentation shell from the current native control's visual contract:

- Copy the native tag-independent presentation signature: class list and non-action visual inline styles.
- Do not copy child nodes or JavaScript listeners.
- Remove `id`, `data-testid`, `href`, `target`, `formaction`, and every attribute whose name begins with `on`.
- If the shell is a button, force `type="button"`. Otherwise expose paper-button semantics with `role="button"` and `tabindex="0"`.
- Add only Tango-owned content and `data-tango-paper-action="quick-buy"`.

Tango's paper badge and amount use `font: inherit` and responsive overflow rules. GMGN remains responsible for the outer geometry, alignment, colors, and four size modes. Tango CSS must not force a fixed height, width, background, padding, or alignment that overrides the copied GMGN presentation.

### Presentation reconciliation

Each binding stores a presentation signature derived from the live native control. When GMGN recreates a native leaf during a size or page transition:

1. Revalidate the active chain, exact card address, amount, and verified card metadata.
2. Compare the new native presentation signature with the bound signature.
3. Rebuild or refresh the inert Tango shell if presentation changed.
4. Remove the newly reconciled native control every time, even when the presentation is unchanged.
5. Reassert Tango lifecycle classes and data attributes because React may overwrite `class` independently of `data-*`.

Resize observation covers the live slot and its immediate geometry wrapper. Normal mutations remain incrementally batched. A 750 ms safety probe performs only cheap selector checks; it requests a full reconciliation only when it detects a native quick-buy leaf inside an eligible trench card, a tracked slot without a connected Tango leaf, or an eligible visible slot without a Tango binding. It does not continuously parse every card.

### New cards and virtual-list reuse

Card identity always comes from the same live card as the button slot. A reused card whose route address changes invalidates its previous action ID before rebinding. A zero-sized or transitional card remains pending until geometry and metadata become coherent. Once coherent, it is injected without waiting for a full-page refresh.

## Real-Money Safety Invariants

The paper quick-buy path uses defense in depth:

1. The Tango control is an inert shell; DOM event listeners from the native GMGN node are never cloned.
2. Navigation, form-action, test-hook, and inline event attributes are stripped.
3. The MAIN-world capture bridge intercepts pointer and click events for `data-tango-paper-action="quick-buy"`, calls `preventDefault()`, `stopPropagation()`, and `stopImmediatePropagation()`, then publishes only the Tango paper action ID.
4. The isolated-world handler validates the current chain, card, address, binding key, and action ID before executing a local paper order.
5. Any native GMGN quick-buy control reconciled into a bound slot is removed before the slot is considered healthy.
6. Disabling the master switch clears Tango buttons, panels, and chart markers and restores only the preserved native control where identity still matches. A virtual click must never call a native handler during either enable or disable transitions.

Automated tests attach a sentinel native real-buy handler at the leaf and ancestor levels. Pointer, keyboard, and click activation of the Tango control must produce one paper action and zero sentinel calls. Static release validation continues to reject wallet, signing, approval, swap, and broadcast code.

## First-Install Onboarding

The common-capital input defaults to 10. A localized note updates on every input event and states that each supported chain receives the entered numeric amount in its own native asset. For example, 12.5 means 12.5 SOL, 12.5 ETH on Ethereum, 12.5 BNB, 12.5 ETH on Base, 12.5 ETH on Robinhood Chain, and 12.5 OKB on X Layer.

Completion order is strict:

1. Validate the finite positive capital value and selected language.
2. Atomically reset all six paper accounts through the existing coordinator.
3. Read storage back and verify every initial and cash balance equals the requested value.
4. Open `https://gmgn.ai/r/X9cuc5jd?chain=bsc` through the extension background worker.
5. Close the onboarding tab. If the browser cannot close it, show a localized completion message and GMGN-open status.

No GMGN page opens when validation, persistence, or read-back verification fails.

## GMGN Entry Links

A single shared constant owns the generic referral URL. The popup GMGN button, dashboard GMGN button, onboarding completion, and any other generic "open GMGN" action call one validated background message that opens exactly that URL.

Token-specific navigation remains generated by `Chains.tokenUrl(chain, address)` so position and history links still open the selected token instead of discarding context.

## Master Keyboard Shortcut

Manifest V3 registers one extension command with suggested key `Alt+Shift+P`. The background worker handles only that exact command name and toggles `settings.enabled` through the existing serialized state coordinator.

The shortcut is a bidirectional master toggle:

- ON to OFF removes paper panels, quick-buy controls, header paper assets, and chart markers through the existing storage subscription lifecycle.
- OFF to ON reconstructs the current GMGN route without requiring a page refresh.
- The popup subscribes to storage changes so its switch reflects shortcut changes while it is open.
- Dashboard and content contexts continue to use their existing subscriptions.

The shortcut never issues a trade command and is independent of the active chain.

## Chart Marker Accuracy

Axis-label samples are scoped to the current canvas drawing generation. A sample is eligible only if it belongs to the latest observed generation or was refreshed within 1.5 seconds. Each canvas keeps a bounded set of recent unique axis positions.

Scale selection continues to compare factual token price and market-cap modes, but it must:

- Reject a fit with insufficient unique labels or excessive residual error.
- Prefer labels spatially belonging to the visible right axis.
- Reset the stable scale when a newer label generation materially changes the value-to-Y mapping.
- Allow only a small, one-tick extrapolation beyond the observed axis range.
- Hide a marker temporarily when no trustworthy current scale exists instead of showing it at a stale position.

The marker payload continues to preserve historical execution market cap and price. A later trusted GMGN/K-line price can provide the current factual ratio used to map that historical market cap, but it does not rewrite trade quantity, cost, or history.

## Testing Strategy

Implementation follows test-driven development. New failing tests cover:

- Small, large, extra-large, and giant native presentation signatures without height-based mode guessing.
- Two-stage 22 px to 113 px transitions and React class replacement.
- A recreated native control updating Tango presentation while never firing native handlers.
- Newly created cards, zero-size recovery, whole-card replacement, and virtual-list address reuse.
- The 750 ms safety probe doing no full scan when healthy and reconciling only on detected drift.
- Dynamic onboarding notes for 10 and 12.5 across all six native symbols.
- Verified onboarding completion opening the referral URL before closing, with no open on failure.
- Every generic GMGN entry using the shared referral URL while token detail links remain exact.
- `Alt+Shift+P` toggling the coordinator setting and popup/content subscriptions reflecting it.
- Current-generation chart samples placing a $6.028K marker near the $6.02K axis value while stale prior-scale samples are ignored.
- Safety sentinels proving paper pointer, keyboard, and click activation invokes zero native trade handlers.

The final gate runs the complete test suite, static extension validation, production build, post-build test suite, source/dist hash comparison, manifest permission review, and the documented six-chain smoke checklist. The unpacked Chrome directory remains `dist/tango-paper-trader`.

## Non-Goals

- No live wallet or real-order integration.
- No change to paper supply, quantity, fee, or fallback valuation rules.
- No replacement of token-specific deep links with the generic referral homepage.
- No continuous high-frequency full-page card parsing.
