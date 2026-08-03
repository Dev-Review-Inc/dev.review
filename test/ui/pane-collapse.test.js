// The left pane's mobile-only collapse toggle.
//
// Desktop shows the pane in a permanent second column, so nothing about it
// ever needs folding away there. On a phone it eats 40vh above the review
// itself (see .pane in the @media (max-width: 760px) block), and a first-time
// reader has no way to get it out from underfoot. #pane-toggle is the way
// back: a bar above #pane-content that survives the collapse, so the pane
// never disappears entirely, only what it was showing.

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

test("the pane bar and its toggle sit in the markup, wrapping the pane's content", () => {
  const pane = html.slice(html.indexOf('<section class="pane">'), html.indexOf("</section>"));

  const barIndex = pane.indexOf('class="pane-bar"');
  const toggleIndex = pane.indexOf('id="pane-toggle"');
  const contentIndex = pane.indexOf('id="pane-content"');
  const filesIndex = pane.indexOf('id="files"');

  assert.ok(barIndex >= 0, "no .pane-bar in the pane");
  assert.ok(toggleIndex >= 0, "no #pane-toggle button in the pane");
  assert.ok(contentIndex >= 0, "no #pane-content wrapper in the pane");
  assert.ok(barIndex < contentIndex, ".pane-bar must come before #pane-content, or it collapses with it");
  assert.ok(contentIndex < filesIndex, "#pane-content must wrap the files list, or collapsing it leaves files showing");
});

test("the bar is hidden outside the mobile media query, so a wide screen never sees it", () => {
  const base = ruleFor(".pane-bar");

  assert.ok(base, ".pane-bar is never declared");
  assert.match(base, /display:\s*none/, `.pane-bar { ${base} } does not start hidden`);

  const mobile = ruleFor(".pane-bar", mobileMediaBlock());

  assert.ok(mobile, "no .pane-bar rule inside the mobile media query");
  assert.match(mobile, /display:\s*flex/, "the mobile .pane-bar rule does not turn it back on");
});

test("collapsing hides #pane-content, never .pane-bar, and only inside the mobile media query", () => {
  const mobile = mobileMediaBlock();

  assert.match(
    mobile,
    /\.pane\.is-collapsed\s+#pane-content\s*\{[^}]*display:\s*none/,
    "no rule hiding #pane-content under .pane.is-collapsed inside the mobile media query",
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
