# 0.3.47 verification / 验收记录

- 2026-10-17: fresh full regression: 1,332 tests passed, zero failures; manifest validation passed.
- Both floating surfaces support proportional edge/corner resizing from 75% to 150%, independent remembered scales and default-size buttons.
- Settings schema adds only validated layout-scale preferences. Quoting, engine/settlement, chart markers and history implementations are unchanged from accepted 0.3.46.
- Runtime tests cover all eight resize directions, viewport clamping, zoom-aware drag coordinates, independent settings persistence/reset, invalid preferences, no-op gestures, save failure, untrusted input, pointer ownership, navigation/master-switch/context-invalidation cancellation, and account state preservation.
- A capture-phase click guard prevents a resize release from reaching trade controls when nodes are rebuilt. No trading is initiated by a resize.
- Independent headless local Chrome fixtures checked long symbols, large amounts, all 23 panel controls and both surfaces at 75%/100%/150%, in actual 500x545 and 1008x673 viewports. Buttons and windows stayed within bounds; horizontal text overflow was corrected with wrapping. These were isolated local layout fixtures, not live GMGN screenshots.
- The publisher manually confirmed on GMGN after loading 0.3.47 that resizing, refresh-time size persistence and restore-default work. The agent did not control the live browser for that acceptance.
- No trades, imports, resets, balance adjustments or position cleanup were performed for this release.
- Prior Today PnL local-date behavior and historical calendar records are preserved.
- ZIP contains 43 runtime files, with manifest.json directly at its root. Every entry matches PACKAGE-SHA256.json and publishing files by SHA-256.
- ZIP SHA-256: df0896b066ed30d1e7e4dd2c9f2ee790e2eb3ac1c942decee3948c82aa2829ac
- Store screenshots remain older actual captures from 0.3.38. They are not 0.3.47 screenshots and do not demonstrate the new resize controls.
- Permissions and privacy behavior are unchanged. This synchronization does not submit to or imply approval by the Chrome Web Store.
- Release: https://github.com/nopapername/tango-paper-trader/releases/tag/v0.3.47
