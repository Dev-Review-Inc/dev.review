import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { itBehavesLikeAnAdapter } from "./conformance.js";
import { makeDirectoryHandle } from "./fake-directory-handle.js";
import { FilesystemAdapter } from "../../web/src/adapters/filesystem.js";

const bytes = (text) => new TextEncoder().encode(text);
const text = (value) => new TextDecoder().decode(value);

itBehavesLikeAnAdapter(
  "filesystem",
  () => new FilesystemAdapter({ label: "Reviews" }, makeDirectoryHandle()),
);

describe("filesystem adapter, on its own terms", () => {
  let handle;
  let adapter;

  beforeEach(() => {
    handle = makeDirectoryHandle();
    adapter = new FilesystemAdapter({ label: "Reviews" }, handle);
  });

  test("makes the directories a nested path needs", async () => {
    await adapter.write("drafts/org--app-1/qa/run.json", bytes("{}"));

    const drafts = await handle.getDirectoryHandle("drafts");
    const app = await drafts.getDirectoryHandle("org--app-1");
    const qa = await app.getDirectoryHandle("qa");

    assert.deepEqual(await qa.keys().next(), { value: "run.json", done: false });
    assert.equal(text(await adapter.read("drafts/org--app-1/qa/run.json")), "{}");
  });

  test("reads nothing from a path whose directories were never made", async () => {
    assert.equal(await adapter.read("drafts/org--app-1/qa/run.json"), null);
  });

  test("lists files and not the directories holding them", async () => {
    await adapter.write("drafts/org--app-1/review.json", bytes("{}"));

    const listed = await adapter.list("");

    assert.deepEqual(
      listed.map((entry) => entry.path),
      ["drafts/org--app-1/review.json"],
    );
  });

  test("keeps the handle out of the configuration it hands over to be saved", () => {
    const config = adapter.config();

    assert.deepEqual(config, { type: "filesystem", label: "Reviews" });
    assert.equal(JSON.parse(JSON.stringify(config)).type, "filesystem");
  });

  test("is ready when the folder is still granted", async () => {
    assert.deepEqual(await adapter.ready(), { ok: true, reason: "" });
  });

  test("is not ready when permission has lapsed back to a prompt", async () => {
    const lapsed = new FilesystemAdapter({}, makeDirectoryHandle({ permission: "prompt" }));

    const ready = await lapsed.ready();

    assert.equal(ready.ok, false);
    assert.match(ready.reason, /permission/i);
  });

  test("is not ready when permission was refused", async () => {
    const refused = new FilesystemAdapter({}, makeDirectoryHandle({ permission: "denied" }));

    const ready = await refused.ready();

    assert.equal(ready.ok, false);
    assert.match(ready.reason, /permission/i);
  });

  test("never prompts while only asking whether it is ready", async () => {
    const lapsed = makeDirectoryHandle({ permission: "prompt" });

    await new FilesystemAdapter({}, lapsed).ready();

    assert.equal(lapsed.state.requests, 0);
  });

  test("prompts only when asked to, because that needs a gesture behind it", async () => {
    const lapsed = makeDirectoryHandle({ permission: "prompt", answer: "granted" });
    const waiting = new FilesystemAdapter({}, lapsed);

    const ready = await waiting.request();

    assert.equal(lapsed.state.requests, 1);
    assert.deepEqual(ready, { ok: true, reason: "" });
  });

  test("stays unready when the prompt is refused", async () => {
    const lapsed = makeDirectoryHandle({ permission: "prompt", answer: "denied" });

    const ready = await new FilesystemAdapter({}, lapsed).request();

    assert.equal(ready.ok, false);
  });

  // A handle store this browser cannot read and a folder that was never chosen
  // both arrive here as no handle, and blaming the reader for the first is the
  // one answer they cannot act on.
  test("says the folder was never chosen when no handle was ever stored", async () => {
    const ready = await new FilesystemAdapter({ label: "Reviews" }, null).ready();

    assert.equal(ready.ok, false);
    assert.match(ready.reason, /No folder has been chosen yet/);
  });

  test("says the folder could not be read back when the handle store failed", async () => {
    const broken = new FilesystemAdapter(
      { label: "Reviews" },
      new Error("the database is not open"),
    );

    const ready = await broken.ready();

    assert.equal(ready.ok, false);
    assert.doesNotMatch(ready.reason, /No folder has been chosen yet/);
    assert.match(ready.reason, /Reviews/);
    assert.match(ready.reason, /the database is not open/);
  });

  test("asking again for a folder it could not read back says the same thing", async () => {
    const broken = new FilesystemAdapter(
      { label: "Reviews" },
      new Error("the database is not open"),
    );

    assert.deepEqual(await broken.request(), await broken.ready());
  });

  test("hands a recording to the object url as a file, never as its bytes", async () => {
    await adapter.write("qa/run.mp4", bytes("not really a video"));
    const given = [];

    URL.createObjectURL = (value) => {
      given.push(value);

      return "blob:fake";
    };
    URL.revokeObjectURL = () => {};

    try {
      const media = await adapter.media("qa/run.mp4");

      assert.equal(media.url, "blob:fake");
      assert.equal(given.length, 1);
      assert.equal(given[0].name, "run.mp4");
      assert.equal(given[0].size, 18);
      assert.equal(handle.state.bytesRead, 0, "the file was pulled into memory to be played");

      assert.doesNotThrow(() => media.release());
    } finally {
      delete URL.createObjectURL;
      delete URL.revokeObjectURL;
    }
  });
});
