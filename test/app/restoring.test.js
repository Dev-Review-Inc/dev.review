// Getting back a pull request you took off the queue.
//
// Dismissing is the only way to resolve a pull request there is nothing to say
// about, so it is reached for often and is easy to reach for by mistake. The
// queue leaves dismissed ones out entirely, which is what makes it useful, and
// also what makes an accident feel permanent: the row is simply gone, with
// nothing on screen admitting it ever existed. These two ask the other half of
// the question the queue answers, so the interface can offer a way back.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { theApp, aPull } from "../use-cases/helper.js";

describe("a pull request the reader dismissed", () => {
  test("leaves the queue and is listed as dismissed instead", async () => {
    const pull = aPull();
    const app = await theApp({ pulls: [pull] });

    app.commands.dismissPull(app.source, app.queue()[0]);

    assert.deepEqual(app.queue(), []);
    assert.deepEqual(
      app.dismissed().map((entry) => entry.number),
      [pull.number],
    );
  });

  test("comes back to the queue when it is restored", async () => {
    const pull = aPull();
    const app = await theApp({ pulls: [pull] });
    const entry = app.queue()[0];

    app.commands.dismissPull(app.source, entry);
    app.commands.restorePull(app.source, entry);

    assert.deepEqual(
      app.queue().map((one) => one.number),
      [pull.number],
    );
    assert.deepEqual(app.dismissed(), []);
  });

  // The two lists are the same pull requests split by one decision, so a pull
  // request that is in neither, or in both, means the split is wrong rather
  // than that the reader has lost one.
  test("is in exactly one of the two lists", async () => {
    const kept = aPull({ number: 1 });
    const gone = aPull({ number: 2 });
    const app = await theApp({ pulls: [kept, gone] });

    app.commands.dismissPull(app.source, app.queue().find((one) => one.number === 2));

    assert.deepEqual(app.queue().map((one) => one.number), [1]);
    assert.deepEqual(app.dismissed().map((one) => one.number), [2]);
  });
});
