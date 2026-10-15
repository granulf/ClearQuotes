# Optional archive backup (personal use only)

If `Fallback/archive.json` exists when you build, it is copied into the app and the widget. When
jamesclear.com can't be reached, the widget then runs its usual rules against this backup instead
of the live site: on days the backup is up to date it shows exactly the idea the site would give,
and it keeps retrying the site every 30 minutes. Without the file, nothing changes.

## It grows by itself

Each device keeps the posts published after the backup in its own cache, and the fallback uses the
backup plus these additions. The newest post comes with the request the widget makes every day
anyway, so this normally costs nothing extra. If a device was off and missed posts, it fetches them
by position, oldest first, at most 5 a day. When you rebuild with a newer backup, additions that it
already holds are dropped. The file itself doesn't change; refresh it now and then if you want the
copy on disk to be current too.

`archive.json` is git-ignored. It holds James Clear's full newsletter texts, so never commit or
publish it.

## Make it

```
node Tests/fetch_fixtures.mjs           # or ./Tests/run_tests.sh, which downloads it once (4-5 requests)
node tools/make_archive.mjs             # Tests/fixtures -> Fallback/archive.json
```

`tools/make_archive.mjs <folder>` also takes any folder with `rest-page-*.json` files, such as an
unzipped backup's `raw/` folder. Then rebuild and reinstall the app.

## iPhone

Copy `archive.json` to *iCloud Drive > Scriptable* as `James Clear 3-2-1 archive.json`. The script
reads it only when the site can't be reached.
