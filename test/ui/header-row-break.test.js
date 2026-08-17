// The header wraps the open pull request and signout onto their own line, away
// from chips too wide to share a line with them on a phone screen. That needs
// a line break of its own to force, and it matters where it lands: put it on
// head-open itself and head-open claims the whole width of the new line,
// bumping signout to a third line rather than sharing the second with it. The
// break has to be a dedicated, empty item instead.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");
const styleSheet = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

function mobileMediaBlock() {
  const start = styleSheet.indexOf("@media (max-width: 760px)");

  assert.ok(start >= 0, "no @media (max-width: 760px) block");

  // Brace-matched extraction: nested rules inside the media query hold their
  // own { }, so slicing to the first closing brace would truncate early.
  let depth = 0;
  let end = start;

  for (let i = styleSheet.indexOf("{", start); i < styleSheet.length; i++) {
    if (styleSheet[i] === "{") depth++;
    if (styleSheet[i] === "}") depth--;

    if (depth === 0) {
      end = i;
      break;
    }
  }

  return styleSheet.slice(start, end + 1);
}

test("a dedicated .row-break, not head-open itself, forces the header's mobile line break", () => {
  const mobile = mobileMediaBlock();

  assert.match(
    mobile,
    /\.row-break\s*\{[^}]*flex-basis:\s*100%/,
    "no .row-break rule forcing a line break at flex-basis: 100% inside the mobile media query",
  );

  assert.doesNotMatch(
    mobile,
    /\.head-open\s*\{[^}]*flex-basis:\s*100%/,
    "head-open itself is forced to flex-basis: 100% - that claims the whole new line, leaving no room for signout to share it",
  );
});

test("the row-break element sits in the header markup, right before head-open", () => {
  const header = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
  const breakIndex = header.indexOf('class="row-break"');
  const headOpenIndex = header.indexOf('class="head-open"');

  assert.ok(breakIndex >= 0, "no .row-break element in the header");
  assert.ok(breakIndex < headOpenIndex, ".row-break must come before head-open to break the line in front of it");
});
