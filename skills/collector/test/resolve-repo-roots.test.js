import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { searchRoots, neighborhood } from "../resolve-repo.js";

test("uses the configured checkout roots when they are set", () => {
  assert.deepStrictEqual(searchRoots({ REVIEWER_CHECKOUTS: "/work/repos" }, "/somewhere"), [
    "/work/repos",
  ]);
});

test("reads several roots from one colon-separated setting", () => {
  assert.deepStrictEqual(searchRoots({ REVIEWER_CHECKOUTS: "/a:/b:/c" }, "/somewhere"), [
    "/a",
    "/b",
    "/c",
  ]);
});

test("ignores empty entries left by a trailing separator", () => {
  assert.deepStrictEqual(searchRoots({ REVIEWER_CHECKOUTS: "/a::/b:" }, "/x"), ["/a", "/b"]);
});

test("falls back to the given directory", () => {
  assert.deepStrictEqual(searchRoots({}, "/home/someone/apps/checkouts"), ["/home/someone/apps/checkouts"]);
});

test("treats a blank setting as unset rather than as a root of nothing", () => {
  assert.deepStrictEqual(searchRoots({ REVIEWER_CHECKOUTS: "   " }, "/x"), ["/x"]);
});

test("a checkout's neighborhood is the folder holding it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "neighborhood-"));

  fs.mkdirSync(path.join(root, "app", ".git"), { recursive: true });

  assert.strictEqual(neighborhood(path.join(root, "app")), root);
});

test("a plain folder is its own neighborhood", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "neighborhood-"));

  assert.strictEqual(neighborhood(root), root);
});

test("a worktree's neighborhood is the folder holding it, .git file and all", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "neighborhood-"));

  fs.mkdirSync(path.join(root, "wt"));
  fs.writeFileSync(path.join(root, "wt", ".git"), "gitdir: elsewhere\n");

  assert.strictEqual(neighborhood(path.join(root, "wt")), root);
});
