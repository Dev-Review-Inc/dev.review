// Whether the summary text can still be written.
//
// The same rule as the send button: approving implies having read the whole
// review, so only approve waits on the draft finishing. A reader choosing to
// comment or request changes before the agent is done needs somewhere to
// write that comment, so the box opens up for those verdicts too.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { summaryWritable } from "../../web/src/app/summary.js";

const finished = { finishedAt: "2026-07-29T15:41:10Z" };
const unfinished = { finishedAt: "" };

describe("a verdict that does not need the review finished", () => {
  test("is writable before the draft finishes", () => {
    assert.equal(summaryWritable(unfinished, "COMMENT", false, false), true);
    assert.equal(summaryWritable(unfinished, "REQUEST_CHANGES", false, false), true);
  });

  test("is writable once the draft finishes too", () => {
    assert.equal(summaryWritable(finished, "COMMENT", false, false), true);
  });
});

describe("approving", () => {
  test("is not writable before the draft finishes", () => {
    assert.equal(summaryWritable(unfinished, "APPROVE", false, false), false);
  });

  test("is writable once the draft finishes", () => {
    assert.equal(summaryWritable(finished, "APPROVE", false, false), true);
  });
});

describe("regardless of the verdict", () => {
  test("is not writable once the review has been posted", () => {
    assert.equal(summaryWritable(finished, "COMMENT", true, false), false);
  });

  test("is not writable behind a lens or theme filter", () => {
    assert.equal(summaryWritable(finished, "COMMENT", false, true), false);
  });
});
