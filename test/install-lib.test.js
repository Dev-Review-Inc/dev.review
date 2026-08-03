import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  extractFencedFiles,
  expandHome,
  defaultDraftsDir,
  classifyDirectory,
  draftsDirPlan,
  claudeMdLine,
  upsertDraftsLine,
} from "../install-lib.mjs";

test("extracts a fenced file by its heading path", () => {
  const md = [
    "### `~/.claude/skills/dev-review/SKILL.md`",
    "",
    "````markdown",
    "---",
    "name: dev-review",
    "---",
    "```json",
    '{ "a": 1 }',
    "```",
    "````",
  ].join("\n");

  const [file] = extractFencedFiles(md);

  assert.equal(file.path, "~/.claude/skills/dev-review/SKILL.md");
  assert.equal(file.content, ['---', "name: dev-review", "---", "```json", '{ "a": 1 }', "```"].join("\n"));
});

test("does not let an inner fence close the outer block early", () => {
  const md = [
    "### `a.md`",
    "````markdown",
    "```js",
    "1",
    "```",
    "````",
    "### `b.js`",
    "```javascript",
    "2",
    "```",
  ].join("\n");

  const files = extractFencedFiles(md);

  assert.equal(files.length, 2);
  assert.equal(files[0].content, ["```js", "1", "```"].join("\n"));
  assert.equal(files[1].content, "2");
});

test("reads every file install.md actually installs", () => {
  const files = extractFencedFiles(fs.readFileSync(new URL("../install.md", import.meta.url), "utf8"));

  assert.deepEqual(
    files.map((f) => f.path),
    [
      "~/.claude/skills/dev-review/SKILL.md",
      "~/.claude/skills/dev-review-sweep/SKILL.md",
      "~/.claude/skills/dev-review-sweep/collector/queue.js",
      "~/.claude/skills/dev-review-sweep/collector/select-new.js",
      "~/.claude/skills/dev-review-sweep/collector/draft-path.js",
      "~/.claude/skills/dev-review-sweep/collector/resolve-repo.js",
      "~/.claude/skills/dev-review-sweep/collector/prune-drafts.js",
    ],
  );

  for (const file of files) assert.ok(file.content.length > 0, `${file.path} extracted empty`);
});

test("expands a leading tilde against home", () => {
  assert.equal(expandHome("~/drafts", "/Users/dallas"), "/Users/dallas/drafts");
  assert.equal(expandHome("~", "/Users/dallas"), "/Users/dallas");
});

test("leaves an absolute path alone", () => {
  assert.equal(expandHome("/var/drafts", "/Users/dallas"), "/var/drafts");
});

test("resolves a bare path against home, not the working directory", () => {
  assert.equal(expandHome("drafts", "/Users/dallas"), "/Users/dallas/drafts");
});

test("suggests a drafts directory under home", () => {
  assert.equal(defaultDraftsDir("/Users/dallas"), "/Users/dallas/reviewer-drafts");
});

test("classifies a directory by what fs.readdirSync reports", () => {
  assert.equal(classifyDirectory(null), "missing");
  assert.equal(classifyDirectory([]), "empty");
  assert.equal(classifyDirectory(["review.json"]), "occupied");
});

test("a missing directory is created, and backed by git only if asked", () => {
  assert.deepEqual(draftsDirPlan({ state: "missing", wantsGit: false }), {
    createDir: true,
    setupGit: false,
    restart: false,
  });
  assert.deepEqual(draftsDirPlan({ state: "missing", wantsGit: true }), {
    createDir: true,
    setupGit: true,
    restart: false,
  });
});

test("an empty directory needs no creating, but git is still a choice", () => {
  assert.deepEqual(draftsDirPlan({ state: "empty", wantsGit: true }), {
    createDir: false,
    setupGit: true,
    restart: false,
  });
});

test("an occupied directory is never touched without an explicit reconciliation", () => {
  assert.deepEqual(draftsDirPlan({ state: "occupied", reconcile: "local-only" }), {
    createDir: false,
    setupGit: false,
    restart: false,
  });
});

test("attaching a remote to an occupied directory does not create it", () => {
  assert.deepEqual(draftsDirPlan({ state: "occupied", reconcile: "attach-remote" }), {
    createDir: false,
    setupGit: true,
    restart: false,
  });
});

test("choosing a different directory restarts instead of touching this one", () => {
  assert.deepEqual(draftsDirPlan({ state: "occupied", reconcile: "different-dir" }), {
    createDir: false,
    setupGit: false,
    restart: true,
  });
});

test("names the CLAUDE.md line the wizard writes", () => {
  assert.equal(claudeMdLine("/Users/dallas/reviewer-drafts"), "My dev review drafts dir is /Users/dallas/reviewer-drafts.");
});

test("appends the drafts line to existing CLAUDE.md content", () => {
  const before = "Some existing instruction.\n";
  const after = upsertDraftsLine(before, "/Users/dallas/reviewer-drafts");

  assert.equal(after, "Some existing instruction.\n\nMy dev review drafts dir is /Users/dallas/reviewer-drafts.\n");
});

test("writes the line alone when CLAUDE.md is empty", () => {
  assert.equal(upsertDraftsLine("", "/Users/dallas/reviewer-drafts"), "My dev review drafts dir is /Users/dallas/reviewer-drafts.\n");
});

test("replaces a previous drafts line rather than duplicating it", () => {
  const before = "Line one.\n\nMy dev review drafts dir is /old/path.\n\nLine three.\n";
  const after = upsertDraftsLine(before, "/new/path");

  assert.equal(after, "Line one.\n\nMy dev review drafts dir is /new/path.\n\nLine three.\n");
  assert.equal((after.match(/My dev review drafts dir is/g) || []).length, 1);
});
