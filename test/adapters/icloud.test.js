// This app's own iCloud container, without one.
//
// The Rust half (src-tauri/src/icloud.rs) is covered by nothing here - it has
// no test harness this suite can reach, and no simulator on this machine has
// ever been signed into iCloud to exercise it against a real container. What's
// under test is the JavaScript half: that it behaves like every other adapter
// once a root exists, and that it tells the truth about why it does not have
// one everywhere else.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { itBehavesLikeAnAdapter } from "./conformance.js";
import { ICloudAdapter, icloudRoot, unavailability } from "../../web/src/adapters/icloud.js";

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15";

function fakeNavigator(userAgent) {
  Object.defineProperty(globalThis, "navigator", { value: { userAgent }, configurable: true });
}

/**
 * A stand-in for icloud_root plus the storage_* commands it hands its root
 * to - the same fake shape test/adapters/tauri.test.js's fakeTauri() builds,
 * with one command added.
 *
 * @param {{root?: string|null}} [options] what icloud_root answers
 * @returns {{files: Map<string, object>, calls: object[], api: object}} the fake
 */
function fakeTauri({ root = "/private/var/mobile/Containers/Data/.../Documents" } = {}) {
  const files = new Map();
  const calls = [];

  const commands = {
    icloud_root: () => root,

    storage_list: ({ prefix }) =>
      [...files.entries()]
        .filter(([path]) => path.startsWith(prefix ?? ""))
        .map(([path, file]) => ({ path, size: file.bytes.length, modified_at: file.modifiedAt })),

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

        return run(args);
      },
    },
  };

  return { files, calls, api };
}

describe("iCloud adapter, once attached", () => {
  let realNavigator;

  beforeEach(async () => {
    realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    fakeNavigator(IOS_UA);
    globalThis.__TAURI__ = fakeTauri().api;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", realNavigator);
    delete globalThis.__TAURI__;
  });

  itBehavesLikeAnAdapter("icloud", async () => {
    const adapter = new ICloudAdapter();

    await adapter.ready();

    return adapter;
  });

  test("resolves its root through ready(), not through config", async () => {
    const adapter = new ICloudAdapter();

    assert.deepEqual(adapter.config(), { type: "icloud", label: "iCloud Drive" });

    await adapter.ready();

    // Answers at all, rather than throwing "no folder has been chosen" the
    // way TauriAdapter would with an empty _root - proof ready() actually
    // set one, not just that it reported ok.
    assert.deepEqual(await adapter.list(""), []);
  });
});

describe("iCloud root resolution", () => {
  let realNavigator;

  beforeEach(() => {
    realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", realNavigator);
    delete globalThis.__TAURI__;
  });

  test("is ready once a root comes back", async () => {
    fakeNavigator(IOS_UA);
    globalThis.__TAURI__ = fakeTauri({ root: "/some/container/Documents" }).api;

    const adapter = new ICloudAdapter();
    const state = await adapter.ready();

    assert.deepEqual(state, { ok: true, reason: "" });
  });

  test("names iCloud itself, not this app, when there is no root to resolve", async () => {
    fakeNavigator(IOS_UA);
    globalThis.__TAURI__ = fakeTauri({ root: null }).api;

    const adapter = new ICloudAdapter();
    const state = await adapter.ready();

    assert.equal(state.ok, false);
    assert.match(state.reason, /iCloud/);
  });

  test("is not ready outside the iOS app, even carrying a root from a previous session", async () => {
    fakeNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");
    globalThis.__TAURI__ = fakeTauri().api;

    const adapter = new ICloudAdapter({ root: "/stale/from/last/time" });
    const state = await adapter.ready();

    assert.equal(state.ok, false);
  });

  test("re-resolves on every ready() rather than trusting a root already held", async () => {
    fakeNavigator(IOS_UA);
    const fake = fakeTauri({ root: "/current/container/Documents" });
    globalThis.__TAURI__ = fake.api;

    const adapter = new ICloudAdapter();
    await adapter.ready();
    await adapter.ready();

    assert.equal(fake.calls.filter((call) => call.command === "icloud_root").length, 2);
  });
});

describe("unavailability()", () => {
  let realNavigator;

  beforeEach(() => {
    realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", realNavigator);
    delete globalThis.__TAURI__;
  });

  test("is usable inside the iOS app", () => {
    fakeNavigator(IOS_UA);
    globalThis.__TAURI__ = fakeTauri().api;

    assert.deepEqual(unavailability(), { reason: "", hint: "" });
  });

  test("names what it needs everywhere else", () => {
    fakeNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");

    assert.equal(unavailability().reason, "needs the iOS app");
  });
});

describe("icloudRoot()", () => {
  afterEach(() => {
    delete globalThis.__TAURI__;
  });

  test("throws outside the iOS app, rather than answering null the same way iCloud-unavailable does", async () => {
    delete globalThis.__TAURI__;

    await assert.rejects(icloudRoot());
  });

  test("answers null, not a throw, when iCloud itself has nothing to give back", async () => {
    globalThis.__TAURI__ = fakeTauri({ root: null }).api;

    assert.equal(await icloudRoot(), null);
  });
});
