// QuoteCardView.swift
// The quote layout shared by the widget and the app window.

import SwiftUI

enum CardSize: String {
    case small, medium, large, extraLarge

    var textSize: CGFloat {
        switch self {
        case .small: return 14
        case .medium: return 16
        case .large: return 19
        case .extraLarge: return 22
        }
    }

    var markSize: CGFloat { self == .small ? 26 : textSize * 2 }

    /// Key used by QuoteEngine for the length limit.
    var engineKey: String { rawValue }
}

enum Palette {
    static func background(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x1C1A17) : Color(hex: 0xFBF8F3)
    }
    static func text(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0xF1ECE4) : Color(hex: 0x1F1C18)
    }
    static func muted(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0x9A9286) : Color(hex: 0x8C8478)
    }
    static func accent(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(hex: 0xE3A35F) : Color(hex: 0xB4632A)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

struct QuoteCardView: View {
    let quote: Quote?
    /// Shown when there is no quote (loading, offline, gallery preview).
    let message: String
    let size: CardSize
    /// true when the system draws the widget tinted or monochrome: use system colors.
    var systemColors: Bool = false

    @Environment(\.colorScheme) private var scheme

    private var textColor: Color { systemColors ? .primary : Palette.text(scheme) }
    private var mutedColor: Color { systemColors ? .secondary : Palette.muted(scheme) }
    private var accentColor: Color { systemColors ? .primary : Palette.accent(scheme) }

    private var footer: String {
        guard let quote = quote else { return "JAMES CLEAR \u{00B7} 3-2-1" }
        if size == .small { return quote.isNew ? "NEW \u{00B7} JAMES CLEAR" : "JAMES CLEAR" }
        let tag = quote.isNew ? "NEW" : "3-2-1"
        return "JAMES CLEAR \u{00B7} \(tag) \u{00B7} \(prettyDate(quote.issue.date).uppercased())"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: size == .small ? 2 : 4) {
            Text("\u{201C}")
                .font(.system(size: size.markSize, weight: .bold, design: .serif))
                .foregroundStyle(accentColor)
                .frame(height: size.markSize * 0.6, alignment: .top)
                .accessibilityHidden(true)
            Text(quote?.text ?? message)
                .font(.system(size: size.textSize, design: .serif))
                .foregroundStyle(quote == nil ? mutedColor : textColor)
                .lineSpacing(size.textSize * 0.12)
                .minimumScaleFactor(0.55)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            Text(footer)
                .font(.system(size: size == .small ? 8 : 9, weight: .semibold))
                .kerning(0.6)
                .foregroundStyle(quote?.isNew == true ? accentColor : mutedColor)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}
