// The agent's documents, read and never edited.
//
// This is the one part of the app's state that is not event sourced, and that
// is deliberate. A draft is external input: an agent wrote it, an agent will
// rewrite it, and this app is a reader of it. Event sourcing it would mean
// inventing a history for changes we did not make.
//
// A draft can be cleared, which is not authorship either: the file goes whole
// and nothing takes its place. It is how a re-review is asked for, because the
// sweep claims the pull requests whose drafts are missing.
//
// So it is a projection instead: read through the adapter, parsed, cached, and
// re-read when the adapter says the bytes moved.

import { draftPath } from "../domain/draft-path.js";
import { parseDraft } from "../domain/draft.js";

// Where a source's drafts sit under its reader's root, matching the layout
// the schema documents so an existing drafts directory can be attached as-is.
export const ROOT = "drafts/";

export class Drafts {
  /**
   * @param {object} options what to read through
   * @param {object} options.adapter the source's reader
   */
  constructor({ adapter }) {
    this.adapter = adapter;
    this._byKey = new Map();
    this._listeners = new Set();
    this._unwatch = null;
  }

  /**
   * What was read for a pull request, if anything has been.
   *
   * @param {string} key e.g. "org/app#42"
   * @returns {object|null} the parsed draft
   */
  find(key) {
    return this._byKey.get(key)?.draft || null;
  }

  /**
   * Why a draft could not be read, if it could not.
   *
   * A draft that does not parse is shown as unreadable rather than as absent,
   * because "the agent has not got to it" and "the agent wrote something this
   * app cannot act on" are different problems with different fixes.
   *
   * @param {string} key e.g. "org/app#42"
   * @returns {string} the reason, or an empty string
   */
  problem(key) {
    return this._byKey.get(key)?.problem || "";
  }

  /**
   * Read the draft for a pull request.
   *
   * @param {{owner: string, repo: string, number: number}} pull which pull request
   * @param {string} key its identity
   * @returns {Promise<object|null>} the parsed draft, or null when none is written
   */
  async load(pull, key) {
    const path = draftPath(pull.owner, pull.repo, pull.number);

    let bytes;

    try {
      bytes = await this.adapter.read(path);
    } catch (error) {
      this._byKey.set(key, { draft: null, problem: `could not be read: ${error.message}` });

      return null;
    }

    if (!bytes) {
      this._byKey.delete(key);

      return null;
    }

    try {
      const draft = parseDraft(JSON.parse(new TextDecoder().decode(bytes)));

      this._byKey.set(key, { draft, problem: "" });

      return draft;
    } catch (error) {
      // A half-written draft parses as broken for a moment. Keeping the last
      // good one beside the problem means the pane does not blink empty while
      // an agent is mid-write.
      this._byKey.set(key, {
        draft: this._byKey.get(key)?.draft || null,
        problem: error.message,
      });

      return null;
    }
  }

  /**
   * Delete the draft for a pull request, so a new one gets written.
   *
   * Forgotten here as well as removed there, rather than waiting for the watch
   * to notice: the reader asked for this, so the pane owes them the answer now.
   *
   * @param {{owner: string, repo: string, number: number}} pull which pull request
   * @param {string} key its identity
   * @returns {Promise<void>} when it is gone
   */
  async clear(pull, key) {
    await this.adapter.remove(draftPath(pull.owner, pull.repo, pull.number));

    this._byKey.delete(key);
  }

  /**
   * Read whatever drafts the reader currently holds.
   *
   * Used on attaching a source, and on every queue refresh, so the queue can
   * say which pull requests have something waiting before any is opened.
   *
   * A listing is the whole truth about what the agent holds, so a draft that is
   * no longer in one has been cleared and is forgotten here. Without that this
   * is only ever additive, and a review cleared while the tab was in the
   * background keeps its marks in the queue on the reader's return: the watch
   * is throttled to a background tab, this refresh is not.
   *
   * @returns {Promise<string[]>} the keys that moved
   */
  async loadAll() {
    const paths = (await this.adapter.list(ROOT)).map((entry) => entry.path);
    const held = new Set(paths.map(keyOf).filter(Boolean));
    const gone = [...this._byKey.keys()].filter((key) => !held.has(key));

    for (const key of gone) this._byKey.delete(key);

    return [...(await this._absorb(paths)), ...gone];
  }

  /**
   * Watch the reader, re-reading drafts as they are written.
   *
   * @param {() => void} onChange called once per round in which anything moved
   * @returns {() => void} stop watching
   */
  watch(onChange) {
    this._listeners.add(onChange);

    if (!this._unwatch) {
      this._unwatch = this.adapter.watch(ROOT, (paths) => {
        this._absorb(paths).then((changed) => {
          if (changed.length) this._listeners.forEach((listener) => listener(changed));
        });
      });
    }

    return () => {
      this._listeners.delete(onChange);

      if (!this._listeners.size && this._unwatch) {
        this._unwatch();
        this._unwatch = null;
      }
    };
  }

  async _absorb(paths) {
    const changed = [];

    for (const path of paths) {
      const key = keyOf(path);

      if (!key) continue;

      const bytes = await this.adapter.read(path).catch(() => null);

      if (!bytes) {
        this._byKey.delete(key);
        changed.push(key);
        continue;
      }

      try {
        this._byKey.set(key, {
          draft: parseDraft(JSON.parse(new TextDecoder().decode(bytes))),
          problem: "",
        });
      } catch (error) {
        this._byKey.set(key, {
          draft: this._byKey.get(key)?.draft || null,
          problem: error.message,
        });
      }

      changed.push(key);
    }

    return changed;
  }
}

/**
 * The pull request a draft path belongs to.
 *
 * The inverse of draftPath, and the only place the app reads a directory name
 * rather than deriving one. Anything that is not a draft is not a draft.
 *
 * @param {string} path e.g. "drafts/org--app-42/review.json"
 * @returns {string|null} e.g. "org/app#42"
 */
export function keyOf(path) {
  const match = String(path).match(/^drafts\/([^/]+)--([^/]+)-(\d+)\/review\.json$/);

  return match ? `${match[1]}/${match[2]}#${Number(match[3])}` : null;
}
