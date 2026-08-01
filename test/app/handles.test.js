// What the app says when the browser's folder handles cannot be reached.
//
// A directory handle cannot go in the event log, so it is kept beside it in its
// own database and asked for again on the next load. Everything that can go
// wrong with that database used to arrive at the same sentence, "No folder has
// been chosen yet", which blames the reader for a failure that is not theirs
// and points them at a button that will not help.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { App } from "../../web/src/app/app.js";
import { MemoryKeyValueStore } from "../../web/src/state/key-value-store.js";

const FOLDER = { name: "Reviews" };

/**
 * The app, with its handle store swapped for one a test can break.
 *
 * The reader is left real: this is about what a filesystem source says about
 * itself, so the real adapter has to be the one saying it.
 *
 * @param {object} handles what stands in for the handle store
 * @returns {Promise<App>} the app, booted
 */
async function anApp(handles) {
  const app = new App({
    database: () => new MemoryKeyValueStore(),
    handles: { remember: async () => {}, recall: async () => null, forget: async () => {}, ...handles },
  });

  await app.boot();

  return app;
}

function aFilesystemSource(app) {
  return app.addSource({ name: "Work", adapter: { type: "filesystem" }, handle: FOLDER });
}

describe("a folder handle that cannot be read back", () => {
  test("is not reported as a folder the reader never chose", async () => {
    const app = await anApp({
      recall: async () => {
        throw new Error("the handle database is not open");
      },
    });

    await aFilesystemSource(app);

    assert.doesNotMatch(app.problems.source, /No folder has been chosen yet/);
    assert.match(app.problems.source, /the handle database is not open/);
  });

  test("says so on the source's row as well, not only on the open one", async () => {
    const app = await anApp({
      recall: async () => {
        throw new Error("the handle database is not open");
      },
    });

    const source = await aFilesystemSource(app);

    assert.equal(app.healthOf(source).state, "broken");
    assert.match(app.healthOf(source).reason, /the handle database is not open/);
  });

  test("reads differently from a source that has no handle stored at all", async () => {
    const app = await anApp({ recall: async () => null });

    await aFilesystemSource(app);

    assert.match(app.problems.source, /No folder has been chosen yet/);
  });
});

describe("a folder handle that could not be kept", () => {
  // The realistic case is a full disk. A source recorded without its folder
  // comes back on the next load claiming nothing was ever chosen, so the
  // reader is told their disk is fine and their choosing is not.
  test("takes the source back out rather than leaving one with no folder", async () => {
    const app = await anApp({
      remember: async () => {
        throw new Error("QuotaExceededError");
      },
    });

    await assert.rejects(() => aFilesystemSource(app), /QuotaExceededError/);

    assert.deepEqual(app.queries.allSources(), []);
    assert.equal(app.source, null);
  });

  test("keeps the source when the folder was kept", async () => {
    const kept = [];
    const app = await anApp({ remember: async (id, handle) => kept.push([id, handle]) });

    const source = await aFilesystemSource(app);

    assert.deepEqual(app.queries.allSources().map((one) => one.id), [source.id]);
    assert.deepEqual(kept, [[source.id, FOLDER]]);
  });
});
