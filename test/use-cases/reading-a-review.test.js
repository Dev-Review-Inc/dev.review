import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { anApp, agentWrites, aDraft, aPull } from "./helper.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { reviewPayload } from "../../web/src/domain/review.js";
import { UNPARSED } from "../../web/src/state/drafts.js";

describe("Reading a review the agent drafted", () => {
  let app;

  beforeEach(async () => {
    app = await anApp();
    await agentWrites(app.adapter, aDraft());
    await app.drafts.loadAll();
  });

  test("the pull request is ready, and shows what was drafted", () => {
    const [entry] = app.queries.queue(app.source, [aPull()]);

    assert.equal(entry.isReady, true);
    assert.equal(entry.draft.summary, "Re-rooted correctly, but the family catch-all is now inert.");
    assert.equal(app.queries.findingsForPull(app.source, entry).length, 2);
  });

  test("a draft the agent has not finished is not ready, but is still shown", async () => {
    await agentWrites(app.adapter, aDraft({ finishedAt: undefined, progress: { note: "QA: 2 of 3" } }));
    await app.drafts.loadAll();

    const [entry] = app.queries.queue(app.source, [aPull()]);

    assert.equal(entry.isReady, false);
    assert.equal(entry.isDrafting, true);
    assert.equal(entry.draft.progress.note, "QA: 2 of 3");
  });

  test("a pull request with nothing drafted still appears, waiting", () => {
    const other = aPull({ number: 40000 });

    const entry = app.open(other);

    assert.equal(entry.draft, null);
    assert.equal(entry.isReady, false);
  });

  test("clearing a review puts the pull request back to nothing drafted", async () => {
    await app.adapter.remove("drafts/org--app-42/review.json");
    // The refresh a reader gets on coming back to the tab, which is what has to
    // notice: it is the queue in the header that keeps the marks of a review.
    await app.drafts.loadAll();

    const [entry] = app.queries.queue(app.source, [aPull()]);

    assert.equal(entry.draft, null);
    assert.equal(entry.isReady, false);
  });

  test("a draft the app cannot act on says so rather than reading as absent", async () => {
    await agentWrites(app.adapter, aDraft({ schema: 99 }));
    await app.drafts.loadAll();

    const problem = app.drafts.problem("org/app#42");

    assert.equal(problem.cause, UNPARSED);
    assert.match(problem.detail, /schema 99/);
  });
});

describe("Deciding what goes out", () => {
  let app;
  let pull;

  beforeEach(async () => {
    app = await anApp();
    await agentWrites(app.adapter, aDraft());
    await app.drafts.loadAll();
    pull = app.open();
  });

  test("a dropped finding is not sent, and is still readable", () => {
    const [finding] = app.queries.findingsForPull(app.source, pull);

    app.commands.dropFinding(app.source, pull, finding);

    const [dropped] = app.queries.findingsForPull(app.source, pull);
    assert.ok(dropped.droppedAt);
    assert.equal(dropped.body, "The rescue clause now parses and never matches.");
    assert.deepEqual(
      app.queries.findingsToPost(app.source, pull).map((item) => item.id),
      ["spec-cannot-fail"],
    );
  });

  test("a dropped finding can be restored", () => {
    const [finding] = app.queries.findingsForPull(app.source, pull);
    app.commands.dropFinding(app.source, pull, finding);

    app.commands.restoreFinding(app.source, pull, finding);

    assert.equal(app.queries.findingsForPull(app.source, pull)[0].droppedAt, null);
  });

  test("editing a finding keeps what the agent wrote", () => {
    const [finding] = app.queries.findingsForPull(app.source, pull);

    app.commands.editFinding(app.source, pull, finding, "Say it more kindly.");

    const [edited] = app.queries.findingsForPull(app.source, pull);
    assert.equal(edited.body, "Say it more kindly.");
    assert.equal(edited.drafted, "The rescue clause now parses and never matches.");
    assert.ok(edited.editedAt);
  });

  test("an edit can be put back to what was drafted", () => {
    const [finding] = app.queries.findingsForPull(app.source, pull);
    app.commands.editFinding(app.source, pull, finding, "Say it more kindly.");

    app.commands.resetFinding(app.source, pull, finding);

    const [reset] = app.queries.findingsForPull(app.source, pull);
    assert.equal(reset.body, "The rescue clause now parses and never matches.");
    assert.equal(reset.drafted, null);
  });

  test("nothing the reader decides is written into the agent's document", async () => {
    const before = await app.adapter.read("drafts/org--app-42/review.json");
    const [finding] = app.queries.findingsForPull(app.source, pull);

    app.commands.dropFinding(app.source, pull, finding);
    app.commands.editFinding(app.source, pull, finding, "Different.");
    app.commands.editComment(app.source, pull, "A different summary.");

    const after = await app.adapter.read("drafts/org--app-42/review.json");
    assert.deepEqual(after, before);
  });

  test("the agent rewriting its draft does not take the reader's decisions with it", async () => {
    const [finding] = app.queries.findingsForPull(app.source, pull);
    app.commands.dropFinding(app.source, pull, finding);
    app.commands.editFinding(app.source, pull, finding, "Say it more kindly.");

    await agentWrites(
      app.adapter,
      aDraft({ summary: "Rewritten by the agent", comment: "Rewritten too" }),
    );
    await app.drafts.loadAll();

    const reopened = app.open();
    const [after] = app.queries.findingsForPull(app.source, reopened);
    assert.ok(after.droppedAt);
    assert.equal(after.body, "Say it more kindly.");
    assert.equal(reopened.draft.summary, "Rewritten by the agent");
  });

  test("a comment the reader writes belongs to them, and two on one line are two", () => {
    const first = app.commands.addFinding(app.source, pull, {
      path: "lib/error.rb",
      line: 12,
      body: "One thought.",
    });
    const second = app.commands.addFinding(app.source, pull, {
      path: "lib/error.rb",
      line: 12,
      body: "And another.",
    });

    assert.notEqual(first.id, second.id);
    assert.equal(first.mine, true);
    assert.equal(app.queries.findingsForPull(app.source, pull).length, 4);
  });

  test("a comment the reader wrote can be taken back", () => {
    const own = app.commands.addFinding(app.source, pull, {
      path: "lib/error.rb",
      line: 12,
      body: "One thought.",
    });

    app.commands.removeFinding(app.source, pull, own);

    assert.equal(app.queries.findingsForPull(app.source, pull).length, 2);
  });

  test("the review body is the agent's until the reader changes it", () => {
    assert.equal(
      app.queries.commentFor(app.source, pull),
      "Two things worth a look before this goes in.",
    );

    app.commands.editComment(app.source, pull, "Mine now.");

    assert.equal(app.queries.commentFor(app.source, pull), "Mine now.");
    assert.equal(app.queries.isCommentEdited(app.source, pull), true);
  });

  test("the verdict is the agent's until the reader overrides it", () => {
    assert.equal(app.queries.verdictFor(app.source, pull, "reader"), "COMMENT");

    app.commands.chooseVerdict(app.source, pull, "REQUEST_CHANGES");

    assert.equal(app.queries.verdictFor(app.source, pull, "reader"), "REQUEST_CHANGES");
  });

  test("a reader cannot approve their own pull request", () => {
    const mine = app.open(aPull({ author: "reader" }));
    app.commands.chooseVerdict(app.source, mine, "APPROVE");

    assert.equal(app.queries.verdictFor(app.source, mine, "reader"), "COMMENT");
  });

  test("the footer counts only what would actually block a merge", () => {
    assert.equal(app.queries.blockingCount(app.source, pull), 1);

    const [blocking] = app.queries.findingsForPull(app.source, pull);
    app.commands.dropFinding(app.source, pull, blocking);

    assert.equal(app.queries.blockingCount(app.source, pull), 0);
  });

  test("a finding posted on its own is left out of the review that follows", () => {
    const [finding] = app.queries.findingsForPull(app.source, pull);

    app.commands.recordPostedFinding(app.source, pull, finding, { url: "https://x" });

    assert.deepEqual(
      app.queries.findingsToPost(app.source, pull).map((item) => item.id),
      ["spec-cannot-fail"],
    );
  });

  test("what goes to the destination is exactly what the reader was shown", () => {
    const [first] = app.queries.findingsForPull(app.source, pull);
    app.commands.dropFinding(app.source, pull, first);
    app.commands.editComment(app.source, pull, "My words.");

    const payload = reviewPayload(
      { findings: app.queries.findingsToPost(app.source, pull), comment: "", verdict: "COMMENT" },
      {
        commitId: "e612b1b",
        dropped: new Set(),
        body: app.queries.commentFor(app.source, pull),
        event: app.queries.verdictFor(app.source, pull, "reader"),
      },
    );

    assert.equal(payload.body, "My words.");
    assert.equal(payload.event, "COMMENT");
    assert.deepEqual(
      payload.comments.map((comment) => comment.path),
      ["spec/error_spec.rb"],
    );
  });
});

describe("Coming back to a review later", () => {
  test("every decision survives the browser being closed", async () => {
    const adapter = new MemoryAdapter();
    const app = await anApp({ adapter });
    await agentWrites(adapter, aDraft());
    await app.drafts.loadAll();
    const pull = app.open();
    const [finding] = app.queries.findingsForPull(app.source, pull);

    app.commands.dropFinding(app.source, pull, finding);
    app.commands.markFile(app.source, pull, "lib/error.rb", true);
    app.commands.collapseFile(app.source, pull, "lib/error.rb", true);
    app.commands.dismissPull(app.source, pull);

    // The same logs, read back from scratch, as a reload would.
    await app.state.restore();

    const again = app.open();
    assert.ok(app.queries.findingsForPull(app.source, again)[0].droppedAt);
    assert.ok(app.queries.fileState(app.source, again, "lib/error.rb").viewedAt);
    assert.ok(app.queries.fileState(app.source, again, "lib/error.rb").collapsedAt);
    assert.equal(app.queries.queue(app.source, [aPull()]).length, 0);
  });

  test("a posted review is recorded, and leaves the queue", async () => {
    const app = await anApp();
    await agentWrites(app.adapter, aDraft());
    await app.drafts.loadAll();
    const pull = app.open();

    app.commands.recordPostedReview(app.source, pull, {
      url: "https://github.com/org/app/pull/42#pullrequestreview-1",
      event: "COMMENT",
    });

    const after = app.open();
    assert.ok(after.postedAt);
    assert.equal(after.postedUrl, "https://github.com/org/app/pull/42#pullrequestreview-1");
    assert.equal(app.queries.isPosted(app.source, after), true);
    assert.equal(app.queries.queue(app.source, [aPull()]).length, 0);
  });
});

describe("Reading the same source from two devices", () => {
  test("a decision made on one device arrives at the other", async () => {
    const adapter = new MemoryAdapter();
    const laptop = await anApp({ adapter, deviceId: "laptop" });
    const desktop = await anApp({ adapter, deviceId: "desktop" });
    await agentWrites(adapter, aDraft());
    await laptop.drafts.loadAll();
    await desktop.drafts.loadAll();

    const pull = laptop.open();
    const [finding] = laptop.queries.findingsForPull(laptop.source, pull);
    laptop.commands.dropFinding(laptop.source, pull, finding);
    await laptop.sync.push(laptop.source);

    const taken = await desktop.sync.pull(desktop.source);

    assert.ok(taken > 0);
    const there = desktop.open();
    assert.ok(desktop.queries.findingsForPull(desktop.source, there)[0].droppedAt);
  });

  test("taking the same log twice changes nothing", async () => {
    const adapter = new MemoryAdapter();
    const laptop = await anApp({ adapter, deviceId: "laptop" });
    const desktop = await anApp({ adapter, deviceId: "desktop" });
    await agentWrites(adapter, aDraft());
    await laptop.drafts.loadAll();
    await desktop.drafts.loadAll();

    const pull = laptop.open();
    laptop.commands.addFinding(laptop.source, pull, {
      path: "lib/error.rb",
      line: 12,
      body: "One thought.",
    });
    await laptop.sync.push(laptop.source);

    await desktop.sync.pull(desktop.source);
    await desktop.sync.pull(desktop.source);

    const there = desktop.open();
    assert.equal(desktop.queries.findingsForPull(desktop.source, there).length, 3);
  });

  test("neither device writes over the other's file", async () => {
    const adapter = new MemoryAdapter();
    const laptop = await anApp({ adapter, deviceId: "laptop" });
    const desktop = await anApp({ adapter, deviceId: "desktop" });
    await agentWrites(adapter, aDraft());
    await laptop.drafts.loadAll();

    laptop.commands.dismissPull(laptop.source, laptop.open());
    await laptop.sync.push(laptop.source);
    desktop.commands.dismissPull(desktop.source, desktop.open());
    await desktop.sync.push(desktop.source);

    const logs = await adapter.list(".reviewer/events/");
    assert.deepEqual(logs.map((entry) => entry.path).sort(), [
      ".reviewer/events/desktop.jsonl",
      ".reviewer/events/laptop.jsonl",
    ]);
  });
});
