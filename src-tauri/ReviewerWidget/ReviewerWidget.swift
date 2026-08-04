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
import WidgetKit

private let appGroup = "group.review.dev.app"
private let queueCountKey = "queueCount"
private let refreshInterval: TimeInterval = 15 * 60

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

  var body: some View {
    VStack(spacing: 4) {
      Text("\(entry.count)")
        .font(.system(size: 34, weight: .bold, design: .monospaced))
      Text(entry.count == 1 ? "review waiting" : "reviews waiting")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .containerBackground(.fill.tertiary, for: .widget)
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
