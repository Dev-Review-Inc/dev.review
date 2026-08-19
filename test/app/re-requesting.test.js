// Being asked to look again at something you already dealt with.
//
// A posted review dismisses the pull request, so everything the reader has ever
// reviewed carries a dismissal for ever. On a draft-driven queue the new
// question is the sweep drafting again: a dismissal records the draftedAt it
// answered, a different draft brings one back, and the same draft stays quiet.
// The raw events written here carry no such record, which is exactly what a
// log from before the payload existed looks like - these tests pin that the
// old time comparison still decides for those.

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

  // A raw dismiss event with no payload is one written before dismissals
  // recorded which draft they answered. On that path the time comparison
  // still decides - but a stamp from the future is a lie about the clock,
  // and a lie does not outvote the reader.
  test("a legacy dismissal ignores a claimed movement in the future", async () => {
    const future = new Date(Date.now() + 4 * HOUR).toISOString();
    const pull = aPull({ isRequested: true, updatedAt: future });
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

describe("a pull request the reader posted on", () => {
  // Posting spends the question for good: a redraft revives a plain
  // dismissal, but "review it again" after a post is the reader's explicit
  // gesture (clearing the draft), never a sweep side-effect.
  test("stays off the queue however new the redraft is", async () => {
    const pull = aPull({ isRequested: true, updatedAt: AFTER });
    const app = await theApp({ pulls: [pull] });
    const key = draftKey(pull.owner, pull.repo, pull.number);

    await app.state.absorb(app.source.id, [
      new EventStoreEvent("pulls", key, "post", { url: "https://github.com/org/app/pull/42#r1", event: "COMMENT" }, DISMISSED_AT),
      new EventStoreEvent("pulls", key, "dismiss", null, DISMISSED_AT),
    ]);

    assert.deepEqual(app.queue(), []);
    assert.deepEqual(
      app.dismissed().map((one) => one.number),
      [pull.number],
    );
  });
});

describe("a dismissed pull request of the reader's own", () => {
  // Every draft is waiting on the reader, their own work included, so the old
  // carve-out for one's own pull request is gone. What cannot revive it is a
  // push: pushes never touch this queue, only the sweep drafting again does.
  test("stays dismissed until the sweep drafts it again", async () => {
    const pull = aPull({ author: "reader", updatedAt: BEFORE });
    const app = await theApp({ pulls: [pull] });

    await dismissedAt(app, pull, DISMISSED_AT);

    assert.deepEqual(app.queue(), []);
    assert.deepEqual(
      app.dismissed().map((one) => one.number),
      [pull.number],
    );
  });
});
