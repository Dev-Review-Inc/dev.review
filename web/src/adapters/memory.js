// A reader that keeps nothing.
//
// This is what the tests run against, and what a source falls back to when
// its real reader cannot be reached, so the interface has something coherent to
// render instead of a blank pane.

import { Adapter, contain } from "./adapter.js";

export class MemoryAdapter extends Adapter {
  static type = "memory";
  static label = "In memory";
  static precise = true;

  // Never offered in the interface. It holds drafts in a variable and loses
  // them on reload, so a reader who picked it would get a source that looks
  // like it works and is not. It exists for the conformance suite.
  static selectable = false;
  static fields = [];

  constructor(config = {}) {
    super();
    this._files = new Map();
    this._label = config.label || MemoryAdapter.label;
    this._writes = 0;
  }

  async list(prefix = "") {
    const within = contain(prefix);

    return [...this._files.entries()]
      .filter(([path]) => path.startsWith(within))
      .map(([path, file]) => ({
        path,
        size: file.bytes.length,
        modifiedAt: file.modifiedAt,
        etag: file.etag,
      }));
  }

  async read(path) {
    const file = this._files.get(contain(path));

    return file ? file.bytes : null;
  }

  async write(path, bytes) {
    this._files.set(contain(path), {
      bytes: Uint8Array.from(bytes),
      modifiedAt: Date.now(),
      etag: String((this._writes += 1)),
    });
  }

  async remove(path) {
    this._files.delete(contain(path));
  }

  async media(path) {
    const bytes = await this.read(path);

    if (!bytes) return null;

    const url = URL.createObjectURL(new Blob([bytes]));

    return { url, release: () => URL.revokeObjectURL(url) };
  }

  config() {
    return { type: MemoryAdapter.type, label: this._label };
  }

  describe() {
    return "Nothing is kept between sessions";
  }
}
