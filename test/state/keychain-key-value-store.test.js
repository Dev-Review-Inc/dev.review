// The Keychain-backed secret store, without a Keychain.
//
// The Rust half (src-tauri/src/keychain.rs) is covered by nothing here - it
// has no test harness this suite can reach. What's under test is the
// JavaScript half: that it speaks the same getItem/setItem/removeItem shape
// every other KeyValueStore does, and that a JS value survives the JSON trip
// the native commands force (they move strings; a secret here is an object).

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { KeychainKeyValueStore } from "../../web/src/state/keychain-key-value-store.js";

function fakeKeychain() {
  const items = new Map();
  const calls = [];

  const commands = {
    keychain_get: ({ account }) => (items.has(account) ? items.get(account) : null),
    keychain_set: ({ account, value }) => {
      items.set(account, value);

      return null;
    },
    keychain_delete: ({ account }) => {
      items.delete(account);

      return null;
    },
  };

  return {
    items,
    calls,
    api: {
      core: {
        async invoke(command, args = {}) {
          calls.push({ command, args });

          const run = commands[command];

          if (!run) throw new Error(`no such command: ${command}`);

          return run(args);
        },
      },
    },
  };
}

describe("KeychainKeyValueStore", () => {
  let fake;

  beforeEach(() => {
    fake = fakeKeychain();
    globalThis.__TAURI__ = fake.api;
  });

  afterEach(() => {
    delete globalThis.__TAURI__;
  });

  test("a value written comes back the same, round-tripped through JSON same as any other KeyValueStore", async () => {
    const store = new KeychainKeyValueStore();

    await store.setItem("secret:github", { token: "abc123" });

    assert.deepEqual(await store.getItem("secret:github"), { token: "abc123" });
  });

  test("what actually reaches the Keychain is a string, not the object itself", async () => {
    const store = new KeychainKeyValueStore();

    await store.setItem("secret:github", { token: "abc123" });

    assert.equal(fake.items.get("secret:github"), '{"token":"abc123"}');
  });

  test("a key never written is nothing, not a failure", async () => {
    const store = new KeychainKeyValueStore();

    assert.equal(await store.getItem("secret:nothing-here"), null);
  });

  test("removing takes it out, same as every other store", async () => {
    const store = new KeychainKeyValueStore();
    await store.setItem("secret:github", { token: "abc123" });

    await store.removeItem("secret:github");

    assert.equal(await store.getItem("secret:github"), null);
  });

  test("the key is the account the native side stores under", async () => {
    const store = new KeychainKeyValueStore();

    await store.setItem("secret:github", { token: "abc123" });

    assert.equal(fake.calls[0].command, "keychain_set");
    assert.equal(fake.calls[0].args.account, "secret:github");
  });
});
