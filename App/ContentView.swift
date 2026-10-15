// ContentView.swift
// Today's idea in a medium-widget-sized card, plus a couple of handy buttons.

import AppKit
import SwiftUI
import WidgetKit

struct ContentView: View {
    @State private var quote: Quote?
    @State private var message = "Loading today's idea\u{2026}"
    @Environment(\.colorScheme) private var scheme

    private let engine = QuoteEngine()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            QuoteCardView(quote: quote, message: message, size: .medium)
                .padding(16)
                .frame(width: 364, height: 170)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(Palette.background(scheme))
                        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
                )

            HStack(spacing: 10) {
                Button("Open this issue") {
                    if let url = quote?.url { _ = NSWorkspace.shared.open(url) }
                }
                .disabled(quote == nil)
                Button("Reload widgets") {
                    WidgetCenter.shared.reloadAllTimelines()
                }
                Spacer()
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Add the widget: right-click the desktop \u{2192} Edit Widgets\u{2026} \u{2192} search \u{201C}James Clear\u{201D}.")
                Text("A new idea appears every morning. Friday to Sunday show that week's newest issue.")
            }
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .frame(width: 404)
        .task { await load() }
    }

    private func load() async {
        do {
            quote = try await engine.quote(for: Date(), family: CardSize.medium.engineKey)
        } catch {
            message = "Couldn't reach jamesclear.com. Check your connection and reopen the app."
        }
    }
}
