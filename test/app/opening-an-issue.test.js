// Opening something the queue got from an issue search.
//
// An issue has no diff: asking /pulls/{n} for an issue number is a 404, so
// opening one fetches the live body instead. A pull request whose draft
// proposes a description needs that same body beside its diff, and one whose
// draft proposes none must not be charged a fetch it will never read.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, aPull, agentWrites, theApp } from "../use-cases/helper.js";

const anIssueDraft = (overrides = {}) =>
  aDraft({
    verdict: "",
    summary: "",
    sections: [],
    findings: [],
    description: "The proposed replacement body.",
    comment: "Why the body should change.",
    ...overrides,
  });

async function opened({ draft, pull, issue }) {
  const adapter = new MemoryAdapter();

  await agentWrites(adapter, draft);

  const calls = [];
  const app = await theApp({
    adapter,
    pulls: [pull],
    destination: {
      files: async () => {
        calls.push("files");

        return [];
      },
      headCommit: async () => {
        calls.push("commit");

        return "e612b1b";
      },
      issue:
        issue ||
        (async () => {
          calls.push("issue");

          return { body: "The live body.", title: "T", isPull: false, url: "" };
        }),
    },
  });

  await app.select(app.queue()[0]);

  return { app, calls };
}

describe("opening an issue", () => {
  test("fetches the live body and never asks for a diff", async () => {
    const { app, calls } = await opened({
      draft: anIssueDraft(),
      pull: aPull({ isIssue: true }),
    });

    assert.equal(app.issue.body, "The live body.");
    assert.deepEqual(calls, ["issue"]);
    assert.deepEqual(app.files, []);
    assert.equal(app.diffProblem, "");
  });

  test("a body that cannot be fetched is a note, never a throw", async () => {
    const { app } = await opened({
      draft: anIssueDraft(),
      pull: aPull({ isIssue: true }),
      issue: async () => {
        throw new Error("rate limited");
      },
    });

    assert.equal(app.issue, null);
    assert.equal(app.issueProblem, "rate limited");
  });
});

describe("opening a pull request", () => {
  test("whose draft proposes a description fetches the body beside the diff", async () => {
    const { app, calls } = await opened({
      draft: anIssueDraft({ verdict: "COMMENT" }),
      pull: aPull(),
    });

    assert.equal(app.issue.body, "The live body.");
    assert.deepEqual(calls.sort(), ["commit", "files", "issue"]);
  });

  test("whose draft proposes none is not charged the extra fetch", async () => {
    const { app, calls } = await opened({ draft: aDraft(), pull: aPull() });

    assert.equal(app.issue, null);
    assert.equal(calls.includes("issue"), false);
  });

  test("does not inherit the last issue's body", async () => {
    const adapter = new MemoryAdapter();

    await agentWrites(adapter, anIssueDraft());
    await agentWrites(adapter, aDraft({ number: 43 }));

    const app = await theApp({
      adapter,
      pulls: [aPull({ isIssue: true }), aPull({ number: 43 })],
      destination: {
        issue: async () => ({ body: "The live body.", title: "T", isPull: false, url: "" }),
      },
    });

    const queue = app.queue();

    await app.select(queue.find((entry) => entry.number === 42));
    assert.equal(app.issue.body, "The live body.");

    await app.select(queue.find((entry) => entry.number === 43));
    assert.equal(app.issue, null);
    assert.equal(app.issueProblem, "");
  });
});
