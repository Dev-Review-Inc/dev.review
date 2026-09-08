// Saying what moved since the draft was written.
//
// `reviewedAt` on a pull request draft is the commit the review was written
// against; `draftedAt` on an issue draft is when the triage was written. Both
// promise the reader can tell a stale draft is stale - this is that promise
// kept. What select holds is `app.drift`, folded from a fetch made only when
// a cheap signal already in hand (a differing head commit, a later
// updated_at) says something might have moved. A destination that will not
// answer leaves it null, exactly like `app.settled`: unknown is not "nothing
// changed".

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { aPull, aDraft, agentWrites, theApp } from "./helper.js";

describe("Opening a pull request with commits pushed since the review", () => {
  test("a stale reviewedAt compares against the head commit and holds what came back", async () => {
    const pull = aPull();
    const app = await theApp({
      pulls: [pull],
      destination: {
        pullDetail: async () => ({
          headCommit: "a1b2c3d",
          state: "open",
          merged: false,
          mergedAt: null,
          closedAt: null,
        }),
        compare: async (target, base, head) => {
          assert.equal(base, "e612b1b");
          assert.equal(head, "a1b2c3d");

          return {
            aheadBy: 2,
            commits: [
              { sha: "a1b2c3d", message: "Fix the family catch-all", author: "someone", date: "2026-08-30T09:00:00Z" },
            ],
          };
        },
      },
    });

    await app.select(app.queue()[0]);

    assert.deepEqual(app.drift, {
      count: 2,
      commits: [
        { sha: "a1b2c3d", message: "Fix the family catch-all", author: "someone", date: "2026-08-30T09:00:00Z" },
      ],
    });
  });

  test("a reviewedAt matching the head commit fetches nothing and holds nothing", async () => {
    let asked = false;
    const app = await theApp({
      pulls: [aPull()],
      destination: {
        // Default pullDetail answers headCommit e612b1b, matching the default
        // draft's reviewedAt - nothing has moved.
        compare: async () => {
          asked = true;

          return { aheadBy: 0, commits: [] };
        },
      },
    });

    await app.select(app.queue()[0]);

    assert.equal(asked, false);
    assert.equal(app.drift, null);
  });

  test("a draft with no reviewedAt fetches nothing", async () => {
    const pull = aPull();
    const app = await theApp({ pulls: [pull], destination: {} });

    await agentWrites(app.adapter, aDraft({ owner: pull.owner, repo: pull.repo, number: pull.number, reviewedAt: undefined }));
    await app.select(app.queue()[0]);

    assert.equal(app.drift, null);
  });

  test("a compare that fails leaves drift null, not thrown", async () => {
    const app = await theApp({
      pulls: [aPull()],
      destination: {
        pullDetail: async () => ({
          headCommit: "a1b2c3d",
          state: "open",
          merged: false,
          mergedAt: null,
          closedAt: null,
        }),
        compare: async () => {
          throw new Error("the api answered 404");
        },
      },
    });

    await app.select(app.queue()[0]);

    assert.equal(app.drift, null);
  });

  test("an issue never asks for a compare", async () => {
    let asked = false;
    const app = await theApp({
      pulls: [aPull({ isIssue: true })],
      destination: {
        compare: async () => {
          asked = true;

          return { aheadBy: 1, commits: [] };
        },
      },
    });

    await app.select(app.queue()[0]);

    assert.equal(asked, false);
  });
});

describe("Opening an issue with comments left since it was triaged", () => {
  test("an updatedAt later than draftedAt fetches comments and keeps those that postdate it", async () => {
    const pull = aPull({ isIssue: true });
    const app = await theApp({
      pulls: [pull],
      destination: {
        issue: async () => ({
          body: "b",
          title: "t",
          isPull: false,
          url: "",
          state: "open",
          stateReason: null,
          closedAt: null,
          commentsCount: 2,
          updatedAt: "2026-07-30T00:00:00Z",
        }),
        issueComments: async () => [
          { author: "sofia", body: "still broken", createdAt: "2026-07-25T00:00:00Z" },
          { author: "tomas", body: "confirmed", createdAt: "2026-07-30T00:00:00Z" },
        ],
      },
    });

    await app.select(app.queue()[0]);

    // The default draft's draftedAt is the pull's updatedAt: 2026-07-29T15:00:00Z.
    assert.deepEqual(app.drift, {
      count: 1,
      comments: [{ author: "tomas", body: "confirmed", createdAt: "2026-07-30T00:00:00Z" }],
    });
  });

  test("an updatedAt no later than draftedAt fetches nothing", async () => {
    let asked = false;
    const app = await theApp({
      pulls: [aPull({ isIssue: true })],
      destination: {
        issue: async () => ({
          body: "b",
          title: "t",
          isPull: false,
          url: "",
          state: "open",
          stateReason: null,
          closedAt: null,
          commentsCount: 0,
          updatedAt: "2026-07-29T15:00:00Z",
        }),
        issueComments: async () => {
          asked = true;

          return [];
        },
      },
    });

    await app.select(app.queue()[0]);

    assert.equal(asked, false);
    assert.equal(app.drift, null);
  });

  test("an updatedAt that moved for a reason other than a comment holds nothing", async () => {
    const app = await theApp({
      pulls: [aPull({ isIssue: true })],
      destination: {
        issue: async () => ({
          body: "b",
          title: "t",
          isPull: false,
          url: "",
          state: "open",
          stateReason: null,
          closedAt: null,
          commentsCount: 0,
          updatedAt: "2026-07-30T00:00:00Z",
        }),
        // A label change, say: updated_at moved, but no comment postdates the draft.
        issueComments: async () => [
          { author: "sofia", body: "old comment", createdAt: "2026-07-20T00:00:00Z" },
        ],
      },
    });

    await app.select(app.queue()[0]);

    assert.equal(app.drift, null);
  });

  test("a comments fetch that fails leaves drift null, not thrown", async () => {
    const app = await theApp({
      pulls: [aPull({ isIssue: true })],
      destination: {
        issue: async () => ({
          body: "b",
          title: "t",
          isPull: false,
          url: "",
          state: "open",
          stateReason: null,
          closedAt: null,
          commentsCount: 1,
          updatedAt: "2026-07-30T00:00:00Z",
        }),
        issueComments: async () => {
          throw new Error("the api answered 403");
        },
      },
    });

    await app.select(app.queue()[0]);

    assert.equal(app.drift, null);
  });
});
