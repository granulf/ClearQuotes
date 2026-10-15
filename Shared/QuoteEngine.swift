// QuoteEngine.swift
// Fetches James Clear's 3-2-1 newsletter from jamesclear.com, extracts his
// "3 ideas from me", and picks one idea per day.
//
// This file mirrors the core of the Scriptable script ("James Clear 3-2-1.js")
// rule for rule, so the Mac and the iPhone show the same idea on the same day
// for the same widget size. Foundation only: it is shared by the app and the
// widget extension, and it also compiles on Linux for testing.

import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - Configuration (keep identical to CONFIG in the Scriptable script)

enum QuoteConfig {
    /// Fri-Sun: show the three ideas from the newest issue, one per day.
    static let newIssueFirst = true
    /// Longest idea (in UTF-16 characters) each widget size will show.
    static let maxChars: [String: Int] = [
        "small": 110,
        "medium": 260,
        "large": 560,
        "extraLarge": 900,
        "accessoryRectangular": 90,
        "accessoryInline": 60,
        "accessoryCircular": 60,
    ]

    static func maxChars(for family: String) -> Int {
        maxChars[family] ?? 260
    }
}

// MARK: - Models

struct Issue: Codable, Equatable, Sendable {
    var id: Int
    var date: String // YYYY-MM-DD
    var link: String
    var title: String
    var ideas: [String]
}

struct IssueRef: Codable, Equatable, Sendable {
    var id: Int
    var date: String
    var link: String
    var title: String
}

struct Quote: Codable, Equatable, Sendable {
    var text: String
    var ideaNumber: Int
    var day: String
    var isNew: Bool
    var offline: Bool
    var issue: IssueRef

    var url: URL? { URL(string: issue.link) }
}

struct CacheFile: Codable {
    struct Meta: Codable {
        var total: Int
        var latest: Issue
        var fetchedDay: String
    }
    struct YearBase: Codable {
        var year: String
        var n: Int
    }
    var v: Int = 1
    var meta: Meta?
    var base: YearBase?
    var issues: [String: Issue] = [:]
    var picks: [String: Quote] = [:]
    /// "Another idea" presses per day (optional so that older caches still load).
    var skips: [String: Int]?
    /// Posts published after the archive backup, kept by this device for the fallback (raw).
    var additions: [WPPost]?
}

enum QuoteError: Error {
    case http(Int)
    case unexpectedResponse
    case unavailable
}

// MARK: - Text extraction

private enum Rx {
    static func make(_ pattern: String, _ caseInsensitive: Bool = true) -> NSRegularExpression {
        // Patterns are constants; a failure here is a programming error caught in testing.
        try! NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
    }
    static let crlfTab = make(#"[\r\n\t]+"#, false)
    static let dropBlocks = make(#"<(script|style|svg|figure|noscript)\b[\s\S]*?</\1>"#)
    static let shareDiv = make(#"<div\b[^>]*class="[^"]*twitter-share[^"]*"[^>]*>[\s\S]*?</div>[ ]*</div>"#)
    static let shareLinks = make(#"<a\b[^>]*href="https?://(?:ctt\.ac|(?:www\.)?twitter\.com/intent|(?:www\.)?x\.com/intent)[^"]*"[^>]*>[\s\S]*?</a>"#)
    static let hr = make(#"<hr\b[^>]*>"#)
    static let br = make(#"<br\b[^>]*>"#)
    static let liOpen = make(#"<li\b[^>]*>"#)
    static let liClose = make(#"</li>"#)
    static let blockTags = make(#"</?(p|div|ul|ol|h[1-6]|blockquote|figcaption|table|tr|section|header|footer)\b[^>]*>"#)
    static let anyTag = make(#"<[^>]*>"#, false)
    static let entity = make(#"&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);"#, false)
    static let invisible = make(#"[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{FEFF}]"#, false)
    static let oddSpaces = make(#"[\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{000B}\x{000C}]"#, false)
    static let spaceRuns = make(#"[ \t]+"#, false)
    static let alnum = make(#"[A-Za-z0-9]"#, false)
    static let shareLine = make(#"^\(?[ ]*(?:click to )?(?:share|tweet) this(?: on (?:twitter|x))?[ ]*\)?$"#)
    static let heading = make(#"ideas? from me"#)
    static let sectionEnd = make(#"(quotes? from|questions? for you)"#)
    static let numeralAlone = make(#"^(I|II|III|IV|V|VI)\.?$"#, false)
    static let numeralInline = make(#"^(I|II|III|IV|V|VI)\.[ \n]+([\s\S]+)$"#, false)
    static let issueLink = make(#"/3-2-1/[a-z]+-[0-9]{1,2}-[0-9]{4}/?$"#, false)
    static let trailingPunct = make(#"[ \n,;:.\x{2014}\x{2013}-]+$"#, false)
}

private extension NSRegularExpression {
    func replace(in s: String, with template: String) -> String {
        stringByReplacingMatches(in: s, options: [], range: NSRange(location: 0, length: (s as NSString).length), withTemplate: template)
    }
    func test(_ s: String) -> Bool {
        firstMatch(in: s, options: [], range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }
    func groups(_ s: String) -> [String?]? {
        let ns = s as NSString
        guard let m = firstMatch(in: s, options: [], range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (0..<m.numberOfRanges).map { i in
            let r = m.range(at: i)
            return r.location == NSNotFound ? nil : ns.substring(with: r)
        }
    }
}

private let hrMarker = "\u{E000}"
private let spaceSet = CharacterSet(charactersIn: " ")
private let spaceNewlineSet = CharacterSet(charactersIn: " \n")

private let namedEntities: [String: String] = [
    "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": "\u{00A0}",
    "hellip": "\u{2026}", "mdash": "\u{2014}", "ndash": "\u{2013}", "lsquo": "\u{2018}", "rsquo": "\u{2019}",
    "ldquo": "\u{201C}", "rdquo": "\u{201D}", "laquo": "\u{00AB}", "raquo": "\u{00BB}", "bull": "\u{2022}",
    "middot": "\u{00B7}", "copy": "\u{00A9}", "reg": "\u{00AE}", "trade": "\u{2122}", "deg": "\u{00B0}",
    "times": "\u{00D7}", "eacute": "\u{00E9}", "egrave": "\u{00E8}", "aacute": "\u{00E1}", "iacute": "\u{00ED}",
    "oacute": "\u{00F3}", "uacute": "\u{00FA}", "ntilde": "\u{00F1}", "auml": "\u{00E4}", "ouml": "\u{00F6}",
    "uuml": "\u{00FC}", "aring": "\u{00E5}", "ccedil": "\u{00E7}", "szlig": "\u{00DF}",
]

func decodeEntities(_ s: String) -> String {
    let ns = s as NSString
    var out = ""
    var last = 0
    for m in Rx.entity.matches(in: s, options: [], range: NSRange(location: 0, length: ns.length)) {
        out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
        let body = ns.substring(with: m.range(at: 1))
        out += decodeEntity(body) ?? ns.substring(with: m.range)
        last = m.range.location + m.range.length
    }
    out += ns.substring(from: last)
    return out
}

private func decodeEntity(_ e: String) -> String? {
    if e.hasPrefix("#") {
        let hex = e.hasPrefix("#x") || e.hasPrefix("#X")
        let digits = String(e.dropFirst(hex ? 2 : 1))
        guard let cp = UInt32(digits, radix: hex ? 16 : 10), cp > 0, cp <= 0x10FFFF,
              !(0xD800...0xDFFF).contains(cp), let scalar = Unicode.Scalar(cp) else { return nil }
        return String(Character(scalar))
    }
    return namedEntities[e]
}

/// HTML fragment -> plain-text paragraphs (lines inside a paragraph joined by "\n").
func htmlToParagraphs(_ html: String) -> [String] {
    var s = Rx.crlfTab.replace(in: html, with: " ")
    s = Rx.dropBlocks.replace(in: s, with: " ")
    s = Rx.shareDiv.replace(in: s, with: " ")
    s = Rx.shareLinks.replace(in: s, with: " ")
    s = Rx.hr.replace(in: s, with: "\n\n" + hrMarker + "\n\n")
    s = Rx.br.replace(in: s, with: "\n")
    s = Rx.liOpen.replace(in: s, with: "\n\u{2022} ")
    s = Rx.liClose.replace(in: s, with: "\n")
    s = Rx.blockTags.replace(in: s, with: "\n\n")
    s = Rx.anyTag.replace(in: s, with: "")
    s = decodeEntities(s)
    s = Rx.invisible.replace(in: s, with: "")
    s = Rx.oddSpaces.replace(in: s, with: " ")
    var paragraphs: [String] = []
    var current: [String] = []
    for raw in s.components(separatedBy: "\n") {
        let line = Rx.spaceRuns.replace(in: raw, with: " ").trimmingCharacters(in: spaceSet)
        if line.isEmpty {
            if !current.isEmpty { paragraphs.append(current.joined(separator: "\n")) }
            current = []
        } else {
            current.append(line)
        }
    }
    if !current.isEmpty { paragraphs.append(current.joined(separator: "\n")) }
    return paragraphs.filter { $0 == hrMarker || (Rx.alnum.test($0) && !Rx.shareLine.test($0)) }
}

private func stripOuterQuotes(_ t: String) -> String {
    let units = Array(t.utf16)
    if units.count >= 2, units.first == 0x201C, units.last == 0x201D {
        let inner = String(decoding: units[1..<(units.count - 1)], as: UTF16.self)
        if !inner.contains("\u{201C}") && !inner.contains("\u{201D}") {
            return inner.trimmingCharacters(in: spaceNewlineSet)
        }
    }
    return t
}

/// James Clear's own ideas ("3 IDEAS FROM ME") from an issue's HTML.
func extractIdeas(_ html: String) -> [String] {
    let paras = htmlToParagraphs(html)
    func isHeading(_ p: String) -> Bool { p.utf16.count <= 40 && Rx.heading.test(p) }
    func isEnd(_ p: String) -> Bool { p.utf16.count <= 40 && Rx.sectionEnd.test(p) }
    guard let start = paras.firstIndex(where: isHeading) else { return [] }
    var end = paras.count
    for i in (start + 1)..<paras.count where isEnd(paras[i]) {
        end = i
        break
    }
    let section = Array(paras[(start + 1)..<end])
    func numeralOf(_ p: String) -> (n: String, rest: String)? {
        if let g = Rx.numeralAlone.groups(p) { return (g[1] ?? "", "") }
        if let g = Rx.numeralInline.groups(p) { return (g[1] ?? "", (g[2] ?? "").trimmingCharacters(in: spaceNewlineSet)) }
        return nil
    }
    // Text before "I." is an intro and is skipped; if "I." is missing, that text is idea I.
    let first = section.lazy.compactMap(numeralOf).first
    var ideas: [[String]] = []
    var current: [String]? = (first?.n == "I") ? nil : []
    for p in section {
        if p == hrMarker {
            if let c = current, !c.isEmpty { ideas.append(c) }
            if current != nil { current = [] }
            continue
        }
        if let num = numeralOf(p) {
            if let c = current, !c.isEmpty { ideas.append(c) }
            current = num.rest.isEmpty ? [] : [num.rest]
            continue
        }
        current?.append(p)
    }
    if let c = current, !c.isEmpty { ideas.append(c) }
    return ideas
        .map { stripOuterQuotes($0.joined(separator: "\n\n").trimmingCharacters(in: spaceNewlineSet)) }
        .filter { Rx.alnum.test($0) }
}

struct WPRendered: Codable, Sendable { let rendered: String }
struct WPPost: Codable, Sendable {
    let id: Int
    let date: String?
    let link: String?
    let title: WPRendered?
    let content: WPRendered?
}

func parseIssue(_ post: WPPost) -> Issue {
    let link = post.link ?? ""
    let real = Rx.issueLink.test(link)
    let title = decodeEntities(Rx.anyTag.replace(in: post.title?.rendered ?? "", with: ""))
        .trimmingCharacters(in: .whitespacesAndNewlines)
    return Issue(
        id: post.id,
        date: String((post.date ?? "").prefix(10)),
        link: link,
        title: title,
        ideas: real ? extractIdeas(post.content?.rendered ?? "") : []
    )
}

// MARK: - Small helpers (identical arithmetic in the JS version)

func fnv1a32(_ s: String) -> UInt32 {
    var h: UInt32 = 0x811C_9DC5
    for b in s.utf8 {
        h ^= UInt32(b)
        h = h &* 0x0100_0193
    }
    return h
}

private let gregorian: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = .current
    return c
}()

/// Local calendar date as "YYYY-MM-DD".
func dayKey(_ date: Date) -> String {
    let c = gregorian.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
func epochDay(_ key: String) -> Int {
    let p = key.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3 else { return 0 }
    let m = p[1], d = p[2]
    let y = p[0] - (m <= 2 ? 1 : 0)
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146_097 + doe - 719_468
}

func prettyDate(_ key: String) -> String {
    let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    let p = key.split(separator: "-").compactMap { Int($0) }
    guard p.count == 3, (1...12).contains(p[1]) else { return key }
    return "\(months[p[1] - 1]) \(p[2]), \(p[0])"
}

func truncate(_ text: String, _ max: Int) -> String {
    let units = Array(text.utf16)
    if units.count <= max { return text }
    var cut = Array(units.prefix(Swift.max(1, max - 1)))
    if let last = cut.last, (0xD800...0xDBFF).contains(last) { cut.removeLast() } // don't split an emoji
    if let space = cut.lastIndex(of: 0x20), Double(space) > Double(max) * 0.6 { cut = Array(cut[..<space]) }
    let s = String(decoding: cut, as: UTF16.self)
    return Rx.trailingPunct.replace(in: s, with: "") + "\u{2026}"
}

// MARK: - Networking and storage

typealias HTTPResult = (status: Int, headers: [String: String], body: Data)
typealias HTTPFetch = @Sendable (URL) async throws -> HTTPResult

enum API {
    static let base = "https://jamesclear.com/wp-json/wp/v2/3-2-1"
    static let fields = "id,date,link,title,content"
    static var latest: URL { URL(string: "\(base)?per_page=1&_fields=\(fields)")! }
    static func offset(_ k: Int) -> URL { URL(string: "\(base)?per_page=1&order=asc&offset=\(k)&_fields=\(fields)")! }
    static func before(year: String) -> URL { URL(string: "\(base)?per_page=1&before=\(year)-01-01T00:00:00&_fields=id")! }

    static let urlSessionFetch: HTTPFetch = { url in
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await withCheckedThrowingContinuation { continuation in
            URLSession.shared.dataTask(with: request) { data, response, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                let http = response as? HTTPURLResponse
                var headers: [String: String] = [:]
                for (key, value) in http?.allHeaderFields ?? [:] {
                    headers[String(describing: key).lowercased()] = String(describing: value)
                }
                continuation.resume(returning: (http?.statusCode ?? 0, headers, data ?? Data()))
            }.resume()
        }
    }
}

/// Widget clicks on macOS go to the containing app, so the widget links to
/// clearquotes://open?url=<issue> and the app opens the issue in the browser.
enum WidgetLink {
    static let scheme = "clearquotes"

    static func make(for quote: Quote) -> URL? {
        var c = URLComponents()
        c.scheme = scheme
        c.host = "open"
        c.queryItems = [URLQueryItem(name: "url", value: quote.issue.link)]
        return c.url
    }

    /// The jamesclear.com page to open for an incoming URL, or nil to ignore it.
    static func issueURL(from url: URL) -> URL? {
        var candidate: URL? = url
        if url.scheme == scheme {
            let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "url" })?.value
            candidate = value.flatMap { URL(string: $0) }
        }
        guard let target = candidate, target.scheme == "https" || target.scheme == "http",
              let host = target.host, host == "jamesclear.com" || host.hasSuffix(".jamesclear.com") else { return nil }
        return target
    }
}

protocol QuoteStore: Sendable {
    func load() -> CacheFile?
    func save(_ cache: CacheFile)
    func clear()
}

/// Keeps nothing: for the throwaway engine that reads the archive backup.
struct NullStore: QuoteStore {
    func load() -> CacheFile? { nil }
    func save(_ cache: CacheFile) {}
    func clear() {}
}

/// Optional personal backup of the archive (raw WordPress posts, see Fallback/README.md).
/// When jamesclear.com can't be reached, the engine runs the same rules against it instead.
enum ArchiveFallback {
    /// archive.json in the app's or the widget's own Resources, if the build included one.
    static let bundled: @Sendable () -> Data? = {
        Bundle.main.url(forResource: "archive", withExtension: "json").flatMap { try? Data(contentsOf: $0) }
    }

    /// Serves the three WordPress API requests the engine makes (latest, offset, before) from a list of posts.
    static func fetch(_ posts: [WPPost]) -> HTTPFetch {
        let asc = posts.sorted { ($0.date ?? "", $0.id) < ($1.date ?? "", $1.id) }
        return { url in
            var query: [String: String] = [:]
            for item in URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [] { query[item.name] = item.value ?? "" }
            if let before = query["before"] {
                let n = asc.filter { ($0.date ?? "") < before }.count
                let body = n > 0 ? [WPPost(id: asc[0].id, date: nil, link: nil, title: nil, content: nil)] : []
                return (200, ["x-wp-total": String(n)], try JSONEncoder().encode(body))
            }
            let total = asc.count
            let offset = Int(query["offset"] ?? "0") ?? 0
            let idx = query["order"] == "asc" ? offset : total - 1 - offset
            let body = idx >= 0 && idx < total ? [asc[idx]] : []
            return (200, ["x-wp-total": String(total)], try JSONEncoder().encode(body))
        }
    }
}

/// Cache in Application Support (inside the sandbox container for the widget).
struct FileQuoteStore: QuoteStore {
    let url: URL

    static var standard: FileQuoteStore {
        let dir = (FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory()))
            .appendingPathComponent("ClearQuotes", isDirectory: true)
        return FileQuoteStore(url: dir.appendingPathComponent("cache.json"))
    }

    func load() -> CacheFile? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(CacheFile.self, from: data)
    }

    func save(_ cache: CacheFile) {
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(cache).write(to: url, options: .atomic)
        } catch {
            // The cache is best-effort.
        }
    }

    func clear() {
        try? FileManager.default.removeItem(at: url)
    }
}

// MARK: - Engine

actor QuoteEngine {
    private let fetch: HTTPFetch
    private let store: QuoteStore
    private let newIssueFirst: Bool
    private let archive: @Sendable () -> Data?
    private var cache: CacheFile

    static let maxAttempts = 5
    static let walkStep = 7919 // prime and larger than the archive: each issue comes up once a year

    init(fetch: @escaping HTTPFetch = API.urlSessionFetch,
         store: QuoteStore = FileQuoteStore.standard,
         newIssueFirst: Bool = QuoteConfig.newIssueFirst,
         archive: @escaping @Sendable () -> Data? = ArchiveFallback.bundled) {
        self.fetch = fetch
        self.store = store
        self.newIssueFirst = newIssueFirst
        self.archive = archive
        if let cached = store.load(), cached.v == 1 {
            cache = cached
        } else {
            cache = CacheFile()
        }
    }

    /// Today's idea for a widget size ("small", "medium", "large", ...).
    func quote(for date: Date = Date(), family: String) async throws -> Quote {
        let day = dayKey(date)
        let max = QuoteConfig.maxChars(for: family)
        let skip = skipCount(day)
        if let cached = cache.picks[QuoteEngine.pickKey(day, max, skip)] { return cached }

        var quote: Quote?
        do {
            quote = try await pick(day: day, max: max, skip: skip)
        } catch {
            quote = nil
        }
        if quote == nil {
            quote = await archivePick(date: date, family: family, skip: skip)
        }
        if quote == nil {
            quote = offlinePick(day: day, max: max, skip: skip)
        }
        save()
        guard let result = quote else { throw QuoteError.unavailable }
        return result
    }

    /// "Another idea": every widget size moves on to the next pick for the day. Returns the new skip count.
    @discardableResult
    func nextIdea(for date: Date = Date()) -> Int {
        let day = dayKey(date)
        let n = skipCount(day) + 1
        var skips = cache.skips ?? [:]
        skips[day] = n
        cache.skips = skips
        save()
        return n
    }

    /// Back to the idea shown before the last "Another idea" (picks are fixed per skip). Returns the new skip count.
    @discardableResult
    func previousIdea(for date: Date = Date()) -> Int {
        let day = dayKey(date)
        let n = Swift.max(0, skipCount(day) - 1)
        var skips = cache.skips ?? [:]
        if n == 0 { skips.removeValue(forKey: day) } else { skips[day] = n }
        cache.skips = skips
        save()
        return n
    }

    /// How many times "Another idea" is in effect today (0 = the daily idea).
    func currentSkip(for date: Date = Date()) -> Int {
        skipCount(dayKey(date))
    }

    /// Most recent cached idea for this widget size (at that day's skip), for gallery previews.
    func anyCachedQuote(family: String) -> Quote? {
        let max = QuoteConfig.maxChars(for: family)
        let suffix = "|\(max)"
        guard let key = cache.picks.keys.filter({ $0.hasSuffix(suffix) }).sorted().last else { return nil }
        let day = String(key.prefix(while: { $0 != "|" }))
        return cache.picks[QuoteEngine.pickKey(day, max, skipCount(day))] ?? cache.picks[key]
    }

    func clearCache() {
        cache = CacheFile()
        store.clear()
    }

    // MARK: Internals

    /// Picks are cached as "day|max" for skip 0 and "day|max|s<n>" after "Another idea".
    static func pickKey(_ day: String, _ max: Int, _ skip: Int) -> String {
        skip == 0 ? "\(day)|\(max)" : "\(day)|\(max)|s\(skip)"
    }

    private func skipCount(_ day: String) -> Int {
        cache.skips?[day] ?? 0
    }

    private func save() {
        let keys = cache.picks.keys.sorted()
        for key in keys.prefix(Swift.max(0, keys.count - 40)) { cache.picks.removeValue(forKey: key) }
        if let days = cache.skips?.keys.sorted() {
            for day in days.prefix(Swift.max(0, days.count - 14)) { cache.skips?.removeValue(forKey: day) }
        }
        store.save(cache)
    }

    private func getPosts(_ url: URL) async throws -> (posts: [WPPost], headers: [String: String]) {
        let result = try await fetch(url)
        guard result.status == 200 else { throw QuoteError.http(result.status) }
        guard let posts = try? JSONDecoder().decode([WPPost].self, from: result.body) else {
            throw QuoteError.unexpectedResponse
        }
        var headers: [String: String] = [:]
        for (key, value) in result.headers { headers[key.lowercased()] = value }
        return (posts, headers)
    }

    private func refreshMeta(day: String) async throws -> CacheFile.Meta {
        if let meta = cache.meta, meta.fetchedDay == day { return meta }
        let (posts, headers) = try await getPosts(API.latest)
        let total = Int(headers["x-wp-total"] ?? "") ?? 0
        guard let first = posts.first, total > 0 else { throw QuoteError.unexpectedResponse }
        let meta = CacheFile.Meta(total: total, latest: parseIssue(first), fetchedDay: day)
        cache.meta = meta
        await extendArchive(total: total, latest: first)
        return meta
    }

    /// Keeps the archive backup current on this device: posts published after it are kept (raw, in the
    /// cache) and the fallback uses them together with it. The newest post comes with the daily request;
    /// posts this device missed are fetched by position, oldest first, a few a day.
    private func extendArchive(total: Int, latest: WPPost) async {
        guard let backup = backupPosts() else { return }
        let backupIDs = Set(backup.map(\.id))
        var added = (cache.additions ?? []).filter { !backupIDs.contains($0.id) } // a newer backup may hold them
        defer { cache.additions = added }
        var newest = (backup + added).compactMap(\.date).max() ?? ""
        func append(_ post: WPPost) -> Bool {
            guard !backupIDs.contains(post.id), !added.contains(where: { $0.id == post.id }), (post.date ?? "") >= newest else { return false }
            added.append(post)
            newest = post.date ?? newest
            return true
        }
        var k = backup.count + added.count
        var fetched = 0
        while k < total - 1 && fetched < QuoteEngine.maxAttempts {
            fetched += 1
            guard let result = try? await getPosts(API.offset(k)), let post = result.posts.first, append(post) else { return }
            cache.issues[String(k)] = parseIssue(post)
            k += 1
        }
        if k == total - 1 { _ = append(latest) }
    }

    /// The archive backup, if there is one (see ArchiveFallback).
    private func backupPosts() -> [WPPost]? {
        guard let data = archive(), let posts = try? JSONDecoder().decode([WPPost].self, from: data), !posts.isEmpty else { return nil }
        return posts
    }

    /// Number of posts published before January 1 of the day's year (fixed for the whole year).
    private func yearBase(day: String) async throws -> Int {
        let year = String(day.prefix(4))
        if let base = cache.base, base.year == year { return base.n }
        let (_, headers) = try await getPosts(API.before(year: year))
        let n = Int(headers["x-wp-total"] ?? "") ?? 0
        guard n > 0 else { throw QuoteError.unexpectedResponse }
        cache.base = CacheFile.YearBase(year: year, n: n)
        return n
    }

    private func issueAt(_ k: Int) async throws -> Issue? {
        let key = String(k)
        if let issue = cache.issues[key] { return issue }
        let (posts, _) = try await getPosts(API.offset(k))
        guard let first = posts.first else { return nil }
        let issue = parseIssue(first)
        cache.issues[key] = issue
        return issue
    }

    private func makeQuote(_ issue: Issue, _ idx: Int, day: String, max: Int, isNew: Bool = false, offline: Bool = false) -> Quote {
        Quote(
            text: truncate(issue.ideas[idx], max),
            ideaNumber: idx + 1,
            day: day,
            isNew: isNew,
            offline: offline,
            issue: IssueRef(id: issue.id, date: issue.date, link: issue.link, title: issue.title)
        )
    }

    /// Offline with an archive backup: the same rules, run against the backup (plus this device's
    /// additions) instead of the live site.
    /// Marked offline, so it isn't cached and the widget keeps retrying the site.
    private func archivePick(date: Date, family: String, skip: Int) async -> Quote? {
        guard let backup = backupPosts() else { return nil }
        let backupIDs = Set(backup.map(\.id))
        let posts = backup + (cache.additions ?? []).filter { !backupIDs.contains($0.id) }
        let local = QuoteEngine(fetch: ArchiveFallback.fetch(posts), store: NullStore(), newIssueFirst: newIssueFirst, archive: { nil })
        for _ in 0..<skip { await local.nextIdea(for: date) }
        guard var quote = try? await local.quote(for: date, family: family) else { return nil }
        quote.offline = true
        return quote
    }

    private func offlinePick(day: String, max: Int, skip: Int) -> Quote? {
        var all: [(Issue, Int)] = []
        for key in cache.issues.keys.sorted(by: { (Int($0) ?? 0) < (Int($1) ?? 0) }) {
            guard let issue = cache.issues[key] else { continue }
            for (i, t) in issue.ideas.enumerated() where t.utf16.count <= max { all.append((issue, i)) }
        }
        if let latest = cache.meta?.latest {
            for (i, t) in latest.ideas.enumerated() where t.utf16.count <= max { all.append((latest, i)) }
        }
        guard !all.isEmpty else { return nil }
        let salt = skip == 0 ? "\(day)|offline" : "\(day)|skip\(skip)|offline"
        let (issue, i) = all[Int(fnv1a32(salt) % UInt32(all.count))]
        return makeQuote(issue, i, day: day, max: max, offline: true)
    }

    /// The pick for one skip, cached. Earlier skips are picked first so that "Another idea"
    /// never repeats an idea shown earlier that day, whatever is in the cache.
    private func pick(day: String, max: Int, skip: Int) async throws -> Quote? {
        let key = QuoteEngine.pickKey(day, max, skip)
        if let cached = cache.picks[key] { return cached }
        var quote: Quote?
        if skip == 0 {
            quote = try await choose(day: day, max: max)
        } else {
            var shown: Set<String> = []
            for k in 0..<skip {
                if let q = try await pick(day: day, max: max, skip: k) { shown.insert("\(q.issue.id)#\(q.ideaNumber)") }
            }
            quote = try await chooseAnother(day: day, max: max, skip: skip, shown: shown)
        }
        if let q = quote { cache.picks[key] = q }
        return quote
    }

    /// Skip n > 0: random issues from the whole archive (no new-issue mode), salted with the skip.
    private func chooseAnother(day: String, max: Int, skip: Int, shown: Set<String>) async throws -> Quote? {
        let meta = try await refreshMeta(day: day)
        var fallback: (issue: Issue, idx: Int, len: Int)?
        for attempt in 0..<QuoteEngine.maxAttempts {
            let k = Int(fnv1a32("\(day)|skip\(skip)|issue|\(attempt)") % UInt32(meta.total))
            guard let issue = try await issueAt(k), !issue.ideas.isEmpty else { continue }
            let n = issue.ideas.count
            let start = Int(fnv1a32("\(day)|skip\(skip)|idea|\(attempt)") % UInt32(n))
            for j in 0..<n {
                let idx = (start + j) % n
                if shown.contains("\(issue.id)#\(idx + 1)") { continue }
                let len = issue.ideas[idx].utf16.count
                if len <= max { return makeQuote(issue, idx, day: day, max: max) }
                if fallback == nil || len < fallback!.len { fallback = (issue, idx, len) }
            }
        }
        if let f = fallback { return makeQuote(f.issue, f.idx, day: day, max: max) }
        return nil
    }

    private func choose(day: String, max: Int) async throws -> Quote? {
        let meta = try await refreshMeta(day: day)
        let latest = meta.latest
        if newIssueFirst && !latest.ideas.isEmpty {
            let age = epochDay(day) - epochDay(latest.date)
            let idx = age - 1
            if age >= 1 && age <= 3 && idx < latest.ideas.count && latest.ideas[idx].utf16.count <= max {
                return makeQuote(latest, idx, day: day, max: max, isNew: true)
            }
        }

        // 1) A no-repeat walk through every issue published before January 1,
        // 2) then a few random issues if that one has no idea short enough for this size.
        let year = String(day.prefix(4))
        let base = try await yearBase(day: day)
        let dayOfYear = epochDay(day) - epochDay("\(year)-01-01")
        let k0 = (QuoteEngine.walkStep * dayOfYear + Int(fnv1a32("year|\(year)") % UInt32(base))) % base
        var candidates: [(k: Int, salt: String)] = [(k0, "walk")]
        for attempt in 1..<QuoteEngine.maxAttempts {
            candidates.append((Int(fnv1a32("\(day)|issue|\(attempt)") % UInt32(meta.total)), String(attempt)))
        }

        var fallback: (issue: Issue, idx: Int, len: Int)?
        for candidate in candidates {
            guard let issue = try await issueAt(candidate.k), !issue.ideas.isEmpty else { continue }
            let n = issue.ideas.count
            let start = Int(fnv1a32("\(day)|idea|\(candidate.salt)") % UInt32(n))
            for j in 0..<n {
                let idx = (start + j) % n
                let len = issue.ideas[idx].utf16.count
                if len <= max { return makeQuote(issue, idx, day: day, max: max) }
                if fallback == nil || len < fallback!.len { fallback = (issue, idx, len) }
            }
        }
        if let f = fallback { return makeQuote(f.issue, f.idx, day: day, max: max) }
        return nil
    }
}
