// The version a release ships under is hand written in two files, and a tag is
// a third copy of it typed by a person at the moment they are least careful.
// Nothing in the build reconciles them: `cargo tauri build` reads
// tauri.conf.json and never looks at the tag, so tagging v0.2.0 over a
// conf that still says 0.1.0 publishes a v0.2.0 release whose installer names
// itself 0.1.0, and the app then reports a version no tag matches.
//
// The workflow refuses that tag before it builds anything, using the same
// module this suite drives, so the drift is caught at commit time here and at
// push time there.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { versions, disagreement } from "../../.github/version.mjs";

describe("the version a release ships", () => {
  test("is one number, not two", () => {
    const { conf, cargo } = versions();

    assert.equal(
      conf,
      cargo,
      "src-tauri/tauri.conf.json and src-tauri/Cargo.toml disagree about the version",
    );
  });

  test("accepts the tag that names it", () => {
    assert.equal(disagreement(`v${versions().conf}`), null);
  });

  test("refuses a tag that names a different one", () => {
    assert.match(disagreement("v9.9.9"), /9\.9\.9/);
  });

  test("refuses a tag that is not a version at all", () => {
    assert.match(disagreement("release-candidate"), /release-candidate/);
  });

  test("is checked by the workflow that publishes it", () => {
    // The module is only a guard while something calls it. Wiring it up is one
    // line in the workflow and deleting that line breaks nothing else.
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    assert.ok(
      workflow.includes("node .github/version.mjs"),
      "the release workflow no longer checks the tag against the packaged version",
    );
  });
});
