// What the app does when the storage moves under an open review.
//
// The agent owns the draft file and rewrites it whenever it likes, so what the
// reader is looking at is not a thing this app can treat as settled once it is
// opened. Both of the watchers running against a source have to leave the app
// saying what the storage now says, and neither may leave the interface with no
// reason to redraw.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, agentWrites, theApp } from "../use-cases/helper.js";

const DRAFT = "drafts/org--app-42/review.json";

// A watch hands its re-reading off rather than awaiting it, so a round of
// polling has not landed until the promises behind it have run as well.
const landed = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("A review the reader is looking at", () => {
  let app;
  let adapter;

  beforeEach(async () => {
    adapter = new MemoryAdapter();

    // Drafted before the reader arrives, which is the ordinary way round: the
    // agent works unattended and the reader opens the app on what is waiting.
    await agentWrites(adapter, aDraft());

    app = await theApp({ adapter });
    await app.select(app.queue()[0]);

    // One beat of the watch, which in a browser has been ticking since the
    // source was attached. Its first look is the one that reports everything
    // as news, and news is only what is there, so a watch that has never
    // looked cannot report anything as gone.
    await adapter.poll();
    await landed();
  });

  test("is put back to nothing drafted when the review is cleared", async () => {
    await adapter.remove(DRAFT);
    await adapter.poll();
    await landed();

    assert.equal(app.selected.draft, null);
    assert.equal(app.selected.isReady, false);
  });

  test("is put back by a refresh as surely as by the watch", async () => {
    await adapter.remove(DRAFT);

    // The reader coming back to the tab, which asks the destination and reads
    // the drafts again. It is the refresh that lands first when a watch has
    // been throttled to a background tab, so it has to leave the app saying
    // exactly what the watch would have left it saying.
    await app.loadQueue();

    assert.equal(app.selected.draft, null);
    assert.equal(app.selected.isReady, false);
  });

  test("says what the agent now says when the draft is rewritten under it", async () => {
    await agentWrites(adapter, aDraft({ summary: "Rewritten by the agent" }));
    await adapter.poll();
    await landed();

    assert.equal(app.selected.draft.summary, "Rewritten by the agent");
  });
});

describe("A draft arriving while nothing is open", () => {
  test("still tells the interface to redraw, or the queue would not show it", async () => {
    const adapter = new MemoryAdapter();
    const app = await theApp({ adapter });
    let redraws = 0;

    app.onChange(() => (redraws += 1));

    await agentWrites(adapter, aDraft());
    await adapter.poll();
    await landed();

    assert.equal(app.selected, null);
    assert.ok(redraws > 0, "the drafts watch said nothing, so nothing would draw the new review");
    assert.equal(app.queue()[0].isReady, true);
  });
});
