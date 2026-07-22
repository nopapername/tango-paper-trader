# GMGN Paper Trading UI, Quote, and Onboarding Resilience Design

Date: 2026-07-22

## Status

Approved design. This document defines the next implementation scope. It does not authorize or introduce any real-money trading path.

## Context

Tango Paper Trader supports six GMGN chains: Solana, Ethereum, BNB Chain, Base, Robinhood Chain, and X Layer. The accounts, positions, trades, balances, and analytics for each chain remain independent.

The current implementation has five related failures:

1. GMGN button-size changes can misalign paper quick-buy controls or cause controls to disappear.
2. A paper buy can fall back to a fixed `1 USD` token price when a detail page has no chart or token response, producing quantities of only hundreds of tokens.
3. Disabling all features does not always clear existing paper buy/sell lines from chart iframes.
4. A first install does not open a guided language and paper-capital setup page.
5. Paper trades do not always appear as chart lines after trench quick-buy navigation, direct detail-page trading, delayed chart creation, or chart iframe replacement.

The failures share two architectural causes. First, execution quotes, live mark quotes, route state, and DOM state are coupled in the content runtime. Second, button and chart behavior assume GMGN nodes remain stable even though GMGN frequently rebuilds token cards, quick-buy slots, and chart iframes.

## Goals

- Keep paper quick-buy controls correctly aligned and present for every eligible visible token card across all GMGN button sizes.
- Execute every valid paper order immediately without waiting for a network response.
- Prefer trustworthy GMGN or chart-backed live prices everywhere as soon as they exist.
- Use deterministic launchpad or unknown-token fallback valuation when no live observation exists.
- Preserve immutable executed quantities and costs while allowing live marks to update immediately.
- Keep the paper trading panel available on a valid token-detail route even when chart and token payloads are absent.
- Make chart markers event-driven, replayable, and removable on disable.
- Open a first-install onboarding page for language and common per-chain native capital.
- Preserve the existing chain isolation model.
- Improve runtime performance by limiting DOM and quote work to affected identities.

## Non-goals and safety boundary

- No wallet connection, signature request, token approval, swap request, RPC transaction, transaction serialization, or broadcast.
- No click on or delegation to GMGN real buy/sell controls.
- No retroactive rewrite of an already executed paper quantity or cost basis.
- No cross-chain aggregation inside the GMGN content panel; it continues to show only the active chain.
- No dependency on a private or undocumented execution endpoint.

## Selected architecture

The implementation will separate four responsibilities while preserving the current local state engine.

### QuickBuyController

The GMGN adapter owns token-card identity discovery, paper-control binding, geometry synchronization, and restoration. A binding is keyed by chain, normalized token address, and the current quick-buy slot rather than by a long-lived original control node.

The controller reacts to:

- affected token-card or trench-column mutations;
- quick-buy slot replacement;
- token-card reuse by GMGN virtual lists;
- slot size changes;
- paper enable, disable, language, and preset changes.

It also performs a low-frequency bounded reconciliation as a recovery path. Normal mutation handling must not scan the full document.

### PaperQuoteResolver

The quote resolver creates a self-contained paper execution snapshot from locally available observations. It never waits for a new network request before committing a valid paper order. Background quote refresh remains asynchronous.

The resolver validates chain, normalized full address, source, timestamp, numeric finiteness, and provenance before considering an observation trustworthy.

### ChartMarkerController

The content runtime owns a latest marker payload per active token identity and broadcasts it to all matching chart frames. The chart bridge owns only rendering and clearing within its iframe.

Marker publication is triggered by state commits, route changes, quote upgrades, feature disable, frame readiness, and relevant iframe mutation. A low-frequency repair tick remains only as a fallback.

### OnboardingController

The background service opens a dedicated dashboard onboarding route on first install. The onboarding page validates language and common native capital, initializes every chain atomically, verifies the persisted result, and then closes itself.

## Paper quote and execution model

### Two-layer position data

Each position conceptually contains two layers:

- **Execution layer:** quantity, native amount, fees, executed price or market-cap basis, cost basis, and execution timestamp. This layer is immutable after the trade commits.
- **Mark layer:** latest live price, market cap, native-asset USD price, quote source, provenance, and observation timestamp. This layer can be upgraded by better data.

The mark layer must never silently rewrite the execution layer.

### Synchronous execution precedence

At paper buy or sell time, choose the highest available valid source in this order:

1. A fresh, trustworthy GMGN or chart-backed live token price for the same chain and address.
2. The click-time trench-card market cap divided by a verified launchpad supply.
3. A verified launchpad initial market cap divided by its verified launchpad supply.
4. The unknown-launchpad fallback: `3,200 USD / 1,000,000,000 tokens`, or `0.0000032 USD` per token.

A launchpad is "verified" only when the registry has an explicit chain-scoped rule for both total supply and initial market cap. Supply-only recognition is insufficient for step 3. If either value is unverified, use step 4. This prevents an inferred or mislabeled launchpad from being treated as factual.

The launchpad registry remains data-driven. Every rule records chain, normalized platform aliases, supply, initial market cap, and provenance. Existing special supply cases such as Pump.fun Mayhem and 100-billion-supply Base/Robinhood launchpads remain distinct. A rule is added only with a dedicated test fixture that proves address-bound launchpad detection.

### Live quote upgrade behavior

As soon as a trustworthy GMGN or chart-backed live price appears, it becomes authoritative for:

- current position value;
- unrealized and realized PnL inputs;
- direct detail-page paper buys and sells;
- position-window sells;
- paper panel price and market-cap display;
- chart marker positioning;
- subsequent trades.

If a position was opened with a provisional launchpad or `3,200 USD` fallback, its already executed quantity and historical cost stay unchanged. The difference between provisional execution and the new market observation appears as ordinary PnL.

No code path may manufacture a `1 USD` token price solely because token data is missing.

### Native-asset price

The active chain's native-asset price uses the freshest trustworthy GMGN major-coin observation first, followed by the existing background price sources and a valid same-chain historical observation. A missing token quote must not prevent use of an already known native price.

If no factual native price exists, the paper engine may use its explicit provisional native-price rule, but must mark the observation provisional and upgrade it immediately when factual data arrives.

## Quick-buy control lifecycle and layout

### Identity and reconciliation

An eligible card must provide:

- the active chain;
- a valid full token address from the card route or same-address launchpad link;
- address-bound token metadata;
- a positive configured native buy amount;
- a current GMGN quick-buy slot.

For each affected card, reconciliation compares the expected binding with the actual DOM. It creates, updates, moves, or removes exactly one paper button. Detached slots release event handlers and resize observations. Reused cards cannot retain the previous token's action.

GMGN may reconcile its native quick-buy control back into a slot. While paper quick-buy is enabled, the controller must re-establish the paper binding without allowing the native control to receive the paper click. When paper quick-buy or all features are disabled, the current GMGN control is restored without reparenting a stale original node from another card.

### Geometry

The paper control derives its current geometry from the live slot and, when present, the current native control before that control is suppressed. It uses flexible layout and size-aware typography rather than fixed absolute offsets for the amount label.

The design must support GMGN's small, large, extra-large, and giant modes. Size changes update only the affected controls. Zero-size or disconnected nodes are deferred until connected geometry exists rather than being permanently skipped.

### Event safety

The main-world guard intercepts only elements marked as Tango paper actions. It stops pointer, mouse, touch, and click propagation before GMGN handlers and dispatches a deduplicated local paper action ID. A paper event never calls the original native quick-buy handler.

## Detail panel behavior without chart data

A valid GMGN detail route is sufficient to create a token context. The panel does not depend on a chart iframe or a successful token API response.

Until GMGN metadata arrives, the route context may use verified trench metadata saved for the same chain and address, followed by persisted position or trade metadata, followed by an address-only label. Later metadata upgrades are address-bound and cannot mix a name or logo from another token.

When no live quote exists, the panel shows the provisional valuation source and remains fully usable for paper buys and sells through the deterministic resolver.

## Chart marker lifecycle

### Publication

After a successful paper buy or sell state commit, the content runtime immediately rebuilds and force-publishes the active token's marker payload. It does not wait for storage subscriptions, the render loop, or the one-second repair tick.

On trench-to-detail navigation, the route context is rebuilt from the URL and saved chain-local trades. Entry and exit lines can therefore be constructed before a fresh detail quote exists.

### Replay

When a chart iframe posts `READY`, the parent sends the latest payload even if the signature was sent to a previous iframe. When a matching iframe is added later or replaced, the parent treats it as a new consumer and replays the payload.

When a trustworthy live price upgrades a provisional mark, marker positions are recomputed and published immediately.

### Clearing

On all-features disable, route invalidation, or chain invalidation, the parent first publishes `{ markers: [] }` to every current chart frame, clears per-frame signatures, and only then drops token context and UI state.

The chart bridge must clear its overlay when it receives an empty payload. A frame created while features are disabled receives only an empty payload, so stale lines cannot reappear.

## First-install onboarding

### Opening behavior

`chrome.runtime.onInstalled` opens the onboarding dashboard route only when `details.reason === "install"`. Extension updates do not reopen onboarding.

If the user closes onboarding before initialization, the popup continues to direct the user to setup. No partially initialized account is persisted.

### Form and initialization

The page contains:

- language selection;
- one finite positive native-capital input, defaulting to `10`;
- a statement that each chain gets the same numeric quantity of its own native asset;
- a statement that all balances are local paper funds and chains remain independent;
- a statement that language and capital can later be changed from the extension UI.

For example, entering `10` creates independent starting balances of 10 SOL, 10 ETH on Ethereum, 10 BNB, 10 ETH on Base, 10 ETH on Robinhood Chain, and 10 OKB on X Layer.

Successful submission initializes all chains in one coordinated storage mutation. The page reads the state back, confirms initialization and balances, then calls `window.close()`. If closure is unavailable, it displays a completed state telling the user the page can be closed.

### Later capital changes

Changing language does not affect accounts or history.

Changing initial paper capital requires an explicit confirmation because it resets every chain's paper balance, positions, trades, realized PnL, and analytics. Other display and behavior settings remain intact. After reset, every chain receives the new common numeric native balance.

## Error handling and arithmetic invariants

- Quotes with an invalid chain, invalid or mismatched address, untrusted source, expired timestamp, `NaN`, infinity, negative values, or impossible supply are rejected before merge.
- Quote absence selects a deterministic fallback instead of failing the paper order.
- Exact 100% sell uses the persisted remaining position quantity; it does not reconstruct quantity by multiplying a rounded percentage.
- All engine inputs are checked before mutation, and storage success is required before showing a success toast.
- A paper action ID is idempotent for its click window so pointer and click events cannot create duplicate trades.
- A storage failure leaves state unchanged and permits a new paper click. It never creates an external request.

## Performance requirements

- Mutation processing is scoped to affected cards, quick-buy slots, trench columns, and chart iframe nodes.
- Resize processing updates only the observed slot.
- Full-page quick-buy reconciliation is low-frequency and bounded; it is not executed for every mutation.
- Token quotes are keyed by chain plus normalized address and merged once per observation.
- Rendering and marker publication are coalesced within a frame where possible, except for explicit force-clear and post-trade publication.
- Expensive text scanning is not performed inside a high-frequency global observer callback.

## Testing and acceptance

### Automated tests

Add failing regression coverage before implementation for:

- all six chains: quick buy, detail buy, 25%, 50%, and exact 100% sell, plus chain isolation;
- every verified launchpad rule and the unknown `3,200 USD / 1 billion` fallback;
- removal of the implicit `1 USD` token fallback;
- trustworthy GMGN/chart live prices overriding provisional marks and all subsequent operations without rewriting executed quantity;
- same-address and cross-chain quote contamination rejection;
- four GMGN button sizes, entire-card replacement, slot replacement, virtual-list reuse, rapid mutation batches, zero-size-to-connected transitions, and no missing or duplicate paper buttons;
- valid detail routes without charts or token payloads still rendering the paper panel;
- quick-buy navigation and direct detail trades publishing markers immediately;
- delayed and replaced chart iframes replaying markers;
- all-features disable clearing existing frames and frames created afterward;
- install-versus-update onboarding behavior, common per-chain initialization, verified close behavior, interrupted onboarding, and confirmed all-chain reset after capital change;
- exact 100% sells remaining finite under provisional and live quote paths.

### Manual extension verification

Build the unpacked extension and verify on GMGN using only Tango-labeled paper controls. Do not click GMGN real trade buttons, wallet controls, approval prompts, or signing surfaces.

Verify:

- each button size on at least two trench columns;
- paper-button persistence after scrolling and size changes;
- immediate paper quantity for a no-chart token;
- live mark replacement when GMGN/chart data appears;
- chart lines after trench navigation and direct trades;
- line removal immediately after disabling all features;
- onboarding on a clean extension profile and non-reappearance on update;
- the final unpacked directory at `dist/tango-paper-trader`.

## Documentation and release impact

Update user documentation to describe:

- first-install language and capital setup;
- equal numeric native capital per independent chain;
- launchpad and unknown-token provisional valuation;
- live GMGN/chart price precedence;
- capital-change reset behavior;
- the paper-only safety boundary.

The release build must refresh `dist/tango-paper-trader` after tests pass.
