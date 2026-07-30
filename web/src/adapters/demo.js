// A reader backed by sample data served beside the page.
//
// This is the reading half of the demo: the drafts an agent would have written,
// shipped as one static JSON file so a marketing page can show the real app
// with no credential anywhere in it.
//
// The seed is read only. Everything the reader does lands in an overlay on top
// of it, so the same file can be served to every visitor and the next tab opens
// on the sample data as it was written.

import { Adapter, contain } from "./adapter.js";
import { readSeed } from "../demo/seed.js";

export class DemoAdapter extends Adapter {
  static type = "demo";
  static label = "Demo";

  // Every write is an entry in a map, so a rewrite of the same size in the same
  // millisecond is still seen.
  static precise = true;

  // Never offered in the interface, for the same reason the in-memory reader is
  // not: it keeps nothing, and the demo attaches it itself.
  static selectable = false;
  static fields = [];

  /**
   * @param {object} [config] how to build it
   * @param {string} [config.label] what to call it
   * @param {string} [config.seed] where the sample data is served, empty for none
   * @param {(url: string) => Promise<object>} [config.fetch] how to fetch it
   */
  constructor(config = {}) {
    super();
    this._label = config.label || DemoAdapter.label;
    this._seed = config.seed || "";
    this._fetch = config.fetch || ((url) => globalThis.fetch(url));

    this._seeded = new Map();
    this._media = new Map();
    this._overlay = new Map();
    this._writes = 0;
    this._problem = "";
    this._loading = null;
  }

  /**
   * @param {string} [prefix] what to list under
   * @returns {Promise<{path: string, size: number, modifiedAt: number, etag: string}[]>} the entries
   */
  async list(prefix = "") {
    const within = contain(prefix);

    await this._loaded();

    return [...this._entries()]
      .filter(([path]) => path.startsWith(within))
      .map(([path, file]) => ({
        path,
        size: file.bytes.length,
        modifiedAt: file.modifiedAt,
        etag: file.etag,
      }));
  }

  /**
   * @param {string} path which path
   * @returns {Promise<Uint8Array|null>} the bytes, or null when nothing is there
   */
  async read(path) {
    const within = contain(path);

    await this._loaded();

    const file = this._at(within);

    return file ? file.bytes : null;
  }

  /**
   * @param {string} path which path
   * @param {Uint8Array} bytes what to write
   * @returns {Promise<void>} when it is written over the seed
   */
  async write(path, bytes) {
    const within = contain(path);

    await this._loaded();

    this._overlay.set(within, {
      bytes: Uint8Array.from(bytes),
      modifiedAt: Date.now(),
      etag: String((this._writes += 1)),
    });
  }

  /**
   * @param {string} path which path
   * @returns {Promise<void>} when it reads as nothing
   */
  async remove(path) {
    const within = contain(path);

    await this._loaded();

    // A tombstone rather than a delete, because the seed underneath cannot be
    // deleted from and a removed sample draft has to stay removed.
    this._overlay.set(within, { removed: true });
  }

  /**
   * Media for a path, which for seeded media is a url the seed already carries.
   *
   * A sample QA video is a data url or a url on the page's own origin, so it is
   * handed straight over. Fetching it to make an object url out of it would be
   * downloading a file we already have a way to show.
   *
   * @param {string} path which path
   * @returns {Promise<{url: string, release: () => void}|null>} the media
   */
  async media(path) {
    const within = contain(path);

    await this._loaded();

    const file = this._at(within);

    if (file) {
      const url = URL.createObjectURL(new Blob([file.bytes]));

      return { url, release: () => URL.revokeObjectURL(url) };
    }

    if (this._overlay.get(within)?.removed) return null;

    const seeded = this._media.get(within);

    return seeded ? { url: seeded, release: () => {} } : null;
  }

  /**
   * @returns {Promise<{ok: boolean, reason: string}>} whether the sample data arrived
   */
  async ready() {
    await this._loaded();

    return { ok: !this._problem, reason: this._problem };
  }

  config() {
    return { type: DemoAdapter.type, label: this._label, seed: this._seed };
  }

  describe() {
    return "Bundled sample data, nothing is kept";
  }

  // The seed is fetched on first use rather than in the constructor, because a
  // constructor cannot wait and a reader that is built and never read from
  // should not cost a request.
  _loaded() {
    if (!this._loading) this._loading = this._load();

    return this._loading;
  }

  async _load() {
    const { document, problem } = await readSeed(this._seed, this._fetch);
    const seededAt = Date.now();

    this._problem = problem;

    for (const [path, draft] of Object.entries(document.drafts || {})) {
      this._seeded.set(contain(path), {
        bytes: new TextEncoder().encode(JSON.stringify(draft)),
        modifiedAt: seededAt,
        etag: `seed:${path}`,
      });
    }

    for (const [path, url] of Object.entries(document.media || {})) {
      this._media.set(contain(path), url);
    }
  }

  // What is at a path once the overlay has had its say.
  _at(path) {
    const written = this._overlay.get(path);

    if (written) return written.removed ? null : written;

    return this._seeded.get(path) || null;
  }

  *_entries() {
    for (const [path, file] of this._seeded) {
      if (!this._overlay.has(path)) yield [path, file];
    }

    for (const [path, file] of this._overlay) {
      if (!file.removed) yield [path, file];
    }
  }
}
