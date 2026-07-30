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

import { commitButton, DISMISS } from "../../web/src/app/footer.js";
import { aPull, theApp } from "../use-cases/helper.js";

const drafted = { draft: { finishedAt: "2026-07-29T15:41:10Z" } };
const drafting = { draft: { finishedAt: "" } };
const undrafted = { draft: null };

describe("with a verdict chosen", () => {
  test("offers to post the review the agent finished", () => {
    assert.deepEqual(commitButton(drafted, "COMMENT", false), {
      label: "Post review",
      disabled: false,
    });
  });

  test("will not send a draft the agent is still writing", () => {
    assert.equal(commitButton(drafting, "COMMENT", false).disabled, true);
    assert.equal(commitButton(undrafted, "COMMENT", false).disabled, true);
  });

  test("will not send a review that already went out", () => {
    assert.equal(commitButton(drafted, "COMMENT", true).disabled, true);
  });

  test("has nothing to offer when nothing is open", () => {
    assert.equal(commitButton(null, "", false).disabled, true);
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

describe("a dismissal chosen and not yet committed", () => {
  test("does not follow the reader to the next pull request", async () => {
    const app = await theApp({ pulls: [aPull(), aPull({ number: 43 })] });

    await app.select(app.queue()[0]);
    app.dismissing = true;

    await app.select(app.queue()[1]);

    assert.equal(app.dismissing, false);
  });
});
