# ClearQuotes: James Clear 3-2-1 widget (unofficial)

A macOS WidgetKit widget with a small host app, plus an iPhone Scriptable script. Each day both show one of James Clear's "3 ideas from me" from his 3-2-1 newsletter, read from jamesclear.com's public WordPress JSON API. The Mac and the iPhone pick the same idea for the same widget size. See README.md for the user-facing setup and the design ("How it works").

If `CLAUDE.local.md` exists (git-ignored), read it too: it holds the owner's machine-specific details.

## Status

- The parser and engine are verified: all 375 issues (as of October 2026) parse to exactly 3 ideas, and the JS and Swift engines produce identical picks.
- Built and run with Xcode 27 on macOS 27 (Apple Silicon); the deployment target is macOS 14.
- "Another idea" and "Previous idea" (skips), the archive fallback and the backup additions are in both engines, and the tests check that JS and Swift agree on them.

## Layout

- `Shared/QuoteEngine.swift`: fetching, parsing, the daily pick and the cache (Foundation only). It mirrors `iPhone/James Clear 3-2-1.js` rule for rule.
- `Shared/QuoteCardView.swift`: the SwiftUI layout shared by the widget and the app.
- `Widget/`: the WidgetKit extension (`ClearQuotesWidgetExtension.appex`). It is sandboxed with `network.client`. `NextIdeaIntent` and `PreviousIdeaIntent` (in `ClearQuotesWidget.swift`) are the "Another idea" and back buttons.
- `App/`: the host app.
  - Widget clicks arrive as `clearquotes://open?url=<issue>`. `AppDelegate.application(_:open:)` opens jamesclear.com links in the browser.
  - `App/Info.plist` registers the scheme.
- `Tests/`: offline parser and engine tests (Node and Swift) plus an optional live test.
- `tools/make_xcodeproj.py`: regenerates `ClearQuotes.xcodeproj` (objectVersion 56, written by hand). When adding source files, add them there and rerun it, or edit `project.pbxproj` carefully.
- `Fallback/`: the optional archive backup. A build phase copies `Fallback/archive.json` (if present) into the app and the widget, and `ArchiveFallback` serves the API from it when the site can't be reached. Each device adds posts published after the backup to its cache (`additions`, see `extendArchive`). `tools/make_archive.mjs` builds it from `Tests/fixtures/`. See `Fallback/README.md`.

## Build, install, verify (macOS 14+, full Xcode needed, not just the Command Line Tools)

1. Run `xcode-select -p`. It should point into `Xcode.app`. If Xcode is missing, ask the owner to install it from the App Store; you cannot do that for them.
2. Signing. Use the owner's free Personal Team.
   - To find the team ID, look for `OU=` in `security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject`, or try `defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier`.
   - A free Apple ID is enough (Personal Team); no paid developer account is needed for a widget on the owner's own Mac.
   - Signing in to iCloud on the Mac is not enough: the Apple ID must also be listed in *Xcode > Settings > Accounts*.
   - Xcode only creates the Apple Development certificate when it is needed. If it is missing, ask the owner to create it: *Xcode > Settings > Accounts*, select the Apple ID, *Manage Certificates...*, then *+ > Apple Development*. Alternatively, `-allowProvisioningUpdates` can create it during the build once the account is in Xcode.
   - Never ask for passwords.
   - codesign may trigger a Keychain prompt. Tell the owner to click **Always Allow**.
3. Archive backup and personal notes. Both are git-ignored, so a fresh clone has neither.
   - If `Fallback/archive.json` is missing, the build has no offline fallback. Tell the owner before building and offer to create it (see `Fallback/README.md`).
   - If `CLAUDE.local.md` is missing, ask the owner whether they keep a copy elsewhere (for example next to their archive backup) to copy in.
4. Build:
   ```
   xcodebuild -project ClearQuotes.xcodeproj -scheme ClearQuotes -configuration Release \
     -derivedDataPath build -allowProvisioningUpdates DEVELOPMENT_TEAM=<TEAMID> build
   ```
   - If signing fails because the bundle ID is taken, change `BUNDLE_ID_PREFIX` (default `se.ulfgran`) in `tools/make_xcodeproj.py` and regenerate.
   - Last-resort unsigned build (the widget may then not register): `CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM=`.
5. Install and launch:
   ```
   ditto build/Build/Products/Release/ClearQuotes.app /Applications/ClearQuotes.app
   open /Applications/ClearQuotes.app
   ```
   The window should show today's idea.
6. Verify:
   - Check that the extension is registered: `pluginkit -m -v -p com.apple.widgetkit-extension | grep -i clearquotes`.
   - Check click forwarding: `open "clearquotes://open?url=https://jamesclear.com/3-2-1"` should open the browser and the app should quit.
   - Check the signature, which must still be valid when `Fallback/archive.json` is bundled: `codesign --verify --deep --strict /Applications/ClearQuotes.app`.
   - For widget logs, use `log show --last 15m --predicate 'process == "ClearQuotesWidgetExtension"'`.
7. Avoid duplicate widgets in the gallery by unregistering the build copy:
   ```
   /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u build/Build/Products/Release/ClearQuotes.app
   ```
8. Only the owner can add the widget to the desktop: right-click the desktop, choose *Edit Widgets...*, and search for "James Clear". macOS has no command for this, so ask them and ask what they see.
9. iPhone: if `~/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/` exists, copy `iPhone/James Clear 3-2-1.js` there and it syncs to Scriptable on the owner's iPhone. Adding the widget on the phone is up to them.

## Rules for changes

- Keep `Shared/QuoteEngine.swift` and `iPhone/James Clear 3-2-1.js` in sync: settings (`QuoteConfig` and `CONFIG`), parsing and the pick rules. After any engine or parser change, run `Tests/run_tests.sh`. It fails if the two disagree on any idea or pick.
- Keep the JS file pure ASCII. Write non-ASCII characters as `\uXXXX` escapes.
- In Swift, use `\u{XXXX}` in string literals and `\x{XXXX}` inside the raw-string regex patterns.
- Be polite to jamesclear.com.
  - Tests download the archive once into `Tests/fixtures/` (4–5 requests). Use `--refresh` to update it; it keeps the old files if the download fails or shrinks.
  - Never loop over issue pages. A widget needs about 2 requests a day.
- The project uses Swift language mode 5 (`SWIFT_VERSION = 5.0`). Swift 6 mode would flag the `completion` captures in `ClearQuotesWidget.swift`.
- All ideas are James Clear's. This repository must never contain them: don't commit `Tests/fixtures/`, `Fallback/*.json` or anything else with newsletter text.

## Git

- This is a public repository. Never commit `build/`, `Tests/fixtures/` (the downloaded archive), `Fallback/*.json` (the archive backup), `Tests/out/` or `*.local.md` (personal notes). `.gitignore` already excludes them.
- Don't push or create remote repositories without the owner's go-ahead.
