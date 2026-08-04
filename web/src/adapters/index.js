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
 * nothing to say. A browser has no git and no way to talk to one: no major host
 * sends the CORS headers a tab needs, so the request is refused before it is
 * sent unless a proxy is named. Finding that out from a failed save would be
 * cruel when the form could have said it first.
 *
 * @returns {{reason: string, hint: string}} usable either way, with what a browser also needs
 */
function gitCaveat() {
  if (inTauri()) return { reason: "", hint: "" };

  return {
    reason: "",
    hint: "In a browser this needs a cors proxy, because no git host answers a tab directly.",
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
  return TYPES.filter((Adapter) => Adapter.selectable !== false).map((Adapter) => ({
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
