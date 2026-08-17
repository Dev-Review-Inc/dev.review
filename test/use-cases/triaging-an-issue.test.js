import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { anApp, agentWrites, aDraft, aPull } from "./helper.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";

// An issue draft: no verdict, no findings, a proposed replacement body.
function anIssueDraft(overrides = {}) {
  return aDraft({
    verdict: "",
    summary: "",
    sections: [],
    findings: [],
    description: "The proposed replacement body.",
    comment: "Why the body should change.",
    ...overrides,
  });
}

describe("Triaging an issue the agent drafted", () => {
  let app;
  let pull;

  beforeEach(async () => {
    app = await anApp();
    await agentWrites(app.adapter, anIssueDraft());
    await app.drafts.loadAll();
    pull = app.open();
  });

  test("a draft with no verdict is still a draft worth opening", () => {
    assert.equal(pull.isReady, true);
    assert.equal(pull.draft.verdict, "");
    assert.equal(pull.draft.description, "The proposed replacement body.");
    assert.equal(app.queries.isPosted(app.source, pull), false);
  });

  test("a rejected hunk stays rejected until it is restored, and the last word wins", () => {
    app.commands.rejectHunk(app.source, pull, "hunk-a");
    app.commands.rejectHunk(app.source, pull, "hunk-b");

    assert.deepEqual(app.queries.rejectedHunks(app.source, pull), new Set(["hunk-a", "hunk-b"]));

    app.commands.restoreHunk(app.source, pull, "hunk-a");

    assert.deepEqual(app.queries.rejectedHunks(app.source, pull), new Set(["hunk-b"]));

    app.commands.rejectHunk(app.source, pull, "hunk-a");

    assert.deepEqual(app.queries.rejectedHunks(app.source, pull), new Set(["hunk-a", "hunk-b"]));
  });

  test("hunk decisions on one issue say nothing about another", () => {
    app.commands.rejectHunk(app.source, pull, "hunk-a");

    const other = app.open(aPull({ number: 43 }));

    assert.deepEqual(app.queries.rejectedHunks(app.source, other), new Set());
  });

  test("the body is hunk-driven until the reader writes their own", () => {
    assert.equal(app.queries.descriptionFor(app.source, pull), null);

    app.commands.editDescription(app.source, pull, "The body as I want it.");

    assert.equal(app.queries.descriptionFor(app.source, pull), "The body as I want it.");

    app.commands.resetDescription(app.source, pull);

    assert.equal(app.queries.descriptionFor(app.source, pull), null);
  });

  test("posting the triage records it and leaves the queue", async () => {
    await app.commands.recordPostedTriage(app.source, pull, {
      url: "https://github.com/org/app/issues/42#issuecomment-1",
    });

    const after = app.open();
    assert.ok(after.postedAt);
    assert.equal(after.postedUrl, "https://github.com/org/app/issues/42#issuecomment-1");
    assert.equal(app.queries.isPosted(app.source, after), true);
    assert.equal(app.queries.queue(app.source, [aPull()]).length, 0);
  });

  test("the agent redrafting does not take the reader's decisions with it", async () => {
    app.commands.rejectHunk(app.source, pull, "hunk-a");
    app.commands.editDescription(app.source, pull, "Mine.");

    await agentWrites(app.adapter, anIssueDraft({ description: "Rewritten by the agent." }));
    await app.drafts.loadAll();

    const reopened = app.open();
    assert.equal(reopened.draft.description, "Rewritten by the agent.");
    assert.deepEqual(app.queries.rejectedHunks(app.source, reopened), new Set(["hunk-a"]));
    assert.equal(app.queries.descriptionFor(app.source, reopened), "Mine.");
  });

  test("every decision survives the browser being closed", async () => {
    app.commands.rejectHunk(app.source, pull, "hunk-a");
    app.commands.restoreHunk(app.source, pull, "hunk-a");
    app.commands.rejectHunk(app.source, pull, "hunk-a");
    app.commands.editDescription(app.source, pull, "Mine.");
    app.commands.resetDescription(app.source, pull);
    await app.commands.recordPostedTriage(app.source, pull, { url: "https://x" });

    // The same logs, read back from scratch, as a reload would.
    await app.state.restore();

    const again = app.open();
    assert.deepEqual(app.queries.rejectedHunks(app.source, again), new Set(["hunk-a"]));
    assert.equal(app.queries.descriptionFor(app.source, again), null);
    assert.equal(app.queries.isPosted(app.source, again), true);
    assert.equal(app.queries.queue(app.source, [aPull()]).length, 0);
  });

  test("a close proposal parses and the draft still opens", async () => {
    await agentWrites(
      app.adapter,
      anIssueDraft({ description: "", comment: "", close: { reason: "duplicate", of: 41 } }),
    );
    await app.drafts.loadAll();

    const opened = app.open();
    assert.equal(opened.isReady, true);
    assert.deepEqual(opened.draft.close, { reason: "duplicate", of: 41 });
  });

  test("dropping the close and restoring it round-trips, last word winning", () => {
    assert.equal(app.queries.closeDropped(app.source, pull), false);

    app.commands.dropClose(app.source, pull);
    assert.equal(app.queries.closeDropped(app.source, pull), true);

    app.commands.restoreClose(app.source, pull);
    assert.equal(app.queries.closeDropped(app.source, pull), false);

    app.commands.dropClose(app.source, pull);
    assert.equal(app.queries.closeDropped(app.source, pull), true);
  });

  test("the dropped close survives the agent redrafting", async () => {
    app.commands.dropClose(app.source, pull);

    await agentWrites(app.adapter, anIssueDraft({ close: { reason: "completed" } }));
    await app.drafts.loadAll();

    assert.equal(app.queries.closeDropped(app.source, app.open()), true);
  });

  test("the dropped close survives the browser being closed", async () => {
    app.commands.dropClose(app.source, pull);
    await app.state.settled();

    await app.state.restore();

    assert.equal(app.queries.closeDropped(app.source, app.open()), true);
  });

  test("a hunk decision made on one device arrives at the other", async () => {
    const adapter = new MemoryAdapter();
    const laptop = await anApp({ adapter, deviceId: "laptop" });
    const desktop = await anApp({ adapter, deviceId: "desktop" });
    await agentWrites(adapter, anIssueDraft());
    await laptop.drafts.loadAll();
    await desktop.drafts.loadAll();

    laptop.commands.rejectHunk(laptop.source, laptop.open(), "hunk-a");
    await laptop.sync.push(laptop.source);

    await desktop.sync.pull(desktop.source);

    assert.deepEqual(
      desktop.queries.rejectedHunks(desktop.source, desktop.open()),
      new Set(["hunk-a"]),
    );
  });
});
