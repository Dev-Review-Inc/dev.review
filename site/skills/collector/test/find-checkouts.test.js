import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findCheckouts } from "../resolve-repo.js";

// tree builds a directory layout under a fresh temp dir. A path ending in
// "/.git" is created as a directory, which is what marks a checkout.
function tree(...paths) {
  // Resolved, because findCheckouts reports real paths so that overlapping
  // roots dedupe — and on macOS the temp dir is reached through a symlink.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "checkouts-")));

  for (const entry of paths) {
    fs.mkdirSync(path.join(root, entry), { recursive: true });
  }

  return root;
}

// found returns the checkout paths relative to the root, sorted.
function found(root, options) {
  return findCheckouts([root], options)
    .map((checkout) => path.relative(root, checkout))
    .sort();
}

test("finds a checkout directly inside the folder", () => {
  const root = tree("app/.git");

  assert.deepStrictEqual(found(root), ["app"]);
});

test("finds a checkout nested several folders deep", () => {
  const root = tree("com/someone/dev/review/.git");

  assert.deepStrictEqual(found(root), ["com/someone/dev/review"]);
});

test("finds checkouts at different depths in one pass", () => {
  const root = tree("forge/app/.git", "games/.git", "co/one/two/thing/.git");

  assert.deepStrictEqual(found(root), ["co/one/two/thing", "forge/app", "games"]);
});

test("stops at a checkout rather than walking into it", () => {
  const root = tree("app/.git", "app/vendor/gem/.git", "app/.claude/worktrees/wt/.git");

  assert.deepStrictEqual(found(root), ["app"]);
});

test("ignores dependency and build directories", () => {
  const root = tree("app/.git", "node_modules/pkg/.git", "tmp/scratch/.git");

  assert.deepStrictEqual(found(root), ["app"]);
});

test("ignores hidden directories, which are not project checkouts", () => {
  const root = tree("app/.git", ".cache/thing/.git");

  assert.deepStrictEqual(found(root), ["app"]);
});

test("stops descending at the depth limit", () => {
  const root = tree("a/b/c/d/e/deep/.git");

  assert.deepStrictEqual(found(root, { maxDepth: 3 }), []);
  assert.deepStrictEqual(found(root, { maxDepth: 6 }), ["a/b/c/d/e/deep"]);
});

test("treats a folder that is itself a checkout as one", () => {
  const root = tree(".git");

  assert.deepStrictEqual(found(root), [""]);
});

test("tolerates a root that does not exist", () => {
  assert.deepStrictEqual(findCheckouts(["/no/such/place"]), []);
});

test("does not report the same checkout twice when roots overlap", () => {
  const root = tree("forge/app/.git");
  const paths = findCheckouts([root, path.join(root, "dns")]);

  assert.strictEqual(paths.length, 1);
});
