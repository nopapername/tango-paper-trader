# 0.3.46 verification / 验收记录

- 2026-10-17: full local regression: 1,319 tests passed, zero failures; manifest validation passed.
- The bottom bar reads the current chain's complete daily realized-PnL ledger for the browser's local date, rather than a cached cumulative portfolio summary. Native/USD formatting matches calendar day cells.
- Midnight rollover is checked on the existing visible-page timer and when the page becomes visible. No additional polling timer or account writes were introduced.
- Controlled-clock tests cover midnight, empty days, all six chain ledgers, negative/collapsed/USD display, and unchanged state. Actual overnight browser waiting was not performed.
- Publisher manually confirmed that the displayed Today PnL matches today's calendar value, balances and holdings remain unchanged, and historical calendar days remain available. The agent lacked browser controls for this acceptance; this is publisher-reported verification.
- Other cumulative account/PnL views and trading calculations are unchanged. No trades, imports, resets or cleanup were performed for this change.
- ZIP contains 43 runtime files at its root. Each ZIP entry matches PACKAGE-SHA256.json and the publishing files by SHA-256.
- ZIP SHA-256: c02dfd6e75a07de5e54ff562df451b7eec8e779bd3671201c312142b680c5c0a
- Store screenshots remain historical captures from 0.3.38; they are not new 0.3.46 screenshots.
- Permissions and privacy behavior are unchanged. Chrome Web Store submission/review is not performed by this synchronization.
- Release: https://github.com/nopapername/tango-paper-trader/releases/tag/v0.3.46
