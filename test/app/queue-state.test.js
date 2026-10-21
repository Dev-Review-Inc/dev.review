// What a queue row says about where a pull request has got to.
//
// The rule under test is that the row and the pane never describe the same
// pull request differently. The pane distinguishes a review nobody has started
// from one an agent is part way through, so the row has to as well: a reader
// scanning the queue for something to do is reading these words, and "reviewing"
// against a pull request no agent has claimed sends them away from the one thing
// on the list that actually wants them.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { stateOf } from "../../web/src/app/header.js";

// The four shapes pullState can hand over, built the way it builds them: the
// draft decides, and isReady, isDrafting and isStalled are read off it
// together, so no entry can claim two of them and none can claim none with a
// draft. An unfinished draft is drafting until its draftedAt is old enough to
// mean the run died, and stalled from then on.
const entry = (draft, { stalled = false } = {}) => ({
  draft,
  isReady: Boolean(draft && draft.finishedAt),
  isDrafting: Boolean(draft && !draft.finishedAt) && !stalled,
  isStalled: Boolean(draft && !draft.finishedAt) && stalled,
  postedAt: null,
});

const drafting = (progress = {}) => entry({ progress, verdict: "" });
const stalled = (progress = {}) => entry({ progress, verdict: "" }, { stalled: true });
const finished = (verdict) => entry({ finishedAt: "2026-07-29T15:41:10Z", verdict, progress: {} });

describe("a pull request with nothing drafted", () => {
  test("says so rather than borrowing the word for a review in progress", () => {
    assert.equal(stateOf(entry(null)).word, "not started");
  });

  test("reads as quietly as the other state nobody needs to act on", () => {
    assert.equal(stateOf(entry(null)).tone, "pending");
  });
});

describe("a review an agent is part way through", () => {
  test("says it is being reviewed", () => {
    assert.equal(stateOf(drafting()).word, "reviewing");
    assert.equal(stateOf(drafting()).tone, "pending");
  });

  test("prefers the agent's own note about where it has got to", () => {
    assert.equal(stateOf(drafting({ note: "QA: 2 of 3" })).word, "QA: 2 of 3");
  });
});

describe("a review whose agent went quiet", () => {
  test("says it stalled rather than that it is being reviewed", () => {
    assert.equal(stateOf(stalled()).word, "stalled");
  });

  test("says so over the agent's last note, which no longer says where it is", () => {
    assert.equal(stateOf(stalled({ note: "QA: 2 of 3" })).word, "stalled");
  });

  test("wears a tone of its own, because this one does want the reader's eye", () => {
    assert.equal(stateOf(stalled()).tone, "stalled");
  });
});

describe("a review the agent finished", () => {
  test("says what the agent decided", () => {
    assert.equal(stateOf(finished("APPROVE")).word, "looks good");
    assert.equal(stateOf(finished("REQUEST_CHANGES")).word, "changes");
    assert.equal(stateOf(finished("COMMENT")).word, "comment");
  });

  test("says it is drafted when the agent named no verdict", () => {
    assert.equal(stateOf(finished("")).word, "drafted");
    assert.equal(stateOf(finished("")).tone, "drafted");
  });
});

describe("a review that has gone out", () => {
  test("says so whatever the draft behind it now holds", () => {
    assert.equal(stateOf({ ...finished("APPROVE"), postedAt: "2026-07-30T09:00:00Z" }).word, "posted");
    assert.equal(stateOf({ ...entry(null), postedAt: "2026-07-30T09:00:00Z" }).word, "posted");
  });
});
