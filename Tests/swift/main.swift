// Test driver for Shared/QuoteEngine.swift (macOS or Linux).
// Compares every parsed idea and every daily pick with the JavaScript engine's output.
// Usage: swiftc -swift-version 5 -o out/enginetest ../Shared/QuoteEngine.swift swift/main.swift && out/enginetest <Tests dir>
import Foundation

final class MemStore: QuoteStore, @unchecked Sendable {
    var data: CacheFile?
    func load() -> CacheFile? { data }
    func save(_ cache: CacheFile) { data = cache }
    func clear() { data = nil }
}

let testsDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath
let fixtureDir = testsDir + "/fixtures"
let outDir = testsDir + "/out"
let freezeAt = "2026-10-08T23:59:59" // same as FREEZE_AT in harness.mjs

var rawItems: [[String: Any]] = []
let fixtureFiles = ((try? FileManager.default.contentsOfDirectory(atPath: fixtureDir)) ?? [])
    .filter { $0.hasPrefix("rest-page-") && $0.hasSuffix(".json") }
guard !fixtureFiles.isEmpty else {
    print("No fixtures in \(fixtureDir): run `node fetch_fixtures.mjs` first.")
    exit(1)
}
for f in fixtureFiles {
    let d = try! Data(contentsOf: URL(fileURLWithPath: "\(fixtureDir)/\(f)"))
    rawItems += try! JSONSerialization.jsonObject(with: d) as! [[String: Any]]
}
let asc = rawItems.sorted { ($0["date"] as! String) < ($1["date"] as! String) }
let ascDates: [String] = asc.map { $0["date"] as! String }
let ascBodies: [Data] = asc.map { try! JSONSerialization.data(withJSONObject: [$0]) }
let firstId = asc[0]["id"] as! Int
let li = ascDates.lastIndex(where: { $0 <= freezeAt }) ?? (asc.count - 1)

var failures: [String] = []

// 1) Parsing: every post must match the JS output exactly
let jsParse = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "\(outDir)/js_parse.json"))) as! [[String: Any]]
var jsById: [Int: [String]] = [:]
for x in jsParse { jsById[x["id"] as! Int] = x["ideas"] as? [String] ?? [] }
var ideasTotal = 0
for item in rawItems {
    let post = try! JSONDecoder().decode(WPPost.self, from: JSONSerialization.data(withJSONObject: item))
    let issue = parseIssue(post)
    ideasTotal += issue.ideas.count
    let js = jsById[issue.id] ?? []
    if issue.ideas != js {
        failures.append("parse mismatch for \(issue.link): swift \(issue.ideas.count) ideas vs js \(js.count)")
    }
}
print("parsed \(rawItems.count) posts, \(ideasTotal) ideas")

// 2) Picks: same 120 days x 7 sizes as the JS test, archive frozen at the same issue
let fixtureFetch: HTTPFetch = { url in
    let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)!
    var q: [String: String] = [:]
    for item in comps.queryItems ?? [] { q[item.name] = item.value ?? "" }
    if let before = q["before"] {
        let n = ascDates.prefix(li + 1).filter { $0 < before }.count
        let body = n > 0 ? try JSONSerialization.data(withJSONObject: [["id": firstId]]) : Data("[]".utf8)
        return (200, ["X-WP-Total": String(n)], body)
    }
    let total = li + 1
    let offset = Int(q["offset"] ?? "0") ?? 0
    let idx = (q["order"] ?? "desc") == "asc" ? offset : li - offset
    let body = (idx >= 0 && idx < total) ? ascBodies[idx] : Data("[]".utf8)
    return (200, ["X-WP-Total": String(total)], body)
}

/// The site as it was when the post at ascending index `last` was the newest.
func siteFetch(_ last: Int) -> HTTPFetch {
    return { url in
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        var q: [String: String] = [:]
        for item in comps.queryItems ?? [] { q[item.name] = item.value ?? "" }
        if let before = q["before"] {
            let n = ascDates.prefix(last + 1).filter { $0 < before }.count
            let body = n > 0 ? try JSONSerialization.data(withJSONObject: [["id": firstId]]) : Data("[]".utf8)
            return (200, ["X-WP-Total": String(n)], body)
        }
        let total = last + 1
        let offset = Int(q["offset"] ?? "0") ?? 0
        let idx = (q["order"] ?? "desc") == "asc" ? offset : last - offset
        let body = (idx >= 0 && idx < total) ? ascBodies[idx] : Data("[]".utf8)
        return (200, ["X-WP-Total": String(total)], body)
    }
}

var cal = Calendar(identifier: .gregorian)
cal.timeZone = .current
let families = ["small", "medium", "large", "extraLarge", "accessoryRectangular", "accessoryInline", "accessoryCircular"]
let jsPicks = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "\(outDir)/js_picks.json"))) as! [[String: Any]]

var n = 0
let sem = DispatchSemaphore(value: 0)
Task {
    // Today's idea (skip 0), then "Another idea" three times, in the same order as the JS test
    let engine = QuoteEngine(fetch: fixtureFetch, store: MemStore())
    for i in 0..<120 {
        let date = cal.date(from: DateComponents(year: 2026, month: 10, day: 1 + i, hour: 12))!
        for skip in 0...3 {
            if skip > 0, await engine.nextIdea(for: date) != skip { failures.append("nextIdea did not return \(skip)") }
            for fam in families {
                let q = try! await engine.quote(for: date, family: fam)
                guard n < jsPicks.count else { failures.append("JS pick table is too short"); break }
                let js = jsPicks[n]
                n += 1
                let same = (js["day"] as! String) == q.day && (js["fam"] as! String) == fam && (js["skip"] as! Int) == skip &&
                    (js["id"] as! Int) == q.issue.id && (js["idea"] as! Int) == q.ideaNumber &&
                    (js["isNew"] as! Bool) == q.isNew && (js["offline"] as! Bool) == q.offline && (js["text"] as! String) == q.text
                if !same { failures.append("pick mismatch \(q.day) \(fam) skip \(skip): swift \(q.issue.id)#\(q.ideaNumber) vs js \(js["id"]!)#\(js["idea"]!)") }
            }
        }
    }
    if n != jsPicks.count { failures.append("compared \(n) picks but the JS table has \(jsPicks.count)") }
    // Back and forth on one day: "Previous idea" returns to the JS picks for the earlier skips
    let d15 = cal.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 8))!
    func jsRow(_ fam: String, _ skip: Int) -> [String: Any]? {
        jsPicks.first { ($0["day"] as! String) == "2026-10-15" && ($0["fam"] as! String) == fam && ($0["skip"] as! Int) == skip }
    }
    let walker = QuoteEngine(fetch: fixtureFetch, store: MemStore())
    for _ in 0..<3 { await walker.nextIdea(for: d15) }
    for (back, want) in [(true, 2), (true, 1), (false, 2), (true, 1), (true, 0), (true, 0), (false, 1)] {
        let got = await (back ? walker.previousIdea(for: d15) : walker.nextIdea(for: d15))
        let current = await walker.currentSkip(for: d15)
        if got != want || current != want { failures.append("\(back ? "previous" : "next"): skip \(got), expected \(want)") }
        for fam in ["small", "large"] {
            let q = try! await walker.quote(for: d15, family: fam)
            let js = jsRow(fam, want)
            if js == nil || (js!["id"] as! Int) != q.issue.id || (js!["idea"] as! Int) != q.ideaNumber {
                failures.append("\(back ? "previous" : "next") to skip \(want) (\(fam)) differs from JS")
            }
        }
    }
    // Offline: empty cache -> error; warm cache -> offline pick
    let offlineFetch: HTTPFetch = { _ in throw URLError(.notConnectedToInternet) }
    do {
        _ = try await QuoteEngine(fetch: offlineFetch, store: MemStore()).quote(for: Date(), family: "medium")
        failures.append("offline engine with empty cache did not throw")
    } catch {}
    let shared = MemStore()
    let warm = QuoteEngine(fetch: fixtureFetch, store: shared)
    for i in 0..<5 { _ = try! await warm.quote(for: cal.date(from: DateComponents(year: 2026, month: 10, day: 20 + i, hour: 9))!, family: "medium") }
    let reopened = QuoteEngine(fetch: offlineFetch, store: shared)
    let q = try? await reopened.quote(for: cal.date(from: DateComponents(year: 2026, month: 11, day: 30, hour: 9))!, family: "medium")
    if q == nil || q!.offline == false { failures.append("offline pick from warm cache failed") }
    // Gallery preview reuses the pick for the same widget size
    let previewEngine = QuoteEngine(fetch: fixtureFetch, store: MemStore())
    let d20 = cal.date(from: DateComponents(year: 2026, month: 10, day: 20, hour: 9))!
    let small = try! await previewEngine.quote(for: d20, family: "small")
    _ = try! await previewEngine.quote(for: d20, family: "extraLarge")
    if await previewEngine.anyCachedQuote(family: "small") != small { failures.append("anyCachedQuote(family:) returned another size's pick") }
    await previewEngine.nextIdea(for: d20)
    let small1 = try! await previewEngine.quote(for: d20, family: "small")
    if small1 == small { failures.append("nextIdea did not change the pick") }
    if await previewEngine.anyCachedQuote(family: "small") != small1 { failures.append("anyCachedQuote(family:) ignored the current skip") }
    // An older cache file without "skips" still loads, and nextIdea works on it
    let oldStore = MemStore()
    let oldWarm = QuoteEngine(fetch: fixtureFetch, store: oldStore)
    let oldPick = try! await oldWarm.quote(for: d20, family: "medium")
    var oldJSON = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(oldStore.data!)) as! [String: Any]
    oldJSON.removeValue(forKey: "skips")
    oldStore.data = try? JSONDecoder().decode(CacheFile.self, from: JSONSerialization.data(withJSONObject: oldJSON))
    if oldStore.data == nil { failures.append("an older cache without skips does not decode") }
    let oldEngine = QuoteEngine(fetch: offlineFetch, store: oldStore)
    if (try? await oldEngine.quote(for: d20, family: "medium")) != oldPick { failures.append("an older cache without skips was discarded") }
    if await oldEngine.nextIdea(for: d20) != 1 { failures.append("nextIdea failed on an older cache") }
    // Archive backup: offline, the same rules run against the backup and match the JS online picks
    let archiveData = try! JSONSerialization.data(withJSONObject: Array(asc.prefix(li + 1)))
    let archStore = MemStore()
    let arch = QuoteEngine(fetch: offlineFetch, store: archStore, archive: { archiveData })
    var archived = 0
    for i in 0..<30 {
        let date = cal.date(from: DateComponents(year: 2026, month: 10, day: 1 + i, hour: 12))!
        for skip in 0...2 {
            if skip > 0 { await arch.nextIdea(for: date) }
            for fam in families {
                let q = try! await arch.quote(for: date, family: fam)
                let js = jsPicks.first { ($0["day"] as! String) == q.day && ($0["fam"] as! String) == fam && ($0["skip"] as! Int) == skip }
                if !q.offline || js == nil || (js!["id"] as! Int) != q.issue.id || (js!["idea"] as! Int) != q.ideaNumber || (js!["text"] as! String) != q.text {
                    failures.append("archive pick \(q.day) \(fam) skip \(skip) differs from the online one")
                }
                archived += 1
            }
        }
    }
    if !(archStore.data?.picks.isEmpty ?? true) { failures.append("archive picks should not be cached") }
    for (name, bad) in [("empty", Data("[]".utf8)), ("garbage", Data("{\"x\":1}".utf8)), ("not JSON", Data("oops".utf8))] {
        if (try? await QuoteEngine(fetch: offlineFetch, store: MemStore(), archive: { bad }).quote(for: d20, family: "medium")) != nil {
            failures.append("a \(name) archive was not ignored")
        }
    }
    print("archive fallback: \(archived) offline picks match the JS online picks")
    // The backup grows: same scenarios and expectations as section 9 of test_engine.mjs
    func backup(_ count: Int) -> @Sendable () -> Data? {
        let data = try! JSONSerialization.data(withJSONObject: Array(asc.prefix(count)))
        return { data }
    }
    func ids(_ from: Int, _ to: Int) -> [Int] { asc[from...to].map { $0["id"] as! Int } }
    func added(_ store: MemStore) -> [Int] { store.data?.additions?.map(\.id) ?? [] }
    func noon(_ d: Int) -> Date { cal.date(from: DateComponents(year: 2026, month: 10, day: d, hour: 12))! }
    let weeklyStore = MemStore()
    _ = try? await QuoteEngine(fetch: siteFetch(li - 1), store: weeklyStore, archive: backup(li - 1)).quote(for: noon(1), family: "medium")
    if added(weeklyStore) != ids(li - 1, li - 1) { failures.append("weekly: first new post not added") }
    _ = try? await QuoteEngine(fetch: siteFetch(li), store: weeklyStore, archive: backup(li - 1)).quote(for: noon(2), family: "medium")
    if added(weeklyStore) != ids(li - 1, li) { failures.append("weekly: second new post not added") }
    let missStore = MemStore()
    var counts: [Int] = []
    for d in 1...4 {
        _ = try? await QuoteEngine(fetch: siteFetch(li), store: missStore, archive: backup(li - 11)).quote(for: noon(d), family: "medium")
        counts.append(added(missStore).count)
    }
    if counts != [5, 10, 12, 12] || added(missStore) != ids(li - 11, li) { failures.append("missed posts: additions grew \(counts)") }
    let grown = QuoteEngine(fetch: offlineFetch, store: missStore, archive: backup(li - 11))
    for d in 20...29 {
        for fam in ["small", "medium", "large"] {
            let q = try! await grown.quote(for: noon(d), family: fam)
            let js = jsPicks.first { ($0["day"] as! String) == q.day && ($0["fam"] as! String) == fam && ($0["skip"] as! Int) == 0 }
            if !q.offline || (js?["id"] as? Int) != q.issue.id || (js?["idea"] as? Int) != q.ideaNumber {
                failures.append("\(q.day) \(fam): backup plus additions differs from the site")
            }
        }
    }
    _ = try? await QuoteEngine(fetch: siteFetch(li), store: missStore, archive: backup(li - 2)).quote(for: noon(5), family: "medium")
    if added(missStore) != ids(li - 2, li) { failures.append("a newer backup did not replace the additions") }
    let noBackup = MemStore()
    _ = try? await QuoteEngine(fetch: siteFetch(li), store: noBackup, archive: { nil }).quote(for: noon(1), family: "medium")
    if !added(noBackup).isEmpty { failures.append("additions without a backup") }
    print("backup additions: \(counts.prefix(3).map(String.init).joined(separator: ", ")) posts after 3 days")
    // Server errors
    let broken: HTTPFetch = { _ in (500, [:], Data("oops".utf8)) }
    do {
        _ = try await QuoteEngine(fetch: broken, store: MemStore()).quote(for: Date(), family: "small")
        failures.append("HTTP 500 did not throw")
    } catch {}
    sem.signal()
}
sem.wait()
print("compared \(n) picks with the JS engine")

// 3) Widget click links and the app's URL filter
let sample = Quote(text: "x", ideaNumber: 1, day: "2026-10-15", isNew: false, offline: false,
                   issue: IssueRef(id: 1, date: "2026-10-08", link: "https://jamesclear.com/3-2-1/october-8-2026", title: "t"))
let link = WidgetLink.make(for: sample)!
if WidgetLink.issueURL(from: link)?.absoluteString != "https://jamesclear.com/3-2-1/october-8-2026" { failures.append("WidgetLink round trip failed") }
if WidgetLink.issueURL(from: URL(string: "clearquotes://open?url=https://evil.example.com/x")!) != nil { failures.append("WidgetLink accepted a foreign host") }
if WidgetLink.issueURL(from: URL(string: "https://jamesclear.com/3-2-1/october-8-2026")!) == nil { failures.append("WidgetLink rejected a plain issue URL") }
if WidgetLink.issueURL(from: URL(string: "clearquotes://open")!) != nil { failures.append("WidgetLink accepted an empty link") }
if WidgetLink.issueURL(from: URL(string: "https://notjamesclear.com/x")!) != nil { failures.append("WidgetLink accepted a look-alike host") }

if failures.isEmpty {
    print("swift checks passed")
} else {
    print("SWIFT FAILURES (\(failures.count)):")
    failures.prefix(25).forEach { print("  " + $0) }
    exit(1)
}
