# GMGN Tab Chain, Robinhood Bankr, and Quick-Buy Consistency Design

**Date:** 2026-07-24

## Goal

Stop cross-tab chain oscillation in the Popup and Dashboard, correct Robinhood Bankr paper quantities when no chart exists, and make dynamically inserted trench quick-buy buttons use the same transparent, size-aware presentation as existing GMGN buttons.

## Confirmed Root Causes

### Cross-tab chain oscillation

Every GMGN content-script instance currently persists its own URL chain to the single global `settings.selectedChain`. Two open tabs on different chains therefore form a storage feedback loop:

`BSC tab -> bsc -> Robinhood tab -> robinhood -> BSC tab -> bsc -> ...`

Popup and Dashboard subscribe to the same storage keys, so the loop appears as rapid chain switching and full-page flicker.

### Robinhood Bankr quantity inflation

Robinhood Bankr correctly uses a 100-billion supply with the fixed 3,200 USD initial market cap when no K-line, price, or market cap is available. The inflation starts later:

- the recursive GMGN extractor gives `total_supply`, `totalSupply`, and generic `supply` the same "exact" trust;
- equal-timestamp nested fragments overwrite earlier fragments by traversal order;
- a generic nested `supply: 1B` can therefore replace an explicit `total_supply: 100B`;
- the content resolver combines that supply-only observation with the historical 3,200 USD fallback market cap and derives a 100x token price;
- Engine updates the mark while preserving the previously executed quantity, so a 6 ETH position can settle near 600 ETH.

The Bankr 100B rule and sell arithmetic are not the source of the error. The error is field-trust inflation, cross-observation dimension mixing, and non-neutral correction of a provisional dimension.

### Mixed transparent and solid quick-buy buttons

The stable presentation cache recognizes synthetic `gmgn-small`, `gmgn-large`, `gmgn-xl`, and `gmgn-giant` classes used by tests, while live GMGN uses Tailwind dimension classes such as `!h-[24px]`, `!px-[6px]`, `!leading-[12px]`, and `!text-[12px]`.

When a new meme card appears before its native quick-buy leaf, no stable presentation is available. Tango creates a safe paper button with `tango-quick-buy-fallback`, whose CSS forces a solid theme-color background. Existing buttons copy GMGN's transparent presentation, producing a mixed page.

## Approved Architecture

### 1. Tab-scoped GMGN chain context

- A content script must never persist a route-derived chain to global settings.
- Page overlays, positions, balance, quotes, and paper actions continue to use `Tango.Chains.fromUrl(location.href)` directly.
- When Popup opens, it queries the active tab. A supported GMGN URL supplies a view-only chain for that Popup instance.
- The Popup active-tab chain must not write storage.
- An explicit Popup selector change remains a user preference: it clears the view-only active-tab override and persists `settings.selectedChain`.
- Dashboard remains driven only by its validated `?chain=` deep link or an explicit persisted selector choice. Background GMGN tabs cannot change it.
- Storage subscriptions remain authoritative for portfolio/settings changes, but no background tab can create a selected-chain write loop.

### 2. Explicit launchpad dimensions and trustworthy quote upgrades

The launchpad registry remains keyed by chain, platform, and launch mode:

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
| Unknown or unverified launchpad | Any supported chain | 1B |

- A missing price/K-line uses the platform supply above and the existing 3,200 USD fallback market cap.
- Only explicit `total_supply` or `totalSupply` fields from an identity-consistent GMGN object may claim exact total-supply trust.
- Generic `supply` is not exact total supply.
- Conflicting address aliases reject the observation instead of selecting by key order.
- Explicit USD price fields outrank generic `price`. Generic price is accepted only with same-observation USD/coherence evidence.
- Equal-time conflicting explicit supplies become ambiguous and cannot calibrate a position.
- Supply-only observations never combine with a historical fallback market cap to manufacture a new live price.
- When price, market cap, and supply coexist, `price * supply` must be materially coherent with market cap before the dimensions may be combined.
- A trusted correction to a provisional supply or provisional native-asset price preserves the remaining position's native value by adjusting only the remaining paper quantity. The original BUY/SELL records remain immutable and a calibration audit records before/after quantities.
- A real token-price movement against the intentional 3,200 USD entry snapshot is not neutralized; after dimensions are trusted, subsequent price changes produce normal paper PnL.
- Paper buys and sells remain immediate and never wait for market data.
- Existing contaminated paper history is not silently repriced or deleted; the previously selected balance-remediation path remains a separate explicit operation.

### 3. Stable, transparent quick-buy presentation

- Stable shared presentation is extracted from real GMGN classes, including height, width, padding, font size, line height, gap, alignment, radius, and transparent-background tokens.
- Transient classes and styles such as loading, disabled, opacity, pointer state, gradients, inline background, and per-card status are never shared.
- A dynamically inserted leafless card first reuses the stable presentation from its trench column, then the current chain.
- If no trusted presentation has appeared yet, the safe fallback fills the GMGN slot but remains transparent and inherits text color.
- When a native presentation later appears, the paper button upgrades immediately.

## Real-Funds Safety Boundary

- No test or validation step clicks a GMGN buy/sell control.
- Native quick-buy leaves remain hidden and pointer-blocked at document start while paper mode is active.
- MAIN-world capture continues to stop pointer, mouse, touch, keyboard, and click events aimed at guarded native/paper slots.
- Tango replacements remain newly created inert `<button type="button">` elements; native nodes are never cloned.
- Action-bearing attributes (`href`, `target`, `formaction`, `data-testid`, inline handlers, and related attributes) remain stripped.
- No wallet, signature, approval, swap, RPC broadcast, or other real-money capability may be introduced.

## Verification

- A shared-storage two-content-context regression proves BSC and Robinhood routes perform zero selected-chain persistence.
- Popup tests prove active GMGN context is view-only and explicit selector changes still persist.
- A Robinhood Bankr regression proves a 6 ETH no-chart buy uses 100B, rejects a nested generic 1B supply, and a same-value 100% sell returns 6 ETH with zero PnL.
- A dimension-correction regression proves only the remaining position quantity is neutralized, while original trades remain immutable and later factual price changes create normal PnL.
- Adapter tests use live-form Tailwind class bundles and a dynamically inserted native-leafless card.
- Full tests, static real-money capability checks, package build, and source/dist hash equality are mandatory.
