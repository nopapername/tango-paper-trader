# 0.3.43 verification

- 1,303 tests passed; manifest validation/build passed.
- 41 installation files match the build by SHA-256.
- Publisher confirmed 0.3.42 automatically restores USD amounts within about15 seconds without manual refresh.
- .43 only refines status presentation: pending requests display refreshing without missing/expired warning; after settlement failed/missing/expired chains still warn. Actual partial USD values remain unchanged.
- .42 messaging retry and visibility refresh regressions retained. No pricing TTL/trade/account calculation changes.
- Publisher accepted .43 online: after reloading and reopening the dashboard, the loading status disappears automatically after about15 seconds without manual refresh, and USD amounts are available on all six chains.
- Main synchronization is recorded in Git history. No Chrome Web Store submission performed.
