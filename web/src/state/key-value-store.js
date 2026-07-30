// Where events sit between sessions.
//
// The event store does not care which of these it was handed, which is what
// lets the whole domain be tested in node without a browser anywhere near it.
// Both keep the same tiny surface: get, set, remove, iterate, clear, teardown.

/**
 * A store that forgets everything when the process does.
 *
 * Used by the tests, and by any adapter that has nowhere durable to write.
 */
export class MemoryKeyValueStore {
  constructor() {
    this._items = new Map();
  }

  async getItem(key) {
    return this._items.has(key) ? this._items.get(key) : null;
  }

  async setItem(key, value) {
    this._items.set(key, value);
    return value;
  }

  async removeItem(key) {
    this._items.delete(key);
  }

  async iterate(each) {
    for (const [key, value] of this._items) each(value, key);
  }

  async clear() {
    this._items.clear();
  }

  async teardown() {
    this._items.clear();
  }
}

// One object store per database, named the same way every time, so a database
// opened twice in one session is the same database.
const STORE = "keyvalue";

/**
 * A store backed by IndexedDB, one database per name.
 *
 * IndexedDB rather than localStorage because the event log outgrows five
 * megabytes on a busy source, and because deleting a source should be
 * one call rather than a scan for prefixed keys.
 */
export class IndexedDBKeyValueStore {
  constructor(name) {
    this.name = name;
    this._opening = null;
  }

  _open() {
    if (this._opening) return this._opening;

    this._opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);

      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this._opening;
  }

  async _transact(mode, run) {
    const db = await this._open();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));

      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async getItem(key) {
    const value = await this._transact("readonly", (store) => store.get(key));

    return value === undefined ? null : value;
  }

  async setItem(key, value) {
    await this._transact("readwrite", (store) => store.put(value, key));

    return value;
  }

  async removeItem(key) {
    await this._transact("readwrite", (store) => store.delete(key));
  }

  async iterate(each) {
    const db = await this._open();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).openCursor();

      request.onsuccess = () => {
        const cursor = request.result;

        if (!cursor) return resolve();

        each(cursor.value, cursor.key);
        cursor.continue();
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  async clear() {
    await this._transact("readwrite", (store) => store.clear());
  }

  async teardown() {
    const db = await this._open();
    db.close();
    this._opening = null;

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      // Another tab holding the database open should not hang the delete.
      request.onblocked = () => resolve();
    });
  }
}
