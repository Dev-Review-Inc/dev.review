// The reader's decisions, as an append-only log.
//
// Nothing the drafting agent writes is in here. The draft is external input:
// it is read through an adapter, projected, and never written back. What this
// store holds is what the *reader* decided — dropped, restored, edited, posted,
// dismissed, marked read — which is the only thing this app is the author of.
//
// Keeping the two apart means the draft has exactly one writer (the agent) and
// this log has exactly one writer (the reader), so the two can never race for
// the same bytes.

import { EventStoreEvent } from "./event-store-event.js";
import { MemoryKeyValueStore } from "./key-value-store.js";

/**
 * Sort objects by when they were first written.
 *
 * @param {object} a an object built by a runner
 * @param {object} b another
 * @returns {number} the comparison
 */
export const SORT_BY_DATE = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);

export class EventStore {
  /**
   * @param {object} options how this store is built
   * @param {object} options.db a key value store to persist events in
   * @param {object} options.runners the reducers, keyed "collection.action"
   */
  constructor({ db, runners = {} }) {
    this._db = db || new MemoryKeyValueStore();
    this._runners = runners;
    this._state = {};
    this._keys = new Set();
    this._events = [];

    // A collection exists because a runner names it. Declaring them anywhere
    // else would let a typo in a runner key create a silent second collection.
    for (const key of Object.keys(runners)) {
      const collection = key.split(".")[0];
      if (!this._state[collection]) this._state[collection] = [];
    }
  }

  /**
   * Record something the reader did.
   *
   * @param {string} collection which collection it concerns
   * @param {string|null} objectId what it concerns; null to have one generated
   * @param {string} action what was done
   * @param {*} [data] the payload
   * @param {number} [time] when, for replaying a log from elsewhere
   * @returns {EventStoreEvent} the event, carrying the id if one was generated
   */
  track(collection, objectId, action, data, time) {
    const event = new EventStoreEvent(
      collection,
      objectId || crypto.randomUUID(),
      action,
      data,
      time,
    );

    this._apply(event);
    this._db.setItem(event.key, event.toLocal());

    return event;
  }

  /**
   * Take events that happened somewhere else — another device, another tab.
   *
   * @param {EventStoreEvent[]} events the events to fold in
   * @returns {Promise<EventStoreEvent[]>} the ones that were new here
   */
  async absorb(events) {
    const fresh = events.filter((event) => !this._keys.has(event.key));
    // Sorted because a peer's log may interleave with ours, and a runner that
    // runs out of order builds a different object than a replay would.
    const ordered = [...fresh].sort((a, b) => a.time - b.time);

    for (const event of ordered) {
      this._apply(event);
      await this._db.setItem(event.key, event.toLocal());
    }

    return ordered;
  }

  /**
   * Rebuild state from what was persisted.
   *
   * @returns {Promise<object>} the state
   */
  async restore() {
    const events = [];

    await this._db.iterate((value) => events.push(EventStoreEvent.fromLocal(value)));

    events.sort((a, b) => a.time - b.time);
    events.forEach((event) => this._apply(event));

    return this._state;
  }

  /**
   * Everything in a collection that has not been deleted.
   *
   * Deletion is filtered here rather than in the queries, so no query can
   * forget to do it.
   *
   * @param {string} collection which collection
   * @returns {object[]} the objects
   */
  findAll(collection) {
    return this.findAllWithDeleted(collection).filter((item) => !item._deleted);
  }

  /**
   * @param {string} collection which collection
   * @returns {object[]} the objects, including deleted ones
   */
  findAllWithDeleted(collection) {
    return this._state[collection] || [];
  }

  /**
   * Every event this store holds, oldest first.
   *
   * @returns {EventStoreEvent[]} the log
   */
  allEvents() {
    return [...this._events].sort((a, b) => a.time - b.time);
  }

  /**
   * @returns {Promise<void>} when the store and its storage are gone
   */
  async teardown() {
    return this._db.teardown();
  }

  _apply(event) {
    if (this._keys.has(event.key)) return;

    this._keys.add(event.key);
    this._events.push(event);

    const runner = this._runners[`${event.collection}.${event.action}`];

    // An action with no runner is a newer version of this app writing an event
    // this one does not understand. Keeping it means it still syncs on, and is
    // still there when this browser catches up.
    if (runner) runner.call(this._state, event);
  }
}

/**
 * The reducers every store gets for free.
 */
EventStore.RUNNERS = {
  CREATE(event) {
    this[event.collection].push({
      ...event.data,
      id: event.objectId,
      createdAt: event.time,
      _collection: event.collection,
    });
  },

  UPDATE(event) {
    const existing = this[event.collection].find((item) => item.id === event.objectId);

    // Creating on update rather than dropping the change: an edit that arrives
    // from another device before the thing it edits must not be lost.
    if (!existing) return EventStore.RUNNERS.CREATE.call(this, event);

    existing.updatedAt = event.time;
    Object.assign(existing, event.data);
  },

  DELETE(event) {
    let existing = this[event.collection].find((item) => item.id === event.objectId);

    // A delete that arrives before the create leaves a tombstone, so the
    // create cannot resurrect what another device already threw away.
    if (!existing) {
      existing = { id: event.objectId, createdAt: event.time, _collection: event.collection };
      this[event.collection].push(existing);
    }

    existing._deleted = true;
    existing.deletedAt = event.time;
  },
};

EventStore.SORT_BY_DATE = SORT_BY_DATE;
