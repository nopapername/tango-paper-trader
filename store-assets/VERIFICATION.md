# 0.3.44 verification

- Scope: issue 5 (privacy button wording) and issue 6 (Chinese-first manifest metadata) only.
- 1,305 tests passed; manifest validation and build passed.
- Chinese default locale zh_CN and English locale en resolve name, description, action title and keyboard-command description.
- Build regression checks verify both language files are packaged and missing locale inputs do not erase the previous build.
- Privacy HTML now uses “Open GMGN”, matching the Markdown policy and current UI.
- Existing app language preferences, trading, quotes, account data and permissions are unchanged.
- Publisher confirmed 0.3.44 after reload: localized extension name and updated English privacy button wording both display normally.
- Main synchronization is recorded in Git history. No Chrome Web Store submission performed.

- Independent review passed. 43 installation files match the candidate build and ZIP entry-by-entry via SHA-256. ZIP SHA-256: 11eb041a8078803bb8819fa245d6904ab5d3dc7782c1c274c20fce41db34363a.
