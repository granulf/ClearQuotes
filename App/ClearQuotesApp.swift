// ClearQuotesApp.swift
// The small host app for the widget. It shows today's idea, and when you click
// the widget it forwards the click to your browser (opening the issue).

import AppKit
import SwiftUI
import WidgetKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let launchedAt = Date()

    /// Clicking the widget opens clearquotes://open?url=<issue>: open the issue in the browser.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            if let target = WidgetLink.issueURL(from: url) {
                _ = NSWorkspace.shared.open(target)
            }
        }
        // If the app was started only to forward the click, get out of the way.
        if Date().timeIntervalSince(launchedAt) < 3 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                NSApp.terminate(nil)
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

@main
struct ClearQuotesApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("James Clear 3-2-1", id: "main") {
            ContentView()
        }
        .windowResizability(.contentSize)
    }
}
