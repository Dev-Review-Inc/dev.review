// Git in a browser tab.
//
// There is no git on the machine here, so the whole of it is done in
// JavaScript: a working copy in IndexedDB, and the smart-HTTP protocol over
// `fetch`. That last part is why a proxy exists at all. No major git host sends
// the CORS headers a browser needs, so a page cannot talk to github.com
// directly however good its credentials are.
//
// This is a transport, not an adapter. Containment, the prefix, media, marks
// and what to do when a push is refused all belong to GitAdapter and are not
// repeated here. What is here is the repository on disk and the wire.

import git from "../../vendor/isomorphic-git.js";
import http from "../../vendor/isomorphic-git-http.js";
import LightningFS from "../../vendor/lightning-fs.js";

// One database for every repository this browser has been pointed at, each in
// its own directory inside it.
const DATABASE = "reviewer-git";

/**
 * The url a request should actually be sent to.
 *
 * Both forms are isomorphic-git's own, because a customer who has a proxy
 * already has it configured the way isomorphic-git documents. A proxy ending in
 * `?` takes the whole url including its scheme as a query; anything else takes
 * it as a path with the scheme stripped.
 *
 * @param {string} corsProxy the proxy, or "" for none
 * @param {string} url the git host's url
 * @returns {string} where to send the request
 */
export function proxied(corsProxy, url) {
  if (!corsProxy) return url;

  return corsProxy.endsWith("?")
    ? `${corsProxy}${url}`
    : `${corsProxy}/${url.replace(/^https?:\/\//, "")}`;
}

/**
 * A stable directory name for one repository and branch.
 *
 * Two sources pointed at the same branch of the same repository should share
 * one working copy rather than clone it twice, and reopening the app should
 * find the clone that is already there.
 *
 * @param {string} url the remote, or "" for a local-only repository
 * @param {string} branch the branch
 * @returns {string} an absolute path in the filesystem
 */
function folder(url, branch) {
  const key = `${url}#${branch}`;
  const readable = key.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();

  return `/${readable.slice(-48)}-${fingerprint(key)}`;
}

/**
 * A short hash, so a truncated name is still a unique one.
 *
 * @param {string} value what to hash
 * @returns {string} eight hex characters
 */
function fingerprint(value) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

/**
 * The host of a url, for saying where something went wrong.
 *
 * @param {string} url the url
 * @returns {string} the host, or the url if it cannot be parsed
 */
function host(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export class IsomorphicTransport {
  /**
   * @param {object} settings what GitAdapter.settings() answers
   * @param {{fs?: object, dir?: string}} [where] the filesystem and directory to work in, for tests
   */
  constructor(settings = {}, where = {}) {
    this._url = settings.url || "";
    this._branch = settings.branch || "main";
    this._corsProxy = settings.corsProxy || "";
    this._username = settings.username || "";
    this._token = settings.token || "";
    this._author = settings.author || { name: "Reviewer", email: "reviewer@dev.review" };

    this._filesystem = where.fs || null;
    this._folder = where.dir || "";
    this._opened = null;
  }

  /**
   * The filesystem the working copy lives on.
   *
   * Built on first use rather than in the constructor, because LightningFS
   * reaches for IndexedDB and `navigator.locks` as it is constructed and this
   * module has to import cleanly under node.
   *
   * @returns {object} a promise-flavoured filesystem
   */
  get fs() {
    if (!this._filesystem) this._filesystem = new LightningFS(DATABASE);

    return this._filesystem;
  }

  get dir() {
    if (!this._folder) this._folder = folder(this._url, this._branch);

    return this._folder;
  }

  async open() {
    if (!this._opened) {
      this._opened = this._clone().catch((error) => {
        this._opened = null;
        throw error;
      });
    }

    return this._opened;
  }

  async tree() {
    await this.open();

    // TREE reads the commit, so a repository nobody has committed to yet walks
    // to nothing rather than failing, and .git is never in view.
    return git.walk({
      fs: this.fs,
      dir: this.dir,
      trees: [git.TREE({ ref: "HEAD" })],
      map: async (path, [entry]) => {
        if (!entry || path === ".") return undefined;
        if ((await entry.type()) !== "blob") return undefined;

        // The object id is a hash of the contents, so it is the mark. Size and
        // time come from the working copy, which is a stat rather than reading
        // every blob in the repository back out of the object store.
        const stat = await this.fs.promises.stat(this._at(path)).catch(() => null);

        return {
          path,
          size: stat ? Number(stat.size) : 0,
          modifiedAt: stat ? Number(stat.mtimeMs ?? 0) : 0,
          etag: await entry.oid(),
        };
      },
    });
  }

  async readFile(path) {
    await this.open();

    try {
      return Uint8Array.from(await this.fs.promises.readFile(this._at(path)));
    } catch (error) {
      // A path holding nothing is an answer, not a fault. A directory holds no
      // bytes either, and the caller asked for bytes.
      if (error.code === "ENOENT" || error.code === "EISDIR") return null;

      throw error;
    }
  }

  async commitFile(path, bytes, message) {
    await this.open();

    await this._mkdirp(this._at(path).split("/").slice(0, -1).join("/"));
    await this.fs.promises.writeFile(this._at(path), bytes);
    await git.add({ fs: this.fs, dir: this.dir, filepath: path });
    await this._commit(message);
  }

  async commitRemoval(path, message) {
    await this.open();

    const tracked = await this._tracked(path);
    const present = await this.fs.promises.stat(this._at(path)).then(
      () => true,
      () => false,
    );

    if (!tracked && !present) return false;

    if (present) await this.fs.promises.unlink(this._at(path));
    if (tracked) await git.remove({ fs: this.fs, dir: this.dir, filepath: path });

    await this._commit(message);

    return true;
  }

  async pull() {
    if (!this._url) return;

    await this.open();

    await git.fetch({
      ...this._remote(),
      ref: this._branch,
      singleBranch: true,
      tags: false,
    });

    try {
      await git.merge({
        fs: this.fs,
        dir: this.dir,
        ours: this._branch,
        theirs: `refs/remotes/origin/${this._branch}`,
        author: this._author,
        message: `Merge origin/${this._branch}`,
      });
    } catch (error) {
      if (error instanceof git.Errors.MergeConflictError) {
        const paths = (error.data?.filepaths || []).join(", ");

        throw new Error(
          `${host(this._url)} has its own version of ${paths}. ` +
            "Resolve it in a git client, then try again.",
        );
      }

      throw error;
    }

    // A merge moves the branch without touching the working copy, and force is
    // safe because every write here was committed as it was made.
    await git.checkout({ fs: this.fs, dir: this.dir, ref: this._branch, force: true });
  }

  async push() {
    if (!this._url) return;

    await this.open();

    try {
      await git.push({ ...this._remote(), ref: this._branch, remoteRef: this._branch });
    } catch (error) {
      // Push never answers "not ok". It throws, twice over: once for what it
      // works out itself before sending, and once for what the host says.
      if (error instanceof git.Errors.PushRejectedError) {
        throw new Error(
          error.data?.reason === "not-fast-forward"
            ? `${host(this._url)} has work this copy does not`
            : `${host(this._url)} refused the push: ${error.data?.reason}`,
        );
      }

      if (error instanceof git.Errors.GitPushError) {
        throw new Error(`${host(this._url)} refused the push: ${refusal(error)}`);
      }

      throw new Error(this._unreachable(error));
    }
  }

  /**
   * Whether the remote can be reached with the credentials as configured.
   *
   * Asking for the branch's ref is the cheapest real question there is: it
   * needs no working copy, no clone and no filesystem, so a source can be
   * checked before anything has been downloaded.
   *
   * @returns {Promise<{ok: boolean, reason: string}>} what the remote said
   */
  async ready() {
    if (!this._url) return { ok: true, reason: "" };

    // ssh is the machine's business: keys, an agent, a known_hosts file. A tab
    // has none of them and cannot open a socket that is not http, so this is a
    // repository the desktop app can read and this one genuinely cannot.
    if (!/^https?:\/\//.test(this._url)) {
      return { ok: false, reason: "an ssh remote needs the desktop app" };
    }

    try {
      await git.listServerRefs({
        http: this._http(),
        url: this._url,
        prefix: `refs/heads/${this._branch}`,
        protocolVersion: 2,
        onAuth: () => this._auth(),
        onAuthFailure: () => ({ cancel: true }),
      });
    } catch (error) {
      return { ok: false, reason: this._unreachable(error) };
    }

    return { ok: true, reason: "" };
  }

  async close() {
    this._opened = null;
  }

  /**
   * Delete the clone, opened or not.
   *
   * A customer who removes a source is owed the removal of the copy of their
   * repository this browser took, so this runs whether or not anything ever
   * opened it.
   *
   * @returns {Promise<void>} when nothing of it is left
   */
  async forget() {
    const dir = this.dir;

    if (!dir || dir === "/") throw new Error("refusing to forget the whole filesystem");

    await this._remove(dir);

    // LightningFS keeps the directory tree in memory and writes it back on a
    // timer, so without this a tab closed straight after a removal reopens
    // still holding it.
    await this.fs.promises.flush?.();

    this._opened = null;
  }

  /**
   * Get a repository on disk, by fetching one or by starting one.
   *
   * A repository with no remote is a real state rather than a half-configured
   * one: it is a local working copy whose history nobody else has yet.
   *
   * @returns {Promise<void>} when there is a repository at `dir`
   */
  async _clone() {
    await this._mkdirp(this.dir);

    if (await this.fs.promises.stat(`${this.dir}/.git`).then(() => true, () => false)) return;

    if (!this._url) {
      await git.init({ fs: this.fs, dir: this.dir, defaultBranch: this._branch });

      return;
    }

    // Said here as well as in `ready`, because a clone is what a caller reaches
    // for first and "fetch failed" would send them looking at their proxy.
    if (!/^https?:\/\//.test(this._url)) {
      throw new Error("an ssh remote needs the desktop app");
    }

    try {
      await git.clone({
        ...this._remote(),
        ref: this._branch,
        singleBranch: true,
        // Not shallow. A push from a shallow clone is broken upstream
        // (isomorphic-git#682), and this clone exists to be pushed from.
        //
        // Yielding between batches keeps the tab answering while a repository
        // with a year of drafts in it comes down.
        nonBlocking: true,
        batchSize: 100,
      });
    } catch (error) {
      throw new Error(this._unreachable(error));
    }
  }

  /**
   * The arguments every operation that touches the network shares.
   *
   * @returns {object} filesystem, http, repository and credentials
   */
  _remote() {
    return {
      fs: this.fs,
      http: this._http(),
      dir: this.dir,
      url: this._url,
      remote: "origin",
      onAuth: () => this._auth(),
      // Without this, a refused token is asked for again forever. Once is
      // enough to know it is wrong, and the caller is owed the news.
      onAuthFailure: () => ({ cancel: true }),
    };
  }

  /**
   * The http client, with the proxy in front of it.
   *
   * The proxy is applied here rather than handed to isomorphic-git so that
   * every request out of this transport goes through one place.
   *
   * @returns {{request: Function}} an isomorphic-git http client
   */
  // A git cors proxy authenticates nobody. It answers only the smart-HTTP
  // paths and forwards only the headers on its own allowlist, and a header it
  // does not know is refused by the browser at preflight rather than dropped
  // quietly. So there is nothing to send it: the credential this carries is the
  // git one, and the proxy is a relay that happens to see it.
  _http() {
    return {
      request: (request) =>
        http.request({ ...request, url: proxied(this._corsProxy, request.url) }),
    };
  }

  /**
   * The credentials, as basic auth.
   *
   * A GitHub token works as the password against the account's login, and also
   * as the username on its own, which is what a customer who pasted a token and
   * nothing else has given us.
   *
   * @returns {{username: string, password: string}} what to send
   */
  _auth() {
    return this._username
      ? { username: this._username, password: this._token }
      : { username: this._token, password: "" };
  }

  /**
   * Why a request never came back with anything useful.
   *
   * Each of these arrives from the browser as something a reader cannot act on,
   * and the CORS one arrives as nothing at all.
   *
   * @param {Error} error whatever was thrown
   * @returns {string} something a reader can act on
   */
  _unreachable(error) {
    if (error instanceof TypeError) {
      return (
        `could not reach ${host(this._url)}: the browser refused the request before it was ` +
        "sent. Git hosts do not send the CORS headers a browser needs, so reaching one from " +
        "a page means configuring a cors proxy."
      );
    }

    if (error instanceof git.Errors.UserCanceledError) {
      return `the access token was refused by ${host(this._url)}`;
    }

    const status = error?.data?.statusCode;

    if (status === 401) return `the access token was refused by ${host(this._url)}`;
    if (status === 404) return `no repository at ${this._url}, or the token cannot see it`;
    if (status) return `${host(this._url)} answered ${status}`;

    return error.message;
  }

  /**
   * @param {string} message what the commit is for
   * @returns {Promise<string>} the new commit's id
   */
  async _commit(message) {
    return git.commit({ fs: this.fs, dir: this.dir, message, author: this._author });
  }

  /**
   * @param {string} path a path in the repository
   * @returns {Promise<boolean>} whether the branch has it
   */
  async _tracked(path) {
    const files = await git
      .listFiles({ fs: this.fs, dir: this.dir, ref: this._branch })
      .catch(() => []);

    return files.includes(path);
  }

  /**
   * @param {string} path a path in the repository
   * @returns {string} where it is on the filesystem
   */
  _at(path) {
    return `${this.dir}/${path}`;
  }

  /**
   * Delete a path and everything under it.
   *
   * LightningFS has no recursive delete and will not drop a directory holding
   * anything, so this goes from the leaves up. A path that is not there is
   * already in the state being asked for.
   *
   * @param {string} path an absolute path
   * @returns {Promise<void>} when it is gone
   */
  async _remove(path) {
    const stat = await this.fs.promises.lstat(path).catch(() => null);

    if (!stat) return;

    if (!stat.isDirectory()) {
      await this.fs.promises.unlink(path);

      return;
    }

    for (const name of await this.fs.promises.readdir(path)) {
      await this._remove(`${path}/${name}`);
    }

    await this.fs.promises.rmdir(path);
  }

  /**
   * Make a directory and everything above it.
   *
   * @param {string} path an absolute path
   * @returns {Promise<void>} when it is there
   */
  async _mkdirp(path) {
    let made = "";

    for (const part of path.split("/").filter(Boolean)) {
      made += `/${part}`;

      await this.fs.promises.mkdir(made).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    }
  }
}

/**
 * What the host said when it refused a push.
 *
 * @param {Error} error a GitPushError
 * @returns {string} the reasons, per ref
 */
function refusal(error) {
  const refs = error.data?.result?.refs || {};
  const reasons = Object.entries(refs)
    .filter(([, result]) => !result.ok)
    .map(([ref, result]) => `${ref}: ${result.error}`);

  return reasons.join(", ") || error.data?.result?.error?.join(", ") || error.message;
}

/**
 * @param {object} settings what GitAdapter.settings() answers
 * @param {{fs?: object, dir?: string}} [where] the filesystem and directory to work in
 * @returns {IsomorphicTransport} a transport over isomorphic-git
 */
export function isomorphicTransport(settings, where) {
  return new IsomorphicTransport(settings, where);
}
