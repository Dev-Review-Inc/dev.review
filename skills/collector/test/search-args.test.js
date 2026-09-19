import test from "node:test";
import assert from "node:assert";
import { searchArgs } from "../search-args.js";

test("excludes dependabot so dependency bumps never reach the sweep", () => {
  assert.ok(searchArgs("--review-requested=@me").includes("-author:app/dependabot"));
});

test("puts exclusions after `--` so gh reads them as query terms, not flags", () => {
  const args = searchArgs("--review-requested=@me");
  assert.ok(args.indexOf("--") < args.indexOf("-author:app/dependabot"));
});

test("keeps the qualifier it was handed", () => {
  assert.ok(searchArgs("--author=@me").includes("--author=@me"));
});

test("asks for the facts the rules read: author, draft state and labels", () => {
  const args = searchArgs("--review-requested=@me");
  const fields = args[args.indexOf("--json") + 1].split(",");

  for (const field of ["author", "isDraft", "labels"]) assert.ok(fields.includes(field), field);
  for (const field of ["number", "title", "repository", "url", "updatedAt"]) assert.ok(fields.includes(field), field);
});
