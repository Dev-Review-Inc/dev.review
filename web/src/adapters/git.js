// A reader backed by a git repository.
//
// The repository is the customer's, on whatever host they already push to. What
// is different about git as a backend is that a write is a commit: the history
// is the audit trail, and a draft that changed can be traced to the run that
// changed it.
//
// Git arrives here two ways. On the desktop there is a real git on the machine,
// which knows about credential helpers, ssh keys and packfiles larger than a
// tab's memory. In a browser there is none, so the work is done in JavaScript
// against the smart-HTTP protocol, through a proxy, because no major host sends
// the CORS headers a browser needs. Those are the same repository seen through
// different plumbing, so they are one adapter over two transports rather than
// two adapters, and the transport is chosen once, here.
//
// Everything a transport must not get wrong twice lives in this file:
// containment, the prefix, marks, and what to do when a push is refused.

import { Adapter, contain } from "./adapter.js";
import { inTauri } from "./tauri.js";

// Who a commit is by when the customer has not said. It is the app writing,
// not a person, and signing it as the person would be a lie in the log.
const AUTHOR = { name: "Reviewer", email: "reviewer@dev.review" };

/**
 * What a transport must be able to do.
 *
 * Deliberately smaller than the adapter's own surface: no containment, no
 * prefix, no media, no watching. A transport is handed paths that are already
 * checked and already rooted, and answers about the repository as it is on
 * disk. Everything else is the adapter's, so it is right once rather than right
 * in each transport.
 *
 * @typedef {object} Transport
 * @property {() => Promise<void>} open clone or initialise, idempotent
 * @property {() => Promise<{path: string, size: number, modifiedAt: number, etag: string}[]>} tree every tracked file, marked with its blob id
 * @property {(path: string) => Promise<Uint8Array|null>} readFile the bytes, or null if the path holds nothing
 * @property {(path: string, bytes: Uint8Array, message: string) => Promise<void>} commitFile write and commit
 * @property {(path: string, message: string) => Promise<boolean>} commitRemoval remove and commit, false if there was nothing there
 * @property {() => Promise<void>} pull bring the remote's work in
 * @property {() => Promise<void>} push send, throwing if refused
 * @property {() => Promise<{ok: boolean, reason: string}>} ready whether the remote can be reached
 * @property {() => Promise<void>} forget delete the local clone, opened or not
 * @property {() => Promise<void>} close let go of whatever was held
 */

export class GitAdapter extends Adapter {
  static type = "git";
  static label = "A git repository";

  static fields = [
    {
      key: "url",
      label: "repository url",
      mono: true,
      required: true,
      placeholder: "https://github.com/org/reviews.git",
    },
    { key: "branch", label: "branch", mono: true, placeholder: "main" },
    { key: "prefix", label: "path in the repository", mono: true, placeholder: "reviews/" },
    {
      key: "corsProxy",
      label: "cors proxy",
      mono: true,
      placeholder: "https://cors.example.com",
    },
    { key: "username", label: "username", mono: true },
    // Not required, because an ssh remote is reached with the keys already on
    // the machine. An https remote without one is refused by `ready` instead,
    // which is where the url is known.
    { key: "token", label: "access token", mono: true, secret: true },
  ];

  // Every listed entry carries the blob's object id, which is a hash of its
  // contents. Two writes of the same length in the same millisecond are
  // different objects, so git tells them apart where a clock cannot.
  static precise = true;

  /**
   * @param {object} [config] the stored configuration, with credentials merged in
   * @param {{transport?: Transport}} [environment] what this build can reach git through
   */
  constructor(config = {}, environment = {}) {
    super();

    this._label = config.label || GitAdapter.label;
    this._url = config.url || "";
    this._branch = config.branch || "main";
    this._prefix = String(config.prefix || "").replace(/^\/+|\/+$/g, "");
    this._corsProxy = config.corsProxy || "";
    this._username = config.username || "";
    this._token = config.token || "";
    this._author = config.author || AUTHOR;

    this._transport = environment.transport || null;
    this._opened = null;
  }

  async list(prefix = "") {
    const under = this._key(contain(prefix));
    const transport = await this._open();

    return (await transport.tree())
      .filter((entry) => entry.path.startsWith(this._key("")) && entry.path.startsWith(under))
      .map((entry) => ({ ...entry, path: this._path(entry.path) }));
  }

  async read(path) {
    const transport = await this._open();

    return transport.readFile(this._key(contain(path)));
  }

  async write(path, bytes) {
    const key = this._key(contain(path));
    const transport = await this._open();

    await transport.commitFile(key, Uint8Array.from(bytes), `Update ${key}`);
    await this._send();
  }

  async remove(path) {
    const key = this._key(contain(path));
    const transport = await this._open();

    // A path that was never in the tree is already gone. Committing nothing
    // would put an empty commit in the customer's history for a no-op.
    if (!(await transport.commitRemoval(key, `Remove ${key}`))) return;

    await this._send();
  }

  async media(path) {
    const bytes = await this.read(path);

    if (!bytes) return null;

    // No URL.createObjectURL in node, and nothing to revoke there either.
    if (typeof URL.createObjectURL !== "function") {
      return { url: `git:${this._key(contain(path))}`, release() {} };
    }

    const url = URL.createObjectURL(new Blob([bytes]));

    return { url, release: () => URL.revokeObjectURL(url) };
  }

  /**
   * Look for changes, having first given the remote a chance to have some.
   *
   * A repository nobody else writes to would never change under a poll that
   * only read the working tree, so the pull is the poll. It is best effort: a
   * remote that cannot be reached is a repository that has not changed yet, not
   * a repository whose every draft just vanished.
   *
   * @returns {Promise<void>} when every watcher has been told
   */
  async poll() {
    if (this._watches.size && this._url) {
      const transport = await this._open().catch(() => null);

      if (transport) await transport.pull().catch(() => {});
    }

    await super.poll();
  }

  async ready() {
    if (!this._url) return { ok: false, reason: "no repository was named" };

    const kind = remoteKind(this._url);

    if (!kind) return { ok: false, reason: "the repository url must be https or ssh" };

    // An https remote is reached with a token. An ssh one is reached with the
    // keys and agent already on the machine, so asking for a token there would
    // be asking for a credential that nothing goes on to use.
    if (kind === "https" && !this._token) {
      return { ok: false, reason: "no access token was given" };
    }

    if (this._corsProxy && remoteKind(this._corsProxy) !== "https") {
      return { ok: false, reason: "the cors proxy url must be https" };
    }

    try {
      const transport = await this._open();

      return transport.ready();
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }

  config() {
    return {
      type: GitAdapter.type,
      label: this._label,
      url: this._url,
      branch: this._branch,
      prefix: this._prefix,
      corsProxy: this._corsProxy,
      username: this._username,
      token: this._token,
    };
  }

  describe() {
    const repository = this._url ? name(this._url) : "a repository";
    const where = `${repository} on ${this._branch}`;

    return this._prefix ? `${where}, under ${this._prefix}/` : where;
  }

  /**
   * Delete the clone this source was reading through.
   *
   * The repository on the host is the customer's and is not touched. What goes
   * is the copy this app made of it, which on a desktop is a folder of their
   * source code and in a browser is the same thing in IndexedDB. Leaving that
   * behind after a removal would mean the delete deleted nothing.
   *
   * The transport is asked directly rather than through `_open`, because a
   * source being removed may never have been opened, and one that fails to open
   * is exactly the one most likely to be getting removed.
   *
   * @returns {Promise<void>} when the clone is gone
   */
  async forget() {
    const transport = await this._pick();

    await transport.forget();

    this._opened = null;
  }

  async teardown() {
    await super.teardown();

    if (this._transport) await this._transport.close();

    this._opened = null;
  }

  /**
   * What this adapter needs to hand a transport to do its work.
   *
   * @returns {object} the repository, the branch, and how to authenticate
   */
  settings() {
    return {
      url: this._url,
      branch: this._branch,
      corsProxy: this._corsProxy,
      username: this._username,
      token: this._token,
      author: this._author,
    };
  }

  /**
   * The transport this build reaches git through.
   *
   * Loaded rather than imported, because the browser transport carries a git
   * implementation with it and most sources are not git. A static import would
   * put a quarter of a megabyte in front of every page load to serve the
   * readers who never attach a repository. Nothing is fetched until someone
   * opens one.
   *
   * @returns {Promise<Transport>} the transport, not yet opened
   */
  async _pick() {
    if (this._transport) return this._transport;

    if (inTauri()) {
      const { NativeTransport } = await import("./git-native.js");

      this._transport = new NativeTransport(() => this.settings());
    } else {
      const { IsomorphicTransport } = await import("./git-isomorphic.js");

      this._transport = new IsomorphicTransport(this.settings());
    }

    return this._transport;
  }

  /**
   * The transport, with its repository ready.
   *
   * Opening is once per adapter and shared by everything that follows, because
   * a clone is expensive and two callers arriving together must not each start
   * one. A failed open is not remembered, so a source that was unreachable at
   * page load recovers without a reload.
   *
   * @returns {Promise<Transport>} the open transport
   */
  async _open() {
    const transport = await this._pick();

    if (!this._opened) {
      this._opened = transport.open().catch((error) => {
        this._opened = null;
        throw error;
      });
    }

    await this._opened;

    return transport;
  }

  /**
   * Send what was just committed, and deal with having been beaten to it.
   *
   * Two devices reviewing against one repository will collide, and the losing
   * push is refused rather than lost. The answer is git's own: take their work
   * first, then offer yours again. Once, because a push that is still refused
   * after a pull is a conflict a retry loop cannot resolve, and spinning on it
   * would hide that from the person who needs to know.
   *
   * A repository with no remote is a local repository, and there is nothing to
   * send.
   *
   * @returns {Promise<void>} when the commit is on the remote
   */
  async _send() {
    if (!this._url) return;

    const transport = await this._open();

    try {
      await transport.push();
    } catch (first) {
      try {
        await transport.pull();
        await transport.push();
      } catch (second) {
        throw new Error(
          `could not push to ${name(this._url)}: ${second.message || first.message}`,
        );
      }
    }
  }

  /**
   * Where a caller's path lives in the repository.
   *
   * Containment is the caller's business and is checked before this, on the
   * path as given. The prefix is part of the adapter's root, so joining it on
   * afterwards cannot be what lets a path escape.
   *
   * @param {string} path a contained path
   * @returns {string} the path in the repository
   */
  _key(path) {
    return this._prefix ? `${this._prefix}/${path}` : path;
  }

  /**
   * The path a repository path came from, with the prefix taken back off, so a
   * caller reads back the paths it wrote.
   *
   * @param {string} key the path in the repository
   * @returns {string} the caller's path
   */
  _path(key) {
    return this._prefix && key.startsWith(`${this._prefix}/`)
      ? key.slice(this._prefix.length + 1)
      : key;
  }
}

/**
 * Which kind of remote a url names, if it names one this app will touch.
 *
 * This is a boundary, not a convenience. Git's transports include ones that run
 * a program the url chooses: `ext::` runs its argument outright, and `file::`
 * and `git://` are no better once a url can come from anywhere. Only two forms
 * are ever accepted, and everything else is refused by not being on the list
 * rather than by being spotted.
 *
 * Argument injection is the other half. Git hands a hostname to `ssh`, so a
 * host or user beginning with `-` arrives there as an option rather than as a
 * name, which turns a repository url into whatever command the option names.
 * That is refused here for every form, before anything is parsed.
 *
 * @param {string} url the url as configured
 * @returns {string} "https", "ssh", or "" for one that is refused
 */
export function remoteKind(url) {
  const value = String(url ?? "");

  // Printable ascii and no spaces. A space is how one argument becomes two, a
  // control character is how one line becomes two, and a character that merely
  // looks like an ascii one is how a host becomes a different host.
  if (!value || /[^\x21-\x7e]/.test(value)) return "";

  if (value.startsWith("https://")) {
    return hostOf(value.slice(8)) ? "https" : "";
  }

  if (value.startsWith("ssh://")) {
    const [host, port] = split(hostOf(value.slice(6)));

    if (!host) return "";

    return port === null || /^\d+$/.test(port) ? "ssh" : "";
  }

  // scp-style, `git@github.com:org/repo.git`. It is only that if there is no
  // scheme at all and the colon comes before any slash, which is what keeps
  // `https://x` from being read as one.
  if (value.includes("://")) return "";

  // A doubled colon is git's remote-helper syntax, and `ext::` runs whatever
  // follows it. Checked before the scp form, which would otherwise read `ext`
  // as a perfectly ordinary hostname. An ipv6 literal is refused along with it,
  // which is a repository nobody is hosting.
  if (value.includes("::")) return "";

  // A drive letter is a colon before a path too, and `C:/repos/x` is a folder
  // on someone's disk rather than a host called C. `contain` refuses the same
  // shape for the same reason.
  if (/^[A-Za-z]:/.test(value)) return "";

  const colon = value.indexOf(":");

  if (colon < 1 || value.slice(0, colon).includes("/")) return "";

  return named(value.slice(0, colon)) ? "ssh" : "";
}

/**
 * The authority of a url, checked for a name that would arrive as an option.
 *
 * @param {string} rest the url with its scheme taken off
 * @returns {string} the authority, or "" if there is nothing usable there
 */
function hostOf(rest) {
  const authority = rest.split("/")[0];

  return named(authority) ? authority : "";
}

/**
 * Whether an authority is a name rather than an argument.
 *
 * @param {string} authority `user@host`, `host`, or `host:port`
 * @returns {string} the authority, or "" if any part of it starts with a dash
 */
function named(authority) {
  if (!authority) return "";

  const at = authority.lastIndexOf("@");
  const user = at === -1 ? "" : authority.slice(0, at);
  const host = authority.slice(at + 1);

  if (!host || host.startsWith("-") || user.startsWith("-")) return "";

  return authority;
}

/**
 * An authority split into its host and its port, if it names one.
 *
 * @param {string} authority the authority
 * @returns {[string, string|null]} the host, and the port or null
 */
function split(authority) {
  const at = authority.lastIndexOf("@");
  const host = authority.slice(at + 1);
  const colon = host.lastIndexOf(":");

  return colon === -1 ? [host, null] : [host.slice(0, colon), host.slice(colon + 1)];
}

/**
 * The repository as a person would name it, rather than as a url.
 *
 * @param {string} url the remote url
 * @returns {string} something like org/reviews
 */
function name(url) {
  const path = String(url)
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^/]*@/, "")
    .replace(/\.git$/, "")
    // A port is addressing rather than identity, and in the scp form the colon
    // does the job a slash does everywhere else.
    .replace(/^([^/:]+):(\d+)(?=\/|$)/, "$1")
    .replace(/^([^/:]+):/, "$1/")
    .split("/")
    .filter(Boolean);

  return path.slice(1).join("/") || path.join("/") || url;
}
