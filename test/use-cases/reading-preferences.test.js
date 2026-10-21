import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { anApp, agentWrites, aDraft } from "./helper.js";

describe("What a finding carries when it is posted on its own", () => {
  test("a committable suggestion goes with it, as it would with the review", async () => {
    const app = await anApp();
    await agentWrites(
      app.adapter,
      aDraft({
        findings: [
          {
            id: "inert-catch-all",
            path: "lib/error.rb",
            line: 12,
            body: "The rescue clause now parses and never matches.",
            suggestion: "module Error; end",
          },
        ],
      }),
    );
    await app.drafts.loadAll();
    const pull = app.open();
    const [finding] = app.queries.findingsForPull(app.source, pull);

    const body = app.queries.bodyToPost(app.source, finding);

    assert.match(body, /```suggestion\nmodule Error; end\n```$/);
  });

  test("a finding with nothing to apply is posted as written", async () => {
    const app = await anApp();
    await agentWrites(app.adapter, aDraft());
    await app.drafts.loadAll();
    const pull = app.open();
    const [finding] = app.queries.findingsForPull(app.source, pull);

    assert.equal(
      app.queries.bodyToPost(app.source, finding),
      "The rescue clause now parses and never matches.",
    );
  });
});

describe("The kinds a review coined", () => {
  let app;
  let pull;

  beforeEach(async () => {
    app = await anApp();
    await agentWrites(app.adapter, aDraft());
    await app.drafts.loadAll();
    pull = app.open();
  });

  test("are read off the findings, with a count each", () => {
    assert.deepEqual(app.queries.kindsForPull(app.source, pull), [
      { kind: "bug", count: 1, color: "critical" },
      { kind: "question", count: 1, color: "neutral" },
    ]);
  });

  test("include one a reader coins by writing their own comment", () => {
    app.commands.addFinding(app.source, pull, {
      path: "lib/error.rb",
      line: 12,
      body: "One thought.",
    });

    assert.deepEqual(
      app.queries.kindsForPull(app.source, pull).map((entry) => entry.kind),
      ["bug", "question", "yours"],
    );
  });

  test("take the worst tone among the findings that share a kind", () => {
    assert.equal(
      app.queries.kindsForPull(app.source, pull).find((entry) => entry.kind === "bug").color,
      "critical",
    );
  });
});

describe("Reading only what is flagged", () => {
  test("is off to begin with", async () => {
    const app = await anApp();

    assert.equal(app.queries.isFlaggedOnly(app.source), false);
  });

  test("stays on when the reader comes back", async () => {
    const app = await anApp();

    app.commands.showFlaggedOnly(app.source, true);
    await app.state.restore();

    assert.equal(app.queries.isFlaggedOnly(app.source), true);
  });

  test("can be turned off again", async () => {
    const app = await anApp();
    app.commands.showFlaggedOnly(app.source, true);

    app.commands.showFlaggedOnly(app.source, false);

    assert.equal(app.queries.isFlaggedOnly(app.source), false);
  });
});

describe("A prefix on every comment and summary", () => {
  test("is empty to begin with", async () => {
    const app = await anApp();

    assert.equal(app.queries.commentPrefixFor(app.source), "");
  });

  test("stays set when the reader comes back", async () => {
    const app = await anApp();

    app.commands.setCommentPrefix(app.source, "[bot-assisted]");
    await app.state.restore();

    assert.equal(app.queries.commentPrefixFor(app.source), "[bot-assisted]");
  });

  test("can be cleared again", async () => {
    const app = await anApp();
    app.commands.setCommentPrefix(app.source, "[bot-assisted]");

    app.commands.setCommentPrefix(app.source, "");

    assert.equal(app.queries.commentPrefixFor(app.source), "");
  });

  // Not commentToPost's job: that string doubles as reviewPayload's own
  // options.body, and reviewPayload is where the prefix belongs on the way
  // out - applying it here too would send it twice.
  test("does not lead commentToPost, which the send builds the prefix onto separately", async () => {
    const app = await anApp();
    await agentWrites(app.adapter, aDraft());
    await app.drafts.loadAll();
    const pull = app.open();
    app.commands.includeSummary(app.source, pull);
    app.commands.setCommentPrefix(app.source, "[bot-assisted]");

    assert.equal(
      app.queries.commentToPost(app.source, pull),
      "Two things worth a look before this goes in.",
    );
  });

  test("leads a finding posted on its own", async () => {
    const app = await anApp();
    await agentWrites(app.adapter, aDraft());
    await app.drafts.loadAll();
    const pull = app.open();
    const [finding] = app.queries.findingsForPull(app.source, pull);
    app.commands.setCommentPrefix(app.source, "[bot-assisted]");

    assert.equal(
      app.queries.bodyToPost(app.source, finding),
      "[bot-assisted] The rescue clause now parses and never matches.",
    );
  });

  // The prefix marks the agent's words. A comment the reader wrote was never
  // the agent's, so it goes out exactly as written from the moment it exists.
  test("does not lead a comment the reader wrote themselves", async () => {
    const app = await anApp();
    await agentWrites(app.adapter, aDraft());
    await app.drafts.loadAll();
    const pull = app.open();
    app.commands.setCommentPrefix(app.source, "[bot-assisted]");

    const own = app.commands.addFinding(app.source, pull, {
      path: "lib/error.rb",
      line: 12,
      body: "One thought of my own.",
    });

    assert.equal(app.queries.bodyToPost(app.source, own), "One thought of my own.");
  });

  // The prefix marks the agent's words. A finding the reader rewrote is the
  // reader's, and marking it as the agent's would be a small lie in public.
  test("does not lead a finding the reader edited", async () => {
    const app = await anApp();
    await agentWrites(app.adapter, aDraft());
    await app.drafts.loadAll();
    const pull = app.open();
    app.commands.setCommentPrefix(app.source, "[bot-assisted]");

    let [finding] = app.queries.findingsForPull(app.source, pull);
    app.commands.editFinding(app.source, pull, finding, "My own sharper point.");
    [finding] = app.queries.findingsForPull(app.source, pull);

    assert.equal(app.queries.bodyToPost(app.source, finding), "My own sharper point.");
  });
});

describe("Labels stripped from every issue posted", () => {
  // A triage draft carrying the given labels, or none.
  async function anIssue(app, labels) {
    await agentWrites(
      app.adapter,
      aDraft({
        url: "https://github.com/org/app/issues/42",
        verdict: "",
        findings: [],
        sections: [],
        comment: "Triaged.",
        ...(labels ? { labels } : {}),
      }),
    );
    await app.drafts.loadAll();

    return { ...app.open(), isIssue: true };
  }

  test("strip triage until the reader says otherwise", async () => {
    const app = await anApp();

    assert.deepEqual(app.queries.strippedLabelsFor(app.source), ["triage"]);
  });

  test("stay set when the reader comes back, and can be emptied", async () => {
    const app = await anApp();

    app.commands.setStrippedLabels(app.source, ["triage", "needs-info"]);
    await app.state.restore();
    assert.deepEqual(app.queries.strippedLabelsFor(app.source), ["triage", "needs-info"]);

    app.commands.setStrippedLabels(app.source, []);
    assert.deepEqual(app.queries.strippedLabelsFor(app.source), []);
  });

  test("join what the draft removes, never removing what it adds", async () => {
    const app = await anApp();
    app.commands.setStrippedLabels(app.source, ["triage", "bug", "stale"]);
    const issue = await anIssue(app, { add: ["bug"], remove: ["stale"] });

    assert.deepEqual(app.queries.labelsToPost(app.source, issue), {
      add: ["bug"],
      remove: ["stale", "triage"],
    });
  });

  test("apply to an issue whose draft proposes no labels", async () => {
    const app = await anApp();
    const issue = await anIssue(app);

    assert.deepEqual(app.queries.labelsToPost(app.source, issue), { add: [], remove: ["triage"] });
  });

  test("leave nothing to post when empty and the draft proposes none", async () => {
    const app = await anApp();
    app.commands.setStrippedLabels(app.source, []);
    const issue = await anIssue(app);

    assert.equal(app.queries.labelsToPost(app.source, issue), null);
  });

  test("never touch a pull request", async () => {
    const app = await anApp();
    await agentWrites(app.adapter, aDraft({ labels: { add: ["bug"] } }));
    await app.drafts.loadAll();

    assert.equal(app.queries.labelsToPost(app.source, { ...app.open(), isIssue: false }), null);
  });
});
