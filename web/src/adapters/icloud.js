// A reader backed by this app's own iCloud container, on iOS.
//
// Unlike TauriAdapter's local folder, there is nothing to pick: the container
// is fixed by the app's own identifier (see src-tauri/src/icloud.rs and
// reviewer_iOS.entitlements), so attaching this source is asking Rust for its
// path rather than opening a dialog for the reader to choose one. Everything
// past that root is identical to a local folder's - the same storage_list/
// storage_read/storage_write/storage_remove commands, which do not know or
// care that a root came from iCloud instead of a picker - so this extends
// TauriAdapter rather than repeating its list/read/write/remove/media.

import { TauriAdapter, inTauriIOS } from "./tauri.js";

function core() {
  const api = globalThis.__TAURI__;

  return api?.core?.invoke ? api.core : null;
}

/**
 * Ask Rust for this app's iCloud container path, creating it if this is the
 * first time.
 *
 * @returns {Promise<string|null>} the path, or null when iCloud itself is not
 *   available - signed out of iCloud, or turned off for this app
 * @throws {Error} if asking failed outright, which is not the same as iCloud
 *   simply not being signed in
 */
export async function icloudRoot() {
  const api = core();

  if (!api) throw new Error("the iOS app is not running");

  try {
    return (await api.invoke("icloud_root")) ?? null;
  } catch (failure) {
    throw failure instanceof Error ? failure : new Error(String(failure));
  }
}

/**
 * Why this source cannot be used here, if it cannot.
 *
 * @returns {{reason: string, hint: string}} usable when both are ""
 */
export function unavailability() {
  if (inTauriIOS()) return { reason: "", hint: "" };

  return { reason: "needs the iOS app", hint: "" };
}

export class ICloudAdapter extends TauriAdapter {
  static type = "icloud";
  static label = "iCloud Drive";

  // Nothing to ask - see icloudRoot() above for what fills this in instead.
  static fields = [];

  static precise = false;

  async ready() {
    if (!inTauriIOS()) {
      return { ok: false, reason: "this reader needs the iOS app" };
    }

    // Re-resolved rather than trusted from config(): a reader can sign out of
    // iCloud, or turn it off for this app, between sessions, and a root that
    // was real yesterday is not proof of anything about right now.
    const root = await icloudRoot();

    if (!root) {
      return { ok: false, reason: "iCloud isn't available - check that you're signed in" };
    }

    this._root = root;

    return { ok: true, reason: "" };
  }

  config() {
    // No root kept here: it comes from icloudRoot() fresh every ready(), and
    // a stale one persisted from a previous device or account would be a
    // path this app never actually resolved, not a shortcut past resolving
    // it again.
    return { type: ICloudAdapter.type, label: this._label };
  }

  describe() {
    return this._label || "This app's iCloud Drive";
  }
}
