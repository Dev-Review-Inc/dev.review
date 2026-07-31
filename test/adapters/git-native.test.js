// Git over the real git binary, without a desktop.
//
// The Rust half is covered by its own unit tests. What is left to prove here is
// that the JavaScript half is interchangeable with the other backends, so the
// full conformance suite runs against GitAdapter wired to this transport, over
// a stand-in for the IPC boundary that drives an actual git repository in a
// temporary directory. The stand-in refuses the same paths the Rust side
// refuses and commits with the same commands, so a test cannot pass by being
// handed something more forgiving than the real thing.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { GitAdapter } from "../../web/src/adapters/git.js";
import { NativeTransport, inTauri, unavailability } from "../../web/src/adapters/git-native.js";
import { itBehavesLikeAnAdapter } from "./conformance.js";
import { gitEnvironment } from "./git-environment.js";

const bytes = (text) => new TextEncoder().encode(text);

const roots = [];

/**
 * Whether a path is one the Rust side would refuse.
 *
 * The same two rules: nothing that climbs or is rooted elsewhere, and nothing
 * that reaches the repository's own directory.
 *
 * @param {string} path the path as given
 * @returns {boolean} true if it must not be touched
 */
function outside(path) {
  const value = String(path ?? "");

  return (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.startsWith("~") ||
    /^[A-Za-z]:/.test(value) ||
    value.split(/[/\\]/).some((part) => part === ".." || part.toLowerCase() === ".git")
  );
}

/**
 * Check a slug the way the Rust side checks it, so a test cannot pass with one
 * the real thing refuses.
 *
 * @param {string} slug the folder name a source asked for
 */
function named(slug) {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(slug) || [".", "..", ".git"].includes(slug)) {
    throw new Error(`not a usable repository name: ${slug}`);
  }
}

/**
 * A stand-in for the Rust commands, running the same git the Rust side runs.
 *
 * @returns {{root: string, calls: object[], api: object}} the fake
 */
function fakeTauri() {
  const root = mkdtempSync(join(tmpdir(), "reviewer-git-native-"));
  const calls = [];

  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      // Not `process.env`. Inside a pre-commit hook it carries GIT_DIR, which
      // outranks cwd and would aim all of this at the repository being
      // committed to. See git-environment.js.
      env: gitEnvironment({
        GIT_CONFIG_COUNT: "4",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: ".git/reviewer-no-hooks",
        GIT_CONFIG_KEY_1: "commit.gpgsign",
        GIT_CONFIG_VALUE_1: "false",
        GIT_CONFIG_KEY_2: "user.name",
        GIT_CONFIG_VALUE_2: "Reviewer",
        GIT_CONFIG_KEY_3: "user.email",
        GIT_CONFIG_VALUE_3: "reviewer@dev.review",
      }),
    });

  const staged = () => {
    try {
      git(["diff", "--cached", "--quiet"]);

      return false;
    } catch {
      return true;
    }
  };

  const commands = {
    // The Rust side puts this under the app's own data directory. Here the
    // temp directory stands in for that, and the slug is checked the way Rust
    // checks it so a test cannot pass with a slug the real thing refuses.
    git_root: ({ slug }) => {
      named(slug);
      mkdirSync(root, { recursive: true });

      return root;
    },

    // Rust deletes the slug's folder under the base and says nothing when it
    // is not there. Here the base holds one folder, so this is that folder.
    git_forget: ({ slug }) => {
      named(slug);
      rmSync(root, { recursive: true, force: true });

      return null;
    },

    git_open: ({ settings }) => {
      if (!existsSync(join(root, ".git"))) git(["init", "-b", settings?.branch || "main"]);

      return null;
    },

    git_tree: () => {
      let listed;

      try {
        listed = git(["ls-tree", "-r", "-l", "-z", "HEAD"]);
      } catch {
        // No HEAD is a repository nobody has committed to yet.
        return [];
      }

      return listed
        .split("\0")
        .filter(Boolean)
        .map((record) => {
          const [head, path] = record.split("\t");
          const [, , oid, size] = head.split(/\s+/);

          return {
            path,
            oid,
            size: Number(size),
            modified_at: Date.now(),
          };
        });
    },

    git_read: ({ path }) => {
      const file = join(root, path);

      return existsSync(file) ? [...readFileSync(file)] : null;
    },

    git_commit_file: ({ path, bytes: written, message }) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), Buffer.from(written));

      git(["add", "--", path]);

      if (staged()) git(["commit", "--no-verify", "-q", "-m", message]);

      return null;
    },

    git_commit_removal: ({ path, message }) => {
      if (!git(["ls-files", "-z", "--", path])) return false;

      git(["rm", "-q", "--", path]);
      git(["commit", "--no-verify", "-q", "-m", message]);

      return true;
    },

    git_pull: () => null,
    git_push: () => null,
    git_ready: () => ({ ok: true, reason: "" }),
  };

  const api = {
    core: {
      async invoke(command, args = {}) {
        calls.push({ command, args });

        const run = commands[command];

        if (!run) throw new Error(`no such command: ${command}`);

        // Every command but the two that work from the slug is given the folder.
        if (!["git_root", "git_forget"].includes(command) && !args.root) {
          throw new Error("no repository folder has been chosen");
        }

        if (args.path != null && outside(args.path)) {
          throw new Error(`path is outside the workspace: ${args.path}`);
        }

        return run(args);
      },
    },
  };

  roots.push(root);

  return { root, calls, api };
}

/**
 * A git adapter over a real repository, reached the way the desktop reaches it.
 *
 * @param {object} [config] what to configure the adapter with
 * @returns {object} the adapter
 */
function build(config = {}) {
  const fake = fakeTauri();
  globalThis.__TAURI__ = fake.api;

  const transport = new NativeTransport(() => adapter.settings());
  const adapter = new GitAdapter(config, { transport });

  return adapter;
}

/**
 * A transport on its own, over a fresh repository.
 *
 * @param {object} [settings] what the adapter would have been configured with
 * @returns {{transport: object, calls: object[], root: string}} the transport and what it asked for
 */
function transporting(settings = {}) {
  const fake = fakeTauri();
  globalThis.__TAURI__ = fake.api;

  return { transport: new NativeTransport(settings), calls: fake.calls, root: fake.root };
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });

  delete globalThis.__TAURI__;
});

itBehavesLikeAnAdapter("git over native git", () => build());

describe("git over native git", () => {
  let adapter;

  beforeEach(() => {
    adapter = build();
  });

  test("commits every write, so the history is the audit trail", async () => {
    await adapter.write("drafts/org--app-1/review.json", bytes("{}"));

    const [entry] = await adapter.list("");

    assert.equal(entry.path, "drafts/org--app-1/review.json");
    assert.equal(entry.etag.length, 40);
  });

  test("marks a listed entry with the blob id, so a same-size rewrite is seen", async () => {
    await adapter.write("a.json", bytes("aaaa"));
    const [before] = await adapter.list("");

    await adapter.write("a.json", bytes("bbbb"));
    const [after] = await adapter.list("");

    assert.notEqual(before.etag, after.etag);
  });

  test("says nothing was removed when the path was never tracked", async () => {
    const { transport } = transporting();

    await transport.open();

    assert.equal(await transport.commitRemoval("nothing.json", "Remove"), false);
  });

  test("asks where the clone goes rather than being told", async () => {
    const { transport, calls } = transporting({ url: "https://github.com/org/reviews.git" });

    await transport.open();

    assert.equal(calls[0].command, "git_root");
    assert.match(calls[0].args.slug, /^github-com-org-reviews-[0-9a-f]{8}$/);
  });

  test("sends the repository folder and the settings with every call", async () => {
    const { transport, calls, root } = transporting({ branch: "drafts", token: "ghp_x" });

    await transport.open();

    const opened = calls.find((call) => call.command === "git_open");

    assert.equal(opened.args.root, root);
    assert.equal(opened.args.settings.branch, "drafts");
  });

  test("asks for the same folder every time, so a source is not cloned twice", async () => {
    const settings = { url: "https://github.com/org/reviews.git", branch: "drafts" };

    const first = transporting(settings);
    await first.transport.open();

    const second = transporting(settings);
    await second.transport.open();

    assert.equal(first.calls[0].args.slug, second.calls[0].args.slug);
  });

  test("asks for a different folder for a different branch or repository", async () => {
    const one = transporting({ url: "https://github.com/org/reviews.git", branch: "main" });
    await one.transport.open();

    const other = transporting({ url: "https://github.com/org/reviews.git", branch: "drafts" });
    await other.transport.open();

    const elsewhere = transporting({ url: "https://gitlab.com/org/reviews.git", branch: "main" });
    await elsewhere.transport.open();

    const slugs = new Set(
      [one, other, elsewhere].map((each) => each.calls[0].args.slug),
    );

    assert.equal(slugs.size, 3);
  });

  test("asks only once, however much work it is given", async () => {
    const { transport, calls } = transporting();

    await transport.open();
    await transport.tree();
    await transport.pull();

    assert.equal(calls.filter((call) => call.command === "git_root").length, 1);
  });

  test("forgets a source that was never opened", async () => {
    const { transport, calls } = transporting({ url: "https://github.com/org/reviews.git" });

    await transport.forget();

    assert.deepEqual(
      calls.map((call) => call.command),
      ["git_forget"],
    );
    assert.match(calls[0].args.slug, /^github-com-org-reviews-[0-9a-f]{8}$/);
  });

  test("takes the clone off the disk, so removing a source keeps no copy", async () => {
    const { transport, root } = transporting();

    await transport.open();
    await transport.commitFile("drafts/a.json", bytes("{}"), "Update drafts/a.json");

    assert.equal(existsSync(join(root, "drafts/a.json")), true);

    await transport.forget();

    assert.equal(existsSync(root), false);
  });

  test("forgetting twice is not an error", async () => {
    const { transport } = transporting();

    await transport.open();
    await transport.forget();

    assert.equal(await transport.forget(), undefined);
  });

  test("opens again after forgetting, rather than reusing a folder that is gone", async () => {
    const { transport } = transporting();

    await transport.open();
    await transport.forget();
    await transport.open();

    assert.deepEqual(await transport.tree(), []);
  });

  test("takes an ssh remote, so the machine's own keys and agent are what talks", async () => {
    const { transport, calls } = transporting({ url: "git@github.com:org/reviews.git" });

    await transport.open();

    assert.match(calls[0].args.slug, /^git-github-com-org-reviews-[0-9a-f]{8}$/);
    assert.equal(
      calls.find((call) => call.command === "git_open").args.settings.url,
      "git@github.com:org/reviews.git",
    );
  });

  test("refuses to touch the repository's own directory", async () => {
    const { transport } = transporting();

    await transport.open();

    await assert.rejects(() => transport.readFile(".git/config"), /outside/);
  });
});

describe("git over native git, outside the desktop app", () => {
  beforeEach(() => {
    delete globalThis.__TAURI__;
  });

  test("knows there is no git to reach", () => {
    assert.equal(inTauri(), false);
    assert.deepEqual(unavailability(), { reason: "needs the desktop app", hint: "" });
  });

  test("says so rather than throwing when asked if it is ready", async () => {
    assert.deepEqual(await new NativeTransport().ready(), {
      ok: false,
      reason: "this reader needs the desktop app",
    });
  });

  test("says so when asked to do work", async () => {
    await assert.rejects(
      () => new NativeTransport().open(),
      /the desktop app is not running/,
    );
  });
});

describe("git over native git, when git complains", () => {
  /**
   * A transport whose every call fails the way git failed.
   *
   * @param {string} said what git wrote to stderr
   * @param {object} [settings] what the adapter was configured with
   * @returns {object} the transport
   */
  function refusing(said, settings = {}) {
    globalThis.__TAURI__ = {
      core: {
        // Tauri rejects with the string a command returned, not with an Error.
        invoke: async () => {
          throw said;
        },
      },
    };

    return new NativeTransport(settings);
  }

  test("names bad credentials rather than repeating git's word for them", async () => {
    await assert.rejects(
      () => refusing("fatal: Authentication failed for 'https://github.com/org/reviews.git/'").push(),
      /refused the credentials/,
    );
  });

  test("names a refused ssh key, and says whose keys they are", async () => {
    await assert.rejects(
      () => refusing("git@github.com: Permission denied (publickey).").push(),
      /ssh key was refused.*this machine's own ssh config/,
    );
  });

  test("names a host this machine has never agreed to trust", async () => {
    await assert.rejects(
      () => refusing("Host key verification failed.").pull(),
      /never been trusted on this machine/,
    );
  });

  test("names a branch that has moved on", async () => {
    await assert.rejects(
      () => refusing("! [rejected] main -> main (non-fast-forward)").push(),
      /someone else pushed first/,
    );
  });

  test("names a repository that is not there", async () => {
    await assert.rejects(
      () => refusing("fatal: repository 'https://example.com/nope.git/' not found").push(),
      /could not be found at that url/,
    );
  });

  test("names a host that cannot be reached", async () => {
    await assert.rejects(
      () => refusing("fatal: unable to access: Could not resolve host: github.com").pull(),
      /host could not be reached/,
    );
  });

  test("names the files a merge could not settle", async () => {
    await assert.rejects(
      () => refusing("merge conflict in drafts/a.json, drafts/b.json").pull(),
      /drafts\/a\.json, drafts\/b\.json/,
    );
  });

  test("passes git's own words through when it has nothing better to say", async () => {
    await assert.rejects(() => refusing("fatal: bad object HEAD").pull(), /bad object HEAD/);
  });

  test("never lets the token into what it says", async () => {
    const token = "ghp_averysecrettoken";

    await assert.rejects(
      () => refusing(`fatal: could not read Password for 'https://${token}@github.com'`, { token }).push(),
      (error) => !error.message.includes(token),
    );
  });
});
