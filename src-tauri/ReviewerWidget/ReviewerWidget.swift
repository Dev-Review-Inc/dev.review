// The home screen widget.
//
// It has no route back into the app's own state - a widget extension is its
// own process. web/src/app/widget.js writes the count into an App Group's
// shared UserDefaults every time the queue reloads (see src-tauri/src/widget.rs
// for the Rust side of that write), and this reads the same key.
//
// WidgetKit's own push for "a fresher number just arrived" - WidgetCenter.
// reloadTimelines() - is Swift-only; nothing else on this framework's surface
// reaches the Objective-C runtime, and the app has no Swift of its own for
// Rust to call into (it is a WKWebView shell). So this asks on a timer of its
// own instead of being told: not as current as it could be if the app could
// push, but current within one refresh window, rather than frozen forever at
// whatever count was on screen when the widget was added.

import SwiftUI
import UIKit
import WidgetKit

private let appGroup = "group.review.dev.app"
private let queueCountKey = "queueCount"
private let refreshInterval: TimeInterval = 15 * 60

// The same palette web/index.html's :root and its light-scheme override
// carry, so the widget reads as this app's own rather than a generic system
// tile. Named rather than pulled from an asset catalog: the widget target
// has no Assets.xcassets of its own, and four colors don't earn one.
private extension Color {
  init(light: (Double, Double, Double), dark: (Double, Double, Double)) {
    self = Color(UIColor { traits in
      let (r, g, b) = traits.userInterfaceStyle == .dark ? dark : light

      return UIColor(red: r, green: g, blue: b, alpha: 1)
    })
  }
}

private enum Theme {
  static let background = Color(light: (0.980, 0.973, 0.957), dark: (0.055, 0.059, 0.071))
  static let accent = Color(light: (0.118, 0.275, 0.784), dark: (0.431, 0.659, 0.996))
  static let green = Color(light: (0.184, 0.420, 0.275), dark: (0.341, 0.788, 0.541))
  static let dim = Color(light: (0.267, 0.243, 0.200), dark: (0.655, 0.682, 0.725))
}

struct QueueEntry: TimelineEntry {
  let date: Date
  let count: Int
}

struct QueueProvider: TimelineProvider {
  func placeholder(in context: Context) -> QueueEntry {
    QueueEntry(date: Date(), count: 0)
  }

  func getSnapshot(in context: Context, completion: @escaping (QueueEntry) -> Void) {
    completion(QueueEntry(date: Date(), count: currentCount()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<QueueEntry>) -> Void) {
    let entry = QueueEntry(date: Date(), count: currentCount())
    let nextCheck = Date().addingTimeInterval(refreshInterval)

    completion(Timeline(entries: [entry], policy: .after(nextCheck)))
  }

  private func currentCount() -> Int {
    UserDefaults(suiteName: appGroup)?.integer(forKey: queueCountKey) ?? 0
  }
}

struct ReviewerWidgetView: View {
  let entry: QueueEntry

  private var caughtUp: Bool { entry.count == 0 }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("REVIEWER")
        .font(.system(size: 11, weight: .semibold, design: .monospaced))
        .tracking(1.4)
        .foregroundStyle(Theme.dim)

      Spacer(minLength: 8)

      Text(caughtUp ? "✓" : "\(entry.count)")
        .font(.system(size: 38, weight: .bold, design: .monospaced))
        .foregroundStyle(caughtUp ? Theme.green : Theme.accent)

      Text(caughtUp ? "caught up" : entry.count == 1 ? "review waiting" : "reviews waiting")
        .font(.system(size: 13, weight: .medium, design: .monospaced))
        .foregroundStyle(Theme.dim)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .padding(16)
    .containerBackground(Theme.background, for: .widget)
  }
}

struct ReviewerWidget: Widget {
  let kind = "ReviewerWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: QueueProvider()) { entry in
      ReviewerWidgetView(entry: entry)
    }
    .configurationDisplayName("Reviewer")
    .description("How many pull requests are waiting for your review.")
    .supportedFamilies([.systemSmall])
  }
}

@main
struct ReviewerWidgetBundle: WidgetBundle {
  var body: some Widget {
    ReviewerWidget()
  }
}
