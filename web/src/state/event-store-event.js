// One thing the reader decided, written down and never changed again.
//
// The key leads with the time so that storage hands events back in the order
// they happened, and carries every other part so an event can be reconstructed
// from its key alone if the payload is ever lost.

// Bumped when the meaning of a payload changes, so an old event can be read
// forward rather than silently misread.
const VERSION = "v1";

export class EventStoreEvent {
  constructor(collection, objectId, action, data, time, version) {
    this.collection = collection;
    this.objectId = objectId;
    this.action = action;
    this.data = data === undefined ? null : data;
    this.time = time || Date.now();
    this.version = version || VERSION;
  }

  /**
   * The event's identity: unique, and sortable by when it happened.
   *
   * @returns {string} e.g. "1700000000000/findings/org--app-1:x/drop/v1"
   */
  get key() {
    return `${this.time}/${this.collection}/${this.objectId}/${this.action}/${this.version}`;
  }

  /**
   * The event as it is held in local storage.
   *
   * @returns {object} a plain object, safe to structured-clone
   */
  toLocal() {
    return {
      collection: this.collection,
      objectId: this.objectId,
      action: this.action,
      data: this.data,
      time: this.time,
      version: this.version,
    };
  }

  /**
   * The event as one line of a sync file.
   *
   * Line-per-event so syncing is an append and a partial write costs one
   * event rather than the whole log.
   *
   * @returns {string} JSON, with no newline of its own
   */
  toLine() {
    return JSON.stringify(this.toLocal());
  }

  /**
   * @param {object} value what {@link toLocal} produced
   * @returns {EventStoreEvent} the event
   */
  static fromLocal(value) {
    return new EventStoreEvent(
      value.collection,
      value.objectId,
      value.action,
      value.data,
      value.time,
      value.version,
    );
  }

  /**
   * @param {string} line what {@link toLine} produced
   * @returns {EventStoreEvent} the event
   */
  static fromLine(line) {
    return EventStoreEvent.fromLocal(JSON.parse(line));
  }
}
