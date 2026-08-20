// Reading what you have.
//
// The drafts were read in past sessions and the reader's decisions are local,
// so an unreachable source costs fresh fetches and posting - never reading.
// The projection keeps its last successful read beside the event log, and a
// boot that cannot reach the storage opens onto that instead of a wall. The
// wall remains for the one reader it is honest to: a source nothing has ever
// been read from.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { theApp, agentWrites, aDraft } from "./helper.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { MemoryKeyValueStore } from "../../web/src/state/key-value-store.js";

// A database that answers the same store for the same name, which is what
// IndexedDB does between sessions and what a fresh factory per app does not.
function aDatabase() {
  const stores = new Map();

  return (name) => {
    if (!stores.has(name)) stores.set(name, new MemoryKeyValueStore());

    return stores.get(name);
  };
}

// A reader whose storage refuses everything, the way GitHub does when it is
// down or the token has died.
class DeadAdapter extends MemoryAdapter {
  async ready() {
    return { ok: false, reason: "Bad credentials" };
  }

  async list() {
    throw new Error("Bad credentials");
  }

  async read() {
    throw new Error("Bad credentials");
  }
}

// A reader that can be switched off and on, for the outage that ends.
class FlakyAdapter extends MemoryAdapter {
  down = false;

  async ready() {
    return this.down ? { ok: false, reason: "Bad credentials" } : super.ready();
  }

  async list(prefix) {
    if (this.down) throw new Error("Bad credentials");

    return super.list(prefix);
  }

  async read(path) {
    if (this.down) throw new Error("Bad credentials");

    return super.read(path);
  }
}

describe("booting against a source that has stopped answering", () => {
  test("a source read before opens onto what it last held, with a note", async () => {
    const database = aDatabase();

    const first = await theApp({ adapter: new MemoryAdapter(), database });

    assert.equal(first.queue().length, 1, "the first session should have read the draft");

    const notes = [];
    const second = await theApp({
      adapter: new DeadAdapter(),
      database,
      attach: false,
      pulls: [],
      report: (message, tone) => notes.push({ message, tone }),
    });

    assert.equal(second.problem, "", "an outage over a held queue is not a wall");
    assert.equal(second.queue().length, 1);
    assert.equal(second.queue()[0].key, "org/app#42");
    assert.ok(
      notes.some((note) => note.message.includes("reading what it last held")),
      `the reader should be told, got: ${JSON.stringify(notes)}`,
    );
  });

  test("a dismissal still records while the source is down", async () => {
    const database = aDatabase();

    await theApp({ adapter: new MemoryAdapter(), database });

    const second = await theApp({
      adapter: new DeadAdapter(),
      database,
      attach: false,
      pulls: [],
    });

    const [pull] = second.queue();

    await second.commands.dismissPull(second.source, second.queries.pullState(second.source, pull));

    assert.equal(second.queue().length, 0);
    assert.equal(second.dismissed().length, 1);
  });

  test("the wall stays for a source nothing has ever been read from", async () => {
    const database = aDatabase();

    await theApp({ adapter: new MemoryAdapter(), database, pulls: [] });

    const second = await theApp({
      adapter: new DeadAdapter(),
      database,
      attach: false,
      pulls: [],
    });

    assert.match(second.problem, /Bad credentials/);
  });

  test("an outage mid-session marks the source without raising the wall", async () => {
    const flaky = new FlakyAdapter();
    const app = await theApp({ adapter: flaky, database: aDatabase() });

    flaky.down = true;
    await app.refreshQueue();

    assert.equal(app.problem, "", "a held queue reads on through a failed refresh");
    assert.equal(app.health[app.source.id].state, "broken");
    assert.equal(app.queue().length, 1);
  });

  test("a recovered read replaces what is held, for the next outage", async () => {
    const database = aDatabase();
    const flaky = new FlakyAdapter();

    await theApp({ adapter: flaky, database });

    flaky.down = true;

    const second = await theApp({ adapter: flaky, database, attach: false, pulls: [] });

    assert.equal(second.queue().length, 1, "the outage boot should read from what is held");

    flaky.down = false;
    await agentWrites(flaky, aDraft({ summary: "Recovered and rewritten." }));
    await second.loadQueue();

    assert.equal(second.drafts.find("org/app#42").summary, "Recovered and rewritten.");

    const third = await theApp({
      adapter: new DeadAdapter(),
      database,
      attach: false,
      pulls: [],
    });

    assert.equal(
      third.drafts.find("org/app#42").summary,
      "Recovered and rewritten.",
      "the recovered read should be what the next outage reads",
    );
  });

  test("a draft cleared while the source was up does not come back from the cache", async () => {
    const database = aDatabase();
    const adapter = new MemoryAdapter();

    const first = await theApp({ adapter, database });

    await first.drafts.clear({ owner: "org", repo: "app", number: 42 }, "org/app#42");

    const second = await theApp({
      adapter: new DeadAdapter(),
      database,
      attach: false,
      pulls: [],
    });

    assert.equal(second.queue().length, 0);
  });
});

describe("what the cache must not paper over", () => {
  test("a fresh source with drafts nested at the wrong level still reads as misconfigured", async () => {
    const adapter = new MemoryAdapter();

    await adapter.write(
      "org--app-42/review.json",
      new TextEncoder().encode(JSON.stringify(aDraft())),
    );

    const app = await theApp({ adapter, database: aDatabase(), pulls: [] });

    assert.match(app.problem, /no drafts\/ directory found/);
  });
});
