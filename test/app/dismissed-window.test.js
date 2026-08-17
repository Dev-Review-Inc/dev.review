// How far back the dismissed list reaches.
//
// The list exists to undo a mis-hit, and a mis-hit is noticed in days. Left
// unbounded it turns into an archive of every pull request the reader ever
// resolved by having nothing to say, which is a list nobody reads. The window
// is over the listing only: what it hides is still in the log, still syncs, and
// still keeps its pull request off the queue.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { theApp, aPull } from "../use-cases/helper.js";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Dismiss a pull request at a moment of the test's choosing.
 *
 * The event carries whatever the clock said when it was appended, and there is
 * no way in from outside to hand it a time, so the clock is what moves.
 *
 * @param {object} app the running app
 * @param {number} number which pull request
 * @param {number} time when the reader dismissed it
 * @returns {void}
 */
function dismissAt(app, number, time) {
  const clock = Date.now;

  Date.now = () => time;

  try {
    app.commands.dismissPull(app.source, app.queue().find((one) => one.number === number));
  } finally {
    Date.now = clock;
  }
}

describe("the dismissed list", () => {
  test("lists a pull request dismissed within the last week", async () => {
    const app = await theApp({ pulls: [aPull()] });

    app.commands.dismissPull(app.source, app.queue()[0]);

    const later = Date.now() + 6 * DAY;

    assert.deepEqual(
      app.queries.dismissed(app.source, app.pulls(), later).map((entry) => entry.number),
      [42],
    );
  });

  test("leaves out a pull request dismissed more than a week ago", async () => {
    const app = await theApp({ pulls: [aPull()] });

    app.commands.dismissPull(app.source, app.queue()[0]);

    const later = Date.now() + 8 * DAY;

    assert.deepEqual(app.queries.dismissed(app.source, app.pulls(), later), []);
  });

  // The one that says the window is a display window. If ageing out ever became
  // a deletion, or the filter ever leaked into queue, this is what would catch
  // it: the pull request is in neither list, which is what a dismissal means.
  test("keeps a pull request it has stopped listing off the queue", async () => {
    const app = await theApp({ pulls: [aPull()] });

    app.commands.dismissPull(app.source, app.queue()[0]);

    const later = Date.now() + 400 * DAY;

    assert.deepEqual(app.queries.dismissed(app.source, app.pulls(), later), []);
    assert.deepEqual(app.queue(), []);
  });

  // The times here straddle the point where epoch milliseconds grow a digit,
  // so a compare that sorts them as text puts the oldest first.
  test("lists the newest dismissal first", async () => {
    const app = await theApp({
      pulls: [aPull({ number: 1 }), aPull({ number: 2 }), aPull({ number: 3 })],
    });

    dismissAt(app, 1, 9_999_999_999_999);
    dismissAt(app, 2, 10_000_000_000_000);
    dismissAt(app, 3, 10_000_000_000_001);

    assert.deepEqual(
      app.queries
        .dismissed(app.source, app.pulls(), 10_000_000_000_002)
        .map((entry) => entry.number),
      [3, 2, 1],
    );
  });

  // Seven days to the millisecond is out. The boundary has to fall somewhere
  // and a dismissal exactly a week old is a week old.
  test("draws the line at seven days", async () => {
    const app = await theApp({ pulls: [aPull()] });

    app.commands.dismissPull(app.source, app.queue()[0]);

    const at = app.dismissed()[0].dismissedAt;

    assert.equal(app.queries.dismissed(app.source, app.pulls(), at + 7 * DAY - 1).length, 1);
    assert.equal(app.queries.dismissed(app.source, app.pulls(), at + 7 * DAY).length, 0);
  });
});
