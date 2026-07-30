// One suite, every adapter.
//
// Adding a third backend should be an afternoon, and it is only an afternoon if
// "does it behave like the others" is a question something else answers. Every
// adapter is run through this, so a backend either conforms or fails out loud.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

const bytes = (text) => new TextEncoder().encode(text);
const text = (value) => new TextDecoder().decode(value);

/**
 * Run the adapter contract against one backend.
 *
 * @param {string} name what to call it in the output
 * @param {() => Promise<object>} build makes a fresh, empty adapter
 */
export function itBehavesLikeAnAdapter(name, build) {
  describe(`${name} adapter`, () => {
    let adapter;

    beforeEach(async () => {
      adapter = await build();
    });

    test("reads back what it wrote", async () => {
      await adapter.write("drafts/org--app-1/review.json", bytes("{}"));

      assert.equal(text(await adapter.read("drafts/org--app-1/review.json")), "{}");
    });

    test("reports a missing path as nothing rather than an error", async () => {
      assert.equal(await adapter.read("drafts/nothing/review.json"), null);
    });

    test("overwrites in place", async () => {
      await adapter.write("a.json", bytes("first"));
      await adapter.write("a.json", bytes("second"));

      assert.equal(text(await adapter.read("a.json")), "second");
    });

    test("lists what is under a prefix, and nothing else", async () => {
      await adapter.write("drafts/org--app-1/review.json", bytes("{}"));
      await adapter.write("drafts/org--app-2/review.json", bytes("{}"));
      await adapter.write("events/device-a.jsonl", bytes(""));

      const listed = (await adapter.list("drafts/")).map((entry) => entry.path).sort();

      assert.deepEqual(listed, [
        "drafts/org--app-1/review.json",
        "drafts/org--app-2/review.json",
      ]);
    });

    test("lists everything when asked for no prefix", async () => {
      await adapter.write("drafts/org--app-1/review.json", bytes("{}"));
      await adapter.write("events/device-a.jsonl", bytes(""));

      assert.equal((await adapter.list("")).length, 2);
    });

    test("lists nothing under a prefix nothing was written to", async () => {
      assert.deepEqual(await adapter.list("drafts/"), []);
    });

    test("says how big each listed entry is, so a change can be spotted", async () => {
      await adapter.write("a.json", bytes("hello"));

      const [entry] = await adapter.list("");

      assert.equal(entry.size, 5);
      assert.equal(typeof entry.modifiedAt, "number");
    });

    test("removes a path", async () => {
      await adapter.write("a.json", bytes("{}"));

      await adapter.remove("a.json");

      assert.equal(await adapter.read("a.json"), null);
      assert.deepEqual(await adapter.list(""), []);
    });

    test("removing what is not there is not an error", async () => {
      await assert.doesNotReject(() => adapter.remove("a.json"));
    });

    test("keeps bytes intact rather than mangling them as text", async () => {
      const payload = new Uint8Array([0, 1, 2, 250, 255]);

      await adapter.write("run.mp4", payload);

      assert.deepEqual(await adapter.read("run.mp4"), payload);
    });

    test("hands media over as a url that can be released", async () => {
      await adapter.write("run.mp4", bytes("not really a video"));

      const media = await adapter.media("run.mp4");

      assert.equal(typeof media.url, "string");
      assert.doesNotThrow(() => media.release());
    });

    test("has no media for a path holding nothing", async () => {
      assert.equal(await adapter.media("run.mp4"), null);
    });

    test("tells a watcher what is already there on its first look", async () => {
      await adapter.write("drafts/org--app-1/review.json", bytes("{}"));
      const seen = [];

      const stop = adapter.watch("drafts/", (paths) => seen.push(paths));
      await adapter.poll();

      stop();

      assert.deepEqual(seen, [["drafts/org--app-1/review.json"]]);
    });

    test("tells a watcher what arrived under its prefix", async () => {
      const seen = [];
      const stop = adapter.watch("drafts/", (paths) => seen.push(paths));
      await adapter.poll();

      await adapter.write("drafts/org--app-1/review.json", bytes("{}"));
      await adapter.poll();

      stop();

      assert.deepEqual(seen, [["drafts/org--app-1/review.json"]]);
    });

    test("says nothing on a first look at a prefix holding nothing", async () => {
      const seen = [];
      const stop = adapter.watch("drafts/", (paths) => seen.push(paths));

      await adapter.poll();

      stop();

      assert.deepEqual(seen, []);
    });

    test("notices a change of size", async () => {
      await adapter.write("drafts/org--app-1/review.json", bytes("aaaa"));
      const seen = [];
      const stop = adapter.watch("drafts/", (paths) => seen.push(paths));
      await adapter.poll();
      seen.length = 0;

      await adapter.write("drafts/org--app-1/review.json", bytes("aaaaa"));
      await adapter.poll();

      stop();
      assert.deepEqual(seen, [["drafts/org--app-1/review.json"]]);
    });

    test("says nothing to a watcher when nothing changed", async () => {
      const seen = [];
      await adapter.write("drafts/org--app-1/review.json", bytes("{}"));
      const stop = adapter.watch("drafts/", (paths) => seen.push(paths));
      await adapter.poll();
      seen.length = 0;

      await adapter.poll();

      stop();
      assert.deepEqual(seen, []);
    });

    // Only backends that hand over an entity tag can see this. The others
    // offer time and size, and two same-length writes in one millisecond are
    // genuinely indistinguishable to them.
    test("notices a rewrite of the same size when it can", async (t) => {
      if (!adapter.precise) return t.skip("this backend has only time and size to go on");

      await adapter.write("drafts/org--app-1/review.json", bytes("aaaa"));
      const seen = [];
      const stop = adapter.watch("drafts/", (paths) => seen.push(paths));
      await adapter.poll();
      seen.length = 0;

      await adapter.write("drafts/org--app-1/review.json", bytes("bbbb"));
      await adapter.poll();

      stop();
      assert.deepEqual(seen, [["drafts/org--app-1/review.json"]]);
    });

    test("tells a watcher when something it was watching went away", async () => {
      await adapter.write("drafts/org--app-1/review.json", bytes("{}"));
      const seen = [];
      const stop = adapter.watch("drafts/", (paths) => seen.push(paths));
      await adapter.poll();
      seen.length = 0;

      await adapter.remove("drafts/org--app-1/review.json");
      await adapter.poll();

      stop();
      assert.deepEqual(seen, [["drafts/org--app-1/review.json"]]);
    });

    test("stops telling a watcher that has stopped listening", async () => {
      const seen = [];
      const stop = adapter.watch("drafts/", (paths) => seen.push(paths));

      stop();
      await adapter.write("drafts/org--app-1/review.json", bytes("{}"));
      await adapter.poll();

      assert.deepEqual(seen, []);
    });

    test("describes itself well enough to be rebuilt", async () => {
      const config = adapter.config();

      assert.equal(typeof config.type, "string");
      assert.ok(config.type.length);
    });

    test("refuses a path that would climb out of its root", async () => {
      for (const path of ["../secrets", "/etc/passwd", "drafts/../../x", "~/.ssh/id_rsa"]) {
        await assert.rejects(() => adapter.read(path), /outside/, `read ${path}`);
        await assert.rejects(() => adapter.write(path, bytes("x")), /outside/, `write ${path}`);
      }
    });
  });
}
