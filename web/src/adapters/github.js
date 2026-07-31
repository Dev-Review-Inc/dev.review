// A reader backed by a GitHub repository.
//
// The repository is the customer's and the token is theirs, kept client side
// and sent as a bearer header. api.github.com allows cross-origin requests with
// an Authorization header, so nothing proxies these calls and no credential
// exists anywhere but this browser.
//
// This is the same repository the git adapter would clone, reached through the
// REST API instead. That trades history for reach: there is no commit graph in
// a tab and no proxy to stand one up, but there are five endpoints that already
// answer from a browser. The write is still a commit on GitHub's side, so the
// audit trail survives.
//
// The calls in web/src/destinations/github.js are not reused. That client
// decodes every answer as JSON and throws on anything but a 2xx, and an adapter
// needs the opposite: a 404 is the answer to "is there a draft here", a 403
// means one thing or another depending on a header, and a file over a megabyte
// is bytes rather than a payload.

import { Adapter, contain } from "./adapter.js";

const API = "https://api.github.com";
const VERSION = "2022-11-28";

// How much of a string `fromCharCode` will take at once. A megabyte of
// arguments overflows the call stack, and drafts carry video.
const CHUNK = 0x8000;

/**
 * Bytes as base64, which is the only way content travels through this API.
 *
 * There is no Buffer in a browser, and a text round trip through TextDecoder
 * would mangle every byte that is not valid UTF-8, so this goes through the
 * one-byte-per-character string `btoa` expects.
 *
 * @param {Uint8Array} bytes the content
 * @returns {string} the encoding
 */
function encode(bytes) {
  let binary = "";

  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }

  return globalThis.btoa(binary);
}

/**
 * Base64 back to bytes.
 *
 * @param {string} content the encoding, which GitHub wraps at 60 columns
 * @returns {Uint8Array} the content
 */
function decode(content) {
  const binary = globalThis.atob(String(content ?? "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);

  return bytes;
}

/**
 * A path as it goes into a url, with the slashes left as slashes.
 *
 * @param {string} key the path in the repository
 * @returns {string} the escaped path
 */
function route(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

export class GitHubAdapter extends Adapter {
  static type = "github";
  static label = "A GitHub repository";

  // What to ask for, declared here rather than in the interface, so no form
  // knows anything about a particular backend. Fields marked secret are kept
  // out of the event log and never rendered back into the page.
  static fields = [
    { key: "owner", label: "owner", mono: true, required: true },
    { key: "repo", label: "repository", mono: true, required: true },
    { key: "branch", label: "branch", mono: true, placeholder: "main" },
    { key: "prefix", label: "path in the repository", mono: true, placeholder: "reviews/" },
    {
      key: "token",
      label: "access token",
      mono: true,
      secret: true,
      required: true,
      hint: "Fine grained, scoped to this repository: contents read and write.",
    },
  ];

  // Every listed entry carries the blob's object id, which is a hash of its
  // contents. Two writes of the same length in the same millisecond are
  // different objects, so git tells them apart where a clock cannot.
  static precise = true;

  constructor(config = {}) {
    super();

    this._label = config.label || GitHubAdapter.label;
    this._owner = config.owner || "";
    this._repo = config.repo || "";
    this._branch = config.branch || "main";
    this._prefix = String(config.prefix || "").replace(/^\/+|\/+$/g, "");
    this._token = config.token || "";
  }

  async list(prefix = "") {
    const under = this._key(contain(prefix));

    // One request for the whole tree. Walking the contents API directory by
    // directory would be a request per folder and a rate limit spent on a
    // source with a year of drafts in it.
    const response = await this._send(
      "GET",
      `/git/trees/${encodeURIComponent(this._branch)}?recursive=1`,
    );

    // A repository nobody has committed to has no tree to walk, which is a
    // source holding nothing rather than a source that failed.
    if (response.status === 409) return [];
    if (!response.ok) throw this._failure(response, "list");

    const payload = await response.json();

    // GitHub cuts a tree off past a hundred thousand entries and says so. A
    // listing that stopped there would report everything past the cut as
    // deleted, which is the one mistake a watcher must never make, so the
    // caller is told the truth instead.
    if (payload.truncated) {
      throw new Error(`${this._name()} holds too many files to list in one request`);
    }

    return (payload.tree || [])
      .filter((entry) => entry.type === "blob" && entry.path.startsWith(under))
      .map((entry) => ({
        path: this._path(entry.path),
        size: entry.size || 0,
        // A tree entry carries no time, and the commit's time is when the
        // branch moved rather than when this file changed. The blob id is a
        // hash of the contents, so the mark does not need one.
        modifiedAt: 0,
        etag: entry.sha,
      }));
  }

  async read(path) {
    const response = await this._contents(this._key(contain(path)));

    // A path holding nothing is an answer, not a fault: the caller asked
    // whether there is a draft there, and there is not.
    if (response.status === 404) return null;
    if (!response.ok) throw this._failure(response, "read");

    const payload = await response.json();

    // An array is a directory listing, and a directory is not a file.
    if (Array.isArray(payload)) return null;

    // GitHub refuses to inline anything over a megabyte and hands over the blob
    // id instead. The blobs API has no such limit, so large media takes one
    // more request rather than being unreadable.
    if (payload.encoding !== "base64") return this._blob(payload.sha);

    return decode(payload.content);
  }

  async write(path, bytes) {
    const key = this._key(contain(path));
    const sha = await this._sha(key);

    const response = await this._send("PUT", `/contents/${route(key)}`, {
      message: `Update ${key}`,
      content: encode(Uint8Array.from(bytes)),
      branch: this._branch,
      // GitHub refuses a write over a file already there unless it is told
      // which version is being replaced, which is what stops two devices
      // losing each other's work.
      ...(sha ? { sha } : {}),
    });

    if (!response.ok) throw this._failure(response, "write");
  }

  async remove(path) {
    const key = this._key(contain(path));
    const sha = await this._sha(key);

    // Nothing there is already gone, and asking anyway would only earn a 404.
    if (!sha) return;

    const response = await this._send("DELETE", `/contents/${route(key)}`, {
      message: `Remove ${key}`,
      branch: this._branch,
      sha,
    });

    if (!response.ok) throw this._failure(response, "remove");
  }

  async media(path) {
    const bytes = await this.read(path);

    if (!bytes) return null;

    // No URL.createObjectURL in node, and nothing to revoke there either.
    if (typeof URL.createObjectURL !== "function") {
      return { url: `github:${this._key(contain(path))}`, release() {} };
    }

    const url = URL.createObjectURL(new Blob([bytes]));

    return { url, release: () => URL.revokeObjectURL(url) };
  }

  /**
   * Ask the repository one cheap question, and translate its answer.
   *
   * The failures here are the ones a customer actually hits, and each arrives
   * as a status that means more than one thing. A fine grained token an
   * organisation has not approved is a 404, indistinguishable from a typo in
   * the name; a 403 is either the rate limit or the token's permissions, and
   * only a header says which.
   *
   * @returns {Promise<{ok: boolean, reason: string}>} whether the repository can be used
   */
  async ready() {
    if (!this._owner || !this._repo) return { ok: false, reason: "no repository was named" };
    if (!this._token) return { ok: false, reason: "no token was given" };

    let response;

    try {
      response = await this._send("GET", "");
    } catch (error) {
      // Already explained by _send, which is where every request funnels, so
      // there is one wording of this rather than two that can drift.
      return { ok: false, reason: error.message };
    }

    if (response.ok) return { ok: true, reason: "" };

    if (response.status === 401) {
      return { ok: false, reason: "the token was refused - check it has not expired" };
    }

    if (response.status === 403) {
      if (response.headers.get("x-ratelimit-remaining") === "0") {
        return { ok: false, reason: "GitHub's rate limit is spent - it resets within the hour" };
      }

      return {
        ok: false,
        reason: `the token was refused - check it has contents read and write on ${this._name()}`,
      };
    }

    if (response.status === 404) {
      return {
        ok: false,
        reason: `no repository named ${this._name()}, or the token cannot see it`,
      };
    }

    return { ok: false, reason: `api.github.com answered ${response.status}` };
  }

  config() {
    return {
      type: GitHubAdapter.type,
      label: this._label,
      owner: this._owner,
      repo: this._repo,
      branch: this._branch,
      prefix: this._prefix,
      token: this._token,
    };
  }

  describe() {
    const where = `${this._name()} on ${this._branch}`;

    return this._prefix ? `${where}, under ${this._prefix}/` : where;
  }

  /**
   * The blob id a path is at now, which a write or a remove has to name.
   *
   * @param {string} key the path in the repository
   * @returns {Promise<string>} the id, or "" if nothing is there
   */
  async _sha(key) {
    const response = await this._contents(key);

    if (response.status === 404) return "";
    if (!response.ok) throw this._failure(response, "read");

    return (await response.json()).sha || "";
  }

  /**
   * @param {string} key the path in the repository
   * @returns {Promise<Response>} whatever the contents API said
   */
  _contents(key) {
    return this._send(
      "GET",
      `/contents/${route(key)}?ref=${encodeURIComponent(this._branch)}`,
    );
  }

  /**
   * A file too large for the contents API, fetched whole.
   *
   * @param {string} sha the blob id
   * @returns {Promise<Uint8Array>} the content
   */
  async _blob(sha) {
    const response = await this._send("GET", `/git/blobs/${encodeURIComponent(sha)}`);

    if (!response.ok) throw this._failure(response, "read");

    return decode((await response.json()).content);
  }

  /**
   * Send one request to the repository.
   *
   * @param {string} method the verb
   * @param {string} path what follows /repos/owner/repo
   * @param {object} [body] a payload, sent as JSON
   * @returns {Promise<Response>} whatever GitHub said
   */
  async _send(method, path, body) {
    const owner = encodeURIComponent(this._owner);
    const repo = encodeURIComponent(this._repo);
    const url = `${API}/repos/${owner}/${repo}${path}`;

    try {
      return await globalThis.fetch(url, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this._token}`,
          "X-GitHub-Api-Version": VERSION,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new Error(this._unreachable(error));
    }
  }

  /**
   * Why a request never got an answer.
   *
   * A browser reports a refused cross-origin request as a bare TypeError with
   * no detail. GitHub allows this origin, so unlike a bucket the customer
   * configured there is no rule of theirs to check, which leaves the network
   * or an extension blocking the host.
   *
   * @param {Error} error whatever fetch threw
   * @returns {string} something a reader can act on
   */
  _unreachable(error) {
    if (!(error instanceof TypeError)) return error.message;

    return (
      "could not reach api.github.com: the browser gave up before it got an answer. " +
      "GitHub allows requests from any origin, so this is the connection rather than a setting."
    );
  }

  _name() {
    return `${this._owner}/${this._repo}`;
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

  /**
   * @param {Response} response what came back
   * @param {string} what the operation that failed
   * @returns {Error} an error naming the status, and never the token
   */
  _failure(response, what) {
    const error = new Error(`could not ${what} from ${this._name()}: ${response.status}`);
    error.status = response.status;

    return error;
  }
}
