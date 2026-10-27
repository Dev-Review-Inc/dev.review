// TestFlight goes through the workflow Follow Along and 66 Scripts share, so a
// fix to the release lands in all three. That workflow expects the caller's
// repo to look a certain way; these assert Reviewer does, since the only
// other check is a tag on a macOS runner.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const workflow = readFileSync(".github/workflows/testflight.yml", "utf8");
const project = readFileSync("src-tauri/ios-project.yml", "utf8");

const executable = (path) => existsSync(path) && (statSync(path).mode & 0o111) !== 0;

describe("the TestFlight upload", () => {
  test("runs on a version tag, behind the suite", () => {
    assert.match(workflow, /tags: \["v\*"\]/);
    assert.match(workflow, /uses: \.\/\.github\/workflows\/test\.yml/);
    assert.match(workflow, /needs: \[?test/);
  });

  test("calls the workflow Follow Along and 66 Scripts share, from the repo root", () => {
    assert.match(workflow, /uses: followalong\/www\.followalong\.com\/\.github\/workflows\/testflight\.yml@main/);
    assert.match(workflow, /project: "\."/);
  });

  test("passes every secret the shared workflow requires", () => {
    for (const name of [
      "APPLE_API_KEY",
      "APPLE_API_ISSUER",
      "APPLE_API_KEY_P8",
      "APPLE_DISTRIBUTION_P12",
      "APPLE_DISTRIBUTION_P12_PASSWORD",
    ]) {
      assert.match(workflow, new RegExp(`^\\s+${name}: \\$\\{\\{ secrets\\.\\w+ \\}\\}`, "m"), `${name} is not passed`);
    }
  });

  test("has what the shared workflow reads at the project root", () => {
    assert.match(readFileSync(".tool-versions", "utf8"), /^rust \d+\.\d+\.\d+$/m);
    assert.ok(executable("ios-project.test.sh"), "ios-project.test.sh is missing or not executable");
  });

  test("pins one Rust version, in both places that name it", () => {
    const [, tools] = readFileSync(".tool-versions", "utf8").match(/^rust (\S+)$/m);
    const [, channel] = readFileSync("src-tauri/rust-toolchain.toml", "utf8").match(/^channel = "(\S+)"$/m);

    assert.equal(channel, tools);
  });

  test("commits the Xcode project the shared workflow builds", () => {
    assert.doesNotMatch(readFileSync("src-tauri/.gitignore", "utf8"), /gen\/apple/);
    assert.ok(existsSync("src-tauri/gen/apple/project.yml"), "src-tauri/gen/apple is not committed");
  });

  test("commits the Xcode project at the app's version", () => {
    // A version bump that skips ios-prepare.sh would otherwise fail on the
    // macOS runner, after the suite has passed.
    const { version } = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    const generated = readFileSync("src-tauri/gen/apple/project.yml", "utf8");
    const found = [...generated.matchAll(/CFBundleShortVersionString: (\S+)/g)].map((m) => m[1]);

    assert.ok(found.length > 0);
    assert.deepEqual([...new Set(found)], [version], "run src-tauri/ios-prepare.sh and commit gen/apple");
  });

  test("gives each build a whole-number build number, set before signing", () => {
    assert.ok(executable("src-tauri/ios-build-number.sh"), "ios-build-number.sh is missing or not executable");
    assert.match(project, /postBuildScripts:\s+- script: sh "\$SRCROOT\/\.\.\/\.\.\/ios-build-number\.sh"\s+name: Set Build Number/);
  });
});
