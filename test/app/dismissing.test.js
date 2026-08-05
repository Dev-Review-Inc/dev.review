// Taking a pull request off the queue, chosen the way a verdict is chosen.
//
// Two rules. The send button never offers to do something that cannot be done,
// and never describes what it is about to do wrongly: posting waits on a draft
// the agent finished, because until then there is nothing to send, and
// dismissing waits on nothing, because the case it exists for is a pull request
// with nothing worth drafting. And a dismissal that has been chosen but not yet
// committed belongs to the pull request it was chosen on, so it cannot follow
// the reader to the next one and take that one off the queue instead.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { choiceHidden, commitButton, DISMISS } from "../../web/src/app/footer.js";
import { aPull, theApp } from "../use-cases/helper.js";

const drafted = { draft: { finishedAt: "2026-07-29T15:41:10Z" } };
const drafting = { draft: { finishedAt: "" } };
const undrafted = { draft: null };

describe("with a verdict chosen", () => {
  test("offers to post the review the agent finished, saying which verdict it would send", () => {
    assert.deepEqual(commitButton(drafted, "COMMENT", false), {
      label: "Comment",
      disabled: false,
    });
  });

  test("will not send a draft that does not exist yet, whatever the verdict", () => {
    assert.equal(commitButton(undrafted, "COMMENT", false).disabled, true);
    assert.equal(commitButton(undrafted, "APPROVE", false).disabled, true);
  });

  test("will not approve a draft the agent is still writing", () => {
    assert.equal(commitButton(drafting, "APPROVE", false).disabled, true);
  });

  test("will not send a review that already went out", () => {
    assert.equal(commitButton(drafted, "COMMENT", true).disabled, true);
  });

  test("has nothing to offer when nothing is open", () => {
    assert.equal(commitButton(null, "", false).disabled, true);
  });
});

// Approving implies having read the whole review, so it alone waits on the
// draft finishing. A comment or a request for changes can be about the part
// already drafted, and does not claim to have seen the rest.
describe("commenting or requesting changes before the draft finishes", () => {
  test("can be sent while the agent is still writing", () => {
    assert.equal(commitButton(drafting, "COMMENT", false).disabled, false);
    assert.equal(commitButton(drafting, "REQUEST_CHANGES", false).disabled, false);
  });

  test("still waits on a draft, and on not already having sent it", () => {
    assert.equal(commitButton(undrafted, "COMMENT", false).disabled, true);
    assert.equal(commitButton(drafting, "COMMENT", true).disabled, true);
  });

  test("approving still waits for the draft to finish", () => {
    assert.equal(commitButton(drafting, "APPROVE", false).disabled, true);
    assert.equal(commitButton(drafted, "APPROVE", false).disabled, false);
  });
});

describe("with dismiss chosen", () => {
  test("says what it will do, which is not posting", () => {
    assert.equal(commitButton(undrafted, DISMISS, false).label, "Dismiss");
  });

  test("can be pressed with no draft at all, which is the whole point", () => {
    assert.equal(commitButton(undrafted, DISMISS, false).disabled, false);
    assert.equal(commitButton(drafting, DISMISS, false).disabled, false);
  });
});

describe("whether a choice is offered in the footer", () => {
  test("dismiss is offered on someone else's pull request", () => {
    assert.equal(choiceHidden(DISMISS, false), false);
  });

  test("dismiss is offered on the reader's own pull request too", () => {
    assert.equal(choiceHidden(DISMISS, true), false);
  });

  test("a verdict other than a comment is withheld on the reader's own pull request", () => {
    assert.equal(choiceHidden("APPROVE", true), true);
    assert.equal(choiceHidden("REQUEST_CHANGES", true), true);
  });

  test("a comment is offered even on the reader's own pull request", () => {
    assert.equal(choiceHidden("COMMENT", true), false);
  });

  test("every verdict is offered on someone else's pull request", () => {
    assert.equal(choiceHidden("APPROVE", false), false);
    assert.equal(choiceHidden("REQUEST_CHANGES", false), false);
    assert.equal(choiceHidden("COMMENT", false), false);
  });
});

describe("a dismissal chosen and not yet committed", () => {
  test("does not follow the reader to the next pull request", async () => {
    const app = await theApp({ pulls: [aPull(), aPull({ number: 43 })] });

    await app.select(app.queue()[0]);
    app.dismissing = true;

    await app.select(app.queue()[1]);

    assert.equal(app.dismissing, false);
  });
});
