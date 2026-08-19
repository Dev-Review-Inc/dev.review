// What the drafts projection does when a read of a draft fails.
//
// The projection has two ways in. `load` reads one draft because the reader
// opened a pull request. `_absorb`, behind `loadAll` and the watch, reads
// whatever the storage says moved, and the watch runs every two seconds for as
// long as a source is open, so it is by far the more travelled of the two.
//
// A read that failed and a draft that was deleted are different news: one says
// the agent finished nothing here, the other says this device could not reach
// the storage. The projection answers both questions with the same two methods,
// so both ways in have to give the same answer to the same failure.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Drafts, UNREAD, UNPARSED } from "../../web/src/state/drafts.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, agentWrites } from "../use-cases/helper.js";

const PATH = "drafts/org--app-42/review.json";
const KEY = "org/app#42";
const PULL = { owner: "org", repo: "app", number: 42 };

// Storage that has the drafts and can be made to refuse to hand them over,
// the way a bucket does while a token is being rotated. Listing keeps working,
// because a listing that failed is a different failure with its own handling.
async function storageThatCanRefuseReads() {
  const adapter = new MemoryAdapter();

  await agentWrites(adapter, aDraft());

  const read = adapter.read.bind(adapter);

  adapter.refusing = false;
  adapter.read = async (path) => {
    if (adapter.refusing) throw new Error("that bucket refused the connection");

    return read(path);
  };

  return adapter;
}

describe("a draft the storage would not hand over", () => {
  test("is not reported as a draft that was never written, when one was opened", async () => {
    const adapter = await storageThatCanRefuseReads();
    const drafts = new Drafts({ adapter });

    adapter.refusing = true;
    await drafts.load(PULL, KEY);

    assert.equal(drafts.problem(KEY).cause, UNREAD);
  });

  test("is not reported as a draft that was never written, when the watch reads it", async () => {
    const adapter = await storageThatCanRefuseReads();
    const drafts = new Drafts({ adapter });

    adapter.refusing = true;
    await drafts.loadAll();

    assert.equal(drafts.problem(KEY).cause, UNREAD);
  });

  // The two ways in cannot disagree. Whichever one runs is an accident of
  // whether the reader had opened the pull request when the storage faltered.
  test("reads the same whichever way the projection got there", async () => {
    const opened = new Drafts({ adapter: await storageThatCanRefuseReads() });
    const watched = new Drafts({ adapter: await storageThatCanRefuseReads() });

    opened.adapter.refusing = true;
    watched.adapter.refusing = true;

    await opened.load(PULL, KEY);
    await watched.loadAll();

    assert.deepEqual(watched.problem(KEY), opened.problem(KEY));
    assert.equal(watched.find(KEY), opened.find(KEY));
  });

  // A draft the reader could see a moment ago is what the queue's ready mark
  // is drawn from. Dropping the entry on a failed read takes that mark off and
  // tells the reader the agent has nothing waiting for them.
  test("does not quietly become a pull request with nothing waiting on it", async () => {
    const adapter = await storageThatCanRefuseReads();
    const drafts = new Drafts({ adapter });

    await drafts.loadAll();
    assert.equal(drafts.find(KEY).verdict, "COMMENT");

    adapter.refusing = true;
    await drafts.loadAll();

    assert.equal(drafts.problem(KEY).cause, UNREAD);
  });
});

// The screen has to say which of the two happened, and the only place that
// knows is here. A reason that is only a sentence leaves the drawing guessing
// from the words in it.
describe("the two ways a draft goes missing", () => {
  test("are carried apart, not left for the screen to read out of the message", async () => {
    const adapter = await storageThatCanRefuseReads();
    const drafts = new Drafts({ adapter });

    adapter.refusing = true;
    await drafts.loadAll();
    const unread = drafts.problem(KEY);

    adapter.refusing = false;
    await adapter.write(PATH, new TextEncoder().encode(JSON.stringify({ schema: 99 })));
    await drafts.loadAll();
    const unparsed = drafts.problem(KEY);

    assert.equal(unread.cause, UNREAD);
    assert.equal(unparsed.cause, UNPARSED);
    assert.match(unread.detail, /refused the connection/);
    assert.match(unparsed.detail, /99/);
  });
});

describe("a draft that really was deleted", () => {
  test("is forgotten, with nothing said to be wrong with it", async () => {
    const adapter = await storageThatCanRefuseReads();
    const drafts = new Drafts({ adapter });

    await drafts.loadAll();
    await adapter.remove(PATH);
    await drafts.loadAll();

    assert.equal(drafts.find(KEY), null);
    assert.equal(drafts.problem(KEY), null);
  });
});

// The common way a brand new source is set up wrong: the agent's files sit at
// the source root instead of nested under drafts/, so the listing this app
// reads is empty even though the storage has work in it. That is worth naming
// rather than reading as "the agent has not started" - it is what a reader
// hits before ever seeing a draft.
// loadAll pays for every draft on startup, and against a GitHub source each
// read is its own round trip to api.github.com. Reading them one at a time
// means a reader with thirty drafts waits for thirty round trips before the
// queue can show anything.
describe("loadAll's reads", () => {
  test("run concurrently rather than one at a time", async () => {
    const adapter = new MemoryAdapter();

    await agentWrites(adapter, aDraft({ number: 1 }));
    await agentWrites(adapter, aDraft({ number: 2 }));
    await agentWrites(adapter, aDraft({ number: 3 }));

    const read = adapter.read.bind(adapter);
    let inFlight = 0;
    let maxInFlight = 0;
    const gate = [];

    adapter.read = (path) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      return new Promise((resolve) => gate.push(() => resolve(read(path)))).finally(() => {
        inFlight -= 1;
      });
    };

    const drafts = new Drafts({ adapter });
    const loading = drafts.loadAll();

    // Let every read start before any of them is allowed to finish.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(gate.length, 3);
    gate.forEach((release) => release());

    await loading;

    assert.equal(maxInFlight, 3);
  });

  test("still record each file's own outcome when one fails mid-batch", async () => {
    const adapter = new MemoryAdapter();

    await agentWrites(adapter, aDraft({ number: 1 }));
    await agentWrites(adapter, aDraft({ number: 2 }));
    await agentWrites(adapter, aDraft({ number: 3 }));

    const read = adapter.read.bind(adapter);

    adapter.read = async (path) => {
      if (path.includes("app-2/")) throw new Error("that bucket refused the connection");

      return read(path);
    };

    const drafts = new Drafts({ adapter });
    await drafts.loadAll();

    assert.equal(drafts.problem("org/app#2").cause, UNREAD);
    assert.equal(drafts.find("org/app#1").verdict, "COMMENT");
    assert.equal(drafts.find("org/app#3").verdict, "COMMENT");
  });
});

describe("a source with no drafts/ directory", () => {
  test("is unremarkable when the source is simply empty", async () => {
    const adapter = new MemoryAdapter();
    const drafts = new Drafts({ adapter });

    await drafts.loadAll();

    assert.equal(drafts.misconfigured, false);
  });

  test("is flagged when what looks like a draft sits at the source root", async () => {
    const adapter = new MemoryAdapter();

    // Written at the root, not under drafts/ - the mistake this catches.
    await adapter.write(
      "org--app-42/review.json",
      new TextEncoder().encode(JSON.stringify(aDraft())),
    );

    const drafts = new Drafts({ adapter });

    await drafts.loadAll();

    assert.equal(drafts.misconfigured, true);
  });

  test("clears once drafts/ actually holds something", async () => {
    const adapter = await storageThatCanRefuseReads();
    const drafts = new Drafts({ adapter });

    await drafts.loadAll();

    assert.equal(drafts.misconfigured, false);
  });
});

describe("all", () => {
  test("hands over every parsed draft by key, leaving out what could not be read", async () => {
    const adapter = new MemoryAdapter();

    await agentWrites(adapter, aDraft());
    await agentWrites(adapter, aDraft({ repo: "site", number: 7 }));
    await adapter.write("drafts/org--app-9/review.json", new TextEncoder().encode("not json"));

    const drafts = new Drafts({ adapter });

    await drafts.loadAll();

    const held = drafts.all();

    assert.deepEqual([...held.keys()].sort(), ["org/app#42", "org/site#7"]);
    assert.equal(held.get("org/app#42").title, aDraft().title);
  });
});

// A watch round is a redraw, and a redraw the reader can see. Storage that
// refreshes timestamps without changing bytes - a git pull re-materialising
// the same files - must not turn into an interface that flickers every two
// seconds while nothing is different.
describe("a draft re-read unchanged", () => {
  test("is not reported as a change", async () => {
    const adapter = new MemoryAdapter();

    await agentWrites(adapter, aDraft());

    const drafts = new Drafts({ adapter });

    assert.deepEqual(await drafts._absorb([PATH]), [KEY]);
    assert.deepEqual(await drafts._absorb([PATH]), []);
  });

  test("is reported again the moment its bytes actually move", async () => {
    const adapter = new MemoryAdapter();

    await agentWrites(adapter, aDraft());

    const drafts = new Drafts({ adapter });

    await drafts._absorb([PATH]);
    await agentWrites(adapter, aDraft({ summary: "Now it says something else." }));

    assert.deepEqual(await drafts._absorb([PATH]), [KEY]);
  });

  test("still reports a deletion, an outage, and a recovery", async () => {
    const adapter = await storageThatCanRefuseReads();
    const drafts = new Drafts({ adapter });

    await drafts._absorb([PATH]);

    adapter.refusing = true;
    assert.deepEqual(await drafts._absorb([PATH]), [KEY], "the outage is news");
    assert.deepEqual(await drafts._absorb([PATH]), [], "the outage continuing is not");

    adapter.refusing = false;
    assert.deepEqual(await drafts._absorb([PATH]), [KEY], "the recovery is news");

    await adapter.remove(PATH);
    assert.deepEqual(await drafts._absorb([PATH]), [KEY], "the deletion is news");
    assert.deepEqual(await drafts._absorb([PATH]), [], "staying gone is not");
  });
});
