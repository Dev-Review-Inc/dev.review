// How a source is doing, asked of every source rather than the open one.
//
// The settings pane lists sources the app is not reading through, so it cannot
// learn about them from the drafts projection: that is built over one adapter,
// the attached one. This asks each source directly instead, and answers in the
// three states a reader can act on - it works, it works and holds nothing, it
// cannot be reached.
//
// This runs for every configured source on boot, so it must never cost the
// reader a permission prompt. It asks `ready()`, which every adapter documents
// as looking rather than asking: the filesystem backend queries the handle's
// permission and keeps `requestPermission` in `request()`, behind a click.
//
// Nothing here throws. A source that is unreachable is the case this exists to
// report, and a probe that threw would take the sweep over the other sources
// with it.

import { ROOT, keyOf } from "./drafts.js";

/**
 * Look at one source.
 *
 * "No drafts here" is one state rather than two. A missing `drafts/` and an
 * empty one are the same answer from every backend we ship: S3 cannot tell an
 * absent prefix from an empty one at all, and both filesystem backends list a
 * missing directory as no entries. Reporting "the directory is missing" would
 * be a guess dressed as a finding, and the remedy is the same either way.
 *
 * @param {object} adapter a built adapter
 * @param {() => number} [now] the clock
 * @returns {Promise<{state: string, reason: string, drafts: number, at: number}>} how it is doing
 */
export async function probe(adapter, now = Date.now) {
  try {
    const ready = await adapter.ready();

    if (!ready.ok) return { state: "broken", reason: ready.reason, drafts: 0, at: now() };

    const entries = await adapter.list(ROOT);

    // Counted the way the projection counts: a draft is a path `keyOf` claims,
    // and one pull request is one draft however many files sit beside it.
    const drafts = new Set(entries.map((entry) => keyOf(entry.path)).filter(Boolean)).size;

    if (!drafts) {
      return {
        state: "warn",
        reason: "No drafts are waiting here. Point the review sweep at this storage to fill it.",
        drafts: 0,
        at: now(),
      };
    }

    return { state: "ok", reason: "", drafts, at: now() };
  } catch (error) {
    return { state: "broken", reason: error.message, drafts: 0, at: now() };
  }
}
