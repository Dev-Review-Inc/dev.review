import test from "node:test";
import assert from "node:assert";
import { selectNew, withinWorkspace, dedupe } from "../select-new.js";

const pr = (n, repo = "org/app") => ({
  number: n,
  repository: { nameWithOwner: repo },
});

test("returns every pull request when nothing has been drafted", () => {
  const { fresh } = selectNew([pr(1), pr(2)], new Set(), 10);
  assert.deepStrictEqual(fresh.map((p) => p.number), [1, 2]);
});

test("drops a pull request a draft already exists for", () => {
  const drafted = new Set(["org/app#1"]);
  const { fresh } = selectNew([pr(1), pr(2)], drafted, 10);
  assert.deepStrictEqual(fresh.map((p) => p.number), [2]);
});

test("keys by repository so the same number in two repos is distinct", () => {
  const drafted = new Set(["org/app#1"]);
  const { fresh } = selectNew([pr(1, "org/product")], drafted, 10);
  assert.deepStrictEqual(fresh.map((p) => p.repository.nameWithOwner), [
    "org/product",
  ]);
});

test("caps the sweep and reports what it deferred rather than dropping it silently", () => {
  const { fresh, deferred } = selectNew([pr(1), pr(2), pr(3)], new Set(), 2);
  assert.deepStrictEqual(fresh.map((p) => p.number), [1, 2]);
  assert.deepStrictEqual(deferred.map((p) => p.number), [3]);
});


test("keeps only the pull requests whose repository is in the workspace", () => {
  const prs = [
    { repository: { nameWithOwner: "org/app" }, number: 1 },
    { repository: { nameWithOwner: "someone/elsewhere" }, number: 2 },
  ];

  assert.deepStrictEqual(
    withinWorkspace(prs, ["org/app"]).map((pr) => pr.number),
    [1],
  );
});

test("matches a repository regardless of how it is cased", () => {
  const prs = [{ repository: { nameWithOwner: "Org/App" }, number: 1 }];

  assert.strictEqual(withinWorkspace(prs, ["org/app"]).length, 1);
});

test("reviews nothing when the workspace holds no repositories yet", () => {
  const prs = [{ repository: { nameWithOwner: "a/b" }, number: 1 }];

  assert.strictEqual(withinWorkspace(prs, []).length, 0);
});

test("merges two searches without repeating a pull request found by both", () => {
  const merged = dedupe([pr(1), pr(2)], [pr(2), pr(3)]);

  assert.deepStrictEqual(merged.map((one) => one.number), [1, 2, 3]);
});
