# GMGN Always-Clickable Paper Quick-Buy Design

**Date:** 2026-08-01
**Status:** Approved for implementation

## Goal

Make every visible Tango trench quick-buy control consistently clickable while paper trading is enabled, keep its text centered and readable across all four GMGN size profiles, and guarantee deterministic paper execution when no trustworthy K-line or market quote exists.

The change must preserve all earlier multichain, launchpad-supply, chain-isolation, marker, onboarding, and real-funds-safety fixes.

## Scope

This design covers:

- the isolated-world native quick-buy guard;
- the MAIN-world paper activation bridge;
- GMGN trench-card discovery, binding, presentation, and React reconciliation;
- no-chart paper quote construction and execution;
- neutral correction when verified launchpad or native-price dimensions arrive later;
- regression coverage and package synchronization.

It does not add wallet connectivity, signatures, approvals, swaps, RPC broadcasts, or any other real-money capability.

## Confirmed Root Causes

### Visible paper control blocked by stale guard trust

The isolated-world guard records a WeakMap identity containing the replacement element, slot, binding, action ID, and native ancestors. React can replace or reparent a native ancestor while leaving the paper element, slot, binding, and action ID coherent. The next protected event revokes the stale WeakMap entry and blocks the entire event path.

The adapter currently ignores a failed `registerPaperAction` result and its health probe does not inspect current guard trust. The result is an enabled-looking paper button whose pointer events are stopped before the MAIN-world bridge can dispatch a paper action.

### Pending metadata incorrectly disables a paper action

The adapter currently requires a confirmed trench column, token href, valid address, positive amount, and verified symbol/name metadata before activating a paper button. A newly inserted card can therefore remain `pendingOnly`, lose its action ID and handler, and be disabled even though a chain-valid token address is already available.

No K-line is not an activation dependency. The apparent correlation comes from new-card DOM and metadata races that occur at the same time as a no-chart detail route.

### Native layout geometry leaks into paper content

The sanitizer currently forwards native height, padding, font-size, line-height, gap, display, and alignment tokens. The paper replacement has different child structure from the GMGN native control, so these tokens can shrink, clip, or vertically shift its text. The `PAPER` hint is also only `0.68em`.

### Existing fallback position and newly verified supply can disagree

A position can be created while the launchpad is unknown, using the approved 1B / 3,200 USD fallback. Later, the same token may be verified as Bankr, Banker, or Clanker with 100B supply, or as Pump.fun Mayhem with 2B supply.

`executeBuy` currently validates the new quote against the old position context before it merges verified token metadata and performs neutral calibration. A valid launchpad-rule quote is therefore rejected as `invalidQuote`. This path was reproduced with an existing Robinhood 1B unknown-fallback position followed by a verified Bankr 100B paper buy.

## Approved Architecture

### 1. Always-clickable paper control state model

A visible `.tango-list-quick-buy` is always a hit-testable paper control. Readiness and duplicate suppression must not use the native `disabled` attribute.

Creation and replacement are atomic: the adapter prepares the binding, nonce, action ID, DOM attributes, and guard registration before revealing a new paper control. During React reconciliation, the last trusted paper control remains the protected visible target until its successor is fully registered; the native control remains hidden and pointer-blocked. A guard-registration failure cannot publish or reveal an untrusted successor.

Each binding has one of these logical states:

- `resolving-identity`: the card generation is known but a chain-valid address is not yet exposed;
- `ready`: a chain-valid address is bound and a paper order may execute immediately;
- `in-flight`: one paper action is executing; later activations for the same action ID are deduplicated without disabling or exposing a native event path.

The visible control retains its action ID and capture protection in all three states. The MAIN-world bridge continues to authorize only a trusted primary pointer down/up pair, supported keyboard activation, or a safe semantic click whose event is trusted, primary, and targeted at the exact registered paper element. Mouse, touch, auxiliary, drag-in, cancellation, repeat, synthetic/untrusted, and duplicate events never create an extra paper order.

When the address is already available, a click commits through the local paper path immediately and never waits for a K-line, token price, native-price network request, name, image, or launchpad label.

When the address is not yet exposed, the click records one immutable **intent-only** action against the exact slot, card node, binding nonce, chain, amount, and DOM generation. This action is handled by a separate intent callback that cannot call the trading engine. Only a later transition to `ready` may create an executable paper order.

The binding nonce is regenerated whenever the slot node, card node, chain, normalized address, amount, or card href changes, and whenever a whole-card replacement is observed. An addressless intent is keyed by that nonce and action ID; repeated clicks coalesce into one intent. It expires after 2,000 ms or is cancelled immediately when the slot/card disconnects, the chain or amount changes, the binding nonce rotates, or the card is reused.

An address may resolve an addressless intent only from a same-chain GMGN token-detail href or an approved same-chain launchpad href found inside that exact card generation. GMGN network observations may enrich metadata only after this card-derived address exists; they cannot assign an address to an otherwise addressless card. Mutation-driven reconciliation executes the intent immediately when the same generation obtains a valid address. It never applies the intent to a replacement token.

### 2. Guard trust recovery without weakening real-funds isolation

Guard validation is split into:

- **core identity:** exact replacement element, slot, binding object, action ID, paper-action marker, containment, connectedness, and non-native paper state;
- **ancestor envelope:** the current native quick-buy ancestors that contain the exact slot.

Core-identity drift always fails closed. The guard blocks the event at capture, revokes the action, and requests adapter reconciliation. It never lets the event continue to a native capture or bubble listener.

Ancestor-only drift may self-heal during capture when the core identity remains exact and the composed path reaches the registered paper element and exact slot before any unrelated native quick-buy control. The guard refreshes the ancestor envelope and authorizes that same paper event. It never authorizes a native node, a replacement outside its slot, a stale action ID, a binding whose nonce/state no longer matches, or a different token generation.

Authorization has two explicit outcomes: `resolving-identity` may publish only the non-executable intent callback, while `ready` and `in-flight` may publish the ordinary paper action callback subject to operation deduplication. Neither outcome exposes a native event path.

The adapter must check every registration result. It must never reveal an apparently active control without current guard trust. Registration, DOM publication, and old-control retirement occur in that order in one isolated-world turn. The 750 ms health probe additionally checks guard trust and schedules immediate reconciliation when needed; MutationObserver and presentation synchronization remain the primary recovery paths.

Native GMGN quick-buy leaves remain hidden and pointer-blocked from `document_start` while paper mode is active. No paper activation calls a native listener.

### 3. Owned layout and four deterministic size profiles

The renderer creates one owned content wrapper containing:

- the paper hint;
- the amount, native-asset icon, and native symbol.

The outer paper control is the hit target and fills the actual `.BuyButton-continer` slot even when mounted inside a preserved GMGN action host. The inner owned wrapper carries the selected visual height/text profile and is horizontally and vertically centered inside that hit target. A transient 113 px host therefore retains a full-slot hit area while its giant visual content remains a centered 36 px profile instead of stretching or shrinking unpredictably.

The adapter derives one of four canonical size profiles from the current or cached native presentation:

| Profile | Control height | Base text |
|---|---:|---:|
| Small | 24 px | 12 px |
| Large | 28 px | 13 px |
| Extra large | 32 px | 14 px |
| Giant | 36 px | 16 px |

The amount remains `1em`. The paper hint becomes `0.80em`; both child line-heights are `1`, and the owned gap is exactly `0.22em`.

Profile selection is deterministic and never uses measured slot height:

1. canonical native height tokens map `24/28/32/36px` to small/large/extra-large/giant;
2. if height is absent, canonical native text tokens map `12/13/14/16px` to the same tiers;
3. a conflicting or unknown transient signature retains the latest stable same-column profile;
4. if the column has no stable profile, use the current chain profile;
5. if neither exists, use the large `28px / 13px` default.

Profiles are cached by chain and trench-column identity with a monotonic presentation revision. A coherent authoritative native signature change increments the revision and propagates the new profile to tracked controls in that column. Disconnecting a column removes its column cache; a chain-route change invalidates the active column/profile view. Transient loading or unmatched signatures never overwrite a stable profile.

Only stable visual tokens may be shared from GMGN: text color, background color, border, radius, outline, and shadow. Height, width, padding, font geometry, line-height, gap, display, flex/grid alignment, placement, transforms, opacity, visibility, pointer state, animation, loading, and disabled tokens cannot control the paper layout.

The stable presentation cache remains column-first and then chain-wide. All paper buttons in the same column/profile use the same background contract, preventing mixed transparent and solid cards during incremental insertion.

Geometry tests use a maximum 1 px outer-hit-box difference and a maximum 0.5 px wrapper-center difference on each axis.

This layout section supersedes both the native-geometry ownership rule in `2026-07-23-gmgn-ui-safety-shortcut-marker-design.md` and the native-geometry forwarding described in section 3 of `2026-07-24-gmgn-tab-chain-bankr-button-consistency-design.md`. Their real-funds isolation rules remain in force.

### 4. Deterministic no-chart quote pipeline

Paper execution resolves valuation dimensions independently:

- **Token price:** use an identity-consistent trustworthy GMGN/K-line price whenever present, even when exact supply is absent. If price is absent, use a trustworthy market cap divided by the independently resolved supply. If both are absent, use the applicable 3,200 USD initial market cap divided by that supply.
- **Supply:** use an identity-consistent GMGN exact supply; otherwise use a verified launchpad rule; otherwise use the unknown 1B fallback.
- **Native price:** use a fresh or last-known exact-chain observation; otherwise use the synthetic 1 USD paper-native value until neutral calibration.

A missing exact supply can never discard or replace a trustworthy live token price. A supply upgrade changes the quantity/price representation at the same valuation snapshot; it does not neutralize a genuine token-price movement between observations.

The launchpad registry remains:

| Launchpad | Chain scope | Initial supply |
|---|---|---:|
| Pump.fun standard | Solana | 1B |
| Pump.fun Mayhem | Solana | 2B |
| Four.meme | BNB Chain | 1B |
| Flap | BNB Chain | 1B |
| Zora Coins | Base | 1B |
| DYOR | X Layer | 1B |
| Bow / Bow.fun | X Layer | 1B |
| Bankr / Bankr.bot / Banker | Base, Robinhood | 100B |
| Clanker | Base, Robinhood | 100B |
| Unknown or unverified | Every supported chain | 1B |

Token symbol, name, image, and launchpad metadata are enrichment fields, not paper-fill gates. A valid chain/address may execute with an address-derived placeholder identity and be enriched later from an exact GMGN observation.

The native-asset conversion uses a fresh or last-known exact-chain native price when available. If none exists, the order uses the existing synthetic paper-native value of 1 USD so the fill remains immediate. A later trustworthy native price neutrally recalibrates only the remaining position quantity/value dimensions; it does not mutate historical trade records.

Before an additional buy or sell, execution builds a verified launch context from the current exact token identity plus the stored position. If a stronger launchpad or supply rule arrives, the engine:

1. validates the new quote against the merged verified context;
2. neutrally calibrates the remaining position while preserving cost basis and native value;
3. validates again against the calibrated position;
4. executes the requested paper order.

For example, an unknown 1B position upgraded to Bankr 100B at the same valuation snapshot receives 100 times the remaining token quantity at one hundredth the token price while retaining the same native value before the new order. A Pump.fun standard-to-Mayhem correction follows the same invariant. If a trustworthy later token price also changes, only the supply/native-dimension correction is neutral; the real price change remains ordinary paper PnL.

A partial or stale market payload cannot make a paper trade fail merely because a price dimension is absent or unusable. Invalid market dimensions are discarded and the resolver reconstructs the deterministic paper fallback. Unsupported chains, invalid addresses, wrong-token identity, insufficient paper balance, invalid settings, and unsafe arithmetic still fail explicitly.

### 5. Sell and arithmetic invariants

- A 100% sell consumes exactly the current remaining paper quantity.
- Sell proceeds are derived from one coherent price/native-price/supply snapshot.
- Supply correction occurs before proceeds calculation.
- Zero-fee, unchanged-market-cap fallback buy/sell round trips return the original native amount for 1B, 2B, and 100B supplies.
- No quote path may produce `NaN`, infinity, negative balance, `invalidArithmetic`, or millions of native units from a small paper position.
- Historical BUY/SELL records are immutable; neutral corrections are recorded separately as calibration events.

## Error and Feedback Behavior

- A ready paper click gives immediate local pressed feedback and proceeds without a market-data waiting toast.
- `in-flight` duplicate clicks remain captured and may show neutral busy feedback, but they do not disable the hit target or create another order.
- An address-resolving intent is described as resolving token identity, never as waiting for price/K-line data; it expires after the specified 2,000 ms identity window.
- A cancelled addressless intent reports that the card disappeared or changed before a token identity existed. It never reports a market-price failure and never purchases a different token.
- A missing K-line, price, native price, symbol, image, or launchpad never produces `invalidQuote` for an otherwise valid paper identity.

## Prior Behavior That Must Not Regress

- Route-derived chain context is tab-local and never writes a global selected-chain loop.
- Popup and Dashboard do not flicker between chains.
- Header balance, positions, trades, calendar deep link, and Dashboard show only the current chain.
- Enabling all features takes effect without a page refresh; disabling restores native UI intentionally and removes paper overlays and chart markers.
- The quick-disable keyboard shortcut remains synchronized with the Popup switch.
- First-run onboarding records language/principal, explains that every chain receives the configured native balance, and opens the approved GMGN referral URL.
- The detail paper panel exists before K-line or token detail data appears.
- Quick buys and detail trades publish/replay correctly positioned BUY/SELL chart lines once the chart becomes ready; disabling removes them.
- Token identity enrichment remains exact-chain/exact-address and does not mix names or images.
- Supply corrections preserve native value and cannot recreate the prior 600 ETH/BNB-style inflation.

## Test-Driven Verification

Production changes begin only after focused tests fail for the intended missing behavior.

### Cross-world activation and safety

- Integrate the adapter, isolated guard, and MAIN bridge harnesses.
- Reparent or replace native ancestors before pointer down, between pointer down/up, and after activation.
- Prove one trusted activation produces exactly one paper callback and zero native callbacks.
- Prove core binding, action ID, containment, card generation, chain, or address drift produces zero paper and zero native callbacks.
- Prove guard-registration failure cannot leave an untrusted active-looking control.
- Prove resolving-identity and in-flight controls remain hit-testable without a native `disabled` attribute.
- Prove allowed paper activations invoke zero native callbacks at both capture and bubble levels.
- Prove an addressless intent resolves only from an approved href on the same slot/card/nonce generation, coalesces duplicate clicks, expires at 2,000 ms, and cancels on amount change, chain change, disconnect, or virtual-list reuse.
- Prove a network quote alone cannot bind an addressless card.

### Layout and dynamic insertion

- Verify the owned wrapper structure and exact child order.
- Verify all four 24/28/32/36 px profiles and 12/13/14/16 px base text tiers.
- Verify the root hit box equals the GMGN slot for direct and nested action-host mounts.
- Verify the content group center equals the slot center and the paper hint computes to `0.80em`.
- Verify the outer hit box stays within 1 px of the slot and the inner wrapper center stays within 0.5 px per axis.
- Verify transient native layout/style tokens cannot affect paper geometry.
- Verify exact height/text-token profile mapping, conflict retention, large-profile default, monotonic revision propagation, column disconnect invalidation, and chain-route invalidation.
- Verify new meme insertion, GMGN size switching, initial onboarding-opened GMGN, and native-leaf reinsertion preserve one visible clickable paper control per eligible slot.
- Verify same-column backgrounds remain consistent.

### Quotes, supply, and arithmetic

- Cover every supported chain with no K-line, no token price, and no native price.
- Cover all registered launchpad rules plus unknown 1B / 3,200 USD fallback.
- Cover first buy, repeated buy, partial sell, 100% sell, and zero-fee round trip.
- Cover unknown 1B to Bankr/Clanker 100B and Pump standard 1B to Mayhem 2B upgrades before an additional buy and before a sell.
- Cover trustworthy price without exact supply, exact supply without price, partial, stale, identityless, wrong-address, conflicting, and exact GMGN observations.
- Prove a trustworthy token-price movement remains PnL while a same-snapshot supply/native correction is neutral.
- Assert no missing-market-data case emits `invalidQuote`, `nativePriceUnavailable`, `staleQuote`, or `invalidArithmetic`.
- Assert finite balances, finite quantities, preserved calibration value, and immutable historical trades.

### Full regression and release gates

- Run the complete Node test suite and extension validator.
- Run static real-funds capability checks.
- Run `git diff --check` without modifying unrelated worktree changes.
- Build only after source tests pass.
- Re-run tests and validation against the built package.
- Compare the authoritative source package and `dist/tango-paper-trader` file sets and SHA-256 hashes.
- Confirm the Chrome loading directory contains the verified package.

No live validation may click a GMGN buy/sell control, open a wallet, request a signature or approval, submit a swap, or broadcast an RPC transaction.

## Acceptance Criteria

The design is complete when:

1. every visible paper quick-buy control remains hit-testable across GMGN rerenders and size changes;
2. a valid-address paper click fills immediately even without K-line or market data;
3. an addressless click is retained only for the same card generation and never reaches a native action;
4. all four size profiles are centered, readable, and geometrically stable;
5. launchpad and unknown fallback quantities are correct and supply upgrades are neutral;
6. buy and 100% sell cannot create invalid arithmetic or inflated native balance;
7. every earlier chain, onboarding, marker, identity, and disable/restore regression remains covered;
8. source, built package, and Chrome loading directory match after all verification gates pass.
