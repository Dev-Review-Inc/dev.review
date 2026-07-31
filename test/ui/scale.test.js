// The design system's rules, as assertions rather than as a comment.
//
// The stylesheet already carried the sentence "every button shares one height"
// above a rule that set eight of them. Prose next to code does not hold; a
// failing test does.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CONTROL_HEIGHTS, heightToken, tokensUsedBy } from "../../web/src/ui/tokens.js";
import { button, ROLES } from "../../web/src/ui/button.js";

const stylesheet = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");

// The :root block, where a token is either declared or is not a token.
const root = stylesheet.slice(stylesheet.indexOf(":root {"), stylesheet.indexOf("@media (prefers-color-scheme: light)"));

function declared(name) {
  return new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(root)?.[1].trim();
}

test("there are exactly three control heights", () => {
  // A fourth role is how eight heights happen. Adding one has to be a decision
  // someone makes here, not a number someone types into a new rule.
  assert.deepEqual(Object.keys(CONTROL_HEIGHTS), ["icon", "compact", "standard"]);
});

test("every button a caller can ask for lands on a sanctioned height", () => {
  const sanctioned = Object.values(CONTROL_HEIGHTS).map((px) => heightToken(px));

  for (const role of Object.keys(ROLES)) {
    for (const compact of [false, true]) {
      const described = button({ role, compact, label: "x", icon: "<svg/>" });

      assert.ok(
        sanctioned.includes(described.style.height),
        `${role}${compact ? " compact" : ""} is ${described.style.height}`,
      );
    }
  }
});

test("the height tokens the stylesheet declares are the heights the code believes in", () => {
  for (const [role, px] of Object.entries(CONTROL_HEIGHTS)) {
    assert.equal(declared(heightName(role)), `${px}px`, `--${heightName(role).slice(2)}`);
  }
});

function heightName(role) {
  return heightToken(CONTROL_HEIGHTS[role]).slice(4, -1);
}

test("every token the ui layer references is declared", () => {
  for (const name of tokensUsedBy(allDescriptions())) {
    assert.ok(declared(name), `${name} is used but never declared`);
  }
});

test("no button styles itself with a raw value", () => {
  // A literal here is a value that light mode will never hear about, and a
  // height that no test above can see.
  for (const described of allDescriptions()) {
    for (const [property, value] of Object.entries(described.style)) {
      assert.match(
        String(value),
        /^(var\(--[a-zA-Z0-9]+\)|1px solid var\(--[a-zA-Z0-9]+\)|0 var\(--[a-zA-Z0-9]+\)|none|700|0)$/,
        `${property}: ${value}`,
      );
    }
  }
});

function allDescriptions() {
  return Object.keys(ROLES).flatMap((role) =>
    [false, true].map((compact) => button({ role, compact, label: "x", icon: "<svg/>" })),
  );
}
