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

test("skips a pull the reader dismissed, so pruning its draft does not redraft it", () => {
  const resolved = new Map([["org/app#1", { action: "dismiss", time: Date.parse("2026-08-10T00:00:00Z") }]]);
  const stale = { ...pr(1), updatedAt: "2026-08-09T00:00:00Z" };

  const { fresh } = selectNew([stale, pr(2)], new Set(), 10, resolved);
  assert.deepStrictEqual(fresh.map((p) => p.number), [2]);
});

test("re-selects a dismissed pull that moved after the dismissal", () => {
  const resolved = new Map([["org/app#1", { action: "dismiss", time: Date.parse("2026-08-10T00:00:00Z") }]]);
  const moved = { ...pr(1), updatedAt: "2026-08-11T00:00:00Z" };

  const { fresh } = selectNew([moved], new Set(), 10, resolved);
  assert.deepStrictEqual(fresh.map((p) => p.number), [1]);
});

test("never re-selects a pull the reader posted on, however new the push", () => {
  const resolved = new Map([["org/app#1", { action: "post", time: Date.parse("2026-08-10T00:00:00Z") }]]);
  const moved = { ...pr(1), updatedAt: "2026-08-11T00:00:00Z" };

  const { fresh } = selectNew([moved], new Set(), 10, resolved);
  assert.deepStrictEqual(fresh, []);
});

test("a dismissed pull with no updatedAt from the search stays skipped", () => {
  const resolved = new Map([["org/app#1", { action: "dismiss", time: 100 }]]);

  const { fresh } = selectNew([pr(1)], new Set(), 10, resolved);
  assert.deepStrictEqual(fresh, []);
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
    withinWorkspace(prs, ["org/app"]).map((entry) => entry.number),
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
