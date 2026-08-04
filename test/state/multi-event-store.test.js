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

describe("secrets", () => {
  test("without a secrets store of its own, a secret sits in the same store as everything else's config", async () => {
    const config = new MemoryKeyValueStore();
    const state = new MultiEventStore({ runners: {}, database: () => config });

    await state.setSecret("github", { token: "abc" });

    assert.deepEqual(await config.getItem("secret:github"), { token: "abc" });
  });

  test("given a secrets store, a secret goes there instead - never into the config store", async () => {
    const config = new MemoryKeyValueStore();
    const secrets = new MemoryKeyValueStore();
    const state = new MultiEventStore({ runners: {}, database: () => config, secrets });

    await state.setSecret("github", { token: "abc" });

    assert.deepEqual(await secrets.getItem("secret:github"), { token: "abc" });
    assert.equal(await config.getItem("secret:github"), null);
  });

  test("reads and forgets go through the same secrets store a write used", async () => {
    const secrets = new MemoryKeyValueStore();
    const state = new MultiEventStore({ runners: {}, database: () => new MemoryKeyValueStore(), secrets });

    await state.setSecret("github", { token: "abc" });
    assert.deepEqual(await state.secret("github"), { token: "abc" });

    await state.forgetSecret("github");
    assert.deepEqual(await state.secret("github"), {});
    assert.equal(await secrets.getItem("secret:github"), null);
  });
});
