# ClearQuotes: a 3-2-1 idea-of-the-day widget

> **Unofficial.** This project is not affiliated with or endorsed by James Clear. It contains none of
> his writing: the widget loads his ideas live from the public archive on jamesclear.com and always
> links back to the issue. Please use it for yourself and be gentle with his site.

One idea a day from James Clear's *3-2-1* newsletter, on your Mac desktop and your iPhone.

- **Source:** the public 3-2-1 archive on jamesclear.com (every issue since August 2019, about 1,100 of his own "3 ideas from me"). No account, no API key, and only about two small requests a day.
- **Rotation:** Friday to Sunday show that week's new issue (ideas I, II, III). Monday to Thursday walk through the archive, so each issue comes up once a year.
- **Same idea everywhere:** the Mac and the iPhone pick the same idea on the same day for the same widget size. Smaller widgets only pick ideas that fit.
- **Another idea:** not feeling today's idea? Swap it until one resonates, and go back if the earlier one was better. The choice stays until midnight, and the next day starts fresh. Swaps are per device, so after one the Mac and the iPhone can differ until the next day.
- **Mac:** click the widget to open that issue on jamesclear.com, or click the small arrows in the top-right corner for another idea. After a swap, a ‹ button next to them goes back.
- **iPhone:** tap the widget for a menu with *Another idea* (and *Previous idea* after a swap) and *Open this issue*. The widget shows a swapped idea at its next refresh (within about an hour).
- **Keep an idea as a picture (iPhone):** *Save as image* puts the idea, in the widget's style, on a picture the size of your screen and saves it to Photos. *Save as Lock Screen image* places it lower, below the clock, for use as a Lock Screen wallpaper.
- **Offline:** shows a cached idea and tries again later. With an optional personal archive backup (see [`Fallback/README.md`](Fallback/README.md)), it keeps showing the usual daily idea even if the site is down or gone.

## How it works

- **Why the newsletter:** James Clear's ideas are also on X, but its API costs money per post and needs a developer account, and scraping it needs a login. The 3-2-1 archive is public and served by the site's WordPress JSON API (`/wp-json/wp/v2/3-2-1`).
- **Only his own ideas:** each issue's "3 ideas from me" section is parsed out of the HTML. Quotes from others and the weekly question are left out. The parser handles every issue in the archive (all 375 as of October 2026 give exactly three ideas).
- **One pick, two engines:** `Shared/QuoteEngine.swift` (Mac) and `iPhone/James Clear 3-2-1.js` (iPhone) implement the same rules line for line, so both devices agree without talking to each other. The tests check that they produce identical picks.
- **The daily pick:** from Friday to Sunday, the newest issue's ideas I, II and III. Otherwise a walk through every issue published before 1 January (a step of 7919, a prime larger than the archive), so nothing repeats within a year. If that issue has no idea short enough for the widget size, a few issues are tried at random (seeded by the date). Requests: the newest issue once a day, plus the day's issue unless it is cached.
- **Another idea and back:** each press moves the day's "skip" count by one. Skip *n* picks from the whole archive with hashes salted by the day and *n*, never repeating an idea shown earlier that day. Because each skip's pick is fixed, going back shows exactly the earlier idea.
- **Widget clicks on the Mac:** macOS sends widget clicks to the containing app, and an `https` link may never reach it. So the widget links to `clearquotes://open?url=<issue>`, and the tiny host app opens the issue in your browser and quits.
- **Optional archive backup:** if you build with `Fallback/archive.json` (your own download, never committed), the widget runs the same rules against it when the site can't be reached. Each device keeps the posts published after the backup, so the fallback stays current.

## Mac (macOS 14 Sonoma or later)

1. Install **Xcode** from the Mac App Store (free). Open it once, then add your Apple ID under *Xcode > Settings > Accounts*. A free Apple ID is enough.
2. Open `ClearQuotes.xcodeproj`.
3. Click the blue **ClearQuotes** project icon in the left sidebar. For **both** targets (`ClearQuotes` and `ClearQuotesWidgetExtension`), go to *Signing & Capabilities* and set **Team** to *Your Name (Personal Team)*.
4. Choose your own bundle identifier prefix: open *Build Settings* for the project, search for `BUNDLE_ID_PREFIX`, and change `se.ulfgran` to something unique to you, such as `com.yourname`.
5. Press **Cmd-R**. A small window opens and shows today's idea.
6. Right-click the desktop, choose **Edit Widgets...**, search for **James Clear**, and drag a size onto the desktop. You can also put it in Notification Center (click the clock in the menu bar).

**Make it permanent (recommended):** in Xcode choose *Product > Show Build Folder in Finder*, open *Products > Debug*, drag **ClearQuotes.app** to *Applications*, and open it once. Then choose *Product > Clean Build Folder* so the widget isn't listed twice.

## iPhone (Scriptable)

1. Install **Scriptable** (free) from the App Store.
2. Add the script in one of two ways:
   - Save `iPhone/James Clear 3-2-1.js` to *iCloud Drive > Scriptable*. It appears in the app.
   - Or in Scriptable tap **+**, paste the file's contents, and name the script *James Clear 3-2-1*.
3. Run it once inside Scriptable. You'll get a menu with *Another idea*, *Previous idea* (after a swap), *Open this issue*, *Save as image*, *Save as Lock Screen image*, *Copy idea*, previews and *Reset cache*. Tapping the widget opens the same menu. The first save asks for permission to add photos.
4. **Home Screen:** long-press, tap **Edit > Add Widget > Scriptable**, choose a size and add it. Then long-press the widget, choose **Edit Widget**, and set **Script** to *James Clear 3-2-1*.
5. **Lock Screen (optional):** customize the Lock Screen, add a Scriptable widget (rectangular or inline), and pick the same script.

Bonus: in the Shortcuts app, a *Run Script* action with this script returns today's idea as text. You could use it in a morning automation or notification.

## Building with Claude Code (optional)

Claude Code can build, install and check the Mac widget for you, because it runs on your Mac and can use Xcode. Install it (`curl -fsSL https://claude.ai/install.sh | bash`), then run `claude` in this folder and ask it to build and install the widget. It reads `CLAUDE.md` for the steps. You still need to install Xcode, add your Apple ID to Xcode once, approve its commands, and add the widget to the desktop yourself.

## Settings

| Setting | Scriptable (`CONFIG`) | Mac (`QuoteConfig` in `Shared/QuoteEngine.swift`) |
|---|---|---|
| Show the new issue Fri-Sun | `newIssueFirst` | `newIssueFirst` |
| Longest idea per widget size | `maxChars` | `maxChars` |

Keep both files in sync if you change a setting, so the two devices keep matching.

## Tests

`Tests/run_tests.sh` needs Node 18+ and Xcode's `swiftc`. It downloads the archive once into `Tests/fixtures/` (4-5 requests, git-ignored) and then runs offline: the parser, the daily picks, "Another idea" and back, the archive fallback, the iPhone menu and its pictures (every idea in the archive must fit both layouts), and a check that the Swift and JavaScript engines agree on every pick.

## Files

| Path | What it is |
|---|---|
| `Shared/QuoteEngine.swift` | Fetching, parsing, daily pick and cache. Mirrors the Scriptable script rule for rule. |
| `Shared/QuoteCardView.swift` | The quote layout used by the widget and the app window. |
| `Widget/ClearQuotesWidget.swift` | The WidgetKit widget (small, medium, large, extra large) and its "Another idea" and back buttons (`NextIdeaIntent`, `PreviousIdeaIntent`). |
| `App/` | Tiny host app. It shows today's idea and forwards widget clicks to your browser. |
| `iPhone/James Clear 3-2-1.js` | The Scriptable widget for iPhone and iPad. |
| `Tests/` | Parser and engine tests (Node and Swift). They check that the Mac and iPhone versions agree. |
| `Fallback/` | Optional personal archive backup, built into the app when `archive.json` is present (git-ignored). |
| `tools/` | `make_xcodeproj.py` regenerates the Xcode project; `make_archive.mjs` builds `Fallback/archive.json`. |
| `CLAUDE.md` | Build, install and verify steps for Claude Code. |

## Notes

- If jamesclear.com changes how it publishes the newsletter, `extractIdeas` (in both engines) may need an update.
- The ideas belong to James Clear. Don't redistribute them, and keep any archive you download (`Tests/fixtures/`, `Fallback/archive.json`) to yourself.

## License

The source code is under the [MIT License](LICENSE). The license covers only this code, not James Clear's writing, which this repository doesn't contain.
