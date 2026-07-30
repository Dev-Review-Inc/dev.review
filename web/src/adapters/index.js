// Where drafts are read from.
//
// Every one of these points at storage the customer already owns. There is no
// adapter that points at us, and there is no tier where this app holds anyone's
// files. That is a constraint on the product, not a stage it grows out of, so
// it is worth stating where the list of backends lives.

import { MemoryAdapter } from "./memory.js";
import { DemoAdapter } from "./demo.js";
import { FilesystemAdapter, unavailability as filesystemUnavailability } from "./filesystem.js";
import { S3Adapter } from "./s3.js";
import { TauriAdapter, unavailability as tauriUnavailability } from "./tauri.js";

const TYPES = [FilesystemAdapter, TauriAdapter, S3Adapter, MemoryAdapter, DemoAdapter];

const WORKS = () => ({ reason: "", hint: "" });

// Why a backend cannot be used in this browser, on this build. An empty reason
// means it can.
const AVAILABILITY = {
  [FilesystemAdapter.type]: filesystemUnavailability,
  [TauriAdapter.type]: tauriUnavailability,
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
 * Rebuild a reader from what was configured and the credential kept beside it.
 *
 * @param {object} config the stored adapter configuration
 * @param {object} [secret] credentials, which are never in the configuration
 * @param {object} [handle] a directory handle, for the backends that need one
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

export { MemoryAdapter, DemoAdapter, FilesystemAdapter, S3Adapter, TauriAdapter };
