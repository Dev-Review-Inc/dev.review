// The signed .dmg runs under the hardened runtime, which blocks the microphone
// unless the app is entitled to it. Talking to the agent needs it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../src-tauri/${path}`, import.meta.url), "utf8");

test("the .dmg build is entitled to the microphone", () => {
  const entitlements = JSON.parse(read("tauri.conf.json")).bundle.macOS?.entitlements;

  assert.ok(entitlements, "tauri.conf.json names no macOS entitlements file");
  assert.match(read(entitlements), /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/);
});
