// Telling the home screen widget how many reviews are waiting.
//
// The widget runs as its own process and cannot ask this app anything, so it
// is told rather than asked - every time the queue is reloaded, not on some
// schedule of its own, because a stale count is worse than a slightly late
// one and this app already reloads the queue on a timer.

import { inTauriIOS } from "../adapters/tauri.js";

function core() {
  const api = globalThis.__TAURI__;

  return api?.core?.invoke ? api.core : null;
}

/**
 * @param {number} count how many pull requests are waiting
 * @returns {Promise<void>} when the widget has been told, or straight away
 *   everywhere this cannot reach
 */
export async function syncWidget(count) {
  if (!inTauriIOS()) return;

  const api = core();

  if (!api) return;

  await api.invoke("widget_update", { count });
}
