// That a suite which drives git cannot be aimed at the wrong repository.
//
// This is not a unit test of a helper for its own sake. The suites here spawn
// real git, and git points its children at a repository through the
// environment. A hook is a child process, so GIT_DIR is set for the whole of a
// pre-commit run, and it outranks both `-C` and the working directory.
//
// The cost of getting this wrong is not a failing test. It is a suite that
// reconfigures the repository it was run from, which is what happened here:
// `core.bare` and `http.receivepack` were written to this project's own config
// and every worktree stopped working until they were removed by hand.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitEnvironment } from "./git-environment.js";

describe("running git from a suite that git itself started", () => {
  test("drops every variable naming somebody else's repository", () => {
    const environment = gitEnvironment();

    assert.deepEqual(
      Object.keys(environment).filter((name) => name.startsWith("GIT_")),
      // Only the one it sets itself, so nothing can hang on a prompt.
      ["GIT_TERMINAL_PROMPT"],
    );
  });

  test("keeps the rest of the environment, which git still needs", () => {
    assert.equal(gitEnvironment().PATH, process.env.PATH);
  });

  test("lets a caller name the variables it does want", () => {
    assert.equal(gitEnvironment({ GIT_PROJECT_ROOT: "/tmp/x" }).GIT_PROJECT_ROOT, "/tmp/x");
  });

  // The failure this exists to stop, run for real: a config write aimed at a
  // temporary repository must not land in the one GIT_DIR names.
  test("writes to the repository it was told to, not the one it inherited", () => {
    const bystander = mkdtempSync(join(tmpdir(), "reviewer-bystander-"));
    const target = join(mkdtempSync(join(tmpdir(), "reviewer-target-")), "repo.git");

    const before = process.env.GIT_DIR;

    try {
      execFileSync("git", ["init", "-q", bystander], { env: gitEnvironment() });
      execFileSync("git", ["init", "--bare", "-q", target], { env: gitEnvironment() });

      // Exactly what `git commit` hands its hooks, and what broke this
      // repository. Set on the process, because that is where a test picks it
      // up from when it reaches for `process.env`.
      process.env.GIT_DIR = join(bystander, ".git");

      execFileSync("git", ["-C", target, "config", "http.receivepack", "true"], {
        env: gitEnvironment(),
      });

      assert.equal(read(target, "http.receivepack"), "true");
      assert.equal(read(bystander, "http.receivepack"), "");
    } finally {
      if (before === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = before;

      rmSync(bystander, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });
});

/**
 * One config value, or "" when it is not set.
 *
 * @param {string} repository the repository to ask
 * @param {string} key the setting
 * @returns {string} the value
 */
function read(repository, key) {
  try {
    return execFileSync("git", ["-C", repository, "config", "--get", key], {
      encoding: "utf8",
      env: gitEnvironment(),
    }).trim();
  } catch {
    return "";
  }
}
