// The queue is the drafts.
//
// Nothing is searched for: an entry appears because the sweep wrote a draft
// into the reader's storage, and for no other reason. The destination is only
// asked per item, when one is opened or posted.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { theApp, agentWrites, aDraft } from "./helper.js";
import { pullsFromDrafts } from "../../web/src/queries/index.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";

// An issue draft: no verdict, a proposed replacement body, an issue url.
function anIssueDraft(overrides = {}) {
  return aDraft({
    number: 7,
    verdict: "",
    summary: "",
    sections: [],
    findings: [],
    description: "The proposed replacement body.",
    comment: "Why the body should change.",
    title: "The tickets pile up",
    url: "https://github.com/org/app/issues/7",
    draftedAt: "2026-08-16T09:00:00Z",
    author: "reporter",
    ...overrides,
  });
}

describe("deriving the queue from drafts", () => {
  test("a pull request draft becomes a pull request entry", () => {
    const drafts = new Map([["org/app#42", aDraft({ draftedAt: "2026-08-16T09:00:00Z", author: "someone" })]]);

    assert.deepEqual(pullsFromDrafts(drafts), [
      {
        owner: "org",
        repo: "app",
        number: 42,
        title: "Re-root the errors onto a common base class",
        author: "someone",
        url: "https://github.com/org/app/pull/42",
        updatedAt: "2026-08-16T09:00:00Z",
        createdAt: "",
        isRequested: true,
        isIssue: false,
      },
    ]);
  });

  test("an issue draft becomes an entry flagged as an issue", () => {
    const [entry] = pullsFromDrafts(new Map([["org/app#7", anIssueDraft()]]));

    assert.equal(entry.isIssue, true);
    assert.equal(entry.isRequested, true);
    assert.equal(entry.title, "The tickets pile up");
    assert.equal(entry.number, 7);
  });

  test("a draft whose url names neither a pull request nor an issue stays invisible", () => {
    const drafts = new Map([
      ["org/app#1", aDraft({ number: 1, url: "" })],
      ["org/app#2", aDraft({ number: 2, url: "https://github.com/org/app" })],
    ]);

    assert.deepEqual(pullsFromDrafts(drafts), []);
  });
});

describe("living with a draft-driven queue", () => {
  let adapter;
  let app;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    app = await theApp({ adapter, pulls: [] });
  });

  test("an issue draft in storage appears on the queue, flagged, with its title", async () => {
    await agentWrites(adapter, anIssueDraft());
    await app.loadQueue();

    const queue = app.queue();

    assert.equal(queue.length, 1);
    assert.equal(queue[0].isIssue, true);
    assert.equal(queue[0].title, "The tickets pile up");
    assert.equal(queue[0].author, "reporter");
    assert.equal(queue[0].isReady, true);
  });

  test("a draft arriving mid-session surfaces without a reload", async () => {
    assert.equal(app.queue().length, 0);

    // What the watch does when the sweep writes: absorb, then reselect.
    await agentWrites(adapter, anIssueDraft());
    await app.drafts.loadAll();
    await app.reselect();

    assert.equal(app.queue().length, 1);
  });

  test("dismissing takes it off, and a newer redraft brings it back", async () => {
    await agentWrites(adapter, anIssueDraft());
    await app.loadQueue();

    app.commands.dismissPull(app.source, app.queue()[0]);

    assert.equal(app.queue().length, 0);
    assert.equal(app.dismissed().length, 1);
    assert.equal(app.dismissed()[0].restorable, true);

    // The sweep drafting again is a new question, so it reaches the reader.
    await agentWrites(
      adapter,
      anIssueDraft({ draftedAt: new Date(Date.now() + 1000).toISOString() }),
    );
    await app.loadQueue();

    assert.equal(app.queue().length, 1);
  });

  test("posting the triage leaves the queue", async () => {
    await agentWrites(adapter, anIssueDraft());
    await app.loadQueue();

    await app.commands.recordPostedTriage(app.source, app.queue()[0], {
      url: "https://github.com/org/app/issues/7#issuecomment-1",
    });

    assert.equal(app.queue().length, 0);
  });

  test("clearing the draft is the entry leaving the queue", async () => {
    await agentWrites(adapter, anIssueDraft());
    await app.loadQueue();
    await app.select(app.queue()[0]);

    await app.clearDraft();
    await app.loadQueue();

    assert.equal(app.queue().length, 0);
  });
});
