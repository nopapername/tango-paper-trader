# Store preparation verification

0.3.38 retains all trading, account, replay, chart markers and chart recovery calculations. Changes are packaging, restored GMGN Handgun/Kaching sounds, disclosure and privacy/UI navigation choices.

Known policy blocker: optional referral is retained at publisher request; the publisher confirms there is no user discount or other user benefit. Do not describe this package as approved or submission-ready.

Official policy references checked during preparation:
https://developer.chrome.com/docs/webstore/program-policies/affiliate-ads
https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
https://developer.chrome.com/docs/webstore/program-policies/limited-use
https://developer.chrome.com/docs/webstore/images
https://docs.gmgn.ai/index/referral-link
## Final local verification (2026-10-16)

- 1,298 tests passed, 0 failed; manifest validation and build passed.
- 41 candidate/install files have identical SHA-256 hashes. Version remains 0.3.38.
- BSC Goat rich: 0.1 BNB buy, 25% sell, remaining 100% sell. Net proceeds 0.0926 BNB, realized PnL -0.0074 BNB. Test holding closed; original holdings preserved.
- Native candles and all three trade lines restored after refresh; replay shows the three actual fills.
- Publisher heard both original local cues but requested restoration of GMGN Handgun/Kaching. Restored URLs tested; final browser reload completed; publisher confirmed both original sounds. No independent audio-license verification is claimed.
- Five actual product screenshots, JPEG 1280x800. Original captures preserved under originals/. Only browser-output empty right/bottom margins were removed and the image resized; no product UI or data was altered.
- ZIP SHA-256: F26BE2B4A0BB440B306B8B6D898689903414CDFC0E8386AC3CD7FB5A644E5533.
- No store submission performed. Main-branch synchronization is recorded in Git history. Affiliate user-benefit policy gate remains unresolved.

## Reload acceptance completed

- Restored Handgun buy and Kaching sell cues confirmed by publisher on 0.3.38.
- Additional Goat rich 0.1 BNB buy and 100% sell: net proceeds 0.0945 BNB; realized loss 0.0055 BNB. Balance 7.1734 -> 7.0734 -> 7.1679 BNB. Replay contains all five fills and agrees with cumulative PnL -0.0129 BNB.
- No remaining Goat rich test position. Original BSC FLАРWНЕЕL position cost 1 BNB retained. SOL 13 position identities and costs match saved baseline; no SOL trades this round.
- Added actual BSC and SOL trench-list screenshots (04/05), JPEG 1280x800; original captures retained. No UI/data was fabricated.
- Browser viewport reset. No production-code changes or additional reload needed in this acceptance round.
