// A File System Access API that lives in a Map.
//
// The filesystem adapter can only run in Chromium, which would leave it the one
// backend the conformance suite never sees. This is enough of
// FileSystemDirectoryHandle, FileSystemFileHandle, FileSystemWritableFileStream
// and File to run the real adapter under `node --test`, so the Chromium-only
// code is exercised on every commit rather than by hand in a browser.
//
// Faithfulness is the whole point: where the real API throws, this throws the
// same shape, and bytes land on close rather than on write. A fake that is
// kinder than the API it stands in for would hide exactly the bugs it exists to
// catch.

// Node has DOMException; a plain error carrying the same `name` stands in
// anywhere it does not, because `error.name` is all the adapter reads.
function fail(name, message) {
  if (typeof DOMException === "function") return new DOMException(message, name);

  const error = new Error(message);
  error.name = name;

  return error;
}

/**
 * A File, as much of one as reading a recording needs.
 *
 * A real File is a Blob, and that is not a detail: it is what lets
 * URL.createObjectURL take one. Extending Blob keeps the fake honest about the
 * bit the adapter depends on most.
 *
 * Held apart from the handle so that `getFile()` hands back a fresh snapshot
 * each time, the way the real API does.
 */
class FakeFile extends Blob {
  constructor(name, bytes, lastModified, state) {
    super([bytes]);
    this.name = name;
    this.lastModified = lastModified;
    this._state = state;
  }

  /**
   * @returns {Promise<ArrayBuffer>} the whole file, in memory
   */
  async arrayBuffer() {
    // Counted so a test can prove that playing a video never came through here.
    this._state.bytesRead += 1;

    return super.arrayBuffer();
  }
}

/**
 * A writable stream that only commits on close.
 *
 * The real stream writes to a swap file and swaps it in at the end, so a reader
 * that looks mid-write sees the old contents. Anything that assumes otherwise
 * should fail here too.
 */
class FakeWritable {
  constructor(file, state) {
    this._file = file;
    this._state = state;
    this._chunks = [];
    this._closed = false;
  }

  /**
   * @param {Uint8Array|ArrayBuffer|{type: string, data: any}} chunk what to append
   * @returns {Promise<void>} when the chunk is buffered
   * @throws {TypeError} if the stream is already closed
   */
  async write(chunk) {
    if (this._closed) throw new TypeError("the stream is closed");

    const data = chunk && chunk.type === "write" ? chunk.data : chunk;

    this._chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  /**
   * @returns {Promise<void>} when the bytes have replaced the file's contents
   */
  async close() {
    if (this._closed) return;

    this._closed = true;

    const size = this._chunks.reduce((total, chunk) => total + chunk.length, 0);
    const bytes = new Uint8Array(size);
    let at = 0;

    for (const chunk of this._chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }

    this._file.bytes = bytes;
    this._file.lastModified = this._state.now();
  }
}

/**
 * A file handle, standing over one entry in the fake tree.
 */
class FakeFileHandle {
  constructor(name, file, state) {
    this.kind = "file";
    this.name = name;
    this._file = file;
    this._state = state;
  }

  /**
   * @returns {Promise<FakeFile>} a snapshot of the file as it stands now
   */
  async getFile() {
    return new FakeFile(this.name, this._file.bytes, this._file.lastModified, this._state);
  }

  /**
   * @returns {Promise<FakeWritable>} a stream whose bytes land on close
   */
  async createWritable() {
    return new FakeWritable(this._file, this._state);
  }

  /**
   * @param {{mode?: string}} _options ignored, as the real API ignores it per handle
   * @returns {Promise<string>} "granted", "prompt" or "denied"
   */
  async queryPermission(_options) {
    return this._state.permission;
  }
}

/**
 * A directory handle over a Map of children.
 */
class FakeDirectoryHandle {
  constructor(name, entries, state) {
    this.kind = "directory";
    this.name = name;
    this._entries = entries;
    this._state = state;
  }

  /**
   * @returns {object} what the tests reach for: permission, the clock, and counters
   */
  get state() {
    return this._state;
  }

  /**
   * @param {string} name the child directory
   * @param {{create?: boolean}} options whether to make it when it is absent
   * @returns {Promise<FakeDirectoryHandle>} the child
   * @throws {DOMException} NotFoundError when absent and not creating,
   *   TypeMismatchError when the name is held by a file
   */
  async getDirectoryHandle(name, options = {}) {
    const existing = this._entries.get(name);

    if (existing && existing.kind === "file") {
      throw fail("TypeMismatchError", `${name} is a file`);
    }

    if (existing) return new FakeDirectoryHandle(name, existing.entries, this._state);

    if (!options.create) throw fail("NotFoundError", `${name} was not found`);

    const entries = new Map();
    this._entries.set(name, { kind: "directory", entries });

    return new FakeDirectoryHandle(name, entries, this._state);
  }

  /**
   * @param {string} name the child file
   * @param {{create?: boolean}} options whether to make it when it is absent
   * @returns {Promise<FakeFileHandle>} the child
   * @throws {DOMException} NotFoundError when absent and not creating,
   *   TypeMismatchError when the name is held by a directory
   */
  async getFileHandle(name, options = {}) {
    const existing = this._entries.get(name);

    if (existing && existing.kind === "directory") {
      throw fail("TypeMismatchError", `${name} is a directory`);
    }

    if (existing) return new FakeFileHandle(name, existing, this._state);

    if (!options.create) throw fail("NotFoundError", `${name} was not found`);

    const file = { kind: "file", bytes: new Uint8Array(0), lastModified: this._state.now() };
    this._entries.set(name, file);

    return new FakeFileHandle(name, file, this._state);
  }

  /**
   * @param {string} name the child to drop
   * @param {{recursive?: boolean}} options whether a full directory may go too
   * @returns {Promise<void>} when it is gone
   * @throws {DOMException} NotFoundError when absent,
   *   InvalidModificationError for a non-empty directory without recursive
   */
  async removeEntry(name, options = {}) {
    const existing = this._entries.get(name);

    if (!existing) throw fail("NotFoundError", `${name} was not found`);

    if (existing.kind === "directory" && existing.entries.size && !options.recursive) {
      throw fail("InvalidModificationError", `${name} is not empty`);
    }

    this._entries.delete(name);
  }

  /**
   * @returns {AsyncGenerator<[string, FakeDirectoryHandle|FakeFileHandle]>} name and handle for each child
   */
  async *entries() {
    for (const [name, entry] of [...this._entries]) {
      yield [
        name,
        entry.kind === "directory"
          ? new FakeDirectoryHandle(name, entry.entries, this._state)
          : new FakeFileHandle(name, entry, this._state),
      ];
    }
  }

  /**
   * @returns {AsyncGenerator<FakeDirectoryHandle|FakeFileHandle>} each child handle
   */
  async *values() {
    for await (const [, handle] of this.entries()) yield handle;
  }

  /**
   * @returns {AsyncGenerator<string>} each child name
   */
  async *keys() {
    for await (const [name] of this.entries()) yield name;
  }

  [Symbol.asyncIterator]() {
    return this.entries();
  }

  /**
   * @param {{mode?: string}} _options ignored, as one fake tree has one permission
   * @returns {Promise<string>} "granted", "prompt" or "denied"
   */
  async queryPermission(_options) {
    this._state.queries += 1;

    return this._state.permission;
  }

  /**
   * Ask, the way a click on a button would.
   *
   * @param {{mode?: string}} _options ignored
   * @returns {Promise<string>} whatever the test set the answer to
   */
  async requestPermission(_options) {
    this._state.requests += 1;
    this._state.permission = this._state.answer;

    return this._state.permission;
  }
}

/**
 * Build an empty fake directory tree.
 *
 * The clock ticks a millisecond per write by default rather than reading the
 * real one, so a test that writes twice in a row gets two different timestamps
 * every time instead of most of the time.
 *
 * @param {{permission?: string, answer?: string, now?: () => number}} options
 *   the starting permission, the answer a prompt would give, and the clock
 * @returns {FakeDirectoryHandle} the root
 */
export function makeDirectoryHandle(options = {}) {
  let tick = 1000;

  const state = {
    permission: options.permission || "granted",
    answer: options.answer || "granted",
    now: options.now || (() => (tick += 1)),
    queries: 0,
    requests: 0,
    bytesRead: 0,
  };

  return new FakeDirectoryHandle("fake-root", new Map(), state);
}
