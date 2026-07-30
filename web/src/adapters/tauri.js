// A reader backed by the desktop app's own filesystem.
//
// The browser build reaches a folder through the File System Access API, which
// only Chromium has. Inside the desktop shell there is a real filesystem on the
// other side of the IPC boundary, so the same folder works on Safari's webview,
// on Windows, and later on mobile.
//
// Tauri is reached off the global rather than imported, because this project
// has no bundler and no node_modules: `withGlobalTauri` in tauri.conf.json puts
// `invoke` on `globalThis.__TAURI__` where a plain ES module can find it.

import { Adapter, contain } from "./adapter.js";

/**
 * The Tauri entry points, or nothing when this is an ordinary browser tab.
 *
 * v2 nests them under `core`; the flat shape is the v1 layout, kept so an old
 * shell degrades to "not available" rather than throwing.
 *
 * @returns {object|null} the core API
 */
function core() {
  const api = globalThis.__TAURI__;

  if (!api) return null;

  return typeof api.core?.invoke === "function"
    ? api.core
    : typeof api.invoke === "function"
      ? api
      : null;
}

/**
 * Whether the app is running inside the desktop shell.
 *
 * @returns {boolean} true inside Tauri
 */
export function inTauri() {
  return core() !== null;
}

/**
 * Why this computer cannot be used here, if it cannot.
 *
 * A browser tab is not a shortcoming to explain away, so there is no hint: the
 * reader is either in the desktop app or they are not, and the sentence tells
 * them which.
 *
 * @returns {{reason: string, hint: string}} why not, both "" inside the desktop app
 */
export function unavailability() {
  if (inTauri()) return { reason: "", hint: "" };

  return { reason: "needs the desktop app", hint: "" };
}

/**
 * Ask for the folder to work in, using the platform's own picker.
 *
 * The dialog is opened on the Rust side, so the desktop app grants the
 * frontend no dialog permission at all.
 *
 * @returns {Promise<string|null>} the chosen absolute path, or null if dismissed
 */
export async function chooseRoot() {
  const api = core();

  if (!api) throw new Error("the desktop app is not running");

  return (await api.invoke("storage_pick_root")) ?? null;
}

export class TauriAdapter extends Adapter {
  static type = "tauri";
  static label = "This computer";

  // The folder is chosen through the native dialog, so there is nothing to ask.
  static fields = [];

  // The Rust side reports what the filesystem reports: time and size. Two
  // writes of the same length in one millisecond are indistinguishable, which
  // is what `precise` false means.
  static precise = false;

  constructor(config = {}) {
    super();
    this._root = config.root || "";
    this._label = config.label || TauriAdapter.label;
  }

  async ready() {
    if (!inTauri()) {
      return { ok: false, reason: "this reader needs the desktop app" };
    }

    if (!this._root) {
      return { ok: false, reason: "no folder has been chosen yet" };
    }

    return { ok: true, reason: "" };
  }

  async list(prefix = "") {
    const within = contain(prefix);
    const entries = await this._invoke("storage_list", { prefix: within });

    return entries.map((entry) => ({
      path: entry.path,
      size: entry.size,
      modifiedAt: entry.modified_at,
    }));
  }

  async read(path) {
    const bytes = await this._invoke("storage_read", { path: contain(path) });

    return bytes == null ? null : Uint8Array.from(bytes);
  }

  async write(path, bytes) {
    // Serde wants a JSON array of numbers on the other end, so the bytes are
    // spelled out rather than handed over as a typed array.
    await this._invoke("storage_write", {
      path: contain(path),
      bytes: Array.from(bytes),
    });
  }

  async remove(path) {
    await this._invoke("storage_remove", { path: contain(path) });
  }

  async media(path) {
    const within = contain(path);
    const listed = await this.list(within);

    if (!listed.some((entry) => entry.path === within)) return null;

    const api = core();
    const absolute = `${this._root.replace(/[/\\]$/, "")}/${within}`;

    // A QA video is tens of megabytes. The asset protocol lets the webview
    // stream it off disk with range requests, so scrubbing works and the bytes
    // never cross the IPC boundary. Reading it whole into a blob is the
    // fallback for a shell without the asset protocol, and costs that memory.
    if (typeof api?.convertFileSrc === "function") {
      return { url: api.convertFileSrc(absolute), release() {} };
    }

    const bytes = await this.read(within);

    if (!bytes) return null;

    if (typeof URL.createObjectURL !== "function") {
      return { url: `tauri:${within}`, release() {} };
    }

    const url = URL.createObjectURL(new Blob([bytes]));

    return { url, release: () => URL.revokeObjectURL(url) };
  }

  config() {
    return { type: TauriAdapter.type, root: this._root, label: this._label };
  }

  describe() {
    return this._root || "No folder chosen";
  }

  _invoke(command, args) {
    const api = core();

    if (!api) throw new Error("the desktop app is not running");

    return api.invoke(command, { root: this._root, ...args });
  }
}
