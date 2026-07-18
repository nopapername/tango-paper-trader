# GMGN Multichain Paper Trading Design

## Goal

Extend Tango Paper Trader from Solana-only paper trading to the first supported multichain release while preserving the current Solana feature set and making every chain an independent paper-trading workspace.

The first release supports these registered chains:

| Chain ID | GMGN route slug | Display name | Native asset | Address family |
| --- | --- | --- | --- | --- |
| `sol` | `sol` | Solana | SOL | Solana Base58 |
| `eth` | `eth` | Ethereum | ETH | EVM |
| `bsc` | `bsc` | BNB Chain | BNB | EVM |
| `base` | `base` | Base | ETH | EVM |
| `robinhood` | `robinhood` | Robinhood Chain | ETH | EVM |
| `xlayer` | `xlayer` | X Layer | OKB | EVM |

Robinhood Chain is initially configured with ETH as its native gas asset. This is registry data rather than engine behavior, so it can be corrected without a storage or trading-engine migration if GMGN exposes a different definition.

Each chain starts with 10 units of its native asset. Existing users retain their complete Solana account and receive new accounts with 10 native units on the other five chains.

## Product Invariants

Every operational feature is chain-local:

- The GMGN URL selects exactly one active chain.
- The trading panel, PnL bar, header account summary, position drawer, inline PnL calendar, chart markers, breakeven action, and close-all action read only the active chain.
- Dashboard positions, history, calendar, settings, CSV export, and result cards read only the explicitly selected chain.
- Trades never debit, credit, close, reset, or repair metadata for another chain.
- The same token address on different EVM chains represents different positions and cache entries.

The only cross-chain presentation is a compact USD summary in Popup and Dashboard overview. It reports total assets and total paper-trading PnL; it does not expose a mixed-chain position list or mixed-chain trading action.

The extension remains local-first and paper-only. It will not request wallets, private keys, signatures, activation codes, user accounts, or real transactions.

## Chain Registry

Add a dependency-free chain registry loaded before the engine and GMGN adapter. Each entry defines:

- Canonical chain ID and display name.
- GMGN route slug and URL construction behavior.
- Native asset symbol and CoinGecko native-price identifier.
- Address family and validator.
- Optional DEX Screener chain identifier.
- Optional wrapped-native fallback token address.
- Default native network fee.
- Default buy presets.
- Page capabilities such as token detail, trench quick buy, and chart markers.

Only registered chains can create orders. Unknown GMGN route values fail closed. The registry is the single source of truth; content, background, Popup, Dashboard, formatting, and tests must not maintain separate chain lists.

DEX Screener support is explicitly nullable. A chain without a verified DEX Screener mapping still works from GMGN quotes but does not guess an external endpoint.

Page capabilities are conservative. Detail-page paper trading is required for every registered chain. Trench injection and chart markers activate only when GMGN exposes the corresponding compatible component for that chain. Missing optional GMGN UI is a documented capability downgrade, not permission to synthesize a separate market or chart.

## Persisted Data Model

Upgrade state storage from schema version 1 to schema version 2.

The state contains:

```js
{
  schemaVersion: 2,
  accounts: {
    [chain]: {
      initialBalanceNative,
      cashBalanceNative,
      realizedPnlNative,
      createdAt,
      updatedAt
    }
  },
  positions: {
    ["chain:normalized-address"]: {
      chain,
      tokenAddress,
      quantity,
      costBasisNative,
      realizedPnlNative,
      lastNativePriceUsd,
      // Existing identity, entry, quote, and valuation fields.
    }
  },
  trades: [],
  dailyRealizedByChain: {
    [chain]: {
      [localDate]: {
        native,
        usdAtExecution
      }
    }
  },
  initialized: true
}
```

Version 2 trade records replace Solana-specific names with native-asset names, including `amountNative`, `platformFeeNative`, `networkFeeNative`, `realizedPnlNative`, `nativePriceUsd`, and `nativeSymbol`. Sell records also store `realizedPnlUsd` at execution time for deterministic historical exports and calendar summaries.

Positions and trades retain the canonical chain ID. Position keys remain `chain:normalized-address`, which already matches the engine's identity model.

Settings split into global and per-chain values:

- Global: enabled, language, display currency, theme, sell presets, slippage, platform fee, fast mode, confirmation, sound, list quick buy, and layout positions.
- Per chain: buy presets, native network fee, and reset principal.

All six chains initially receive independent copies of the current buy presets: `[0.1, 0.2, 0.5, 1, 2, 3, 5, 10]` native units. All six chain settings initially use `0.001` native units as the simulated network fee, matching the existing Solana behavior. These are separate stored values from initialization onward, so editing one chain never changes another. A later registry-only release may tune the defaults for newly created accounts without rewriting an existing user's settings.

## Migration and Import Compatibility

The version 1 to version 2 migration is pure and idempotent.

- The version 1 `account` becomes `accounts.sol` without changing its initial balance, cash balance, realized PnL, or timestamps.
- Existing Solana positions and trades are retained. Solana-specific amount and fee names are mapped to version 2 native names.
- Existing `dailyRealized` becomes `dailyRealizedByChain.sol`.
- Existing buy presets and `networkFeeSol` become Solana chain settings.
- ETH, BSC, Base, Robinhood, and X Layer accounts are created with 10 native units.
- Missing per-chain settings are filled from the registry.
- Re-reading migrated data does not recreate balances, duplicate trades, or change timestamps.

The importer accepts valid version 1 and version 2 Tango backups, normalizes them to version 2, and rejects unsupported schemas, unknown chains, invalid addresses, non-finite balances, negative quantities, and malformed account references. Export always writes version 2.

Reset has two explicit commands:

- Reset the selected chain, clearing only its account, positions, trades, and calendar while preserving all other chains.
- Reset all chains, clearing all paper-trading data after a stronger confirmation.

The default reset balance is 10 native units. The existing custom-principal workflow remains available for the selected chain.

## Trading Engine

Make the engine native-asset neutral while preserving its existing formulas and safety checks.

For a buy on chain `C`:

1. Resolve `accounts[C]` and the registered native asset.
2. Validate the token quote and the current native-asset USD price.
3. Debit `amountNative` from only `accounts[C].cashBalanceNative`.
4. Calculate net investment after chain-local network fees and the global platform fee.
5. Calculate token quantity using `netInvestmentNative * nativePriceUsd / executionPriceUsd`.
6. Update only the `C:address` position with weighted cost basis.

For a sell, proceeds, fees, cost share, realized PnL, and remaining cost basis are denominated in the chain's native asset. The sell also records execution-time USD PnL. Partial sell, full sell, breakeven sell, mark-to-market, and weighted entry behavior remain mathematically equivalent to the Solana implementation.

Close all is chain-local. It attempts only positions on the selected chain, closes positions with fresh executable quotes, retains positions without a fresh quote, and returns explicit per-position failures.

Market-cap valuation remains available for GMGN surfaces that provide market cap without a real token price. Its synthetic divisor is internal to relative valuation and must not be presented as a real market price. Price-axis chart markers require a real or ratio-derived price; market-cap-axis markers may use recorded market caps directly.

## Quote Pipeline

Token quotes follow this order:

1. Fresh quotes reused from GMGN page network responses.
2. Values read from the verified current GMGN detail or trench DOM.
3. DEX Screener fallback only when the chain registry has a verified mapping.
4. Fail the order when no fresh executable token quote is available.

Native-asset USD prices are fetched and cached by native asset and chain configuration:

- SOL uses the Solana price source.
- ETH is shared by Ethereum, Base, and Robinhood Chain.
- BNB uses the BNB price source.
- OKB uses the OKB price source.

Wrapped-native DEX fallback is allowed only where the registry supplies a verified address and DEX chain mapping. A missing native price blocks execution and marks USD aggregation as incomplete.

All token quote caches and in-flight requests use `chain:normalized-address` keys. Native-price requests can coalesce for chains sharing the same native asset, such as Ethereum, Base, and Robinhood.

The MAIN-world GMGN response tap annotates extracted quotes with the active registered chain derived from the request URL and current GMGN route. An unbound payload or a quote whose address does not validate for the active chain is ignored. It never assigns a `0x` quote to every EVM chain.

Last-known token and native prices are allowed for read-only portfolio valuation. They are not refreshed to the current timestamp or used to create a new trade. Buy, sell, breakeven, and close-all require fresh executable data.

## GMGN Integration

Generalize current route and address assumptions through the registry:

- Token detail routes accept only `/{registered-chain}/token/{validated-address}`.
- Root/trench routes accept only a registered GMGN chain query value.
- Solana uses Base58 validation and retains Pump.fun-specific parsing.
- ETH, BSC, Base, Robinhood, and X Layer use normalized EVM addresses.
- Position links use the position's registered chain instead of a fixed Solana route.
- Background tab opening validates both the chain segment and the address before opening GMGN.

The detail adapter keeps the current fail-closed identity rules: a header must be bound to the current route address, transient stale SPA content must not replace the active token, and only verified address-bound metadata may update a position.

Trench injection additionally verifies that the card, link, route, address, and replacement slot all belong to the active chain. A chain without a compatible trench capability receives no injected quick-buy control. Disabling the extension or leaving the supported route restores the original GMGN controls.

Chart marker payloads already match both chain and address. The iframe bridge remains shared; it receives markers only for the active chain and token.

## User Experience

### Popup

- Add a registered-chain selector.
- Display the selected chain's native cash, equity, PnL, and position count.
- Display a compact all-chain USD asset and paper-trading PnL summary separately.
- Initialize a new installation with six accounts of 10 native units each.
- Allow selected-chain principal reset and an explicit all-chain reset.
- Keep one global extension enable/disable switch.

### GMGN page

The GMGN URL determines the active chain. The trading panel, buy and sell presets, PnL bar, position drawer, header asset summary, PnL calendar, confirmations, sounds, result notifications, and chart markers show only that chain.

The upper-right account summary always displays the current route chain's native balance. It never shows a cross-chain total. The position drawer contains only current-chain positions and has no all-chain filter. Close all affects only the current chain.

### Dashboard

Dashboard has a selected-chain context. Positions, history, calendar, settings, CSV export, reset actions, and result cards operate only on that chain.

Overview may show a separate all-chain USD total asset and total paper-trading PnL summary, followed by per-chain account cards. It does not show or operate on a combined position list.

Single-chain views use the chain's native unit. Result cards and CSV rows include chain, native symbol, native/USD execution price, native amounts, and USD PnL. JSON backup includes every chain because it is a full disaster-recovery artifact.

All-chain total assets are the sum of each chain's current native equity multiplied by its current native/USD price. All-chain paper-trading PnL is the sum of each chain's native trading PnL multiplied by its current native/USD price. Native-asset price appreciation by itself is not counted as strategy PnL. When any native price is unavailable, the UI labels the aggregate as partial rather than treating the missing chain as zero.

## Formatting and Language

Replace Solana-specific amount formatting at call sites with a native-asset formatter that receives chain or native symbol. Existing SOL formatting remains compatible for migrated data. English and Simplified Chinese copy must cover chain selection, current-chain scope, partial USD summaries, unsupported chains, invalid addresses, missing native prices, and partial close-all failures.

No page should display `SOL` for an ETH, BNB, Base, Robinhood, or X Layer account because of a fallback formatter.

## Error Handling

- Unsupported chain: do not render trading controls and do not create an order.
- Invalid chain-specific address: discard the context or quote.
- Missing or stale token quote: block execution with a localized message.
- Missing native/USD price: block execution and mark USD totals partial.
- SPA chain or token change: clear stale current context and re-verify route, address, and DOM metadata.
- Close-all partial failure: commit successful current-chain closes, retain failed positions, and report the failed token count and reason.
- Import failure: leave existing local data unchanged.
- External quote failure: clear the in-flight lock so a later request can retry.

## Test Strategy

Implementation follows test-first red/green/refactor cycles.

### Registry and routing

- Every registered chain has a unique ID, GMGN slug, native asset, address family, and defaults.
- All six detail routes resolve correctly.
- Solana and EVM address validators accept and reject representative values.
- Unknown chains and mismatched address families fail closed.

### Engine and isolation

- Each chain can buy, add, partially sell, fully sell, sell to breakeven, and close all with the same behavioral contract.
- A trade changes only the selected chain account.
- The same EVM address on ETH, BSC, Base, Robinhood, and X Layer creates independent positions.
- Chain-local network fees and buy presets do not leak across chains.
- Cross-chain USD assets and PnL use the correct native price without counting native-asset appreciation as trading PnL.
- Close all never touches another chain and reports stale-quote failures.

### Migration and storage

- Version 1 Solana state migrates byte-equivalently in economic value.
- Five new accounts receive exactly 10 native units.
- Repeated normalization is idempotent.
- Version 1 import succeeds; invalid version 2 data fails without overwriting storage.
- Selected-chain reset preserves every other chain.
- All-chain reset clears every account exactly once.

### Quotes and background

- Token cache and in-flight work are isolated by chain and address.
- Shared native assets coalesce native-price requests.
- Per-chain DEX mappings construct the correct endpoint.
- Chains without verified DEX fallback do not guess an endpoint.
- Failed requests release locks and can retry.
- GMGN network quotes are bound to the active chain.

### GMGN fixtures and content structure

- Solana detail and trench regression fixtures retain existing behavior.
- EVM detail fixtures validate address-bound identity and token context.
- Supported trench fixtures inject only in the active chain's slot.
- Route changes clear stale chain context.
- PnL bar, header assets, drawer, calendar, markers, and close-all receive current-chain data only.
- Dashboard chain selection prevents mixed-chain operational tables and actions.

### Verification

After each implementation task and at completion, run:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
git status --short
```

Perform a manual GMGN smoke test for each currently accessible registered chain. Verify detail trading everywhere and record trench/chart capability downgrades where GMGN does not expose compatible components.

## Scope Boundaries

This release does not:

- Dynamically trust unknown GMGN chains.
- Add a wallet, real transaction path, account server, or cloud synchronization.
- Build an independent market list or chart for chains lacking GMGN components.
- Merge positions, history, calendars, settings, or trading actions across chains.
- Add third-party quote providers beyond the registered GMGN, CoinGecko, and verified DEX Screener paths.
- Migrate the dependency-free IIFE architecture to a framework or bundler.

## Completion Criteria

The work is complete when:

- All six registered chains support independent detail-page paper trading with the current Solana trading feature set.
- Optional trench and chart features activate only on verified compatible GMGN surfaces.
- Existing Solana data migrates without economic or identity loss.
- Every operational component and action is current-chain-only.
- Popup and Dashboard report correct, explicitly separated all-chain USD summaries.
- Quote and address validation fail closed without cross-chain cache or metadata contamination.
- Existing and new tests pass, static validation passes, the unpacked extension builds, and manual smoke-test results are documented.
