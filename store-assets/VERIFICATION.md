# 0.3.50 verification / 验收记录

Date / 日期: 2026-10-17 (Asia/Shanghai)

- Full regression: 1,348 passed, 0 failed. Manifest V3 validation passed; 24 referenced paths resolved.
- The version contract test now expects 0.3.50; no trading test or execution logic was changed.
- User acceptance: the reloaded popup displays the author link and plugin guide correctly, and both navigate to the requested destinations.
- Link inspection: Privacy, beginner tutorial, official plugin guide and author links remain present once each, using target=_blank and rel=noopener noreferrer. The footer wraps on narrow layouts.
- Runtime changes since 0.3.49 are limited to popup markup/styles, version metadata and README. No account data was read, reset or altered; no new transactions were executed.
- Core trading, valuation, fee/PnL calculations, permissions, bilingual privacy policy and invitation behavior remain byte-for-byte unchanged.
- Public homepage author link deployed successfully via Sites; homepage content beyond its footer was retained.
- 43 runtime paths match installation, main publishing tree, ZIP entries and PACKAGE-SHA256.json. No wrapper directory, store materials, tests, logs or user backup is included in the ZIP.
- ZIP SHA-256: 0af772b5c79a6e7ab3f190e4da8a96bbf787fcd8014c2f838549a88c3a8d576c
- Existing screenshots are actual 0.3.38 captures, not new 0.3.50 screenshots. No Chrome Web Store submission or approval is implied.
- Release: https://github.com/nopapername/tango-paper-trader/releases/tag/v0.3.50
