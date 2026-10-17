# 0.3.49 verification / 验收记录

Date / 日期: 2026-10-17 (Asia/Shanghai)

- Full regression: 1,348 passed, 0 failed. Manifest V3 validation passed; 24 referenced paths resolved.
- Targeted amount/preset/combined regression: 35 passed, 0 failed. An isolated title test fixture was made independent of other tests' global document; no runtime change was needed for that fixture.
- Independent review found no blocking issue in the same-URL route-identity fix. Two regressions reproduced the cold-start issue before the fix and passed afterward.
- Six-chain seeded independent ledger: 150 random buy/sell events plus final exits; checks fees, slippage, changing native/USD rates, cash, quantity, remaining cost, realized/unrealized PnL, per-chain isolation and calendar totals.
- Live audit across the 0.3.48-to-0.3.49 fix/acceptance cycle confirmed 12 buys and 14 sells on SOL, BSC, Ethereum, Base, Robinhood and X Layer. Test positions closed; pre-existing holdings were not operated, and no reset or balance rewrite was performed.
- Post-fix cold-load combined buys opened previews and settled. Mixed-card native units and target accounts were checked. Single-chain primary amount changes followed GMGN on all six chains; BSC secondary preset changed 0.5 to 0.73 and back correctly. GMGN explicit zero disabled the primary, while empty values retain a positive fallback by user preference.
- Actual Tango preset UI showed 0.1/0.2 for all six accounts. Combined SOL/BSC, Robinhood/X Layer, Base and ETH cards matched those target-native presets. Changing a mixed-column input to 3.7 did not change Tango amounts; all temporary inputs, gear selections, master state and the original SOL/BSC/Robinhood selection were restored.
- Card holding badges agreed with the drawer valuation. Fill review points/retained rows, partial-sell cost allocation, final account PnL, calendar and daily report were checked. The daily report PNG downloaded. ETH historical sell lines reappeared after reload, and hiding one line removed only that line.
- Limits: extension-internal dashboard/popup pages were not automatically accessible in the embedded browser. Actual speaker output was not audibly assessed by tools. Rounded live displays were cross-checked; exact ledger arithmetic is asserted separately in isolated tests.
- 43 runtime paths match local installation, main-branch publishing tree, ZIP entries and PACKAGE-SHA256.json byte for byte. ZIP entries contain no wrapper directory, store materials, tests, logs or user backup.
- ZIP SHA-256: d55e21549d064d7509fcd9b92e98878782b318f61092d5b3856e1d21ae41470e
- Existing store images are actual 0.3.38 captures, not new 0.3.49 images. Their scope is disclosed in README.md and the submission guide.
- Permissions, bilingual privacy policy and invitation code behavior remain unchanged. No Chrome Web Store submission or policy approval is implied.
- Release: https://github.com/nopapername/tango-paper-trader/releases/tag/v0.3.49
