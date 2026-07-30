// What the empty state promises a reader who has no source yet.
//
// The promise has to match what this browser can actually offer. A folder needs
// the File System Access API, which Chromium has, Firefox has declined, Safari
// does not ship, and Brave switches off by default - so telling everyone they
// can point at a folder sends a good share of readers looking for a control
// that is not on the screen.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { sourceHint } from "../../web/src/app/summary.js";

const folder = { type: "filesystem", reason: "", hint: "" };
const noFolder = { type: "filesystem", reason: "needs a Chromium browser such as Chrome or Edge", hint: "" };
const desktop = { type: "tauri", reason: "", hint: "" };
const noDesktop = { type: "tauri", reason: "needs the desktop app", hint: "" };
const bucket = { type: "s3", reason: "", hint: "" };

describe("the sentence under “no draft source attached”", () => {
  test("offers a folder when this browser can open one", () => {
    const hint = sourceHint([folder, noDesktop, bucket]);

    assert.match(hint, /a folder on this computer, or a bucket you own/);
  });

  test("offers a folder inside the desktop app, which reads one without the browser API", () => {
    const hint = sourceHint([noFolder, desktop, bucket]);

    assert.match(hint, /a folder on this computer, or a bucket you own/);
  });

  test("promises no folder when nothing here can open one, and says where one works", () => {
    const hint = sourceHint([noFolder, noDesktop, bucket]);

    assert.doesNotMatch(hint, /a folder on this computer, or a bucket you own/);
    assert.match(hint, /desktop app or a Chromium browser/);
    assert.match(hint, /bucket you own works in any browser/);
  });

  test("says what a draft source is either way", () => {
    for (const types of [
      [folder, noDesktop, bucket],
      [noFolder, noDesktop, bucket],
    ]) {
      assert.match(sourceHint(types), /the storage your review agent writes to/);
    }
  });

  test("reads this browser for itself when it is not told", () => {
    assert.match(sourceHint(), /the storage your review agent writes to/);
  });
});
