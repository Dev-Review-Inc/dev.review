// Opening something already merged or closed.
//
// The queue is the drafts, so a draft can outlive its pull request: the reader
// opens one already merged, or an issue already closed, and the app has to say
// so. What it holds is `app.settled` - folded from the same fetches select
// already makes, so knowing costs no extra request - and a destination that
// would not answer leaves it null, because unknown is not open.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { aPull, theApp } from "./helper.js";

const detail = (overrides = {}) => ({
  headCommit: "e612b1b",
  state: "open",
  merged: false,
  mergedAt: null,
  closedAt: null,
  ...overrides,
});

async function opened(destination, { isIssue = false } = {}) {
  const app = await theApp({
    pulls: [aPull(isIssue ? { isIssue: true } : {})],
    destination,
  });

  await app.select(app.queue()[0]);

  return app;
}

describe("Opening a pull request that is already settled", () => {
  test("a merged pull request is held as merged, with its moment", async () => {
    const app = await opened({
      pullDetail: async () =>
        detail({ state: "closed", merged: true, mergedAt: "2026-08-30T10:00:00Z", closedAt: "2026-08-30T10:00:00Z" }),
    });

    assert.deepEqual(app.settled, { state: "merged", at: "2026-08-30T10:00:00Z" });
    assert.equal(app.headCommit, "e612b1b");
  });

  test("a closed, unmerged pull request is held as closed", async () => {
    const app = await opened({
      pullDetail: async () => detail({ state: "closed", closedAt: "2026-08-30T10:00:00Z" }),
    });

    assert.deepEqual(app.settled, { state: "closed", at: "2026-08-30T10:00:00Z" });
  });

  test("an open pull request is held as open, with no moment", async () => {
    const app = await opened({});

    assert.deepEqual(app.settled, { state: "open", at: null });
  });

  test("a destination that would not answer leaves it null - unknown is not open", async () => {
    const app = await opened({
      pullDetail: async () => {
        throw new Error("the api answered 403");
      },
    });

    assert.equal(app.settled, null);
  });

  test("a closed issue is held as closed, from the same fetch as its body", async () => {
    const app = await opened(
      {
        issue: async () => ({
          body: "b",
          title: "t",
          isPull: false,
          url: "",
          state: "closed",
          stateReason: "completed",
          closedAt: "2026-08-30T10:00:00Z",
        }),
      },
      { isIssue: true },
    );

    assert.deepEqual(app.settled, { state: "closed", at: "2026-08-30T10:00:00Z" });
  });

  test("selecting again starts from unknown, not from the last answer", async () => {
    let merged = true;
    const app = await opened({
      pullDetail: async () => {
        if (merged) return detail({ state: "closed", merged: true, mergedAt: "2026-08-30T10:00:00Z" });

        throw new Error("the api answered 403");
      },
    });

    assert.equal(app.settled.state, "merged");

    merged = false;
    await app.select(app.queue()[0]);

    assert.equal(app.settled, null);
  });
});
