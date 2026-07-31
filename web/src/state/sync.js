// Getting the reader's decisions to their other devices.
//
// One file per device, appended to, never shared. Two browsers writing the same
// file would lose each other's work on every other write, which is the failure
// the old design had when the app and the agent both wrote the draft. So each
// device owns exactly one file, and reading is merging everyone else's.
//
// Merging is safe because events are immutable and carry the time they
// happened: absorbing the same event twice is a no-op, and absorbing them out
// of order still lands on the same state because they are replayed sorted.

import { EventStoreEvent } from "./event-store-event.js";

// Where a source's own log lives under its reader's root, beside the drafts
// rather than inside them: this is the app's file, not the agent's.
const ROOT = ".reviewer/events/";

export class Sync {
  /**
   * @param {object} options what to sync
   * @param {import("./multi-event-store.js").MultiEventStore} options.state the logs
   * @param {(source: object) => object} options.adapterFor the reader for a source
   * @param {string} options.deviceId this browser, stable across sessions
   */
  constructor({ state, adapterFor, deviceId }) {
    this.state = state;
    this.adapterFor = adapterFor;
    this.deviceId = deviceId;
    this._unwatch = new Map();
  }

  /**
   * Write this device's whole log to the reader.
   *
   * The whole log rather than the new part, because an append that has to know
   * what is already there needs a read-modify-write, and this file is small
   * enough that rewriting it is cheaper than being clever about it.
   *
   * A refused write is answered rather than thrown. A reader whose storage is
   * unreachable keeps reading and keeps deciding; what they have decided since
   * the last write that landed is what `unsynced` counts.
   *
   * @param {object} source which source
   * @returns {Promise<boolean>} whether it reached the source
   */
  async push(source) {
    const adapter = this.adapterFor(source);

    if (!adapter) return false;

    const events = this.state.allEvents(source.id);
    const body = events.map((event) => event.toLine()).join("\n");

    try {
      await adapter.write(this._path(this.deviceId), new TextEncoder().encode(body));
    } catch {
      // The mark stands where it was, which is the record of the failure: it
      // is what makes the count right again after a reload.
      return false;
    }

    // What went out, not what is held now. A decision made while the write was
    // in flight is not in the bytes that left.
    await this._record(source, events.length);

    return true;
  }

  /**
   * How many decisions are not known to have reached the source.
   *
   * A count rather than a position in the log. Absorbing a peer's older event
   * lands it in the middle of `allEvents`, which is sorted by time, so an index
   * or a timestamp would name the wrong events. Nothing is ever removed from a
   * log and a key is only ever applied once, so the difference between what is
   * held and what is known to have landed is exact however they interleave.
   *
   * @param {object} source which source
   * @returns {Promise<number>} how many are waiting
   */
  async unsynced(source) {
    return this.state.allEvents(source.id).length - (await this._known(source));
  }

  /**
   * Take in everything every other device has written.
   *
   * @param {object} source which source
   * @returns {Promise<number>} how many events were new here
   */
  async pull(source) {
    const adapter = this.adapterFor(source);

    if (!adapter) return 0;

    const entries = await adapter.list(ROOT);
    let taken = 0;

    for (const entry of entries) {
      // This device's own file is the one thing in here it already knows.
      if (entry.path === this._path(this.deviceId)) continue;

      taken += (await this._absorb(source, adapter, entry.path)).length;
    }

    return taken;
  }

  /**
   * Watch for other devices, and take in what they write.
   *
   * @param {object} source which source
   * @param {() => void} onChange called when something new arrived
   * @returns {() => void} stop watching
   */
  watch(source, onChange) {
    const adapter = this.adapterFor(source);

    if (!adapter) return () => {};

    const stop = adapter.watch(ROOT, (paths) => {
      const others = paths.filter((path) => path !== this._path(this.deviceId));

      if (!others.length) return;

      Promise.all(others.map((path) => this._absorb(source, adapter, path)))
        .then((absorbed) => {
          if (absorbed.some((events) => events.length)) onChange();
        })
        .catch(() => {
          // Another device's log being briefly unreadable is not worth
          // interrupting a reader over. The next round picks it up.
        });
    });

    this._unwatch.set(source.id, stop);

    return () => {
      stop();
      this._unwatch.delete(source.id);
    };
  }

  async _absorb(source, adapter, path) {
    const bytes = await adapter.read(path).catch(() => null);

    if (!bytes) return [];

    const events = [];

    for (const line of new TextDecoder().decode(bytes).split("\n")) {
      if (!line.trim()) continue;

      try {
        events.push(EventStoreEvent.fromLine(line));
      } catch {
        // One unreadable line is one lost decision, not a lost log. A device
        // writing a newer schema will have lines this one cannot read yet.
      }
    }

    const taken = await this.state.absorb(source.id, events);

    // What came out of the source is at the source. Counting a peer's decisions
    // as this device's backlog would have the pane raise an alarm about work
    // that is already safe.
    if (taken.length) await this._record(source, (await this._known(source)) + taken.length);

    return taken;
  }

  // The mark sits in preferences beside the device id rather than in the log:
  // it describes this browser's relationship with the storage, and syncing it
  // would tell every other device it had pushed what this one pushed.
  _known(source) {
    return this.state.preference(`synced:${source.id}`, 0);
  }

  _record(source, count) {
    return this.state.setPreference(`synced:${source.id}`, count);
  }

  _path(deviceId) {
    return `${ROOT}${deviceId}.jsonl`;
  }
}

/**
 * This browser's identity, so its log file is its own.
 *
 * Random rather than derived from anything about the user: it names a file in
 * the customer's own storage and should say nothing about who they are.
 *
 * @param {object} state the logs, where the id is remembered
 * @returns {Promise<string>} the device id
 */
export async function deviceIdFor(state) {
  const known = await state.preference("deviceId");

  if (known) return known;

  const made = crypto.randomUUID();

  await state.setPreference("deviceId", made);

  return made;
}
