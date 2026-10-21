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

  test("is the same number the iOS project ships", () => {
    // ios-project.yml is a fourth and fifth copy: xcodegen reads it to write
    // the Xcode project, and it names the version once per target because the
    // widget extension carries its own Info.plist. A widget whose version
    // disagrees with its host app fails embedding validation at upload, long
    // after the tag that caused it.
    const { conf, ios } = versions();

    assert.ok(ios.length > 0, "no CFBundleShortVersionString found in src-tauri/ios-project.yml");

    for (const found of ios) {
      assert.equal(found, conf, `src-tauri/ios-project.yml says ${found} and tauri.conf.json says ${conf}`);
    }
  });

  test("refuses a tag when the iOS project has drifted", () => {
    assert.match(
      disagreement("v0.9.0", { conf: "0.9.0", cargo: "0.9.0", ios: ["0.9.0", "0.6.2"] }),
      /ios-project\.yml/,
    );
  });

  test("the iOS build number is not a literal that repeats", () => {
    // Apple refuses a second upload that reuses a CFBundleVersion for the same
    // marketing version, so a hardcoded one works once and then stops. It has
    // to come from a build setting something outside the file can raise.
    const project = readFileSync("src-tauri/ios-project.yml", "utf8");

    const keys = project.split("\n").filter((line) => /^\s*CFBundleVersion:/.test(line));

    assert.ok(keys.length > 0, "no CFBundleVersion found in src-tauri/ios-project.yml");

    for (const line of keys) {
      assert.match(line, /\$\(/, `CFBundleVersion is hardcoded: ${line.trim()}`);
    }
  });

  test("gives the app and its widget one iOS deployment target that Xcode still builds", () => {
    // The app said 14.0 and the widget 17.0, so iOS 14 to 16 got the app
    // without its widget. Xcode 27 also refuses anything below 15.0, which
    // is how the first device build found it.
    const project = readFileSync("src-tauri/ios-project.yml", "utf8");

    const targets = [...project.matchAll(/^\s*(?:iOS|deploymentTarget):\s*"?(\d+(?:\.\d+)*)"?\s*$/gm)].map(
      (match) => match[1],
    );

    assert.equal(targets.length, 2, `expected the app's and the widget's deployment target, found ${targets.length}`);
    assert.equal(targets[0], targets[1], `the app targets iOS ${targets[0]} and the widget iOS ${targets[1]}`);
    assert.ok(Number.parseFloat(targets[0]) >= 15, `iOS ${targets[0]} is below the 15.0 that Xcode 27 builds`);
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
