// Asking for a pull request to be reviewed again.
//
// This is the one thing the app does to an agent's document, and it is not
// authorship: the file goes, whole, and nothing takes its place. It has to be
// a deletion because of how the work is claimed. Nothing asks for a review;
// the sweep looks for a pull request whose draft is not there and reviews that
// one. So the absence of the file is the request, and clearing it is how a
// reader says "this one again".
//
// The reader's own decisions are not part of it. Dropping a comment is a thing
// they did, a redraft is a thing the agent did, and finding ids carry across
// one so the other survives it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { theApp, aDraft, agentWrites } from "./helper.js";

const PATH = "drafts/org--app-42/review.json";

async function reading(draft = aDraft()) {
  const adapter = new MemoryAdapter();

  if (draft) await agentWrites(adapter, draft);

  const app = await theApp({ adapter });

  await app.select(app.queue()[0]);

  return { app, adapter };
}

describe("clearing the draft on the pull request being read", () => {
  test("takes the file out of the source, which is the whole request", async () => {
    const { app, adapter } = await reading();

    await app.clearDraft();

    assert.equal(await adapter.read(PATH), null);
  });

  test("stops the pane showing a review that is no longer there", async () => {
    const { app } = await reading();

    await app.clearDraft();

    assert.equal(app.selected.draft, null);
  });

  test("leaves the reader's decisions standing, for the redraft to land on", async () => {
    const { app, adapter } = await reading();
    const dropped = app.queries.findingsForPull(app.source, app.selected)[0];

    app.commands.dropFinding(app.source, app.selected, dropped);

    await app.clearDraft();
    await agentWrites(adapter, aDraft({ summary: "Second look." }));
    await app.select(app.queue()[0]);

    const again = app.queries.findingsForPull(app.source, app.selected)[0];

    assert.equal(again.id, dropped.id);
    assert.ok(again.droppedAt);
  });
});

describe("clearing when there is nothing to clear", () => {
  test("is not offered, and does nothing if asked anyway", async () => {
    const { app, adapter } = await reading(null);

    await app.clearDraft();

    assert.equal(app.selected.draft, null);
    assert.deepEqual(await adapter.list("drafts/"), []);
  });
});
