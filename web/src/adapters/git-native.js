// Git as the desktop shell does it: the real git binary on the machine.
//
// The browser transport reimplements the wire protocol in JavaScript because it
// has no other choice. Here there is a git that already knows the customer's
// credential helpers, their ssh agent, their proxy and their packfile limits,
// so the work is to hand it paths and get out of the way.
//
// Everything git-shaped that is not plumbing - containment, the prefix, media,
// marks, the pull-then-retry after a refused push - is GitAdapter's, and none
// of it is repeated here.

import { inTauri } from "./tauri.js";

export { inTauri };

/**
 * Why this transport cannot be used here, if it cannot.
 *
 * @returns {{reason: string, hint: string}} why not, both "" inside the desktop app
 */
export function unavailability() {
  if (inTauri()) return { reason: "", hint: "" };

  return { reason: "needs the desktop app", hint: "" };
}

/**
 * A Transport, as git.js defines one, over the git on this machine.
 *
 * Settings are the only thing it is given. The clone's folder is not a setting:
 * it is a cache this app manages, so where it goes is Rust's to say, and the
 * frontend never handles an absolute path it did not get from there.
 *
 * They are read on every call rather than captured, because the adapter owns
 * them and a token the customer has just corrected must be the one the next
 * push uses.
 */
export class NativeTransport {
  /**
   * @param {object|(() => object)} settings what GitAdapter.settings() returns
   */
  constructor(settings = {}) {
    this._settings = typeof settings === "function" ? settings : () => settings;
    this._resolved = null;
  }

  async open() {
    await this._invoke("git_open");
  }

  async tree() {
    const entries = await this._invoke("git_tree");

    // The blob id is the mark: a rewrite of the same length in the same
    // millisecond is a different object, and git says so.
    return entries.map((entry) => ({
      path: entry.path,
      size: entry.size,
      modifiedAt: entry.modified_at,
      etag: entry.oid,
    }));
  }

  async readFile(path) {
    const bytes = await this._invoke("git_read", { path });

    return bytes == null ? null : Uint8Array.from(bytes);
  }

  async commitFile(path, bytes, message) {
    // Serde wants a JSON array of numbers on the other end, so the bytes are
    // spelled out rather than handed over as a typed array.
    await this._invoke("git_commit_file", { path, bytes: Array.from(bytes), message });
  }

  async commitRemoval(path, message) {
    return await this._invoke("git_commit_removal", { path, message });
  }

  async pull() {
    await this._invoke("git_pull");
  }

  async push() {
    await this._invoke("git_push");
  }

  async ready() {
    if (!inTauri()) return { ok: false, reason: "this reader needs the desktop app" };

    try {
      return await this._invoke("git_ready");
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }

  async close() {}

  /**
   * Take this source's clone off the machine.
   *
   * The slug rather than the cached folder, because a source removed before it
   * was ever opened still left nothing behind only if this works without one.
   * The cache is dropped after, so a later open resolves the folder again
   * instead of writing into a path that is no longer there.
   */
  async forget() {
    await this._call("git_forget", { slug: slugFor(this._settings()) });

    this._resolved = null;
  }

  /**
   * The folder this source's clone lives in, asked for once.
   *
   * Cached against the slug rather than forever, so a source pointed at a
   * different repository resolves a different folder instead of pulling the
   * new remote into the old clone.
   *
   * @returns {Promise<string>} the absolute path
   */
  async _root() {
    const slug = slugFor(this._settings());

    if (this._resolved?.slug !== slug) {
      this._resolved = { slug, root: await this._call("git_root", { slug }) };
    }

    return this._resolved.root;
  }

  async _invoke(command, args) {
    return this._call(command, {
      root: await this._root(),
      settings: this._settings(),
      ...args,
    });
  }

  async _call(command, args) {
    const api = globalThis.__TAURI__;
    const core = typeof api?.core?.invoke === "function" ? api.core : api;

    if (typeof core?.invoke !== "function") {
      throw new Error("the desktop app is not running");
    }

    try {
      return await core.invoke(command, args);
    } catch (error) {
      throw new Error(explain(String(error?.message ?? error), this._settings().token));
    }
  }
}

/**
 * What to call this source's folder on disk.
 *
 * Stable for a url and branch, so reopening a source finds the clone it made
 * last time rather than fetching the whole history again. Readable at the
 * front so a person looking in the folder can tell which is which, and hashed
 * at the end so two repositories whose names flatten to the same thing - the
 * same path on two hosts, say - do not share one clone. Rust sanitises this
 * again before touching a disk; it is derived from a url the customer typed.
 *
 * @param {object} settings what GitAdapter.settings() returns
 * @returns {string} the slug
 */
function slugFor({ url = "", branch = "" } = {}) {
  const seed = `${url}#${branch || "main"}`;

  const readable =
    String(url)
      .replace(/^[a-z+]+:\/\//i, "")
      .replace(/\.git$/, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "local";

  return `${readable}-${hash(seed)}`;
}

/**
 * A short, stable digest. FNV-1a: not a security claim, just a way of telling
 * two seeds apart that needs no crypto and no await.
 *
 * @param {string} seed what to digest
 * @returns {string} eight hex characters
 */
function hash(seed) {
  let value = 0x811c9dc5;

  for (const letter of seed) {
    value ^= letter.codePointAt(0);
    value = Math.imul(value, 0x01000193) >>> 0;
  }

  return value.toString(16).padStart(8, "0");
}

/**
 * Say what git said, in words that name what to do about it.
 *
 * Git writes for someone at a terminal who ran the command themselves. Here
 * nobody typed anything, so "fatal: Authentication failed" has to become the
 * sentence a reader can act on. What is not recognised is passed through
 * rather than flattened, because git's own words beat a guess.
 *
 * @param {string} said git's stderr, as the Rust side handed it over
 * @param {string} [token] the credential, so it can be kept out of the answer
 * @returns {string} something to put in front of a person
 */
function explain(said, token = "") {
  // Belt and braces: the token is passed to git through the environment and
  // never reaches a command line, so it should not be in here to begin with.
  const message = token ? said.split(token).join("***") : said;

  for (const [pattern, plain] of TRANSLATIONS) {
    const found = message.match(pattern);

    if (found) return plain(found);
  }

  return message;
}

const TRANSLATIONS = [
  [
    /merge conflict in (.+)/i,
    (found) => `the same files were changed in both places: ${found[1]}`,
  ],
  // Before the credentials line below: nothing this app was configured with was
  // refused here, so pointing at the username and token would send a reader to
  // the wrong screen.
  [
    /permission denied \(publickey|no supported authentication methods|could not open a connection to your authentication agent/i,
    () =>
      "the ssh key was refused: keys and the agent come from this machine's own ssh config rather than from this app",
  ],
  [
    /host key verification failed|no (rsa |ecdsa |ed25519 )?host key is known/i,
    () =>
      "that host has never been trusted on this machine: connect to it once outside the app so its fingerprint is checked and recorded",
  ],
  [
    /authentication failed|could not read (username|password)|invalid username or password|terminal prompts disabled|403 forbidden|401 unauthorized/i,
    () => "the repository refused the credentials: check the username and access token",
  ],
  [
    /non-fast-forward|fetch first|\[rejected\]|updates were rejected/i,
    () => "the branch has moved on since this copy was taken: someone else pushed first",
  ],
  [
    /no such remote|does not appear to be a git repository|repository .*not found|couldn't find remote ref/i,
    () => "the repository could not be found at that url",
  ],
  [
    /could not resolve host|network is unreachable|failed to connect|connection timed out|connection refused|operation timed out/i,
    () => "the host could not be reached: check the network and the url",
  ],
];
