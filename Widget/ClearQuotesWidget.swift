// ClearQuotesWidget.swift
// macOS widget: one idea a day from James Clear's 3-2-1 newsletter.

import AppIntents
import SwiftUI
import WidgetKit

/// One engine per widget-extension process; the actor serializes cache access.
enum WidgetShared {
    static let engine = QuoteEngine()
}

/// The widget's "Another idea" button. WidgetKit reloads the timeline after it runs.
struct NextIdeaIntent: AppIntent {
    static let title: LocalizedStringResource = "Another idea"
    static let description: IntentDescription? = IntentDescription("Swaps today's idea for another one until midnight.")

    func perform() async throws -> some IntentResult {
        await WidgetShared.engine.nextIdea()
        return .result()
    }
}

/// The widget's back button, shown after "Another idea": returns to the idea before.
struct PreviousIdeaIntent: AppIntent {
    static let title: LocalizedStringResource = "Previous idea"
    static let description: IntentDescription? = IntentDescription("Goes back to the idea shown before the last \"Another idea\".")

    func perform() async throws -> some IntentResult {
        await WidgetShared.engine.previousIdea()
        return .result()
    }
}

enum EntryState {
    case ok, placeholder, preview, offline
}

struct QuoteEntry: TimelineEntry {
    let date: Date
    let quote: Quote?
    let state: EntryState
    /// "Another idea" presses in effect today; the back button shows when it is above 0.
    var skip: Int = 0

    var message: String {
        switch state {
        case .offline: return "Couldn't reach jamesclear.com yet. Trying again soon."
        default: return "Today's idea from James Clear's 3-2-1 newsletter appears here."
        }
    }
}

extension WidgetFamily {
    var cardSize: CardSize {
        switch self {
        case .systemSmall: return .small
        case .systemLarge: return .large
        case .systemExtraLarge: return .extraLarge
        default: return .medium
        }
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> QuoteEntry {
        QuoteEntry(date: Date(), quote: nil, state: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (QuoteEntry) -> Void) {
        let key = context.family.cardSize.engineKey
        let isPreview = context.isPreview
        Task {
            if isPreview, let cached = await WidgetShared.engine.anyCachedQuote(family: key) {
                completion(QuoteEntry(date: Date(), quote: cached, state: .ok))
                return
            }
            let quote = try? await WidgetShared.engine.quote(for: Date(), family: key)
            let skip = await WidgetShared.engine.currentSkip()
            completion(QuoteEntry(date: Date(), quote: quote, state: quote == nil ? (isPreview ? .preview : .offline) : .ok, skip: skip))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuoteEntry>) -> Void) {
        let key = context.family.cardSize.engineKey
        Task {
            let now = Date()
            let quote = try? await WidgetShared.engine.quote(for: now, family: key)
            let skip = await WidgetShared.engine.currentSkip(for: now)
            // New idea just after midnight; retry in 30 minutes if offline (or showing a cached fallback).
            let retry = quote == nil || quote?.offline == true
            let next = retry ? now.addingTimeInterval(30 * 60) : Provider.nextMidnight(after: now)
            let entry = QuoteEntry(date: now, quote: quote, state: quote == nil ? .offline : .ok, skip: skip)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    static func nextMidnight(after date: Date) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let today = calendar.startOfDay(for: date)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: today) ?? date.addingTimeInterval(86_400)
        return tomorrow.addingTimeInterval(5 * 60)
    }
}

struct QuoteWidgetView: View {
    let entry: QuoteEntry

    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        QuoteCardView(
            quote: entry.quote,
            message: entry.message,
            size: family.cardSize,
            systemColors: renderingMode != .fullColor
        )
        .redacted(reason: entry.state == .placeholder ? RedactionReasons.placeholder : RedactionReasons())
        .overlay(alignment: .topTrailing) {
            if entry.quote != nil {
                HStack(spacing: 0) {
                    if entry.skip > 0 {
                        cornerButton(PreviousIdeaIntent(), symbol: "chevron.backward", label: "Previous idea")
                    }
                    cornerButton(NextIdeaIntent(), symbol: "arrow.triangle.2.circlepath", label: "Another idea")
                }
                .offset(x: 4, y: -4)
            }
        }
        .widgetURL(entry.quote.flatMap { WidgetLink.make(for: $0) })
        .containerBackground(for: .widget) {
            Palette.background(scheme)
        }
    }

    private func cornerButton(_ intent: some AppIntent, symbol: String, label: String) -> some View {
        Button(intent: intent) {
            Image(systemName: symbol)
                .font(.system(size: family == .systemSmall ? 10 : 11, weight: .semibold))
                .foregroundStyle(renderingMode == .fullColor ? Palette.muted(scheme) : Color.secondary)
                .padding(4)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
    }
}

@main
struct ClearQuotesWidget: Widget {
    let kind = "ClearQuotesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            QuoteWidgetView(entry: entry)
        }
        .configurationDisplayName("James Clear 3-2-1")
        .description("One idea a day from James Clear's 3-2-1 newsletter. Click to open the issue, or the corner buttons for another idea and back.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
    }
}

#Preview(as: .systemMedium) {
    ClearQuotesWidget()
} timeline: {
    QuoteEntry(date: .now, quote: nil, state: .preview)
    QuoteEntry(date: .now, quote: nil, state: .offline)
}
