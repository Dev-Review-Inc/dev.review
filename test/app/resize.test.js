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
