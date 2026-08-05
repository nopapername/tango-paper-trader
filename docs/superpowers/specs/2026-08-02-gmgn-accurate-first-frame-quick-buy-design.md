# GMGN Accurate First-Frame Paper Quick-Buy Design

**Date:** 2026-08-02
**Status:** Approved in conversation; awaiting written-spec review
**Scope:** Targeted amendment to the existing GMGN paper quick-buy resilience design

## Goal

Fix the three primary user-visible regressions without weakening existing behavior:

1. trench quick-buy controls sometimes cannot be clicked;
2. quick-buy text shifts vertically or renders too small;
3. a valid-address paper buy without K-line data sometimes reports that a real-time price is unavailable.

Newly created token cards must accept a paper click immediately. If the address is not yet present, the click may remain in memory briefly and finalize automatically within tens of milliseconds after exact identity evidence arrives. Accuracy has priority over retaining an ambiguous intent.

## Safety and Compatibility Constraints

- Never click, dispatch, or call a GMGN native buy/sell control.
- Never open a wallet, request a signature or approval, submit a swap, or broadcast an RPC transaction.
- One permitted activation produces exactly one Tango paper callback and zero native capture/bubble callbacks.
- Preserve current-chain balances, positions, Dashboard records, PnL calendar filtering, shortcut synchronization, onboarding, detail-panel behavior, chart markers, supply rules, and disable/restore behavior.
- Do not introduce provisional positions, mutable BUY/SELL history, reserved balances, temporary token addresses, or pending chart markers.
- Do not add WebSocket connections, permissions, network requests, or wallet capabilities.
- Existing source files remain authoritative. Build `dist/tango-paper-trader` only after every source test and validator passes.
- Preserve all staged and unstaged work. Do not stage, commit, reset, clean, stash, or switch branches.

## Evidence and Root Causes

### Mutation latency

The page observer currently accumulates mutation roots and waits 160 ms before incremental quick-buy discovery. Adapter publication is synchronous once invoked, so this timer is the main new-card-to-ready delay.

### Missing stable GMGN row generation

Read-only inspection of a real BSC trench card found:

- a `.BuyButton-continer` slot;
- a TokenItem root with `data-sentry-source-file="TokenItem.tsx"`;
- the eventual token `href`;
- virtualization position styles;
- no public row ID, generation ID, pre-address token ID, or readable React key.

Therefore, a pre-existing virtual row that silently changes logical token cannot be distinguished perfectly from ordinary first-href hydration. Automatic completion must be limited to a newly observed TokenItem root and its first address, with a short expiry and strict fail-closed checks.

### Layout leakage

Native height, padding, line-height, gap, display, and alignment classes can be copied to a replacement with a different child tree. Text then jumps between the top and bottom or becomes too small. The paper control must own its internal geometry.

### K-line/price coupling

K-line readiness is not required by the Engine. Intermittent failures occur when partial observations are treated as an execution gate instead of reconstructing a deterministic paper quote dimension by dimension.

## Selected Architecture

### 1. Fast mutation lane

Split mutation work into two lanes:

- **Fast identity lane:** during the MutationObserver callback, synchronously pass only the target and added element roots to root-scoped quick-buy discovery when settings are authoritatively enabled, state is initialized, and list quick-buy is enabled.
- **Deferred maintenance lane:** keep the existing 160 ms batch for metadata, header updates, chart replay, broad cleanup, presentation repair, and idempotent reconciliation.

The fast lane must not perform a document-wide scan. It handles only a bounded number of slots from the current mutation roots. Overflow remains queued for the deferred lane.

When a valid same-chain card href and positive amount already exist, the adapter atomically publishes `ready` in that same observer turn. Symbol, name, logo, launchpad, price, supply, native price, and K-line are enrichment only.

When the address is absent, the adapter atomically publishes an enabled `resolving-identity` paper control. No native control becomes clickable.

### 2. Ephemeral card birth certificate

Maintain a WeakMap-backed, non-persistent record only for TokenItem roots actually observed through `addedNodes`:

```text
CardBirth {
  card, slot, root,
  generation, chain,
  bornAt,
  firstAddressHref,
  eligible
}
```

The record is invalidated when the card, slot, or root disconnects or changes; the route chain, amount, settings, or adapter generation changes; a prior valid href existed; multiple conflicting addresses appear; an href is removed or rewritten; or the extension is disabled.

An attribute-only mutation on a pre-existing virtual row cannot create a birth certificate. It may become an ordinary `ready` action once an address exists, but it cannot consume an earlier addressless click automatically.

### 3. Immediate click acceptance

All visible paper states remain hit-testable and never use native `disabled`:

- `resolving-identity`
- `ready`
- `in-flight`

On a `resolving-identity` activation:

1. The Guard and MAIN bridge block the native event path.
2. The adapter synchronously re-reads card-local address evidence.
3. If a valid address is already present, it atomically promotes the exact binding to `ready` and consumes this same paper activation.
4. Otherwise it records one immutable, in-memory intent for that exact action and birth certificate.

The intent TTL is exactly 300 ms. Repeated activation of the same action ID and binding nonce coalesces to one intent. It does not call the Engine, deduct cash, create a position or trade, publish a marker, or write storage.

### 4. Accurate short-window auto-finalization

The first valid href may automatically consume the intent only when all of these remain exact:

- the same card, slot, TokenItem root, card birth, adapter generation, action ID, and binding nonce;
- the same route chain, binding chain, amount, paper setting, and enabled state;
- the href is the first and only valid same-chain address observed for that birth;
- the card/root/slot stayed connected and no prior address was removed, restored, or rewritten;
- current time is at or before `intent.createdAt + 300`;
- atomic promotion obtains current Guard trust.

Passive GMGN fetch/XHR observations may confirm the same normalized `{chain,address}` but can never assign an address to a card or override failing DOM/birth checks.

After promotion, the normal ready handler revalidates route, card-local href, normalized address, amount, quote, balance, and settings immediately before Engine execution. Only then may one paper order commit.

Any ambiguity cancels the intent without changing paper assets. The now-addressed card may still publish a normal enabled `ready` button for an explicit click.

### 5. Atomic publication and real-funds isolation

Every successor binding follows the existing atomic order:

1. stage unpublished DOM and complete identity;
2. register exact Guard identity;
3. verify Guard trust;
4. publish typed action map entry;
5. reveal the paper action;
6. retire the previous binding and remove native leaves.

Failure restores the previous protected publication. Old action IDs/nonces cannot call the successor. Native callbacks remain zero at capture and bubble levels during ready, resolving, promotion, failure, and React ancestor replacement.

## Owned Button Layout

The paper button fills the complete GMGN quick-buy slot. A single owned inner wrapper holds the hint and amount and is centered horizontally and vertically.

Canonical profiles remain:

| GMGN size | Wrapper height | Base text |
| --- | ---: | ---: |
| Small | 24 px | 12 px |
| Large | 28 px | 13 px |
| Extra large | 32 px | 14 px |
| Giant | 36 px | 16 px |

- Amount text: `1em`.
- Paper hint: `0.80em`, increased from the previous undersized presentation.
- Both child line-heights: `1`.
- Owned gap: `0.22em`.
- The outer hit target remains full width and height regardless of profile.

Height, padding, font-size, line-height, gap, flex/grid direction, placement, transforms, visibility, opacity, and pointer state from GMGN cannot enter the paper layout. Only stable color/background/border/radius/outline/shadow tokens may be shared.

The text group cannot move from bottom to top during size changes, React reinsertion, or new-card hydration. All four sizes and both direct/nested action-host mounts use the same centered structure.

## Deterministic No-K-Line Execution

For a valid supported chain and address, lack of K-line or real-time market data is never an execution failure.

Resolve dimensions independently:

1. **Token price:** trustworthy exact price; otherwise trustworthy market cap divided by supply; otherwise fallback initial market cap divided by supply.
2. **Supply:** GMGN exact; otherwise verified launchpad rule; otherwise unknown 1B.
3. **Native price:** fresh or last-known exact-chain observation; otherwise synthetic paper-native price of 1 USD.

Fallback initial market cap is 3,200 USD. Supply rules remain:

- Pump.fun standard 1B;
- Pump.fun Mayhem 2B;
- Bankr/Banker/Bankr.bot/Clanker on Base and Robinhood 100B;
- Four.meme, Flap, Zora, DYOR, and Bow 1B;
- unknown launchpad 1B.

A valid identity must not emit `nativePriceUnavailable`, `staleQuote`, `invalidQuote`, or a real-time-price error merely because market dimensions are missing. Unsupported chain, invalid address, insufficient paper balance, invalid settings, and unsafe arithmetic remain explicit failures.

Later trustworthy price/supply/native observations update the position through existing factual-PnL and neutral-calibration rules. Historical trades remain immutable.

## Feedback and Failure Behavior

- Clicking `resolving-identity` immediately shows that the paper click was accepted and token identity is being confirmed.
- It must not say that market data, K-line, or real-time price is being awaited.
- A successful short-window promotion uses the ordinary paper success feedback.
- Identity drift or expiry clears only the intent and reports that token identity changed and the user may click the now-ready paper button again.
- Promotion registration failure preserves the previous protected paper button and may retry within the remaining TTL; it never exposes native input.
- Disabling all features synchronously cancels births/intents, removes paper UI and chart lines, then intentionally restores native UI through the existing controlled path.

## Performance Boundaries

- Address-known new card: `ready` publication completes in the same mutation callback turn, without the 160 ms timer.
- Addressless click: intent creation completes synchronously.
- Eligible first-href completion: auto-finalization occurs within the 300 ms TTL and is scheduled without a market/network wait.
- Fast discovery is incremental, root-bounded, idempotent, and slot-budgeted.
- Metadata, quote enrichment, layout repair, broad cleanup, and marker replay remain deferred.
- WeakMap births and expired intents are reclaimed; no persistent pending-order state is added.
- Existing passive fetch/XHR capture is reused without new requests or permissions.

## Test-Driven Regression Matrix

Production changes begin only after focused tests demonstrate the missing behavior.

### Clickability and identity

- A complete newly added card becomes `ready` from the observer callback before the 160 ms timer runs.
- An addressless new card exposes one enabled resolving action in the same turn.
- A resolving click with an address that appeared immediately before dispatch promotes and executes that same click exactly once.
- A first href at 300 ms is accepted; at 301 ms it cannot auto-execute.
- Card/slot/root replacement, chain/amount/route/settings drift, conflicting href, href rewrite, disconnect, and pre-existing virtual-row attribute hydration all cancel automatic execution.
- Twenty duplicate/reordered activation messages still produce at most one paper order.
- Every permitted case has one paper callback and zero native callbacks at every native ancestor in capture and bubble phases.

### Layout

- Exact owned wrapper/child order and full-slot hit target.
- Four canonical sizes with `12/13/14/16px` text and `0.80em` hint.
- Text center tolerance at most 0.5 px per axis; outer hit-box difference at most 1 px.
- GMGN size changes, new meme insertion, direct/nested mounts, presentation fallback, React reinsertion, and column background propagation cannot shift text or remove hit testing.

### No-K-line execution

- Every supported chain with no K-line, token price, native price, symbol, image, or launchpad metadata.
- Exact 1B/2B/100B and unknown-supply fallback arithmetic.
- Quick buy, detail buy, repeat buy, 25% sell, and exact 100% sell.
- No valid-address missing-market case emits a real-time-price error, `invalidQuote`, `staleQuote`, `nativePriceUnavailable`, or `invalidArithmetic`.
- Later factual observations reposition markers/calibrate positions without mutating BUY/SELL history.

### Existing-product preservation

- Current-route chain controls header balance, positions, trades, Dashboard, and PnL deep links without selected-chain write loops or flicker.
- Popup master switch and `Alt+Shift+P` remain synchronized.
- Onboarding still gives every chain the configured native principal and opens the approved referral URL.
- Detail panel and BUY/SELL chart lines work before and after K-line readiness; OFF clears them and ON reconstructs them.
- Source suite, validator, static real-funds scan, build, post-build suite, and source/package SHA-256 identity all pass before the unpacked extension is reported ready.

## Superseded Behavior

This design narrows the previously approved 2,000 ms addressless auto-claim behavior:

- automatic consumption is limited to 300 ms;
- it requires a TokenItem root observed as newly added plus its first valid address;
- a pre-existing or unverifiable virtual row cannot auto-consume an addressless click.

All other Guard, nonce, atomic publication, four-size layout, deterministic quote, supply calibration, chain isolation, marker, onboarding, and release requirements remain in force.

## Acceptance Criteria

The change is complete only when:

1. every eligible trench card shows a full-slot, centered, readable, clickable paper button without a native event leak;
2. address-known cards fill immediately and newly added addressless cards accept a click synchronously, auto-filling only when exact first-address evidence arrives within 300 ms;
3. no valid-address no-K-line buy fails for missing real-time price dimensions;
4. 1B/2B/100B quantities, sell proceeds, balances, and markers remain finite and correct;
5. every existing chain, UI, onboarding, shortcut, marker, enable/disable, and package-integrity regression passes unchanged;
6. no wallet, signature, approval, swap, transaction, RPC broadcast, native GMGN activation, or real-funds capability is introduced.
