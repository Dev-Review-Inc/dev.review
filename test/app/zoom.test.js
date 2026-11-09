// Cmd +, Cmd - and Cmd 0 zoom the whole window: the text and the terminal
// grow together, the terminal refitting to its new size.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));

test("the main window zooms on Cmd + and Cmd -", () => {
  const main = config.app.windows.find((window) => window.label === "main");

  assert.equal(main.zoomHotkeysEnabled, true);
});

// Tauri's hotkey script sets the zoom through an IPC call the main window
// must be allowed to make.
test("the main window may set its own zoom", () => {
  const capability = JSON.parse(readFileSync(new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf8"));

  assert.ok(capability.windows.includes("main"));
  assert.ok(capability.permissions.includes("core:webview:allow-set-webview-zoom"));
});
