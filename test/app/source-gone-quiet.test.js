// What the reader is told when their source stops answering.
//
// The watch is the only thing that keeps asking a source anything once it is
// open: health is probed on boot and never again on a timer. So an outage that
// the watch swallows is an outage nobody in the app knows about, and the reader
// goes on reviewing against a queue that stopped being current.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Adapter } from "../../web/src/adapters/adapter.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, agentWrites, theApp } from "../use-cases/helper.js";

const landed = () => new Promise((resolve) => setTimeout(resolve, 0));

async function beats(adapter, rounds) {
  for (let round = 0; round < rounds; round += 1) {
    await adapter.poll();
    await landed();
  }
}

describe("A source that goes quiet under an open review", () => {
  let app;
  let adapter;
  let said;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    said = [];

    await agentWrites(adapter, aDraft());

    app = await theApp({ adapter, report: (message, tone) => said.push([message, tone]) });
    await app.select(app.queue()[0]);
    await adapter.poll();
    await landed();

    adapter.list = async () => {
      throw new Error("the folder is no longer readable");
    };
  });

  test("is not mentioned while it could still be a blip", async () => {
    await beats(adapter, Adapter.QUIET - 1);

    assert.deepEqual(said, []);
  });

  test("is reported once it has been silent long enough to matter", async () => {
    await beats(adapter, Adapter.QUIET);

    assert.deepEqual(said, [
      ["this source has stopped answering: the folder is no longer readable", "error"],
    ]);
  });

  test("is not reported again for as long as the silence lasts", async () => {
    await beats(adapter, Adapter.QUIET + 30);

    assert.equal(said.length, 1);
  });

  test("is reported as answering again once it does", async () => {
    await beats(adapter, Adapter.QUIET);

    delete adapter.list;
    await beats(adapter, 1);

    assert.deepEqual(said[1], ["this source is answering again", "ok"]);
  });

  test("leaves the open review exactly where the reader had it", async () => {
    const open = app.selected;

    await beats(adapter, Adapter.QUIET + 5);

    assert.equal(app.selected, open);
    assert.equal(app.selected.draft.summary, aDraft().summary);
  });
});
