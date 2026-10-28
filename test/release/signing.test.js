// A signed release and an unsigned one are the same file until someone
// double-clicks it. The signing, notarisation and checks live in the macOS
// workflow Follow Along and 66 Scripts share, so these assert the caller's half:
// it calls that workflow behind the suite and the version check, and it hands
// over every secret, since another owner's workflow cannot inherit them.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");

describe("the macOS release", () => {
  test("calls the shared workflow from the repo root", () => {
    assert.match(workflow, /uses: dallasread\/releases\/\.github\/workflows\/macos-release\.yml@main/);
    assert.match(workflow, /project: "\."/);
  });

  test("runs only behind the suite and the version check", () => {
    assert.match(workflow, /uses: \.\/\.github\/workflows\/test\.yml/);
    assert.match(workflow, /needs: \[test, version\]/);
  });

  test("lets the shared workflow publish the release", () => {
    assert.match(workflow, /permissions:\n\s+contents: write/);
  });

  test("passes every secret the shared workflow requires", () => {
    for (const name of [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_SIGNING_IDENTITY",
      "APPLE_API_KEY",
      "APPLE_API_ISSUER",
      "APPLE_API_KEY_P8",
    ]) {
      assert.match(workflow, new RegExp(`^\\s+${name}: \\$\\{\\{ secrets\\.${name} \\}\\}$`, "m"), `${name} is not passed`);
    }
  });
});
