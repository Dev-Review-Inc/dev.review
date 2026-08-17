// Being asked to look again at something you already dealt with.
//
// A posted review dismisses the pull request, so everything the reader has ever
// reviewed carries a dismissal for ever. GitHub puts a pull request back in
// front of them when someone re-requests their review, and a dismissal that
// outlives that request is the app hiding the one thing they were asked for.
// These hold the line on where a dismissal stops counting, and on the two cases
// that must not move: a request with nothing new behind it, and the reader's
// own pull request, which they dismissed knowing they would go on pushing to it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { draftKey } from "../../web/src/domain/draft-path.js";
import { EventStoreEvent } from "../../web/src/state/event-store-event.js";
import { theApp, aPull } from "../use-cases/helper.js";

// The rule compares two clocks, so both are written down rather than left to
// read "now" and race each other. Relative to the real clock rather than a
// fixed calendar date: DISMISSED_WINDOW (queries/index.js) measures against
// the real Date.now(), so a hardcoded past date quietly ages out of it the
// moment more real time separates "now" from that date than the window
// allows - this file's own dates did exactly that.
const HOUR = 60 * 60 * 1000;
const DISMISSED_AT = Date.now() - HOUR;
const BEFORE = new Date(DISMISSED_AT - HOUR).toISOString();
const AFTER = new Date(DISMISSED_AT + HOUR).toISOString();

/**
 * Dismiss a pull request at a definite moment, as the reader did then.
 *
 * @param {object} app the app
 * @param {object} pull which pull request
 * @param {number} time when it was dismissed
 * @returns {Promise<void>} when the log holds it
 */
function dismissedAt(app, pull, time) {
  const key = draftKey(pull.owner, pull.repo, pull.number);

  return app.state.absorb(app.source.id, [
    new EventStoreEvent("pulls", key, "dismiss", null, time),
  ]);
}

describe("a dismissed pull request whose review is requested again", () => {
  test("comes back to the queue once it has moved since the dismissal", async () => {
    const pull = aPull({ isRequested: true, updatedAt: AFTER });
    const app = await theApp({ pulls: [pull] });

    await dismissedAt(app, pull, DISMISSED_AT);

    assert.deepEqual(
      app.queue().map((one) => one.number),
      [pull.number],
    );
    assert.deepEqual(app.dismissed(), []);
  });

  test("stays dismissed while nothing has changed upstream", async () => {
    const pull = aPull({ isRequested: true, updatedAt: BEFORE });
    const app = await theApp({ pulls: [pull] });

    await dismissedAt(app, pull, DISMISSED_AT);

    assert.deepEqual(app.queue(), []);
    assert.deepEqual(
      app.dismissed().map((one) => one.number),
      [pull.number],
    );
  });

  // The reader has seen it come back and taken it off again. The second
  // dismissal answers the same request the first one did not.
  test("goes quiet again when the reader dismisses it a second time", async () => {
    const pull = aPull({ isRequested: true, updatedAt: AFTER });
    const app = await theApp({ pulls: [pull] });

    await dismissedAt(app, pull, DISMISSED_AT);
    app.commands.dismissPull(app.source, app.queue()[0]);

    assert.deepEqual(app.queue(), []);
    assert.deepEqual(
      app.dismissed().map((one) => one.number),
      [pull.number],
    );
  });
});

describe("a dismissed pull request of the reader's own", () => {
  // The common case in the dismissed list, and the one that treating any
  // upstream change as a reason to come back would ruin: the reader pushes to
  // their own branch all day.
  test("stays dismissed however often it is pushed to", async () => {
    const pull = aPull({ isRequested: false, author: "reader", updatedAt: AFTER });
    const app = await theApp({ pulls: [pull] });

    await dismissedAt(app, pull, DISMISSED_AT);

    assert.deepEqual(app.queue(), []);
    assert.deepEqual(
      app.dismissed().map((one) => one.number),
      [pull.number],
    );
  });
});
