// A decision the reader takes while reading, and when the interface is told.
//
// The store writes in the same task as the click, which is what carries a
// decision through the document being torn down. This is the second half of
// that: the redraw is the only thing that tells the reader a decision was
// taken, so it waits until the decision is somewhere it would survive. A reader
// who reads "1 comment staged" and closes the tab must find it still staged.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { MemoryKeyValueStore } from "../../web/src/state/key-value-store.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, agentWrites, theApp } from "../use-cases/helper.js";

// Storage whose writes can be held open, so a test can look at the app in the
// window between a decision being taken and it landing.
function heldStorage() {
  const waiting = [];
  let holding = false;
  let refusing = false;

  return {
    database: () => {
      const store = new MemoryKeyValueStore();
      const write = store.setItem.bind(store);

      store.setItem = (key, value) => {
        if (refusing) return Promise.reject(new Error("the disk is full"));

        if (!holding) return write(key, value);

        return new Promise((resolve) => waiting.push(() => resolve(write(key, value))));
      };

      return store;
    },
    hold: () => (holding = true),
    refuse: () => (refusing = true),
    heal: () => (refusing = false),
    release: () => {
      holding = false;
      waiting.splice(0).forEach((land) => land());
    },
  };
}

// A turn of the event loop, which is longer than any number of microtasks.
const beat = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("A decision taken while reading", () => {
  let app;
  let storage;

  beforeEach(async () => {
    const adapter = new MemoryAdapter();

    await agentWrites(adapter, aDraft());

    storage = heldStorage();
    app = await theApp({ adapter, database: storage.database });

    await app.select(app.queue()[0]);
  });

  test("is not drawn as taken until it is in storage", async () => {
    let redraws = 0;

    app.onChange(() => (redraws += 1));
    storage.hold();

    const [finding] = app.queries.findingsForPull(app.source, app.selected);

    app.commands.dropFinding(app.source, app.selected, finding);
    app.reselect();

    await beat();
    assert.equal(redraws, 0, "the drop was drawn as taken before it was written down");

    storage.release();
    await beat();

    assert.equal(redraws, 1);
  });

  test("still reads back the moment it is taken, so nothing waits to be asked", () => {
    storage.hold();

    const [finding] = app.queries.findingsForPull(app.source, app.selected);

    app.commands.dropFinding(app.source, app.selected, finding);

    assert.ok(app.queries.findingsForPull(app.source, app.selected)[0].droppedAt);
  });

  test("is drawn even when the write fails, or a bad disk would freeze the interface", async () => {
    let redraws = 0;

    app.onChange(() => (redraws += 1));
    storage.refuse();

    const [finding] = app.queries.findingsForPull(app.source, app.selected);

    app.commands.dropFinding(app.source, app.selected, finding);
    app.reselect();

    await beat();
    // The debounced sync writes a moment later, and this test is not about it.
    storage.heal();

    assert.equal(redraws, 1);
  });
});
