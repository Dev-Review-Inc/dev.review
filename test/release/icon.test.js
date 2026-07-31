// The icon a release ships is generated once and then forgotten, so nothing
// notices when it rots. It shipped as a single 512 PNG for a while, which the
// bundler dutifully wrapped in an .icns holding one entry: every size the Dock
// and Finder ask for below 512 was resampled from it, and the placeholder it
// was drawn from had no artwork in it at all.
//
// These read the packaged icon rather than the source it came from, because
// the source being right is not what ships.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));

// An .icns is a header followed by typed chunks, one per size and depth. The
// four character type is all we need: how many, and which.
const entries = (path) => {
  const icns = readFileSync(path);
  const types = [];
  let at = 8;
  while (at + 8 <= icns.length) {
    types.push(icns.toString("latin1", at, at + 4));
    const length = icns.readUInt32BE(at + 4);
    if (length < 8) break;
    at += length;
  }
  return types;
};

describe("the icon a release ships", () => {
  test("is every file the bundle claims", () => {
    for (const icon of conf.bundle.icon) {
      assert.ok(existsSync(`src-tauri/${icon}`), `src-tauri/${icon} is missing`);
    }
  });

  test("includes the macOS icon set", () => {
    assert.ok(conf.bundle.icon.includes("icons/icon.icns"));
  });

  test("holds a size for every place macOS draws it", () => {
    const types = entries("src-tauri/icons/icon.icns");

    // is32 is the 16 the Finder list uses, ic10 the 1024 the Dock magnifies to.
    for (const size of ["is32", "il32", "ic07", "ic08", "ic09", "ic10"]) {
      assert.ok(types.includes(size), `icon.icns has no ${size} entry`);
    }
  });

  test("is drawn, not a flat tile", () => {
    // The placeholder was two greys a shade apart. Artwork is not.
    const png = readFileSync("src-tauri/icons/128x128.png");

    assert.ok(png.length > 3000, "the 128 icon is too plain to be artwork");
  });

  test("keeps the transparent margin macOS expects", () => {
    // macOS rounds nothing for you and sits its squircle inside the canvas, so
    // an icon that fills its own corners is the one that looks wrong in a Dock
    // full of ones that do not.
    const source = readFileSync("src-tauri/app-icon.svg", "utf8");

    assert.match(source, /viewBox="0 0 1024 1024"/);
    assert.match(source, /width="824" height="824"/);
  });
});
