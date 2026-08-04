// Secret storage backed by the native Keychain, gated behind Face ID.
//
// Only meaningful where src-tauri/src/keychain.rs's three commands exist to
// answer it - the iOS app. Every other platform keeps whichever
// KeyValueStore multi-event-store.js was already handed for secrets,
// unchanged; see view.js for where the choice between the two is made.
//
// The native commands move strings; a secret here is a small object (a
// token, maybe a label), so it is JSON on the way in and out - one encoding
// step wider than IndexedDB, which stores the object itself via structured
// clone and needs none.

function invoke(command, args) {
  return globalThis.__TAURI__.core.invoke(command, args);
}

export class KeychainKeyValueStore {
  async getItem(key) {
    const raw = await invoke("keychain_get", { account: key });

    return raw === null || raw === undefined ? null : JSON.parse(raw);
  }

  async setItem(key, value) {
    await invoke("keychain_set", { account: key, value: JSON.stringify(value) });

    return value;
  }

  async removeItem(key) {
    await invoke("keychain_delete", { account: key });
  }
}
