import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MultiEventStore } from "../../web/src/state/multi-event-store.js";
import { MemoryKeyValueStore } from "../../web/src/state/key-value-store.js";

function store() {
  return new MultiEventStore({ runners: {}, database: () => new MemoryKeyValueStore() });
}

describe("MultiEventStore", () => {
  test("opens one log per source and gives the same one back", () => {
    const state = store();

    assert.equal(state.open("work"), state.open("work"));
    assert.notEqual(state.open("work"), state.open("home"));
  });

  // Whatever waits on this is waiting to draw. One log that will not settle
  // must not be able to hold up the drawing of every other one.
  test("settles when a log's own settle rejects", async () => {
    const state = store();
    state.open("work").settled = () => Promise.reject(new Error("the disk is full"));

    await state.settled();
  });
});
