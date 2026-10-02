// Where drafts are read from.
//
// Every one of these points at storage the customer already owns. There is no
// adapter that points at us, and there is no tier where this app holds anyone's
// files. That is a constraint on the product, not a stage it grows out of, so
// it is worth stating where the list of backends lives.

import { MemoryAdapter } from "./memory.js";
import { DemoAdapter } from "./demo.js";
import {
  FilesystemAdapter,
  pickDirectory,
  unavailability as filesystemUnavailability,
} from "./filesystem.js";
import { GitAdapter } from "./git.js";
import { GitHubAdapter } from "./github.js";
import { S3Adapter } from "./s3.js";
import {
  TauriAdapter,
  chooseRoot,
  inTauri,
  inTauriIOS,
  unavailability as tauriUnavailability,
} from "./tauri.js";
import {
  ICloudAdapter,
  icloudRoot,
  unavailability as icloudUnavailability,
} from "./icloud.js";

const TYPES = [
  FilesystemAdapter,
  TauriAdapter,
  ICloudAdapter,
  GitHubAdapter,
  GitAdapter,
  S3Adapter,
  MemoryAdapter,
  DemoAdapter,
];

const WORKS = () => ({ reason: "", hint: "" });

/**
 * Git works everywhere, but not the same way in both places, and the difference
 * is one the reader has to act on before they can save.
 *
 * The desktop app drives the git already on the machine, so it inherits the
 * credential helper and ssh agent the customer already set up and there is
 * nothing to say. Everywhere else the work is done in JavaScript against the
 * smart-HTTP protocol, and no major host sends the CORS headers a webview
 * needs, so the request is refused before it is sent unless a proxy is named.
 * Finding that out from a failed save would be cruel when the form could have
 * said it first.
 *
 * Which of those applies is decided by whether git.rs is in this build, not by
 * whether this is Tauri at all. The iOS app is Tauri and compiles git.rs out,
 * so it is on the JavaScript transport and needs the proxy exactly as a tab
 * does - see git.js's `_pick`, which asks Rust the same question. Asking
 * `inTauri` alone told the iOS reader nothing and left them to discover the
 * proxy from a push that was refused.
 *
 * The sandboxed macOS App Store build compiles git.rs out too and is not
 * covered here: nothing tells it apart from the Developer ID build
 * synchronously, and the honest answer needs the async `git_native_available`
 * this list has no way to await.
 *
 * @returns {{reason: string, hint: string}} usable either way, with what the JavaScript transport also needs
 */
function gitCaveat() {
  if (inTauri() && !inTauriIOS()) return { reason: "", hint: "" };

  return {
    reason: "",
    hint: "Outside the desktop app this needs a cors proxy, because no git host answers a webview directly.",
  };
}

// Why a backend cannot be used in this browser, on this build. An empty reason
// means it can.
const AVAILABILITY = {
  [FilesystemAdapter.type]: filesystemUnavailability,
  [TauriAdapter.type]: tauriUnavailability,
  [ICloudAdapter.type]: icloudUnavailability,
  [GitHubAdapter.type]: WORKS,
  [GitAdapter.type]: gitCaveat,
  [S3Adapter.type]: WORKS,
  [MemoryAdapter.type]: WORKS,
  [DemoAdapter.type]: WORKS,
};

/**
 * The sources this build can offer, here, now, and why any of them cannot.
 *
 * Two different things look alike from the form's side and must not be
 * collapsed, because the reader is owed a different answer about each.
 *
 * A backend that cannot be used here stays on the list carrying its reason. An
 * option that silently is not there leaves a reader who was told this app reads
 * folders with nothing to look at and nothing to do. A dead end with an exit is
 * better than a dead end you cannot see: the form greys it out and says what
 * would make it work.
 *
 * Filesystem and Tauri are the one deliberate exception to that, because they
 * are not two different things: both mean "a folder on this computer," and
 * which of them can act on that is decided entirely by where this build
 * happens to be running, not by anything the reader could do. A Chromium tab
 * cannot gain Tauri's picker and the desktop app's WKWebView cannot gain File
 * System Access, so showing the one that never works here is not a dead end
 * with an exit - it is a dead end wearing the other one's coat, and the two
 * looking almost, not quite, alike ("A folder on this computer" beside "This
 * computer") is exactly how a reader who picked the wrong one keeps failing to
 * notice a right one was sitting beside it. Only whichever one actually works
 * here is offered, so there is only ever one "a folder on this computer" to
 * find.
 *
 * On iOS neither of them can, and the slot is empty rather than holding a
 * substitute. The picker half needs src-tauri/src/lib.rs's storage_pick_root,
 * which that build's `run()` does not register, because iOS has no lasting
 * "arbitrary folder" to hand back - so the option would open nothing and
 * throw. iCloud Drive is already on this list in its own right, and it is the
 * folder an iOS reader actually has, so standing it in here as well would
 * either list it twice or make "the local folder pair" mean a thing that is
 * not a folder on this device and not one of the pair. The cost is admitted:
 * an iOS reader who attached "a folder on this computer" on their Mac finds no
 * such option on their phone and no sentence about it. That is the same cost
 * this pair already pays in a non-Chromium tab, and iCloud Drive sitting in
 * the list is what they are meant to find instead.
 *
 * A backend that must never be offered is dropped. The in-memory reader keeps
 * nothing and the demo reader holds sample data the app attaches itself, so
 * attaching either by hand would produce a source that looks like it works
 * right up until the reader reloads the page. Greying that out would be
 * advertising a footgun, so `selectable` false takes them off the list entirely
 * and no reason is shown, because there is nothing the reader could do about it
 * and nothing they should want to.
 *
 * Each carries the fields it needs asking for, so the form that asks them knows
 * nothing about any particular backend.
 *
 * @returns {{type: string, label: string, fields: object[], reason: string, hint: string}[]} what can be attached, and what cannot
 */
export function adapterTypes() {
  // iOS is the one place where neither half of the pair can act on a folder,
  // so there is no "whichever one works here" to offer and the slot is empty.
  // See the paragraph above the function for why an empty slot is right here
  // and a greyed-out option is right everywhere else.
  const localFolder = inTauriIOS() ? null : inTauri() ? TauriAdapter : FilesystemAdapter;
  const isLocalFolderPair = (Adapter) => Adapter === FilesystemAdapter || Adapter === TauriAdapter;

  return TYPES.filter((Adapter) => Adapter.selectable !== false)
    .filter((Adapter) => !isLocalFolderPair(Adapter) || Adapter === localFolder)
    .map((Adapter) => ({
      type: Adapter.type,
      label: Adapter.label || Adapter.type,
      fields: Adapter.fields || [],
      ...AVAILABILITY[Adapter.type](),
    }));
}

/**
 * Which dialog opens for a backend whose storage is chosen rather than typed.
 *
 * The backend the reader picked decides, not the shell: a folder reached
 * through the desktop app is a path on the machine, and a folder reached
 * through a browser is a handle that browser granted. Asking the shell instead
 * would offer the desktop dialog to a browser build that has nowhere to put
 * what it returns.
 *
 * iCloud opens no dialog at all - there is nothing to choose, only this app's
 * own fixed container to ask Rust for. See icloud.js for why that is a
 * property of the backend and not a shortcut taken here.
 *
 * @param {string} type the backend the form has selected
 * @returns {string} "native" for the desktop app's own dialog, "auto" for one
 *   resolved with nothing to ask, "browser" otherwise
 */
export function folderChooser(type) {
  if (type === TauriAdapter.type) return "native";
  if (type === ICloudAdapter.type) return "auto";

  return "browser";
}

/**
 * Ask the reviewer for a folder, with whichever dialog that backend uses.
 *
 * The two answer differently and the caller keeps both apart: the desktop app
 * answers with a path it can store, and a browser answers with a handle it
 * cannot. Being dismissed is not a failure in either, so both say so the same
 * way rather than making the caller know one throws and one does not. A dialog
 * that failed is not dismissal in either, and throws in both.
 *
 * Must be called from a user gesture; the browser picker will not open
 * otherwise.
 *
 * @param {string} type the backend the form has selected
 * @returns {Promise<{root: string}|{handle: object}|null>} what was chosen, or null if dismissed
 * @throws {Error} if the dialog could not be opened, or failed while open
 */
export async function chooseFolder(type) {
  if (folderChooser(type) === "native") {
    const root = await chooseRoot();

    return root ? { root } : null;
  }

  // Not a dismissal even when there is nothing to resolve yet - unlike a
  // picker closed with nothing chosen, an unavailable iCloud container is
  // attached anyway, and ready() is what explains why it cannot be read,
  // the same as any other source with a real reason it is not working.
  if (folderChooser(type) === "auto") {
    return { root: (await icloudRoot()) || "" };
  }

  try {
    return { handle: await pickDirectory() };
  } catch (failure) {
    if (failure.name === "AbortError") return null;

    throw failure;
  }
}

/**
 * Rebuild a reader from what was configured and the credential kept beside it.
 *
 * @param {object} config the stored adapter configuration
 * @param {object} [secret] credentials, which are never in the configuration
 * @param {object|Error} [handle] a directory handle, for the backends that need one, or why it could not be fetched
 * @returns {object} the adapter
 * @throws {Error} if this build has no such backend
 */
export function buildAdapter(config, secret = {}, handle = null) {
  const Adapter = TYPES.find((candidate) => candidate.type === config.type);

  if (!Adapter) {
    throw new Error(`this build cannot read from ${config.type} storage`);
  }

  if (Adapter === FilesystemAdapter) return new FilesystemAdapter(config, handle);

  return new Adapter({ ...config, ...secret });
}

export {
  MemoryAdapter,
  DemoAdapter,
  FilesystemAdapter,
  GitAdapter,
  GitHubAdapter,
  S3Adapter,
  TauriAdapter,
};
