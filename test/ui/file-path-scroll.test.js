// A file row's path scrolls horizontally instead of being ellipsis-truncated,
// so a reader can still read the tail of a long path rather than losing it.
// Universal rather than mobile-only: nothing relies on the old ellipsis (no
// tooltip is set from it, no test asserted it) and a long path is exactly as
// unreadable on a wide screen as on a narrow one.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");
const styleSheet = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

function ruleFor(selector) {
  const clean = styleSheet.replace(/\/\*[\s\S]*?\*\//g, "");

  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((found) => [found[1].trim(), found[2]])
    .find(([found]) => found === selector)?.[1];
}

test("the path scrolls its own overflow instead of ellipsis-truncating it", () => {
  const block = ruleFor(".file .path");

  assert.ok(block, ".file .path is never declared");
  assert.match(block, /overflow-x:\s*auto/, `.file .path { ${block} } does not scroll horizontally`);
  assert.match(block, /white-space:\s*nowrap/, ".file .path must stay on one line for a scrollbar to mean anything");
  assert.doesNotMatch(block, /text-overflow:\s*ellipsis/, ".file .path still truncates instead of scrolling");
});

test("the path can shrink inside the row's flex layout, or overflow-x: auto never engages", () => {
  // A flex item's min-width defaults to its content size, which for
  // white-space: nowrap text is the full, unwrapped line - wide enough that
  // it never has less room than it wants, so overflow-x: auto never triggers.
  const block = ruleFor(".file .path");

  assert.match(block, /min-width:\s*0/, ".file .path has no min-width: 0, so it cannot shrink below its full text width and the scrollbar never appears");
});

test("the badge and the stats beside the path stay pinned, not pushed out by a long path", () => {
  for (const selector of [".file .n", ".file .adds", ".file .dels"]) {
    const block = ruleFor(selector);

    assert.ok(block, `${selector} is never declared`);
    assert.match(block, /flex-shrink:\s*0/, `${selector} { ${block} } can still be squeezed by a wide .path`);
  }
});
