// The left pane's mobile-only menu control.
//
// Desktop shows the pane in a permanent second column, so nothing about it
// ever needs opening or closing there. On a phone it now opens as a drawer
// over the comment section rather than pushing it down a page with no room
// to spare (see .pane and #comment sharing a grid cell in the
// @media (max-width: 760px) block). #pane-toggle lives in the header itself -
// higher in the hierarchy than the pane it opens - so it is reachable
// wherever the reader has scrolled to, and #pane-backdrop is the drawer's own
// way out, a click on whatever it is covering.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { togglePaneCollapsed } from "../../web/src/app/rail.js";

const html = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");
const styleSheet = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

function ruleFor(selector, sheet = styleSheet) {
  const clean = sheet.replace(/\/\*[\s\S]*?\*\//g, "");

  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((found) => [found[1].trim(), found[2]])
    .find(([found]) => found === selector)?.[1];
}

function mobileMediaBlock() {
  const start = styleSheet.indexOf("@media (max-width: 760px)");

  assert.ok(start >= 0, "no @media (max-width: 760px) block");

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

test("#pane-toggle sits in the header, ahead of the chips it now outranks", () => {
  const header = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
  const toggleIndex = header.indexOf('id="pane-toggle"');
  const sourceIndex = header.indexOf('id="source-button"');

  assert.ok(toggleIndex >= 0, "no #pane-toggle in the header");
  assert.ok(sourceIndex >= 0, "no #source-button in the header");
  assert.ok(toggleIndex < sourceIndex, "#pane-toggle must come before the chips to read as the header's own menu control, not the pane's");
});

test("#pane-backdrop sits in the markup, its own element rather than something borrowed from the pane", () => {
  const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));

  assert.ok(main.includes('id="pane-backdrop"'), "no #pane-backdrop in the markup");
});

test("#pane-toggle and #pane-backdrop are off outside mobile, where the pane never overlays anything", () => {
  const toggleBase = ruleFor("#pane-toggle");

  assert.ok(toggleBase, "#pane-toggle is never declared");
  assert.match(toggleBase, /display:\s*none/, `#pane-toggle { ${toggleBase} } does not start hidden`);

  const backdropBase = ruleFor("#pane-backdrop");

  assert.ok(backdropBase, "#pane-backdrop is never declared");
  assert.match(backdropBase, /display:\s*none/, `#pane-backdrop { ${backdropBase} } does not start hidden`);

  const mobile = mobileMediaBlock();

  assert.match(mobile, /#pane-toggle\s*\{[^}]*display:\s*inline-flex/, "no mobile rule turning #pane-toggle back on");
  assert.match(
    mobile,
    /#pane-backdrop:not\(\[hidden\]\)\s*\{[^}]*display:\s*block/,
    "no mobile rule showing #pane-backdrop once it is not hidden",
  );
});

test("the pane and the comment section share one grid cell on mobile, so opening the pane overlays rather than pushes it down", () => {
  const mobile = mobileMediaBlock();

  assert.match(
    mobile,
    /\.pane,\s*#comment\s*\{[^}]*grid-row:\s*1[^}]*grid-column:\s*1/,
    "no rule stacking .pane and #comment into the same grid cell inside the mobile media query",
  );
});

test("collapsing hides the whole pane, and only inside the mobile media query", () => {
  const mobile = mobileMediaBlock();

  assert.match(
    mobile,
    /\.pane\.is-collapsed\s*\{[^}]*display:\s*none/,
    "no rule hiding .pane under .pane.is-collapsed inside the mobile media query",
  );

  assert.doesNotMatch(
    styleSheet.slice(0, styleSheet.indexOf("@media (max-width: 760px)")),
    /\.pane\.is-collapsed/,
    ".pane.is-collapsed is declared outside the mobile media query, so it would also apply at desktop width",
  );
});

test("togglePaneCollapsed flips the flag kept on the app, the same place app.filter and app.editing live", () => {
  const app = { paneCollapsed: false };

  assert.equal(togglePaneCollapsed(app), true);
  assert.equal(app.paneCollapsed, true);

  assert.equal(togglePaneCollapsed(app), false);
  assert.equal(app.paneCollapsed, false);
});
