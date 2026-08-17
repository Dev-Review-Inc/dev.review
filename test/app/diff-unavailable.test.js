// What opening a pull request says when the destination would not give up the
// diff.
//
// The diff and the head commit are wanted but not required, and that is right:
// a draft is readable without either, and a destination that is rate limiting
// must not stop a reader reading. But a fetch that failed and a pull request
// that changed nothing draw identically, so not throwing has to mean saying,
// not saying nothing. Without that the reader reads "no files" off a rate
// limit, and the head commit's failure waits to surface until they try to post.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { App } from "../../web/src/app/app.js";
import { MemoryKeyValueStore } from "../../web/src/state/key-value-store.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, agentWrites } from "../use-cases/helper.js";

const FILES = [{ filename: "lib/error.rb", additions: 3, deletions: 1, patch: "" }];

// A destination that answers the queue but can be made to refuse the two
// things `select` asks for after it, each on its own.
async function anAppWhoseDestination({ files, headCommit }) {
  const adapter = new MemoryAdapter();

  await agentWrites(adapter, aDraft());

  const app = new App({
    database: () => new MemoryKeyValueStore(),
    adapter: () => adapter,
    destination: () => ({
      identify: async () => ({ login: "reader" }),
      files,
      headCommit,
    }),
  });

  await app.boot();
  await app.addDestination({ type: "github", label: "GitHub", secret: { token: "x" } });
  await app.addSource({ name: "Work", adapter: { type: "memory" } });

  return app;
}

const refuse = (what) => async () => {
  throw new Error(`the api answered 403 for the ${what}`);
};

describe("a diff the destination would not give up", () => {
  test("lets the reader go on reading the draft", async () => {
    const app = await anAppWhoseDestination({
      files: refuse("files"),
      headCommit: async () => "e612b1b",
    });

    await app.select(app.queue()[0]);

    assert.equal(app.selected.draft.verdict, "COMMENT");
  });

  test("is not left looking like a pull request that changed nothing", async () => {
    const app = await anAppWhoseDestination({
      files: refuse("files"),
      headCommit: async () => "e612b1b",
    });

    await app.select(app.queue()[0]);

    assert.match(app.diffProblem, /403/);
  });

  // The head commit is what a finding is anchored to. Its failure is silent
  // until the reader presses post, which is the worst moment to learn of it.
  test("says so when it was the head commit that could not be fetched", async () => {
    const app = await anAppWhoseDestination({
      files: async () => FILES,
      headCommit: refuse("head commit"),
    });

    await app.select(app.queue()[0]);

    assert.match(app.diffProblem, /403/);
    // The files did arrive, so they are still shown.
    assert.equal(app.files.length, 1);
  });

  test("says nothing when both arrived", async () => {
    const app = await anAppWhoseDestination({
      files: async () => FILES,
      headCommit: async () => "e612b1b",
    });

    await app.select(app.queue()[0]);

    assert.equal(app.diffProblem, "");
  });

  // Opening a second pull request that is fine must not carry the first one's
  // complaint over, the way the source and destination problems are cleared.
  test("is dropped when another pull request is opened", async () => {
    let refusing = true;
    const app = await anAppWhoseDestination({
      files: async () => {
        if (refusing) throw new Error("the api answered 403 for the files");

        return FILES;
      },
      headCommit: async () => "e612b1b",
    });

    await app.select(app.queue()[0]);
    refusing = false;
    await app.select(app.queue()[0]);

    assert.equal(app.diffProblem, "");
  });
});
