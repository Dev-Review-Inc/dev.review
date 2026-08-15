// The footer over an issue.
//
// An issue takes no verdict - there is nothing to approve and no merge to
// block - so the send waits only on a draft that proposes something and on not
// having already gone out. Dismissing stays, because "I don't want to triage
// this one" is as true of an issue as of a pull request.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DISMISS, closeWords, triageButton } from "../../web/src/app/footer.js";

const drafted = { draft: { description: "New body.", comment: "Why." } };
const undrafted = { draft: null };

describe("the send over an issue", () => {
  test("wears the destination's own word for posting", () => {
    assert.equal(triageButton(drafted, "", false, "Post to GitHub").label, "Post to GitHub");
  });

  test("offers to post whatever the draft proposes", () => {
    assert.equal(triageButton(drafted, "", false, "Post").disabled, false);
  });

  test("waits on a draft, and on not already having sent it", () => {
    assert.equal(triageButton(undrafted, "", false, "Post").disabled, true);
    assert.equal(triageButton(drafted, "", true, "Post").disabled, true);
  });

  test("dismissing waits on nothing, as ever", () => {
    assert.deepEqual(triageButton(undrafted, DISMISS, false, "Post"), {
      label: "Dismiss",
      disabled: false,
    });
  });
});

describe("the one line about a proposed close", () => {
  test("names the reason the way GitHub names it", () => {
    assert.equal(closeWords({ reason: "not_planned", of: null }, false), "closes as not planned");
    assert.equal(closeWords({ reason: "completed", of: null }, false), "closes as completed");
  });

  test("a duplicate names the ticket it duplicates", () => {
    assert.equal(
      closeWords({ reason: "duplicate", of: 482 }, false),
      "closes as duplicate of #482",
    );
  });

  test("a dropped close reads as the ticket staying open", () => {
    assert.equal(closeWords({ reason: "completed", of: null }, true), "the ticket stays open");
  });

  test("says nothing when the draft proposes no close", () => {
    assert.equal(closeWords(null, false), "");
  });
});
