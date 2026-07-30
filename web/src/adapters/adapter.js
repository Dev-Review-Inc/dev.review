// What every reader looks like.
//
// An adapter is a *reader*: the place drafts are read from, and the place this
// app's own event log is synced to. It is always storage the customer already
// owns. There is no adapter that points at us, and there is no tier where we
// hold anyone's files.
//
// The surface is deliberately seven methods. Anything larger and a third
// backend stops being an afternoon's work.

/**
 * A path is a relative, forward-slashed path inside the adapter's root.
 *
 * Draft-supplied strings reach this — a QA scenario names its own video — so
 * containment is checked here as well as in the draft parser. Two layers,
 * because the cost of being wrong once is reading a file off someone's disk.
 *
 * @param {string} path the path as given
 * @returns {string} the path, normalised
 * @throws {Error} if it is absolute, or climbs out of the root
 */
export function contain(path) {
  const value = String(path ?? "");

  const escapes =
    value.startsWith("/") ||
    value.startsWith("~") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").includes("..");

  if (escapes) {
    throw new Error(`path is outside the source: ${value}`);
  }

  return value;
}

/**
 * What a listed entry looks like now, for spotting that it has changed.
 *
 * A backend that hands over an entity tag is taken at its word. One that does
 * not gets time and size together, because a draft rewritten inside a single
 * clock tick looks unchanged by time alone — and even then two writes of the
 * same length in the same millisecond are indistinguishable. Backends that can
 * do better say so with `precise`.
 *
 * @param {{path: string, size: number, modifiedAt: number, etag?: string}} entry a listing entry
 * @returns {string} the mark
 */
function mark(entry) {
  return entry.etag ? `etag:${entry.etag}` : `${entry.modifiedAt}:${entry.size}`;
}

/**
 * The parts every adapter shares: containment, and the bookkeeping that turns
 * a listing into "what changed".
 *
 * Watching is polling for every backend we ship, which at one draft an hour is
 * the right amount of machinery. Subclasses implement `list`, `read`, `write`,
 * `remove` and `media`; everything else is here.
 */
export class Adapter {
  // How often a watch re-lists, matching what the old directory watch did.
  static BEAT = 2000;

  // Whether a listing can tell two same-length writes apart. False means the
  // backend offers only time and size, so a same-size rewrite inside one
  // millisecond goes unnoticed until the next real change.
  static precise = false;

  get precise() {
    return this.constructor.precise;
  }

  constructor() {
    this._watches = new Set();
    this._timer = null;
  }

  /**
   * Notice changes under a prefix.
   *
   * @param {string} prefix what to watch
   * @param {(paths: string[]) => void} onChange called with the paths that changed
   * @returns {() => void} stop watching
   */
  watch(prefix, onChange) {
    const watch = { prefix, onChange, marks: null };

    this._watches.add(watch);
    this._start();

    return () => {
      this._watches.delete(watch);
      if (!this._watches.size) this._stop();
    };
  }

  /**
   * Run one round of every watch.
   *
   * Separate from the timer so tests drive it directly rather than sleeping,
   * and so a window regaining focus can ask for an immediate look.
   *
   * @returns {Promise<void>} when every watcher has been told
   */
  async poll() {
    for (const watch of [...this._watches]) {
      let entries;

      try {
        entries = await this.list(watch.prefix);
      } catch {
        // A backend that is briefly unreachable is not a change. Saying
        // "everything vanished" would throw away the reader's view of it.
        continue;
      }

      const marks = new Map(entries.map((entry) => [entry.path, mark(entry)]));
      const previous = watch.marks;
      watch.marks = marks;

      // A watcher's first look is all news: it has been told nothing yet, and
      // waiting for the next write would leave a reader staring at an empty
      // queue that is not empty.
      if (!previous) {
        if (marks.size) watch.onChange([...marks.keys()].sort());
        continue;
      }

      const changed = [];

      for (const [path, mark] of marks) {
        if (previous.get(path) !== mark) changed.push(path);
      }

      for (const path of previous.keys()) {
        if (!marks.has(path)) changed.push(path);
      }

      if (changed.length) watch.onChange(changed.sort());
    }
  }

  /**
   * @returns {Promise<{ok: boolean, reason: string}>} whether this adapter can be used right now
   */
  async ready() {
    return { ok: true, reason: "" };
  }

  /**
   * @returns {object} enough to rebuild this adapter, for persisting
   */
  config() {
    throw new Error("an adapter must describe its own configuration");
  }

  /**
   * @returns {Promise<void>} when the adapter has let go of its resources
   */
  async teardown() {
    this._stop();
    this._watches.clear();
  }

  _start() {
    if (this._timer || typeof setInterval !== "function") return;

    this._timer = setInterval(() => this.poll(), Adapter.BEAT);
    // Watching must never be the reason a process stays alive.
    if (typeof this._timer.unref === "function") this._timer.unref();
  }

  _stop() {
    if (!this._timer) return;

    clearInterval(this._timer);
    this._timer = null;
  }
}
