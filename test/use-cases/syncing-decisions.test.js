// What the settings pane has to be able to say: your decisions are piling up
// here because they cannot be written to your storage.
//
// The number has to survive a reload, because the reader who closes the tab on
// a plane and opens it in a hotel is exactly the reader it is for. It also has
// to stay quiet about a peer's decisions: those arrived from the storage, so
// they are already there, and counting them would make the pane cry wolf.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { App } from "../../web/src/app/app.js";
import { MemoryKeyValueStore } from "../../web/src/state/key-value-store.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { anApp, agentWrites, aDraft, aPull } from "./helper.js";

// Databases that outlive one App, so booting a second one against them is
// what a reload is: the same storage, a fresh application object.
function someDatabases() {
  const made = new Map();

  return (name) => {
    if (!made.has(name)) made.set(name, new MemoryKeyValueStore());

    return made.get(name);
  };
}

// Storage that can be taken away, the way a laptop leaves the wifi. Reads keep
// working, because a reader offline is still reading what they already have.
function storageThatCanRefuse() {
  const adapter = new MemoryAdapter();
  const write = adapter.write.bind(adapter);

  adapter.refusing = false;
  adapter.write = async (path, bytes) => {
    if (adapter.refusing) throw new Error("that bucket refused the connection");

    return write(path, bytes);
  };

  return adapter;
}

function aDestination(pulls = [aPull()]) {
  return {
    identify: async () => ({ login: "reader" }),
    queue: async () => pulls,
    files: async () => [],
    headCommit: async () => "e612b1b",
  };
}

async function anAppOn(adapter, databases = someDatabases()) {
  const app = new App({
    database: databases,
    adapter: () => adapter,
    destination: () => aDestination(),
  });

  await app.boot();

  return app;
}

describe("Decisions that have not reached the source", () => {
  let app;
  let adapter;

  beforeEach(async () => {
    adapter = storageThatCanRefuse();
    await agentWrites(adapter, aDraft());
    app = await anAppOn(adapter);
    await app.addDestination({ type: "github", label: "GitHub", secret: { token: "x" } });
    await app.addSource({ name: "Work", adapter: { type: "memory" } });
  });

  test("a source nothing has been decided on has nothing waiting", async () => {
    assert.equal(await app.unsyncedFor(app.source), 0);
  });

  test("decisions made while the storage refuses writes are counted", async () => {
    adapter.refusing = true;

    app.commands.dismissPull(app.source, app.queue()[0]);
    await app.commands.sync.push(app.source);

    assert.equal(await app.unsyncedFor(app.source), 1);
  });

  test("a refused push is answered, not thrown at the reader", async () => {
    adapter.refusing = true;
    app.commands.dismissPull(app.source, app.queue()[0]);

    assert.equal(await app.commands.sync.push(app.source), false);
    // The decision still stands locally: the queue is what the reader made it.
    assert.deepEqual(app.queue(), []);
  });

  test("a push that gets through clears the count", async () => {
    adapter.refusing = true;
    app.commands.dismissPull(app.source, app.queue()[0]);
    await app.commands.sync.push(app.source);

    adapter.refusing = false;

    assert.equal(await app.commands.sync.push(app.source), true);
    assert.equal(await app.unsyncedFor(app.source), 0);
  });

  test("what never reached the storage is still waiting after a reload", async () => {
    const databases = someDatabases();
    const first = await anAppOn(adapter, databases);
    await first.addDestination({ type: "github", label: "GitHub", secret: { token: "x" } });
    await first.addSource({ name: "Work", adapter: { type: "memory" } });
    adapter.refusing = true;
    first.commands.dismissPull(first.source, first.queue()[0]);
    await first.commands.sync.push(first.source);

    // The same databases, read again, as a reload would.
    const again = await anAppOn(adapter, databases);

    assert.equal(await again.unsyncedFor(again.source), 1);
  });

  test("what did reach the storage is not counted again after a reload", async () => {
    const databases = someDatabases();
    const first = await anAppOn(adapter, databases);
    await first.addDestination({ type: "github", label: "GitHub", secret: { token: "x" } });
    await first.addSource({ name: "Work", adapter: { type: "memory" } });
    first.commands.dismissPull(first.source, first.queue()[0]);
    await first.commands.sync.push(first.source);

    const again = await anAppOn(adapter, databases);

    assert.equal(await again.unsyncedFor(again.source), 0);
  });
});

describe("Counting what another device decided", () => {
  test("a decision taken in from a peer is already at the source, so it is not waiting", async () => {
    const adapter = new MemoryAdapter();
    const laptop = await anApp({ adapter, deviceId: "laptop" });
    const desktop = await anApp({ adapter, deviceId: "desktop" });
    await agentWrites(adapter, aDraft());
    await laptop.drafts.loadAll();

    laptop.commands.dismissPull(laptop.source, laptop.open());
    await laptop.sync.push(laptop.source);
    await desktop.sync.pull(desktop.source);

    assert.equal(await desktop.sync.unsynced(desktop.source), 0);
  });
});
