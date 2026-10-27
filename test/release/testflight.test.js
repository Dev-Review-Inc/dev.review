// The TestFlight upload is read here as the artefact it is, the same way
// signing.test.js reads release.yml. Nothing runs it but a tag on a macOS
// runner, so these assert the wiring a run would otherwise find out about
// after the compile: the gate, the version, the secrets, and the order.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/testflight.yml", "utf8");

// One entry per `- ` under steps:, comments removed (see toolchain.test.js).
const steps = workflow
  .split(/\n {6}- /)
  .slice(1)
  .map((step) => step.replace(/^\s*#.*$/gm, ""));

const used = [...new Set([...workflow.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]))];

const checked = (workflow.match(/for name in ([A-Z0-9_ ]+); do/) ?? [, ""])[1]
  .split(/\s+/)
  .filter(Boolean);

const indexOf = (pattern) => steps.findIndex((step) => pattern.test(step));

describe("the TestFlight upload", () => {
  test("runs on a version tag, behind the suite", () => {
    assert.match(workflow, /tags: \["v\*"\]/);
    assert.match(workflow, /uses: \.\/\.github\/workflows\/test\.yml/);
    assert.match(workflow, /needs: test/);
  });

  test("refuses a tag that disagrees with the version before it builds", () => {
    const version = indexOf(/node \.github\/version\.mjs "\$GITHUB_REF_NAME"/);

    assert.ok(version !== -1, "the version is never checked against the tag");
    assert.ok(version < indexOf(/cargo tauri ios build/));
  });

  test("names every secret it needs before it builds", () => {
    assert.ok(used.length > 0, "the workflow reads no secrets");

    for (const name of used.filter((one) => one !== "GITHUB_TOKEN")) {
      assert.ok(checked.includes(name), `${name} reaches the build without the preflight checking it is set`);
    }

    assert.ok(indexOf(/for name in/) < indexOf(/cargo tauri ios build/));
  });

  test("runs rust from src-tauri, where the toolchain pin is", () => {
    for (const step of steps.filter((one) => /\b(rustup|cargo)\b/.test(one))) {
      assert.match(step, /working-directory: src-tauri/, `rust runs outside src-tauri:\n${step.trim()}`);
    }
  });

  test("prepares the Xcode project before building it", () => {
    // A bare init ships blank entitlements and tauri's default icon.
    const prepare = indexOf(/\.\/ios-prepare\.sh/);

    assert.ok(prepare !== -1, "ios-prepare.sh never runs");
    assert.ok(prepare < indexOf(/cargo tauri ios build/));
  });

  test("hands tauri a key file it wrote, so tauri signs for the App Store", () => {
    const build = steps[indexOf(/cargo tauri ios build/)];

    assert.match(build, /--export-method app-store-connect/);
    assert.doesNotMatch(build, /--build-number/, "tauri appends it as a fourth version number");

    const [, file] = build.match(/APPLE_API_KEY_PATH: \$\{\{ runner\.temp \}\}\/(\S+)/) ?? [];

    assert.ok(file, "the build is not given APPLE_API_KEY_PATH");
    assert.ok(workflow.includes(`base64 --decode > "$RUNNER_TEMP/${file}"`), `nothing writes ${file}`);
  });

  test("puts the distribution certificate in a keychain the build can search", () => {
    const keychain = indexOf(/security import/);

    assert.ok(keychain !== -1, "the certificate is never imported");
    assert.match(steps[keychain], /security list-keychains/);
    assert.ok(keychain < indexOf(/cargo tauri ios build/));
  });

  test("uploads the archive it built to App Store Connect", () => {
    const upload = indexOf(/altool --upload-app/);

    assert.ok(upload > indexOf(/cargo tauri ios build/), "nothing uploads after the build");
    assert.match(steps[upload], /--type ios/);
  });
});
