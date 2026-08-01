// What the settings pane has to be able to say: your decisions are piling up
// here because they cannot be written to your storage.
//
// The number has to survive a reload, because the reader who closes the tab on
// a plane and opens it in a hotel is exactly the reader it is for. It also has
// to stay quiet about a peer's decisions: those arrived from the storage, so
// they are already there, and counting them would make the pane cry wolf.

import { test, describe, beforeEach, afterEach } from "node:test";
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

// Local databases with room for everything except the mark that says what was
// pushed, the way a browser that hits its quota part way through a session has.
function databasesThatCannotMark() {
  const databases = someDatabases();
  const wrapped = new WeakSet();

  return (name) => {
    const db = databases(name);

    if (wrapped.has(db)) return db;

    wrapped.add(db);

    const set = db.setItem.bind(db);

    db.setItem = async (key, value) => {
      if (key.startsWith("preference:synced:")) throw new Error("the disk is full");

      return set(key, value);
    };

    return db;
  };
}

// Local databases that can be made to refuse the one read that says how much
// has reached the source, the way an IndexedDB read fails on a device whose
// storage is under pressure. Everything else keeps answering, because a
// browser that has lost its database entirely is a different failure.
function databasesThatCanRefuseTheMark() {
  const databases = someDatabases();
  const wrapped = new WeakSet();
  const made = (name) => {
    const db = databases(name);

    if (wrapped.has(db)) return db;

    wrapped.add(db);

    const get = db.getItem.bind(db);

    db.getItem = async (key) => {
      if (made.refusing && key.startsWith("preference:synced:")) {
        throw new Error("that database would not answer");
      }

      return get(key);
    };

    return db;
  };

  made.refusing = false;

  return made;
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

describe("A local store that cannot remember what reached the source", () => {
  let app;
  let adapter;
  let rejections;
  let note;

  beforeEach(async () => {
    rejections = [];
    note = (reason) => rejections.push(reason);
    process.on("unhandledRejection", note);

    adapter = new MemoryAdapter();
    await agentWrites(adapter, aDraft());
    app = await anAppOn(adapter, databasesThatCannotMark());
    await app.addDestination({ type: "github", label: "GitHub", secret: { token: "x" } });
    await app.addSource({ name: "Work", adapter: { type: "memory" } });
  });

  afterEach(() => {
    process.off("unhandledRejection", note);
  });

  test("a push whose mark cannot be written is answered, not thrown", async () => {
    app.commands.dismissPull(app.source, app.queue()[0]);

    assert.equal(await app.commands.sync.push(app.source), false);
  });

  test("a decision whose mark cannot be written is still counted as waiting", async () => {
    app.commands.dismissPull(app.source, app.queue()[0]);
    await app.commands.sync.push(app.source);

    assert.equal(await app.unsyncedFor(app.source), 1);
  });

  // The debounced push is the one nobody holds, and it runs a second after the
  // decision, so this waits it out rather than asserting before it could fire.
  test("the debounced push does not reject into nobody's hands", async () => {
    app.commands.dismissPull(app.source, app.queue()[0]);

    await new Promise((resolve) => setTimeout(resolve, 1200));

    assert.deepEqual(rejections, []);
  });
});

// A push is documented as answering rather than throwing, and the debounced one
// is dropped on a timer that relies on exactly that. Only the write was ever
// inside the try, so reading the log, turning it into lines, or finding the
// reader for the source could each throw straight past the contract.
describe("A push that cannot get as far as writing", () => {
  let rejections;
  let note;

  beforeEach(() => {
    rejections = [];
    note = (reason) => rejections.push(reason);
    process.on("unhandledRejection", note);
  });

  afterEach(() => {
    process.off("unhandledRejection", note);
  });

  test("answers that it did not land when the log cannot be read", async () => {
    const app = await anApp();

    app.state.allEvents = () => {
      throw new Error("the log is unreadable");
    };

    assert.equal(await app.sync.push(app.source), false);
  });

  test("answers that it did not land when there is no reader for the source", async () => {
    const app = await anApp();

    app.sync.adapterFor = () => {
      throw new Error("that source cannot be built");
    };

    assert.equal(await app.sync.push(app.source), false);
  });

  test("does not reject out of the timer that dropped it", async () => {
    const app = await anApp();

    app.state.allEvents = () => {
      throw new Error("the log is unreadable");
    };

    app.commands.dismissPull(app.source, app.open());

    await new Promise((resolve) => setTimeout(resolve, 1200));

    assert.deepEqual(rejections, []);
  });
});

// The count is itself a read of storage, and the sweep that gathers it for the
// settings pane is the only thing that ever answers this question on screen. A
// read that failed is not an answer of nothing: reporting zero here takes the
// one durable record that a push did not land and turns it into the reader
// being told their work is safe.
describe("A sweep that cannot read how much is waiting", () => {
  let app;
  let databases;

  beforeEach(async () => {
    const adapter = new MemoryAdapter();
    await agentWrites(adapter, aDraft());
    databases = databasesThatCanRefuseTheMark();
    app = await anAppOn(adapter, databases);
    await app.addDestination({ type: "github", label: "GitHub", secret: { token: "x" } });
    await app.addSource({ name: "Work", adapter: { type: "memory" } });
  });

  test("does not report decisions that are still here as nothing waiting", async () => {
    app.commands.dismissPull(app.source, app.queue()[0]);
    databases.refusing = true;

    await app.probeSources();

    assert.notEqual(app.unsyncedCounts[app.source.id], 0);
  });

  test("says it does not know rather than naming a number it did not read", async () => {
    app.commands.dismissPull(app.source, app.queue()[0]);
    databases.refusing = true;

    await app.probeSources();

    assert.equal(app.unsyncedCounts[app.source.id], null);
  });

  // One source that cannot be counted is one row that cannot say, not a sweep
  // that gives up on the others.
  test("still counts the sources it could read", async () => {
    const other = await app.commands.addSource({ name: "Spare", adapter: { type: "memory" } });

    await app.probeSources();

    assert.equal(app.unsyncedCounts[other.id], 0);
  });
});

// Opening a source pulls the other devices' logs once, and that pull is
// deliberately allowed to fail without a word. The argument for the silence is
// that nothing is lost, because the watch it sits beside re-lists two seconds
// later and its first look reports everything as news. That is only a silence
// worth keeping while it stays true, so it is asserted rather than believed.
describe("A first pull that could not reach the other devices' logs", () => {
  // A watch hands its re-reading off rather than awaiting it.
  const landed = () => new Promise((resolve) => setTimeout(resolve, 0));

  // Storage that will not list the app's own logs, while the drafts beside
  // them keep listing: a prefix denied is the shape a bucket policy has.
  function storageThatWillNotListLogs() {
    const adapter = new MemoryAdapter();
    const list = adapter.list.bind(adapter);

    adapter.refusing = false;
    adapter.list = async (prefix = "") => {
      if (adapter.refusing && prefix.startsWith(".reviewer/")) {
        throw new Error("that prefix is denied");
      }

      return list(prefix);
    };

    return adapter;
  }

  async function aDeviceOn(adapter) {
    const app = await anAppOn(adapter, someDatabases());

    await app.addDestination({ type: "github", label: "GitHub", secret: { token: "x" } });
    await app.addSource({ name: "Work", adapter: { type: "memory" } });

    return app;
  }

  test("still lets the source open, on this device's own decisions", async () => {
    const adapter = storageThatWillNotListLogs();
    await agentWrites(adapter, aDraft());
    adapter.refusing = true;

    const desktop = await aDeviceOn(adapter);

    assert.equal(desktop.queue().length, 1);
    assert.equal(desktop.problems.source, "");
  });

  test("does not cost the reader the decision, because the watch brings it", async () => {
    const adapter = storageThatWillNotListLogs();
    await agentWrites(adapter, aDraft());

    const laptop = await aDeviceOn(adapter);
    laptop.commands.dismissPull(laptop.source, laptop.queue()[0]);
    await laptop.commands.sync.push(laptop.source);

    adapter.refusing = true;
    const desktop = await aDeviceOn(adapter);

    // The pull that failed: the laptop's dismissal has not arrived.
    assert.equal(desktop.queue().length, 1);

    adapter.refusing = false;
    await adapter.poll();
    await landed();

    assert.equal(desktop.queue().length, 0);
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
