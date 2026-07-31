import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { IndexedDBKeyValueStore } from "../../web/src/state/key-value-store.js";

// Enough of IndexedDB to watch when transactions are created. The open request
// answers from the event loop, the way a real one does, because that delay is
// the whole thing under test.
function fakeIndexedDB() {
  const transactions = [];

  const database = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction(name, mode) {
      const transaction = { mode, objectStore: () => objectStore(transaction) };

      transactions.push(transaction);
      queueMicrotask(() => transaction.oncomplete && transaction.oncomplete());

      return transaction;
    },
  };

  function objectStore(transaction) {
    const record = (kind) => (value, key) => {
      transaction.wrote = { kind, value, key };

      return { result: undefined };
    };

    return { put: record("put"), get: record("get"), delete: record("delete") };
  }

  return {
    transactions,
    open() {
      const request = { result: database };

      setTimeout(() => request.onsuccess && request.onsuccess(), 0);

      return request;
    },
  };
}

describe("IndexedDBKeyValueStore", () => {
  let original;

  before(() => {
    original = globalThis.indexedDB;
  });

  after(() => {
    globalThis.indexedDB = original;
  });

  test("writes in the task that asked, so a tab closing after it still commits", async () => {
    const fake = fakeIndexedDB();
    globalThis.indexedDB = fake;
    const store = new IndexedDBKeyValueStore("reviewer-test");
    // A read at startup is what opens the connection in the real app.
    await store.getItem("anything");

    const written = store.setItem("a-key", { body: "hi" });

    // No await between the call and this line: the transaction has to exist
    // already, because a document torn down now would take a later one with it.
    assert.equal(fake.transactions.filter((one) => one.mode === "readwrite").length, 1);
    await written;
  });
});
