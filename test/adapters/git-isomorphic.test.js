// The isomorphic-git transport, against real repositories.
//
// The contract is the conformance suite, run through a real GitAdapter over a
// real repository in a temporary directory. Everything else here is what only
// this transport has: commits, blob ids, a remote it can fall out of step with,
// and the proxy a browser needs to reach a git host at all.
//
// node's own filesystem stands in for the browser's IndexedDB, which is the
// whole point of git taking its filesystem as an argument.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promises as fsp } from "node:fs";
import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import git from "../../web/vendor/isomorphic-git.js";
import { GitAdapter } from "../../web/src/adapters/git.js";
import {
  IsomorphicTransport,
  isomorphicTransport,
  proxied,
} from "../../web/src/adapters/git-isomorphic.js";
import { itBehavesLikeAnAdapter } from "./conformance.js";
import { gitEnvironment } from "./git-environment.js";

// isomorphic-git decides a filesystem is promise-flavoured by looking for an
// own enumerable `promises`, which is what an object literal gives it.
const fs = { promises: fsp };

const bytes = (text) => new TextEncoder().encode(text);

const roots = [];

/**
 * A directory that is cleaned up after the test that asked for it.
 *
 * @returns {Promise<string>} the path
 */
async function root() {
  const made = await mkdtemp(join(tmpdir(), "reviewer-git-"));
  roots.push(made);

  return made;
}

/**
 * An adapter over a fresh, empty repository on disk.
 *
 * The adapter is the authority on what its transport needs, so the settings
 * come from it rather than from a second copy of the same configuration here.
 *
 * @param {object} [config] what to configure it with
 * @returns {Promise<{adapter: GitAdapter, transport: IsomorphicTransport, dir: string}>} the adapter and what is under it
 */
async function build(config = {}) {
  const dir = await root();
  const transport = isomorphicTransport(new GitAdapter(config).settings(), { fs, dir });

  return { adapter: new GitAdapter(config, { transport }), transport, dir };
}

/**
 * Every commit message on the branch, newest first.
 *
 * @param {string} dir the repository
 * @returns {Promise<string[]>} the messages, trimmed
 */
async function messages(dir) {
  const log = await git.log({ fs, dir, ref: "main" }).catch(() => []);

  return log.map((entry) => entry.commit.message.trim());
}

const servers = [];

// Never `process.env`. Inside a pre-commit hook that carries GIT_DIR, which
// outranks -C and would aim every one of these at the repository being
// committed to. See git-environment.js.
const execute = promisify(execFile);
const run = (command, args) => execute(command, args, { env: gitEnvironment() });

/**
 * A repository to push to, served the way a git host serves one.
 *
 * isomorphic-git speaks smart HTTP and nothing else, so a `file://` remote is
 * not something it can be pointed at. The real server is `git http-backend`,
 * which is git's own, so fetch, push and merge here go over the same protocol
 * and the same packfiles they will in front of a customer.
 *
 * @returns {Promise<{url: string, gitdir: string}>} the remote
 */
async function origin() {
  const project = await root();
  const gitdir = join(project, "repo.git");

  await run("git", ["init", "--bare", "--initial-branch=main", gitdir]);
  await run("git", ["-C", gitdir, "config", "http.receivepack", "true"]);

  // A clone of a repository with no commits has no branch to check out, so the
  // remote starts the way a customer's does: with something already in it.
  const seed = await root();
  await run("git", ["init", "--initial-branch=main", seed]);
  await writeFile(join(seed, ".keep"), "");
  await run("git", ["-C", seed, "add", ".keep"]);
  // Named explicitly so the machine's own git configuration, which may sign
  // commits or have no identity at all, is not what decides whether this passes.
  await run("git", [
    "-C",
    seed,
    "-c",
    "user.name=Reviewer",
    "-c",
    "user.email=reviewer@dev.review",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Start",
  ]);
  await run("git", ["-C", seed, "push", gitdir, "main"]);

  const server = createServer((request, response) => backend(project, request, response));
  servers.push(server);

  await new Promise((done) => server.listen(0, "127.0.0.1", done));

  return { url: `http://127.0.0.1:${server.address().port}/repo.git`, gitdir };
}

/**
 * Answer one request by handing it to `git http-backend` as CGI.
 *
 * @param {string} project the directory holding the repository
 * @param {import("node:http").IncomingMessage} request what came in
 * @param {import("node:http").ServerResponse} response what to write back
 * @returns {void}
 */
function backend(project, request, response) {
  const url = new URL(request.url, "http://127.0.0.1");

  // A GIT_DIR inherited from a calling git would outrank GIT_PROJECT_ROOT, and
  // this server accepts pushes. It would be serving the repository being
  // committed to, over http, to anything that asked.
  const child = spawn("git", ["http-backend"], {
    env: gitEnvironment({
      GIT_PROJECT_ROOT: project,
      GIT_HTTP_EXPORT_ALL: "1",
      REQUEST_METHOD: request.method,
      PATH_INFO: url.pathname,
      QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: request.headers["content-type"] || "",
      CONTENT_LENGTH: request.headers["content-length"] || "",
      HTTP_CONTENT_ENCODING: request.headers["content-encoding"] || "",
      REMOTE_USER: "reviewer",
      REMOTE_ADDR: "127.0.0.1",
    }),
  });

  request.pipe(child.stdin);

  const parts = [];
  child.stdout.on("data", (part) => parts.push(part));

  child.on("close", () => {
    const answer = Buffer.concat(parts);
    const split = answer.indexOf("\r\n\r\n");
    const boundary = split === -1 ? answer.indexOf("\n\n") : split;
    const width = split === -1 ? 2 : 4;

    let status = 200;
    const headers = {};

    for (const line of answer.subarray(0, boundary).toString().split(/\r?\n/)) {
      const [name, ...rest] = line.split(":");

      if (!rest.length) continue;
      if (name.toLowerCase() === "status") status = Number(rest.join(":").trim().split(" ")[0]);
      else headers[name] = rest.join(":").trim();
    }

    response.writeHead(status, headers);
    response.end(answer.subarray(boundary + width));
  });
}

afterEach(async () => {
  while (servers.length) await new Promise((done) => servers.pop().close(done));
  while (roots.length) await rm(roots.pop(), { recursive: true, force: true });
});

itBehavesLikeAnAdapter("git over isomorphic-git", async () => (await build()).adapter);

describe("the isomorphic-git transport", () => {
  let adapter;
  let transport;
  let dir;

  beforeEach(async () => {
    ({ adapter, transport, dir } = await build());
  });

  test("commits every write, so the history is the audit trail", async () => {
    await adapter.write("drafts/a.json", bytes("{}"));

    assert.deepEqual(await messages(dir), ["Update drafts/a.json"]);
  });

  test("commits a removal", async () => {
    await adapter.write("a.json", bytes("{}"));

    await adapter.remove("a.json");

    assert.deepEqual(await messages(dir), ["Remove a.json", "Update a.json"]);
  });

  test("puts nothing in the history for removing what was never there", async () => {
    await adapter.write("a.json", bytes("{}"));

    assert.equal(await transport.commitRemoval("b.json", "Remove b.json"), false);
    assert.deepEqual(await messages(dir), ["Update a.json"]);
  });

  test("marks each entry with the blob id, so a same-size rewrite is a change", async () => {
    await adapter.write("a.json", bytes("aaaa"));
    const [before] = await transport.tree();

    await adapter.write("a.json", bytes("bbbb"));
    const [after] = await transport.tree();

    assert.match(before.etag, /^[0-9a-f]{40}$/);
    assert.equal(before.size, after.size);
    assert.notEqual(before.etag, after.etag);
  });

  test("says a repository with no commits holds nothing, rather than throwing", async () => {
    await transport.open();

    assert.deepEqual(await transport.tree(), []);
  });

  test("never lists the repository's own bookkeeping", async () => {
    await adapter.write("a.json", bytes("{}"));

    const listed = (await transport.tree()).map((entry) => entry.path);

    assert.deepEqual(listed, ["a.json"]);
  });

  test("reads a path holding nothing as nothing", async () => {
    await transport.open();

    assert.equal(await transport.readFile("nothing/at/all.json"), null);
  });

  test("reads a directory as nothing, rather than as bytes", async () => {
    await adapter.write("drafts/a.json", bytes("{}"));

    assert.equal(await transport.readFile("drafts"), null);
  });

  test("opens once, however many callers ask", async () => {
    await adapter.write("a.json", bytes("{}"));

    await transport.open();
    await transport.open();

    assert.deepEqual(await messages(dir), ["Update a.json"]);
  });
});

describe("forgetting a repository", () => {
  /**
   * @param {string} path a directory
   * @returns {Promise<boolean>} whether anything is there
   */
  const there = (path) => fsp.stat(path).then(() => true, () => false);

  test("is not an error on a source nobody ever opened", async () => {
    const { transport, dir } = await build();

    await transport.forget();

    assert.equal(await there(dir), false);
  });

  test("takes the files, the repository and the directory itself", async () => {
    const { adapter, transport, dir } = await build();
    await adapter.write("drafts/a.json", bytes("{}"));

    await transport.forget();

    assert.equal(await there(dir), false);
  });

  test("is not an error the second time", async () => {
    const { adapter, transport } = await build();
    await adapter.write("a.json", bytes("{}"));

    await transport.forget();

    await transport.forget();
  });

  test("leaves a clone behind that a later open starts again from nothing", async () => {
    const { adapter, transport } = await build();
    await adapter.write("a.json", bytes("{}"));

    await transport.forget();
    await transport.open();

    assert.deepEqual(await transport.tree(), []);
  });

  test("leaves every other repository on the same filesystem alone", async () => {
    const mine = await build();
    const theirs = await build();
    await mine.adapter.write("a.json", bytes("mine"));
    await theirs.adapter.write("a.json", bytes("theirs"));

    await mine.transport.forget();

    assert.equal(new TextDecoder().decode(await theirs.adapter.read("a.json")), "theirs");
  });

  test("refuses a directory that would take the whole filesystem with it", async () => {
    const transport = isomorphicTransport({}, { fs, dir: "/" });

    await assert.rejects(() => transport.forget(), /whole filesystem/);
  });
});

describe("where an unconfigured transport keeps its repository", () => {
  test("is the same place for the same repository and branch", () => {
    const settings = { url: "https://github.com/org/reviews.git", branch: "main" };

    assert.equal(
      new IsomorphicTransport(settings).dir,
      new IsomorphicTransport({ ...settings }).dir,
    );
  });

  test("is a different place for a different branch", () => {
    const url = "https://github.com/org/reviews.git";

    assert.notEqual(
      new IsomorphicTransport({ url, branch: "main" }).dir,
      new IsomorphicTransport({ url, branch: "trunk" }).dir,
    );
  });
});

describe("a repository with a remote", () => {
  let remote;

  beforeEach(async () => {
    remote = await origin();
  });

  /**
   * @param {string} gitdir the bare repository
   * @returns {Promise<string[]>} every path on its main branch
   */
  const onRemote = (gitdir) => git.listFiles({ fs, gitdir, ref: "main" });

  test("starts from what is already in the repository", async () => {
    const { transport } = await build({ url: remote.url });

    assert.deepEqual(
      (await transport.tree()).map((entry) => entry.path),
      [".keep"],
    );
  });

  test("sends what it commits", async () => {
    const { adapter } = await build({ url: remote.url });

    await adapter.write("drafts/a.json", bytes("{}"));

    assert.deepEqual(await onRemote(remote.gitdir), [".keep", "drafts/a.json"]);
  });

  /**
   * Two devices, each with its own clone, both taken before either writes.
   *
   * Cloning lazily on the first write would mean the second device started
   * from the first device's commit, and there would be nothing to fall out of
   * step over.
   *
   * @returns {Promise<{mine: object, theirs: object, pull: () => Promise<void>}>} both devices
   */
  async function devices() {
    const one = await build({ url: remote.url });
    const two = await build({ url: remote.url });

    await one.transport.open();
    await two.transport.open();

    return { mine: one.adapter, theirs: two.adapter, pull: () => one.transport.pull() };
  }

  test("brings the other device's work in", async () => {
    const { mine, theirs, pull } = await devices();

    await theirs.write("drafts/a.json", bytes("theirs"));
    await pull();

    assert.equal(new TextDecoder().decode(await mine.read("drafts/a.json")), "theirs");
  });

  test("merges work that arrived while it was writing, rather than losing the push", async () => {
    const { mine, theirs } = await devices();

    await theirs.write("drafts/theirs.json", bytes("{}"));
    await mine.write("drafts/mine.json", bytes("{}"));

    assert.deepEqual(await onRemote(remote.gitdir), [
      ".keep",
      "drafts/mine.json",
      "drafts/theirs.json",
    ]);
  });

  test("says which path two devices disagree about", async () => {
    const { mine, theirs } = await devices();

    await theirs.write("drafts/a.json", bytes("theirs"));

    await assert.rejects(() => mine.write("drafts/a.json", bytes("mine")), /drafts\/a\.json/);
  });
});

describe("putting a proxy in front of a git host", () => {
  test("leaves the url alone when there is no proxy", () => {
    assert.equal(proxied("", "https://github.com/org/reviews.git"), "https://github.com/org/reviews.git");
  });

  test("appends the whole url to a proxy that ends in a question mark", () => {
    assert.equal(
      proxied("https://cors.example.com?", "https://github.com/org/reviews.git"),
      "https://cors.example.com?https://github.com/org/reviews.git",
    );
  });

  test("appends the url as a path to a proxy that does not, dropping the scheme", () => {
    assert.equal(
      proxied("https://cors.example.com", "https://github.com/org/reviews.git"),
      "https://cors.example.com/github.com/org/reviews.git",
    );
  });
});

describe("a remote a tab cannot reach", () => {
  test("says an ssh remote needs the desktop app rather than blaming the proxy", async () => {
    const transport = new IsomorphicTransport({ url: "git@github.com:org/reviews.git" });

    assert.deepEqual(await transport.ready(), {
      ok: false,
      reason: "an ssh remote needs the desktop app",
    });
  });

  test("says the same when asked to clone one", async () => {
    const where = await mkdtemp(join(tmpdir(), "reviewer-git-ssh-"));
    roots.push(where);
    const transport = new IsomorphicTransport(
      { url: "ssh://git@github.com/org/reviews.git" },
      { fs: { promises: fsp }, dir: where },
    );

    await assert.rejects(() => transport.open(), /needs the desktop app/);
  });
});
