# Tango Paper Trader English listing

Version 0.3.57

Name: Tango Paper Trader

Short description: Paper trade tokens across six GMGN chains with local, bilingual portfolio analytics.

Detailed description:

Tango is a completely free Meme paper-trading practice tool independent of GMGN. Practice entries, scaling, percentage exits and recovering principal using simulated funds. It does not connect wallets, sign transactions or broadcast real trades.

Use independent accounts on Solana, BSC, Ethereum, Base, Robinhood Chain and X Layer. Compatible trench cards offer labeled paper quick buys and native-asset holding-value badges. Token-detail panels show quotes, market caps and PnL, with percentage sells and a recover-principal action.

Review recorded buy/sell points from History or token detail pages. A dashed fill-to-fill path is explicitly labeled as non-market history when complete market data is unavailable. Compatible charts support virtual entry/exit lines. Use PnL calendars, daily-report PNGs, trade-result images, CSV exports and full-account JSON backups. English/Chinese and light/dark themes are supported.


Paper data stays in the current browser. Tango reads public GMGN market observations and may request reference quotes from CoinGecko and DEX Screener. Simulated results do not guarantee live performance. Site changes and missing quotes can limit compatibility.

Alongside token quantity, the detail trading panel displays the holding value in the chain native asset (such as SOL or BNB). Unavailable valuations show a placeholder; execution calculations are unchanged.

The bottom Today PnL bar shows realized net PnL from sells on the current chain for the browser's local date. It starts a new daily total at midnight, excludes unrealized PnL, and preserves balances, positions and historical calendar records.

Drag an edge or corner to resize the bottom PnL bar and detail trading panel proportionally (75%–150%). Text and controls scale together; each surface remembers its size. Click ↺ to restore the default size. Resizing does not change trading, quotes, PnL calculations, balances or positions.

In single-chain trenches, the primary paper button follows the explicit GMGN column amount and the secondary button follows its current native preset. Empty values retain a positive paper fallback; explicit zero or invalid values disable the affected action. Combined cards use Tango native-coin buy presets 1 and 2 for their own chain, without converting GMGN mixed-column amounts.

The popup includes the detailed plugin guide and author @oooooyoung X profile next to Privacy. External pages open only when clicked.


Token review: use the compact note-icon button above the buy balance to write entry ideas, invalidation reminders or a trade summary in one field. One note is saved per chain, contract and browser-local date, including tokens not yet traded or already closed. Daily review in the PnL calendar filters notes by date and chain for reading/editing. Notes stay in this browser and are not automatically uploaded: up to 4,000 characters per note within a separate 1 MiB budget. JSON backups include notes; older backups without notes preserve existing notes on import.

Embedded detail-page trenches also support paper quick buys. After a paper buy, Tango follows the observed GMGN after-buy setting: new tab, same-tab navigation or no opening. Open GMGN Custom once per single-chain/combined view to synchronize this preference; until observed, no navigation occurs.
