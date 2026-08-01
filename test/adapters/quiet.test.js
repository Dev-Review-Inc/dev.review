// A source that has stopped answering.
//
// A listing that fails is not a change, and the adapter is right to leave the
// reader's view of the entries alone. What it may not do is leave that the only
// thing it ever does: a source unreachable for an hour polls eighteen hundred
// times, and nothing else is looking, because health is not re-probed on a
// timer. So the counting lives here, and the point at which a blip has become
// an outage is a number this suite pins down.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Adapter } from "../../web/src/adapters/adapter.js";

class Flaky extends Adapter {
  constructor() {
    super();
    this.entries = [];
    this.broken = false;
  }

  async list() {
    if (this.broken) throw new Error("the bucket did not answer");

    return this.entries;
  }
}

/**
 * Poll a number of times, as the timer would.
 *
 * @param {object} adapter the reader
 * @param {number} rounds how many beats
 * @returns {Promise<void>} when they have all run
 */
async function beats(adapter, rounds) {
  for (let round = 0; round < rounds; round += 1) await adapter.poll();
}

describe("A reader whose listing keeps failing", () => {
  let adapter;
  let told;

  beforeEach(async () => {
    adapter = new Flaky();
    told = [];
    adapter.onTrouble = (trouble) => told.push(trouble);

    adapter.watch("drafts/", () => {});
    await adapter.poll();
  });

  test("says nothing about a blip", async () => {
    adapter.broken = true;
    await beats(adapter, Adapter.QUIET - 1);

    assert.deepEqual(told, []);
  });

  test("says so once it has been failing long enough to matter", async () => {
    adapter.broken = true;
    await beats(adapter, Adapter.QUIET);

    assert.deepEqual(told, [{ ok: false, reason: "the bucket did not answer" }]);
  });

  test("says it once rather than once a beat", async () => {
    adapter.broken = true;
    await beats(adapter, Adapter.QUIET + 40);

    assert.equal(told.length, 1);
  });

  test("says so when the source answers again", async () => {
    adapter.broken = true;
    await beats(adapter, Adapter.QUIET);
    adapter.broken = false;
    await beats(adapter, 2);

    assert.deepEqual(told, [
      { ok: false, reason: "the bucket did not answer" },
      { ok: true, reason: "" },
    ]);
  });

  test("counts each outage on its own, so an answered round is a fresh start", async () => {
    adapter.broken = true;
    await beats(adapter, Adapter.QUIET - 1);
    adapter.broken = false;
    await adapter.poll();
    adapter.broken = true;
    await beats(adapter, Adapter.QUIET - 1);

    assert.deepEqual(told, []);
  });

  test("says so again when a source that came back goes quiet a second time", async () => {
    adapter.broken = true;
    await beats(adapter, Adapter.QUIET);
    adapter.broken = false;
    await adapter.poll();
    adapter.broken = true;
    await beats(adapter, Adapter.QUIET);

    assert.equal(told.length, 3);
    assert.deepEqual(told[2], { ok: false, reason: "the bucket did not answer" });
  });

  test("leaves the reader's view of the entries exactly as it was", async () => {
    const seen = [];

    adapter.entries = [{ path: "drafts/org--app-1/review.json", size: 2, modifiedAt: 1 }];
    adapter.watch("drafts/", (paths) => seen.push(paths));
    await adapter.poll();

    adapter.broken = true;
    await beats(adapter, Adapter.QUIET + 5);
    adapter.broken = false;
    await adapter.poll();

    // Nothing vanished and nothing arrived: the same one draft was there before
    // the outage and after it, so the only news is the watcher's first look.
    assert.deepEqual(seen, [["drafts/org--app-1/review.json"]]);
  });
});
