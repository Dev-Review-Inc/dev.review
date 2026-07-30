// The install document carries the skills and the queue helper inline, so that
// one fetch of one URL is the whole install.
//
// Every embedded file is therefore a second copy of a file that already exists
// in this repository, and a second copy drifts. This is what stops it: edit a
// skill without rebuilding the document and this goes red, rather than the site
// quietly handing out an installer for last month's skill.
//
//   node site/install-doc.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildInstall } from "../../site/install-doc.mjs";

describe("the install document", () => {
  test("is the one its sources build", () => {
    assert.equal(
      fs.readFileSync("site/install.md", "utf8"),
      buildInstall(),
      "site/install.md is stale - rebuild it with: node site/install-doc.mjs",
    );
  });

  test("carries every file it claims to install", () => {
    const doc = buildInstall();

    for (const path of [
      "~/.claude/skills/dev-review/SKILL.md",
      "~/.claude/skills/dev-review-sweep/SKILL.md",
      "~/.claude/skills/dev-review-sweep/collector/queue.js",
      "~/.claude/skills/dev-review-sweep/collector/select-new.js",
      "~/.claude/skills/dev-review-sweep/collector/draft-path.js",
      "~/.claude/skills/dev-review-sweep/collector/resolve-repo.js",
    ]) {
      assert.ok(doc.includes(path), `${path} is not in the install document`);
    }
  });

  test("closes every block it opens", () => {
    // A skill carrying its own fenced blocks needs a longer fence around it.
    // Get that wrong and the first inner fence ends the outer one, spilling the
    // rest of a skill onto the page as prose that reads almost right.
    const fences = buildInstall().match(/^`{3,}/gm) || [];
    const depth = fences.reduce((open, run) => open ^ (run.length >= 4 ? 2 : 1), 0);

    assert.equal(fences.length % 2, 0, "an odd number of fences means one is unclosed");
    assert.equal(depth, 0, "a fence was closed by a run of a different length");
  });
});
