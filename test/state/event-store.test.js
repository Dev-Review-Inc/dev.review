import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MemoryKeyValueStore } from "../../web/src/state/key-value-store.js";
import { EventStoreEvent } from "../../web/src/state/event-store-event.js";
import { EventStore } from "../../web/src/state/event-store.js";

const RUNNERS = {
  "notes.create": EventStore.RUNNERS.CREATE,
  "notes.update": EventStore.RUNNERS.UPDATE,
  "notes.delete": EventStore.RUNNERS.DELETE,
  "notes.pin"(event) {
    const note = this.notes.find((item) => item.id === event.objectId);
    if (note) note.pinnedAt = event.time;
  },
};

function store(db = new MemoryKeyValueStore()) {
  return new EventStore({ db, runners: RUNNERS });
}

describe("EventStoreEvent", () => {
  test("keys sort by time and carry every part", () => {
    const event = new EventStoreEvent("notes", "abc", "create", { body: "hi" }, 1700, "v1");

    assert.equal(event.key, "1700/notes/abc/create/v1");
  });

  test("survives a round trip through storage", () => {
    const event = new EventStoreEvent("notes", "abc", "create", { body: "hi" }, 1700, "v1");
    const restored = EventStoreEvent.fromLocal(event.toLocal());

    assert.deepEqual(restored, event);
  });

  test("reads back a line of the sync file", () => {
    const event = new EventStoreEvent("notes", "abc", "create", { body: "hi" }, 1700, "v1");
    const restored = EventStoreEvent.fromLine(event.toLine());

    assert.deepEqual(restored, event);
  });
});

describe("EventStore", () => {
  test("builds state by running events through their runners", () => {
    const state = store();

    state.track("notes", "abc", "create", { body: "hi" });

    assert.deepEqual(
      state.findAll("notes").map((note) => note.body),
      ["hi"],
    );
  });

  test("generates an id when the caller has none", () => {
    const state = store();

    const event = state.track("notes", null, "create", { body: "hi" });

    assert.ok(event.objectId);
    assert.equal(state.findAll("notes")[0].id, event.objectId);
  });

  test("hides soft deleted objects but keeps them for the asking", () => {
    const state = store();
    state.track("notes", "abc", "create", { body: "hi" });

    state.track("notes", "abc", "delete");

    assert.deepEqual(state.findAll("notes"), []);
    assert.equal(state.findAllWithDeleted("notes").length, 1);
  });

  test("ignores an action with no runner rather than throwing", () => {
    const state = store();

    assert.doesNotThrow(() => state.track("notes", "abc", "shout"));
  });

  test("restores the same state from what it persisted", async () => {
    const db = new MemoryKeyValueStore();
    const first = store(db);
    first.track("notes", "abc", "create", { body: "hi" });
    first.track("notes", "abc", "pin");

    const second = store(db);
    await second.restore();

    assert.equal(second.findAll("notes")[0].body, "hi");
    assert.ok(second.findAll("notes")[0].pinnedAt);
  });

  test("replays events in time order however they came out of storage", async () => {
    const db = new MemoryKeyValueStore();
    const late = new EventStoreEvent("notes", "abc", "update", { body: "second" }, 2000);
    const early = new EventStoreEvent("notes", "abc", "create", { body: "first" }, 1000);
    await db.setItem(late.key, late.toLocal());
    await db.setItem(early.key, early.toLocal());

    const state = store(db);
    await state.restore();

    assert.equal(state.findAll("notes")[0].body, "second");
  });

  test("updates an object that no event created, so a peer's edit is not lost", () => {
    const state = store();

    state.track("notes", "abc", "update", { body: "hi" });

    assert.equal(state.findAll("notes")[0].body, "hi");
  });

  test("takes an event from elsewhere only once", async () => {
    const state = store();
    const event = new EventStoreEvent("notes", "abc", "create", { body: "hi" }, 1000);

    await state.absorb([event, event]);

    assert.equal(state.findAll("notes").length, 1);
  });

  test("settles only once the write has actually landed", async () => {
    let land;
    const db = new MemoryKeyValueStore();
    db.setItem = () => new Promise((resolve) => (land = resolve));
    const state = store(db);

    state.track("notes", "abc", "create", { body: "hi" });

    let written = false;
    const settled = state.settled().then(() => (written = true));
    await Promise.resolve();
    assert.equal(written, false, "settled before the store had it");

    land();
    await settled;
    assert.equal(written, true);
  });

  // Whatever waits on this is waiting to draw. A write that failed is not going
  // to land, and a redraw that never comes is a frozen interface.
  test("settles on a write that failed, because a failed write is no longer outstanding", async () => {
    const db = new MemoryKeyValueStore();
    db.setItem = () => Promise.reject(new Error("the disk is full"));
    const state = store(db);

    state.track("notes", "abc", "create", { body: "hi" });

    await state.settled();
  });

  test("hands over every event it holds, in time order", () => {
    const state = store();
    state.track("notes", "abc", "create", { body: "hi" }, 2000);
    state.track("notes", "def", "create", { body: "ho" }, 1000);

    assert.deepEqual(
      state.allEvents().map((event) => event.objectId),
      ["def", "abc"],
    );
  });
});
