# 0.3.45 verification

- Fresh release verification: 1,315 tests passed; manifest validation passed. Build and independent read-only review passed during implementation.
- Runtime messaging contains synchronous context-invalidated throws and asynchronous rejections. Confirmed dead contexts stop background quote requests and the quote interval; startup does not recreate that interval. Transient failures can recover, and unrelated programming errors are not silently suppressed.
- Detail holdings retain token quantity and display the existing mark value in the current chain native asset, independently of the USD display preference. Unavailable valuation displays a dash; existing trade controls remain unchanged.
- Six-chain native/USD display, quantity-change and missing-price tests passed. Real Chrome light/dark layout tests passed at 200/280/360 pixel widths with long symbols.
- Read-only IAB acceptance passed on existing SOL and BSC holdings: native amounts match the panel valuation basis; all eight sell presets remain; measured holding text has no overflow. No page-level errors observed in that session.
- Publisher confirmed the isolated extension-reload check: after opening a fresh 0.3.45 GMGN page, clearing old errors and reloading Tango without refreshing that page, no new error was added.
- No test transactions, imports, resets or position cleanup were performed for this release. Existing positions were retained.
- 43 installed runtime files match the candidate build and ZIP entry-by-entry by SHA-256. ZIP SHA-256: 7796416373b76befdcf85de58009371d758b2f3ad32d760259728e07f3197dc3.
- Main synchronization is recorded in Git history. GitHub Release: https://github.com/nopapername/tango-paper-trader/releases/tag/v0.3.45 . Chrome Web Store approval is not claimed.
