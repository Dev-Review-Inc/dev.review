// One event log per source, and one for the app itself.
//
// A source is a reader: a name and the storage its drafts come from. Its
// decisions belong with that storage, so each gets its own log, its own local
// database, and its own sync. Switching source switches the queue and the
// decisions together, and two sources watching different orgs cannot mix.
//
// The root log is separate again and never syncs anywhere. It holds the list of
// sources and destinations, which describe where things live and so cannot
// themselves live inside one of those places.

import { EventStore } from "./event-store.js";
import { MemoryKeyValueStore } from "./key-value-store.js";

export class MultiEventStore {
  /**
   * @param {object} options how the stores are built
   * @param {object} options.runners the reducers every log shares
   * @param {(name: string) => object} options.database makes a key value store
   * @param {string} [options.name] prefix for the underlying databases
   */
  constructor({ runners, database, name = "reviewer" }) {
    this._runners = runners;
    this._database = database || (() => new MemoryKeyValueStore());
    this._name = name;
    this._dbs = {};

    this._root = new EventStore({ db: this._database(`${name}-root`), runners });
    // Preferences sit beside the root log rather than in it. Which source is
    // open and whether the flagged filter is on are not decisions worth a
    // history, and a credential must never be in something that syncs.
    this._config = this._database(`${name}-config`);
  }

  /**
   * Start a log for a source, or return the one already running.
   *
   * @param {string} id the source
   * @returns {EventStore} its log
   */
  open(id) {
    if (!this._dbs[id]) {
      this._dbs[id] = new EventStore({
        db: this._database(`${this._name}-${id}`),
        runners: this._runners,
      });
    }

    return this._dbs[id];
  }

  /**
   * Throw away a source's log and everything in it.
   *
   * @param {string} id the source
   * @returns {Promise<void>} when it is gone
   */
  async close(id) {
    const db = this._dbs[id];

    delete this._dbs[id];

    if (db) await db.teardown();

    await this._config.removeItem(id);
  }

  /**
   * Record something.
   *
   * @param {string|null} id the source, or null for the app's own log
   * @param {string} collection which collection it concerns
   * @param {string|null} objectId what it concerns; null to have one generated
   * @param {string} action what was done
   * @param {*} [data] the payload
   * @returns {EventStoreEvent} the event
   */
  track(id, collection, objectId, action, data) {
    return this._store(id).track(collection, objectId, action, data);
  }

  /**
   * Wait for every log's outstanding writes to be in storage.
   *
   * @returns {Promise<void>} when nothing anywhere is outstanding
   */
  async settled() {
    const logs = [this._root, ...Object.values(this._dbs)];

    // Settled rather than all, so this holds whatever a log does. What waits
    // here is waiting to draw, and one log that answers with a failure should
    // not reject onto the redraw path and freeze the interface for the rest.
    await Promise.allSettled(logs.map((db) => db.settled()));
  }

  /**
   * Read a collection.
   *
   * @param {string|null|undefined} id a source, null for the app's own log,
   *   or undefined for every source at once
   * @param {string} collection which collection
   * @returns {object[]} the objects, oldest first
   */
  findAll(id, collection) {
    if (id !== undefined) return this._store(id).findAll(collection);

    return Object.values(this._dbs)
      .reduce((items, db) => items.concat(db.findAll(collection)), [])
      .sort(EventStore.SORT_BY_DATE);
  }

  /**
   * Every event one log holds, for handing to sync.
   *
   * @param {string|null} id the source, or null for the app's own log
   * @returns {EventStoreEvent[]} the log, oldest first
   */
  allEvents(id) {
    return this._store(id).allEvents();
  }

  /**
   * Fold in events from somewhere else.
   *
   * @param {string|null} id the source, or null for the app's own log
   * @param {EventStoreEvent[]} events what arrived
   * @returns {Promise<EventStoreEvent[]>} the ones that were new here
   */
  absorb(id, events) {
    return this._store(id).absorb(events);
  }

  /**
   * Rebuild everything from what was persisted.
   *
   * The root log comes back first, because it is what says which sources
   * there are to restore.
   *
   * @returns {Promise<void>} when every log is back
   */
  async restore() {
    await this._root.restore();

    for (const source of this._root.findAll("sources")) this.open(source.id);

    await Promise.all(Object.values(this._dbs).map((db) => db.restore()));
  }

  /**
   * @param {string} key which preference
   * @param {*} [fallback] what to answer when it has never been set
   * @returns {Promise<*>} the value
   */
  async preference(key, fallback = null) {
    const value = await this._config.getItem(`preference:${key}`);

    return value === null || value === undefined ? fallback : value;
  }

  /**
   * @param {string} key which preference
   * @param {*} value what to remember
   * @returns {Promise<void>} when it is written
   */
  async setPreference(key, value) {
    await this._config.setItem(`preference:${key}`, value);
  }

  /**
   * A source's or destination's secret: adapter keys, a personal access token.
   *
   * Kept out of the event log deliberately. The log is what syncs to the
   * customer's storage, and a credential that syncs is a credential that
   * leaves the browser it was typed into.
   *
   * @param {string} id whose secret
   * @returns {Promise<object>} the secret, or an empty object
   */
  async secret(id) {
    return (await this._config.getItem(`secret:${id}`)) || {};
  }

  /**
   * @param {string} id whose secret
   * @param {object} value the secret
   * @returns {Promise<void>} when it is written
   */
  async setSecret(id, value) {
    await this._config.setItem(`secret:${id}`, value);
  }

  /**
   * @param {string} id whose secret
   * @returns {Promise<void>} when it is gone
   */
  async forgetSecret(id) {
    await this._config.removeItem(`secret:${id}`);
  }

  _store(id) {
    if (id === null) return this._root;

    if (!id) throw new Error("which source? pass null for the app's own log");

    return this.open(id);
  }
}
