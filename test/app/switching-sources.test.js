// What clicking a source in the settings panel does to the open review.
//
// Every row in that panel both shows a source and reads from it, and the row
// the panel highlights when it opens is the one already being read. Clicking it
// is not a switch, so it must leave the reader on the pull request they had
// open. Clicking a different one is a switch, and there the review has to go:
// it belongs to storage the reader has just left.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, agentWrites, theApp } from "../use-cases/helper.js";

describe("Clicking a source while a review is open", () => {
  let app;

  beforeEach(async () => {
    const adapter = new MemoryAdapter();

    await agentWrites(adapter, aDraft());

    app = await theApp({ adapter });
    await app.select(app.queue()[0]);
  });

  test("leaves the review open when it is the source already being read", async () => {
    await app.switchSource(app.source);

    assert.equal(app.selected.number, 42);
    assert.equal(app.selected.draft.summary, aDraft().summary);
  });

  test("closes the review when it is another source", async () => {
    const other = await app.commands.addSource({
      name: "Elsewhere",
      adapter: { type: "memory" },
    });

    await app.select(app.queue()[0]);
    await app.switchSource(other);

    assert.equal(app.selected, null);
    assert.equal(app.source.id, other.id);
  });
});
