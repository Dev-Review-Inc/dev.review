import test from "node:test";
import assert from "node:assert";
import { repoFromRemote, pickLocalRepo } from "../resolve-repo.js";

test("reads an ssh remote", () => {
  assert.strictEqual(
    repoFromRemote("git@github.com:org/app.git"),
    "org/app",
  );
});

test("reads an https remote", () => {
  assert.strictEqual(
    repoFromRemote("https://github.com/org/event-ingestion-pipeline.git"),
    "org/event-ingestion-pipeline",
  );
});

test("reads an https remote with no .git suffix", () => {
  assert.strictEqual(
    repoFromRemote("https://github.com/org/upstream-resolver-plugin"),
    "org/upstream-resolver-plugin",
  );
});

test("ignores a remote that is not on github", () => {
  assert.strictEqual(repoFromRemote("git@gitlab.com:org/thing.git"), null);
});

test("ignores an empty remote", () => {
  assert.strictEqual(repoFromRemote(""), null);
});

test("matches case-insensitively, as github does", () => {
  assert.strictEqual(
    repoFromRemote("git@github.com:Org/App.git"),
    "org/app",
  );
});

test("finds the local checkout whose remote matches, whatever its directory is named", () => {
  const candidates = [
    { path: "/apps/checkouts/blog", remote: "git@github.com:org/blog.git" },
    { path: "/apps/checkouts/app", remote: "git@github.com:org/app.git" },
  ];
  assert.strictEqual(pickLocalRepo("org/app", candidates), "/apps/checkouts/app");
});

test("returns null when no local checkout matches, so the caller can clone", () => {
  const candidates = [
    { path: "/apps/checkouts/blog", remote: "git@github.com:org/blog.git" },
  ];
  assert.strictEqual(pickLocalRepo("org/product", candidates), null);
});

test("picks deterministically when several checkouts share one remote", () => {
  const candidates = [
    { path: "/apps/checkouts/netlify", remote: "git@github.com:org/billing-connector.git" },
    { path: "/apps/checkouts/connector", remote: "git@github.com:org/billing-connector.git" },
    { path: "/apps/checkouts/heroku", remote: "git@github.com:org/billing-connector.git" },
  ];
  assert.strictEqual(
    pickLocalRepo("org/billing-connector", candidates),
    "/apps/checkouts/connector",
  );
});
