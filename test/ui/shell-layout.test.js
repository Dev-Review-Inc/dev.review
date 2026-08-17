// The one rule that keeps the header from growing past the screen it is on.
//
// #shell is a grid with no explicit columns, which leaves the browser to size
// the implicit one from its widest child's content. A header carrying a long
// title and an unbreakable chip is exactly the content that trips that up: the
// column grew to fit it, the header grew with the column, and Sign out - at
// the end of the row - went with it, off the edge of the phone. A bounded
// column is what keeps the row the width of the screen instead of the width of
// whatever is written into it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const stylesheet = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");

function ruleFor(selector) {
  const sheet = stylesheet
    .slice(stylesheet.indexOf("<style>"), stylesheet.indexOf("</style>"))
    .replace(/\/\*[\s\S]*?\*\//g, "");

  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((found) => [found[1].trim(), found[2]])
    .find(([found]) => found === selector)?.[1];
}

test("#shell bounds its column, so the grid cannot grow wider than the viewport to fit a header's content", () => {
  const block = ruleFor("#shell");

  assert.ok(block, "#shell is never declared");

  const columns = /(?:^|[;{\s])grid-template-columns:\s*([^;}]+)/.exec(block)?.[1]?.trim();

  assert.ok(columns, "#shell sets no grid-template-columns, so its implicit column sizes to content");
  assert.match(
    columns,
    /minmax\(\s*0/,
    `grid-template-columns: ${columns} does not floor the column at 0, so wide content can still grow it`,
  );
});
