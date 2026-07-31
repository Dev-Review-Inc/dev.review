// `src-tauri/rust-toolchain.toml` pins the toolchain, and a pin only applies
// where the file can be seen. rustup and cargo read it from the working
// directory, so `rustup target add` run at the repository root adds the target
// to whatever the machine's default toolchain happens to be, and the build,
// which runs in src-tauri, then asks the pinned one for a target nobody gave
// it. It fails after the compile, naming the target rather than the directory.
//
// On the runner the default is already stable, which is the same toolchain the
// pin resolves to, so the release survives on a coincidence about an image
// nobody here controls. This is what the pin was for; it just has to be in
// scope. src-tauri/README.md says the same thing to a person at a terminal.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");

// One entry per `- ` under steps:, each holding everything indented beneath it.
// Comments included, and the comments belonging to the next step trail into the
// previous one's block, so they come out first: this file explains rustup in
// prose above a step that does not run it.
const steps = workflow
  .split(/\n {6}- /)
  .slice(1)
  .map((step) => step.replace(/^\s*#.*$/gm, ""));

describe("the toolchain a release builds with", () => {
  test("is the pinned one everywhere it is used", () => {
    const pinned = steps.filter((step) => /\b(rustup|cargo)\b/.test(step));

    assert.ok(pinned.length >= 2, "no rust steps found in the release workflow");

    for (const step of pinned) {
      assert.match(
        step,
        /working-directory: src-tauri/,
        `this step runs rust outside src-tauri, so the pin does not reach it:\n${step.trim()}`,
      );
    }
  });
});
