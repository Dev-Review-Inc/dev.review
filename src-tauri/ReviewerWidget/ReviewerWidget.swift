// The home screen widget.
//
// It has no route back into the app's own state - a widget extension is its
// own process. web/src/app/widget.js writes the count into an App Group's
// shared UserDefaults every time the queue reloads (see src-tauri/src/widget.rs
// for the Rust side of that write), and this reads the same key. There is no
// timer here asking for a fresher number on its own: the count is only ever
// as current as the app's last queue reload, and a timeline that guessed
// between those reloads would just be guessing wrong on a fixed schedule
// instead of an honest one.

import SwiftUI
import WidgetKit

private let appGroup = "group.review.dev.app"
private let queueCountKey = "queueCount"

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

    completion(Timeline(entries: [entry], policy: .never))
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
    .configurationDisplayName("Dev Review")
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
