// The rail and the terminal dock are dragged to the width the reader wants,
// each kept usable and never squeezing the code and its comments away.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { dockWidth, railWidth } from "../../web/src/app/resize.js";

// A 1400px main, from 0 to 1400.
const main = { left: 0, right: 1400, width: 1400 };

describe("the rail, dragged", () => {
  test("follows the pointer from main's left edge", () => {
    assert.equal(railWidth(main, 360, 0), 360);
  });

  test("keeps a usable rail and leaves the code room beside the dock", () => {
    assert.equal(railWidth(main, 50, 0), 200);
    assert.equal(railWidth(main, 1300, 400), 1400 - 400 - 320);
  });
});

describe("the dock, dragged", () => {
  test("follows the pointer from main's right edge", () => {
    assert.equal(dockWidth(main, 1000, 300), 400);
  });

  test("keeps a usable terminal and leaves the code room beside the rail", () => {
    assert.equal(dockWidth(main, 1390, 300), 280);
    assert.equal(dockWidth(main, 10, 300), 1400 - 300 - 320);
  });
});

describe("the dock, at a width kept from a wider window", () => {
  test("never runs off main's right edge", async () => {
    const { readFileSync } = await import("node:fs");
    const sheet = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");
    const rule = sheet.match(/main\.dock-sized:has\(> #terminal-dock:not\(\[hidden\]\)\) \{ grid-template-columns: ([^;]+);/)[1];

    assert.match(rule, /min\(var\(--dock-width\), 100% - var\(--rail-width, 300px\) - 320px\)/);
  });
});

describe("the dock, folded", () => {
  test("is a strip wide enough to hit, with a glyph big enough to see", async () => {
    const { readFileSync } = await import("node:fs");
    const sheet = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");

    assert.match(sheet, /main:has\(> #terminal-dock\.collapsed:not\(\[hidden\]\)\) \{ grid-template-columns: var\(--rail-width, 300px\) minmax\(0, 1fr\) 44px; \}/);
    assert.match(sheet, /#terminal-dock\.collapsed .terminal-fold \{ font-size: var\(--textDisplay\); \}/);
  });
});
