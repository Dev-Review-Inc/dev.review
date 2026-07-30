import test from "node:test";
import assert from "node:assert";

import { draftPath, draftKey } from "../web/src/domain/draft-path.js";

test("derives the path the sweep writes a draft to", () => {
  assert.strictEqual(
    draftPath("org", "app", 42),
    "drafts/org--app-42/review.json",
  );
});

test("keeps the owner so two orgs sharing a repository name do not collide", () => {
  assert.notStrictEqual(
    draftPath("org", "app", 1),
    draftPath("acme", "app", 1),
  );
});

test("names a pull request the way the sweep's seen-state does", () => {
  assert.strictEqual(draftKey("org", "app", 42), "org/app#42");
});

test("refuses an owner or repository that could walk out of the drafts directory", () => {
  assert.throws(() => draftPath("..", "app", 1), /unusable/);
  assert.throws(() => draftPath("org", "../../state", 1), /unusable/);
  assert.throws(() => draftPath("org", "app/nested", 1), /unusable/);
});

test("refuses a number that is not a number", () => {
  assert.throws(() => draftPath("org", "app", "42; rm -rf"), /unusable/);
  assert.throws(() => draftPath("org", "app", -1), /unusable/);
});
