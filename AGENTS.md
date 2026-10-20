# Tango development handoff

This repository contains the extension source, complete automated tests, build/validation scripts, and store materials. Read `DEVELOPMENT.md` and `docs/development/HANDOFF.md` before making changes.

- Keep the current extension behavior unless the user explicitly requests a change. Protect existing balances, positions, historical trades and token-review notes.
- Run commands from the repository root. Use Node.js 22+ and a locally installed Chrome/Chromium. There are no external npm dependencies; `npm install` is not required. Set `CHROME_PATH` when Chrome is installed outside a detected location.
- Verification: `npm test`, `npm run check`, `npm run build`. On Windows PowerShell, `npm.cmd` avoids the optional npm.ps1 execution-policy issue.
- `src/` is the editable source. `dist/tango-paper-trader/` is generated installable output. Never edit generated files as the only source of a fix.
- Extension version metadata is in `manifest.json`, `src/shared/constants.js`, and `package.json`; the static version contract is in `tests/validate-extension.test.js`.
- Keep test fixtures self-contained and use repository-relative paths. Do not refer to a previous machine's Temp directory. Test synthetic records must remain distinguishable from user records.
- Do not weaken route/chain/address identity, quote provenance, native exchange-rate freshness, account synchronization, confirmation or native-button safety guards to make a test pass.
- Notes use independent local storage with a closed-shadow editor. Preserve dirty drafts, stale-edit conflict checks and legacy-backup compatibility.
- Do not publish browser profiles, credentials, account exports, private notes, local audit logs or user screenshots. The public HTML fixtures are reduced market-card/base-info/settings fragments, not account backups.
- Build output and store-upload ZIPs must exclude tests, scripts, development notes, credentials and user exports. The only store-upload package is `store-assets/tango-paper-trader-<version>.zip`; supplementary listing files remain unpacked.
- Publishing is a separate user-authorized step: verify the intended runtime files against ZIP entries and SHA-256 metadata before pushing a version tag. The tag-triggered workflow publishes those verified assets. Do not force-move an existing release tag.
- Browser tests operate only explicitly identified paper controls. Preserve user holdings and distinguish user activity from test activity. Report when a browser feature or extension-internal page cannot be verified, rather than claiming full live coverage.
