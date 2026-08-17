// Being asked to look again at something whose draft is gone.
//
// A posted review dismisses the pull request, and the draft that put it on
// the queue is eventually pruned or cleared. The dismissed list used to be
// built by filtering the queue's own entries, so the moment the draft went,
// this app's own record of ever having reviewed it went with it. What is
// dismissed is read from what this app decided, not from whichever drafts
// the storage happens to still hold.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { theApp, aPull } from "../use-cases/helper.js";

describe("a pull request whose draft is gone", () => {
  test("still shows in the dismissed list once dismissed", async () => {
    const pull = aPull();
    const app = await theApp({ pulls: [pull] });

    app.commands.dismissPull(app.source, app.queue()[0]);

    assert.deepEqual(
      app.queries.dismissed(app.source, [], Date.now()).map((entry) => entry.number),
      [pull.number],
    );
  });

  test("still shows in the dismissed list once a review is posted for it", async () => {
    const pull = aPull();
    const app = await theApp({ pulls: [pull] });

    await app.commands.recordPostedReview(app.source, app.queue()[0], {
      url: "https://github.com/org/app/pull/42#pullrequestreview-1",
      event: "COMMENT",
    });

    assert.deepEqual(
      app.queries.dismissed(app.source, [], Date.now()).map((entry) => entry.number),
      [pull.number],
    );
  });

  test("carries enough of an identity to be opened and read again", async () => {
    const pull = aPull();
    const app = await theApp({ pulls: [pull] });
    app.commands.dismissPull(app.source, app.queue()[0]);

    const [entry] = app.queries.dismissed(app.source, [], Date.now());

    assert.equal(entry.owner, pull.owner);
    assert.equal(entry.repo, pull.repo);
    assert.equal(entry.number, pull.number);
    assert.equal(entry.url, pull.url);

    await app.select(entry);

    assert.equal(app.selected.number, pull.number);
  });

  // Restoring means putting a pull request back on the queue, and there is no
  // queue to put one back on once the destination has stopped listing it -
  // restoring it anyway clears the one thing keeping it in this list, with
  // nowhere else for it to reappear. It has to say so rather than let the row
  // offer a way out that quietly deletes the row instead.
  test("cannot be restored, since there is nowhere left to restore it to", async () => {
    const pull = aPull();
    const app = await theApp({ pulls: [pull] });
    app.commands.dismissPull(app.source, app.queue()[0]);

    const [entry] = app.queries.dismissed(app.source, [], Date.now());

    assert.equal(entry.restorable, false);
  });
});

describe("a dismissed pull request whose draft is still held", () => {
  test("can be restored", async () => {
    const pull = aPull();
    const app = await theApp({ pulls: [pull] });
    app.commands.dismissPull(app.source, app.queue()[0]);

    const [entry] = app.queries.dismissed(app.source, [pull], Date.now());

    assert.equal(entry.restorable, true);
  });
});
