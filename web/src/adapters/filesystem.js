// A reader over a folder on the reviewer's own disk.
//
// The File System Access API is the only way a page reaches a real folder
// without a daemon in the middle, so this is the backend for someone who keeps
// drafts beside the checkout they came from. It is Chromium only, which is
// accepted: the other backends cover everyone else, and the failure here says
// so plainly rather than throwing something obscure.
//
// Two things shape the design. The directory handle is a live object, not data,
// so it cannot go in JSON alongside the rest of the configuration - it is
// structured-cloned into IndexedDB instead, and handed back to the constructor.
// And permission over that handle lapses when the tab closes, so `ready()` only
// looks while `request()` asks, because asking requires a user gesture and
// nothing about loading a page is a gesture.

import { Adapter, contain } from "./adapter.js";
import { IndexedDBKeyValueStore } from "../state/key-value-store.js";

// One database for handles, apart from the event log, so clearing a source's
// events never takes its folder permission with it.
const HANDLES = "reviewer-handles";

const MODE = { mode: "readwrite" };

let handles = null;

function handleStore() {
  if (!handles) handles = new IndexedDBKeyValueStore(HANDLES);

  return handles;
}

// A missing file and a missing parent directory arrive as the same error, and
// both mean the same thing here: there is nothing at that path.
function absent(error) {
  return error && error.name === "NotFoundError";
}

export class FilesystemAdapter extends Adapter {
  static type = "filesystem";
  static label = "A folder on this computer";

  // The folder is chosen through the picker rather than typed, so there is
  // nothing to ask for. The interface offers a button instead of a form.
  static fields = [];

  // A listing has File.lastModified and File.size and nothing else, so two
  // writes of the same length inside one millisecond are indistinguishable.
  static precise = false;

  /**
   * A folder that was never chosen and a folder this browser could not read
   * back are different things to say, so they arrive as different values: the
   * first as nothing, the second as the failure itself.
   *
   * @param {{type?: string, label?: string}} config the serialisable half
   * @param {FileSystemDirectoryHandle|Error|null} handle the folder itself, from IndexedDB or the picker, or why it could not be fetched
   */
  constructor(config = {}, handle = null) {
    super();
    this._handle = handle instanceof Error ? null : handle;
    this._unreadable = handle instanceof Error ? handle : null;
    this._label = config.label || FilesystemAdapter.label;
  }

  /**
   * @param {string} prefix the path prefix to keep, "" for everything
   * @returns {Promise<Array<{path: string, size: number, modifiedAt: number}>>} every file beneath it
   * @throws {Error} if the prefix climbs out of the folder
   */
  async list(prefix = "") {
    const within = contain(prefix);
    const found = [];

    await this._collect(this._handle, "", found);

    return found.filter((entry) => entry.path.startsWith(within));
  }

  /**
   * @param {string} path the file to read
   * @returns {Promise<Uint8Array|null>} its bytes, or nothing if it is not there
   * @throws {Error} if the path climbs out of the folder
   */
  async read(path) {
    const handle = await this._fileHandle(contain(path), false);

    if (!handle) return null;

    const file = await handle.getFile();

    return new Uint8Array(await file.arrayBuffer());
  }

  /**
   * @param {string} path where to write, directories made as needed
   * @param {Uint8Array} bytes what to write
   * @returns {Promise<void>} when the bytes have landed
   * @throws {Error} if the path climbs out of the folder
   */
  async write(path, bytes) {
    const handle = await this._fileHandle(contain(path), true);
    const writable = await handle.createWritable();

    await writable.write(Uint8Array.from(bytes));
    await writable.close();
  }

  /**
   * @param {string} path the file to drop; one that is not there is not an error
   * @returns {Promise<void>} when it is gone
   * @throws {Error} if the path climbs out of the folder
   */
  async remove(path) {
    const within = contain(path);
    const segments = within.split("/").filter(Boolean);
    const name = segments.pop();

    if (!name) return;

    const directory = await this._directory(segments, false);

    if (!directory) return;

    try {
      await directory.removeEntry(name);
    } catch (error) {
      if (!absent(error)) throw error;
    }
  }

  /**
   * A url the interface can point a video or an image at.
   *
   * The File is handed to createObjectURL as it is. Reading the bytes first
   * would pull a whole QA recording into memory to play it, which is the one
   * thing this backend is well placed to avoid.
   *
   * @param {string} path the file to show
   * @returns {Promise<{url: string, release: () => void}|null>} the url and how to let it go
   * @throws {Error} if the path climbs out of the folder
   */
  async media(path) {
    const handle = await this._fileHandle(contain(path), false);

    if (!handle) return null;

    const file = await handle.getFile();
    const url = URL.createObjectURL(file);

    return { url, release: () => URL.revokeObjectURL(url) };
  }

  /**
   * Whether the folder can be touched right now, without asking.
   *
   * Called on load, where a prompt would be both unexplained and refused, so
   * this only ever looks. Permission granted in a previous session comes back
   * as "prompt", which is the interface's cue to offer a button.
   *
   * @returns {Promise<{ok: boolean, reason: string}>} whether it is usable, and why not
   */
  async ready() {
    if (!this._handle) return this._missing();

    return this._judge(await this._handle.queryPermission(MODE));
  }

  /**
   * Ask for the folder back.
   *
   * Separate from `ready()` because requestPermission is only answered inside a
   * user gesture; call this from a click, never from a load.
   *
   * @returns {Promise<{ok: boolean, reason: string}>} what the reviewer answered
   */
  async request() {
    if (!this._handle) return this._missing();

    return this._judge(await this._handle.requestPermission(MODE));
  }

  /**
   * @returns {{type: string, label: string}} the part of this adapter that survives JSON
   */
  config() {
    return { type: FilesystemAdapter.type, label: this._label };
  }

  /**
   * @returns {string} what the interface says about this backend
   */
  describe() {
    return "Files stay on this computer, in the folder you chose";
  }

  // Why there is no folder here. Choosing one again is the remedy either way,
  // but only one of these is something the reader left undone, and telling
  // someone whose browser storage is broken to choose a folder they already
  // chose sends them round the same loop.
  _missing() {
    if (this._unreadable) {
      return {
        ok: false,
        reason: `This browser could not read back the folder kept for ${this._label}: ${this._unreadable.message}. Choose the folder again to reconnect it.`,
      };
    }

    return { ok: false, reason: "No folder has been chosen yet." };
  }

  _judge(permission) {
    if (permission === "granted") return { ok: true, reason: "" };

    if (permission === "denied") {
      return {
        ok: false,
        reason: `Permission to read ${this._label} was refused. Choose the folder again to undo that.`,
      };
    }

    return {
      ok: false,
      reason: `This browser has forgotten its permission for ${this._label}. Grant it again to carry on.`,
    };
  }

  async _collect(directory, prefix, found) {
    for await (const [name, entry] of directory.entries()) {
      const path = `${prefix}${name}`;

      if (entry.kind === "directory") {
        await this._collect(entry, `${path}/`, found);
        continue;
      }

      const file = await entry.getFile();

      found.push({ path, size: file.size, modifiedAt: file.lastModified });
    }
  }

  async _directory(segments, create) {
    let directory = this._handle;

    for (const name of segments) {
      try {
        directory = await directory.getDirectoryHandle(name, { create });
      } catch (error) {
        if (absent(error)) return null;
        throw error;
      }
    }

    return directory;
  }

  async _fileHandle(path, create) {
    const segments = path.split("/").filter(Boolean);
    const name = segments.pop();

    if (!name) return null;

    const directory = await this._directory(segments, create);

    if (!directory) return null;

    try {
      return await directory.getFileHandle(name, { create });
    } catch (error) {
      if (absent(error)) return null;
      throw error;
    }
  }
}

/**
 * Whether this browser has the File System Access API at all.
 *
 * @returns {boolean} true on Chromium, false everywhere else
 */
export function isSupported() {
  return typeof globalThis.showDirectoryPicker === "function";
}

// Whether this is a Chromium browser, which is what User-Agent Client Hints
// are: no other engine ships navigator.userAgentData. The brand names inside
// it are not read. A browser is free to put anything there, and a message that
// depended on finding a particular name would be wrong the day one changed it.
function chromium() {
  return Array.isArray(globalThis.navigator?.userAgentData?.brands);
}

/**
 * Why a folder on this computer cannot be used here, if it cannot.
 *
 * Three different browsers arrive at the same missing global by three different
 * routes, and the reader's next step is different in each, so this returns the
 * one that fits rather than a single sentence that fits none of them.
 *
 * The connection is checked before the engine because it is the case the reader
 * can act on immediately, and because an insecure page has no picker whatever
 * the engine is, so blaming the engine there would be a lie.
 *
 * The Chromium case gets a hint rather than a diagnosis. Some Chromium browsers
 * ship this switched off by default and Brave is one of them today, but we
 * cannot see a flag from in here and that default is theirs to change. Pointing
 * at where the switch lives is true either way; asserting it is the cause is
 * not.
 *
 * @returns {{reason: string, hint: string}} why not and where to look, both "" when it works
 */
export function unavailability() {
  if (isSupported()) return { reason: "", hint: "" };

  if (globalThis.isSecureContext === false) {
    return {
      reason: "needs a secure connection, so open this app over https or on localhost",
      hint: "",
    };
  }

  if (chromium()) {
    return {
      reason: "your browser has the File System Access API switched off",
      hint: "Some Chromium browsers ship it off by default. In Brave the switch is at brave://flags/#file-system-access-api, and it needs a relaunch.",
    };
  }

  return {
    reason: "needs a Chromium browser such as Chrome or Edge",
    hint: "",
  };
}

/**
 * Ask the reviewer to choose a folder.
 *
 * Must be called from a user gesture; the picker will not open otherwise.
 *
 * @returns {Promise<FileSystemDirectoryHandle>} the chosen folder
 * @throws {Error} if the browser has no File System Access API
 * @throws {DOMException} AbortError if the reviewer closes the picker
 */
export async function pickDirectory() {
  if (!isSupported()) {
    throw new Error(
      "Choosing a folder needs the File System Access API, which today is Chrome, Edge and other Chromium browsers only. Use a different backend in this browser.",
    );
  }

  return globalThis.showDirectoryPicker(MODE);
}

/**
 * Keep a folder handle for next time.
 *
 * IndexedDB rather than localStorage because a handle is a live object: it
 * survives a structured clone and not a JSON round trip.
 *
 * @param {string} id the source the folder belongs to
 * @param {FileSystemDirectoryHandle} handle the folder
 * @returns {Promise<void>} when it is stored
 */
export async function rememberHandle(id, handle) {
  await handleStore().setItem(id, handle);
}

/**
 * Fetch a folder handle from a previous session.
 *
 * What comes back carries no permission with it. Ask the adapter whether it is
 * ready, and offer a button if it is not.
 *
 * @param {string} id the source the folder belongs to
 * @returns {Promise<FileSystemDirectoryHandle|null>} the folder, or nothing
 */
export async function recallHandle(id) {
  return handleStore().getItem(id);
}

/**
 * Drop a stored folder handle.
 *
 * @param {string} id the source the folder belonged to
 * @returns {Promise<void>} when it is gone
 */
export async function forgetHandle(id) {
  await handleStore().removeItem(id);
}
