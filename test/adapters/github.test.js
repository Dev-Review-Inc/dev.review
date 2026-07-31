// The GitHub adapter, proved interchangeable with the others.
//
// The point of the conformance suite is that a backend either behaves like
// every other backend or fails out loud, so this runs the whole suite against
// the real adapter with a fake GitHub standing in for the network. The fake is
// strict where GitHub is strict: it refuses a write over an existing file that
// does not name the version it replaces, it refuses to inline a file over a
// megabyte, and it answers a repository with no commits in it with a 409. Those
// are the three places this adapter would otherwise quietly be wrong.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { itBehavesLikeAnAdapter } from "./conformance.js";
import { GitHubAdapter } from "../../web/src/adapters/github.js";

const API = "https://api.github.com";
const OWNER = "dev-review";
const REPO = "reviews";
const BRANCH = "main";
const TOKEN = "github_pat_11EXAMPLE";

// What GitHub will inline in a contents response. Anything at or over this
// comes back with no content at all and has to be fetched as a blob.
const INLINE = 1024 * 1024;

const bytes = (text) => new TextEncoder().encode(text);

/**
 * Base64, written out longhand rather than borrowed from the adapter, so a bug
 * in one is not cancelled out by the same bug in the other.
 *
 * @param {Uint8Array} content the bytes
 * @returns {string} the encoding
 */
function base64(content) {
  let binary = "";

  for (const byte of content) binary += String.fromCharCode(byte);

  return globalThis.btoa(binary);
}

/**
 * A hash that changes when the content does, standing in for git's blob id.
 *
 * @param {Uint8Array} content the file's bytes
 * @returns {string} a hex id
 */
function shaOf(content) {
  let hash = 0x811c9dc5;

  for (const byte of content) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }

  return `${hash.toString(16).padStart(8, "0")}${content.length}`;
}

/**
 * An in-memory GitHub that answers `fetch`.
 *
 * @returns {{fetch: Function, store: Map, calls: object[], truncated: boolean, reset: Function}} the fake
 */
function fakeGitHub() {
  const store = new Map();
  const calls = [];

  const json = (status, payload, headers = {}) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

  const missing = () => json(404, { message: "Not Found" });

  const file = (path) => {
    const content = store.get(path);
    const sha = shaOf(content);

    // GitHub will not inline a large file. It answers with the metadata and an
    // encoding of "none", leaving the blob id as the only way through.
    if (content.length >= INLINE) {
      return json(200, {
        type: "file",
        path,
        sha,
        size: content.length,
        content: "",
        encoding: "none",
      });
    }

    return json(200, {
      type: "file",
      path,
      sha,
      size: content.length,
      // Real responses arrive wrapped at 60 columns.
      content: base64(content).replace(/(.{60})/g, "$1\n"),
      encoding: "base64",
    });
  };

  // Named, and referred to by name rather than through `this`, because the
  // adapter is handed `fake.fetch` on its own as globalThis.fetch.
  const fake = {
    store,
    calls,
    truncated: false,

    reset() {
      store.clear();
      calls.length = 0;
      fake.truncated = false;
    },

    fetch: async (url, init = {}) => {
      const parsed = new URL(url);
      const method = (init.method || "GET").toUpperCase();
      const headers = init.headers || {};
      const body = init.body ? JSON.parse(init.body) : null;

      calls.push({ method, url: String(url), headers, body });

      if (headers.Authorization !== `Bearer ${TOKEN}`) {
        return json(401, { message: "Bad credentials" });
      }

      const segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      const [root, owner, repo, ...rest] = segments;

      if (root !== "repos" || owner !== OWNER || repo !== REPO) return missing();

      if (!rest.length) return json(200, { full_name: `${OWNER}/${REPO}` });

      if (rest[0] === "git" && rest[1] === "trees") {
        if (rest[2] !== BRANCH) return missing();

        // A repository nobody has committed to has no tree to walk.
        if (!store.size) return json(409, { message: "Git Repository is empty." });

        const tree = [...store.keys()].sort().map((path) => ({
          path,
          mode: "100644",
          type: "blob",
          sha: shaOf(store.get(path)),
          size: store.get(path).length,
        }));

        return json(200, { sha: "tree", tree, truncated: fake.truncated });
      }

      if (rest[0] === "git" && rest[1] === "blobs") {
        const found = [...store.values()].find((content) => shaOf(content) === rest[2]);

        if (!found) return missing();

        return json(200, {
          sha: rest[2],
          size: found.length,
          content: base64(found),
          encoding: "base64",
        });
      }

      if (rest[0] === "contents") {
        const path = rest.slice(1).join("/");

        if (method === "GET") {
          if (parsed.searchParams.get("ref") !== BRANCH) return missing();

          return store.has(path) ? file(path) : missing();
        }

        if (method === "PUT") {
          const sha = store.has(path) ? shaOf(store.get(path)) : "";

          // Writing over a file without saying which version is being replaced
          // is how two devices lose each other's work, so GitHub refuses it.
          if (sha !== (body.sha || "")) {
            return json(409, { message: `${path} does not match ${body.sha || "nothing"}` });
          }

          const content = Uint8Array.from(globalThis.atob(body.content), (character) =>
            character.charCodeAt(0),
          );

          store.set(path, content);

          return json(sha ? 200 : 201, { content: { path, sha: shaOf(content) } });
        }

        if (method === "DELETE") {
          if (!store.has(path)) return missing();
          if (body.sha !== shaOf(store.get(path))) return json(409, { message: "sha mismatch" });

          store.delete(path);

          return json(200, { commit: {} });
        }
      }

      return missing();
    },
  };

  return fake;
}

const github = fakeGitHub();

/**
 * @param {object} overrides anything to change about the standard config
 * @returns {GitHubAdapter} an adapter pointed at the fake
 */
function build(overrides = {}) {
  return new GitHubAdapter({
    label: "Test repository",
    owner: OWNER,
    repo: REPO,
    branch: BRANCH,
    token: TOKEN,
    ...overrides,
  });
}

itBehavesLikeAnAdapter("github", () => {
  github.reset();
  globalThis.fetch = github.fetch;

  return build();
});

describe("github adapter, in its own terms", () => {
  let adapter;

  beforeEach(() => {
    github.reset();
    globalThis.fetch = github.fetch;
    adapter = build();
  });

  test("reads the whole tree in one request rather than walking directories", async () => {
    await adapter.write("drafts/org--app-1/review.json", bytes("{}"));
    await adapter.write("drafts/org--app-2/review.json", bytes("{}"));
    github.calls.length = 0;

    const listed = (await adapter.list("drafts/")).map((entry) => entry.path).sort();

    assert.deepEqual(listed, [
      "drafts/org--app-1/review.json",
      "drafts/org--app-2/review.json",
    ]);
    assert.equal(github.calls.length, 1);
    assert.match(github.calls[0].url, /\/git\/trees\/main\?recursive=1$/);
  });

  test("refuses to report a truncated tree as the whole tree", async () => {
    await adapter.write("drafts/a.json", bytes("{}"));
    github.truncated = true;

    await assert.rejects(() => adapter.list("drafts/"), /too many files|truncat/i);
  });

  test("marks entries by blob id, since a tree carries no time", async () => {
    await adapter.write("a.json", bytes("hello"));

    const [entry] = await adapter.list("");

    assert.equal(entry.etag, shaOf(bytes("hello")));
    assert.equal(entry.modifiedAt, 0);
    assert.equal(entry.size, 5);
  });

  test("says a repository with no commits holds nothing rather than failing", async () => {
    assert.deepEqual(await adapter.list(""), []);
  });

  test("does not mistake a branch that is not there for an empty repository", async () => {
    await adapter.write("a.json", bytes("{}"));

    await assert.rejects(() => build({ branch: "nope" }).list(""), /404/);
  });

  test("reads a file the contents api will not inline, through its blob", async () => {
    const big = new Uint8Array(INLINE + 32).map((_, at) => at % 251);

    await adapter.write("run.mp4", big);
    github.calls.length = 0;

    assert.deepEqual(await adapter.read("run.mp4"), big);
    assert.ok(
      github.calls.some((call) => call.url.includes("/git/blobs/")),
      "a file over a megabyte has to come back as a blob",
    );
  });

  test("names the version it replaces, which a write over an existing file needs", async () => {
    await adapter.write("a.json", bytes("first"));
    await adapter.write("a.json", bytes("second"));

    const puts = github.calls.filter((call) => call.method === "PUT");

    assert.equal(puts.length, 2);
    assert.equal(puts[0].body.sha, undefined);
    assert.equal(puts[1].body.sha, shaOf(bytes("first")));
    assert.equal(puts[1].body.branch, BRANCH);

    // And the fake really would have refused a write that did not name it.
    const bare = await github.fetch(`${API}/repos/${OWNER}/${REPO}/contents/a.json`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ message: "x", content: "", branch: BRANCH }),
    });

    assert.equal(bare.status, 409);
  });

  test("asks for no delete at all when there is nothing there", async () => {
    await adapter.remove("a.json");

    assert.deepEqual(
      github.calls.filter((call) => call.method === "DELETE"),
      [],
    );
  });

  test("names the version it removes", async () => {
    await adapter.write("a.json", bytes("{}"));
    await adapter.remove("a.json");

    const [deleted] = github.calls.filter((call) => call.method === "DELETE");

    assert.equal(deleted.body.sha, shaOf(bytes("{}")));
    assert.equal(deleted.body.branch, BRANCH);
  });

  test("writes under the configured prefix and lists without it", async () => {
    const prefixed = build({ prefix: "team/reviews" });

    await prefixed.write("drafts/a.json", bytes("{}"));

    assert.ok(github.store.has("team/reviews/drafts/a.json"));
    assert.deepEqual(
      (await prefixed.list("drafts/")).map((entry) => entry.path),
      ["drafts/a.json"],
    );
    assert.deepEqual(await prefixed.read("drafts/a.json"), bytes("{}"));
  });

  test("keeps containment about the caller's path, not the prefixed one", async () => {
    const prefixed = build({ prefix: "team/reviews" });

    await assert.rejects(() => prefixed.read("../../etc/passwd"), /outside/);
  });

  test("sends the token as a bearer, with the api version it was written for", async () => {
    await adapter.write("a.json", bytes("{}"));

    for (const call of github.calls) {
      assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
      assert.equal(call.headers.Accept, "application/vnd.github+json");
      assert.ok(call.headers["X-GitHub-Api-Version"], call.url);
    }
  });

  test("never puts the token in a url or in what it throws", async () => {
    globalThis.fetch = async (url, init) => {
      await github.fetch(url, init);

      return new Response("{}", { status: 500 });
    };

    for (const attempt of [
      () => adapter.list(""),
      () => adapter.read("a.json"),
      () => adapter.write("a.json", bytes("{}")),
      () => adapter.remove("a.json"),
    ]) {
      await assert.rejects(attempt, (error) => {
        assert.ok(!error.message.includes(TOKEN), error.message);

        return true;
      });
    }

    for (const call of github.calls) assert.ok(!call.url.includes(TOKEN), call.url);
  });

  test("refuses to pretend a server error is an empty file", async () => {
    globalThis.fetch = async () => new Response("{}", { status: 500 });

    await assert.rejects(() => adapter.read("a.json"), /500/);
  });

  test("says it is ready when the repository answers", async () => {
    assert.deepEqual(await adapter.ready(), { ok: true, reason: "" });
  });

  test("says what is missing before it asks anything", async () => {
    assert.match((await build({ owner: "" }).ready()).reason, /no repository/);
    assert.match((await build({ token: "" }).ready()).reason, /no token/);
    assert.deepEqual(github.calls, []);
  });

  test("blames the token when GitHub will not accept it", async () => {
    const { ok, reason } = await build({ token: "expired" }).ready();

    assert.equal(ok, false);
    assert.match(reason, /expired/);
  });

  test("blames the rate limit when the count is spent", async () => {
    globalThis.fetch = async () =>
      new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } });

    const { ok, reason } = await adapter.ready();

    assert.equal(ok, false);
    assert.match(reason, /rate limit/);
  });

  test("blames the token's permissions when a 403 is not the rate limit", async () => {
    globalThis.fetch = async () =>
      new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "4999" } });

    const { ok, reason } = await adapter.ready();

    assert.equal(ok, false);
    assert.match(reason, /contents/);
  });

  test("cannot tell a repository that is not there from one it cannot see", async () => {
    const { ok, reason } = await build({ repo: "private" }).ready();

    assert.equal(ok, false);
    assert.match(reason, /no repository named dev-review\/private/);
  });

  test("explains a request that never got an answer", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    const { ok, reason } = await adapter.ready();

    assert.equal(ok, false);
    assert.match(reason, /could not reach api\.github\.com/);
  });

  test("keeps enough to be rebuilt, and no more than was given", async () => {
    const config = build({ prefix: "team" }).config();

    assert.equal(config.type, "github");
    assert.equal(config.owner, OWNER);
    assert.equal(config.repo, REPO);
    assert.equal(config.branch, BRANCH);
    assert.equal(config.prefix, "team");
    assert.equal(config.token, TOKEN);

    const rebuilt = new GitHubAdapter(config);

    await rebuilt.write("a.json", bytes("{}"));

    assert.ok(github.store.has("team/a.json"));
    assert.deepEqual(rebuilt.config(), config);
  });

  test("describes where it points", () => {
    assert.equal(build().describe(), "dev-review/reviews on main");
    assert.equal(
      build({ prefix: "team/reviews" }).describe(),
      "dev-review/reviews on main, under team/reviews/",
    );
  });

  test("asks for what a repository needs and marks the token secret", () => {
    const fields = Object.fromEntries(GitHubAdapter.fields.map((field) => [field.key, field]));

    assert.deepEqual(Object.keys(fields), ["owner", "repo", "branch", "prefix", "token"]);
    assert.ok(fields.owner.required && fields.repo.required && fields.token.required);
    assert.ok(fields.token.secret);
    assert.ok(GitHubAdapter.fields.every((field) => field.mono));
  });
});
