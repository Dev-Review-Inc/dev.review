// The desktop reader, without a desktop.
//
// The Rust half is covered by its own unit tests. What is left to prove here is
// that the JavaScript half is interchangeable with the other backends, so the
// full conformance suite runs against the real adapter with a stand-in for the
// IPC boundary. The stand-in refuses the same paths the Rust side refuses, so a
// test cannot pass by being handed a more forgiving filesystem than the real
// one.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { itBehavesLikeAnAdapter } from "./conformance.js";
import { TauriAdapter, inTauri, chooseRoot } from "../../web/src/adapters/tauri.js";

const bytes = (text) => new TextEncoder().encode(text);

function outside(path) {
  const value = String(path ?? "");

  return (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.startsWith("~") ||
    /^[A-Za-z]:/.test(value) ||
    value.split(/[/\\]/).includes("..")
  );
}

/**
 * A stand-in for the Rust commands, keeping files in a Map.
 *
 * @param {object} [options] extras the real shell has
 * @param {(path: string) => string} [options.convertFileSrc] the asset protocol
 * @returns {{files: Map<string, object>, calls: object[], api: object}} the fake
 */
function fakeTauri({ convertFileSrc } = {}) {
  const files = new Map();
  const calls = [];

  const commands = {
    storage_pick_root: () => "/Users/someone/Reviews",

    storage_list: ({ prefix }) =>
      [...files.entries()]
        .filter(([path]) => path.startsWith(prefix ?? ""))
        .map(([path, file]) => ({
          path,
          size: file.bytes.length,
          modified_at: file.modifiedAt,
        })),

    storage_read: ({ path }) => {
      const file = files.get(path);

      return file ? [...file.bytes] : null;
    },

    storage_write: ({ path, bytes: written }) => {
      files.set(path, { bytes: Uint8Array.from(written), modifiedAt: Date.now() });

      return null;
    },

    storage_remove: ({ path }) => {
      files.delete(path);

      return null;
    },
  };

  const api = {
    core: {
      async invoke(command, args = {}) {
        calls.push({ command, args });

        const run = commands[command];

        if (!run) throw new Error(`no such command: ${command}`);

        if (command !== "storage_pick_root" && !args.root) {
          throw new Error("no folder has been chosen");
        }

        if (args.path != null && outside(args.path)) {
          throw new Error(`path is outside the source: ${args.path}`);
        }

        return run(args);
      },
    },
  };

  if (convertFileSrc) api.core.convertFileSrc = convertFileSrc;

  return { files, calls, api };
}

itBehavesLikeAnAdapter("tauri", () => {
  globalThis.__TAURI__ = fakeTauri().api;

  return new TauriAdapter({ root: "/Users/someone/Reviews" });
});

describe("tauri adapter, on the desktop", () => {
  let fake;

  beforeEach(() => {
    // Spelled the way Tauri v2 spells it, so the encoding is under test too.
    fake = fakeTauri({ convertFileSrc: (path) => `asset://localhost/${encodeURIComponent(path)}` });
    globalThis.__TAURI__ = fake.api;
  });

  afterEach(() => {
    delete globalThis.__TAURI__;
  });

  test("knows it is running inside the desktop app", () => {
    assert.equal(inTauri(), true);

    delete globalThis.__TAURI__;

    assert.equal(inTauri(), false);
  });

  test("streams media off disk rather than through the ipc boundary", async () => {
    const adapter = new TauriAdapter({ root: "/Users/someone/Reviews" });
    await adapter.write("run.mp4", bytes("not really a video"));
    fake.calls.length = 0;

    const media = await adapter.media("run.mp4");

    assert.equal(
      media.url,
      `asset://localhost/${encodeURIComponent("/Users/someone/Reviews/run.mp4")}`,
    );
    assert.ok(!fake.calls.some((call) => call.command === "storage_read"));
  });

  test("has no media for a path holding nothing, even with the asset protocol", async () => {
    const adapter = new TauriAdapter({ root: "/Users/someone/Reviews" });

    assert.equal(await adapter.media("run.mp4"), null);
  });

  test("sends the chosen folder with every call", async () => {
    const adapter = new TauriAdapter({ root: "/Users/someone/Reviews" });

    await adapter.list("");

    assert.equal(fake.calls[0].args.root, "/Users/someone/Reviews");
  });

  test("asks the platform for a folder", async () => {
    assert.equal(await chooseRoot(), "/Users/someone/Reviews");
  });

  test("describes itself well enough to be rebuilt with the same folder", () => {
    const adapter = new TauriAdapter({ root: "/Users/someone/Reviews" });

    assert.deepEqual(new TauriAdapter(adapter.config()).config(), adapter.config());
  });

  test("is not ready until a folder is chosen", async () => {
    assert.equal((await new TauriAdapter().ready()).ok, false);
    assert.equal((await new TauriAdapter({ root: "/Users/someone/Reviews" }).ready()).ok, true);
  });

  test("is not ready outside the desktop app", async () => {
    delete globalThis.__TAURI__;

    assert.equal((await new TauriAdapter({ root: "/Users/someone/Reviews" }).ready()).ok, false);
  });
});
