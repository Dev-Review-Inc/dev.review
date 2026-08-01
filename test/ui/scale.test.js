// The design system's rules, as assertions rather than as a comment.
//
// The stylesheet already carried the sentence "every button shares one height"
// above a rule that set eight of them. Prose next to code does not hold; a
// failing test does.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CONTROL_HEIGHTS, heightToken, tokensUsedBy } from "../../web/src/ui/tokens.js";
import { button, ROLES, TONES } from "../../web/src/ui/button.js";

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
  const colours = Object.values(ROLES).flatMap((look) => [
    { style: { background: look.background, color: look.color, border: look.border } },
  ]);

  for (const name of tokensUsedBy([...allDescriptions(), ...colours])) {
    assert.ok(declared(name), `${name} is used but never declared`);
  }
});

test("the colours the stylesheet gives each role are the colours the code decided", () => {
  // Two copies of a decision is how they drift, the same way two copies of a
  // height was. The sheet holds the colours because colour has states; ROLES
  // still says what they are.
  for (const [role, look] of Object.entries(ROLES)) {
    const block = ruleFor(`.ui-button--${role}`);

    assert.ok(block, `.ui-button--${role} is never declared`);
    assert.equal(declaration(block, "background"), look.background, role);
    assert.equal(declaration(block, "color"), look.color, role);
    assert.equal(declaration(block, "border"), look.border, role);
    assert.equal(declaration(block, "font-weight"), look.weight, role);
  }
});

test("every tone a caller can ask for is a fill the stylesheet paints", () => {
  for (const [tone, colour] of Object.entries(TONES)) {
    const block = ruleFor(`.ui-button--primary.is-${tone}`);

    assert.ok(block, `.is-${tone} is never declared`);
    assert.equal(declaration(block, "background"), colour, tone);
  }
});

function ruleFor(selector) {
  return rules().find(([found]) => found === selector)?.[1];
}

function declaration(block, property) {
  return new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;}]+)`).exec(block)?.[1].trim();
}

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

// Selectors naming something a reader presses, matched at the end of a
// selector so a rule about a control is told apart from one about a dot inside
// it. `.verdicts` and `.settings-kind` are here as the containers they are:
// segmented controls, which are not buttons and still may not invent a height.
const CONTROL =
  /(^|[\s,>])(\.ui-button[\w-]*|\.ghost|#post|#confirm-post|#cheer-next|\.cheer-cta|\.settings-(?:button|choose|add|kind)|\.setup-edit|\.copy-url|\.clear-review|\.verdicts)((\.|:|\[)[^\s,]*)?$/;

test("no rule in the stylesheet gives a control a height of its own", () => {
  // This is the assertion the sheet could not carry before: every control rule
  // that set a height set a different one, and the sentence promising they
  // matched sat above the rule that broke it. Now a height is a token or it is
  // not written.
  for (const [selector, block] of rules()) {
    if (!selector.split(",").some((one) => CONTROL.test(one.trim()))) continue;

    const height = /(?:^|[;{\s])height:\s*([^;}]+)/.exec(block)?.[1]?.trim();

    if (!height) continue;

    assert.match(height, /^var\(--ctl(Icon|Compact|Standard)\)$/, `${selector} { height: ${height} }`);
  }
});

test("no rule in the stylesheet gives a control a typeface of its own", () => {
  // The settings panel's buttons were mono by their own rule, its Choose
  // button by a class the call site remembered to add. One of them forgetting
  // is a typeface change nobody chose.
  for (const [selector, block] of rules()) {
    if (!selector.split(",").some((one) => CONTROL.test(one.trim()))) continue;

    const family = /font-family:\s*([^;}]+)/.exec(block)?.[1]?.trim();

    assert.ok(!family, `${selector} { font-family: ${family} }`);
  }
});

// Every rule in the page's one stylesheet, as selector and declarations. The
// at-rules are flattened away: a media query's contents are rules like any
// other, and a height set inside one counts the same.
function rules() {
  const sheet = stylesheet
    .slice(stylesheet.indexOf("<style>"), stylesheet.indexOf("</style>"))
    .replace(/\/\*[\s\S]*?\*\//g, "");

  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((found) => [found[1].trim(), found[2]])
    .filter(([selector]) => !selector.startsWith("@") && !selector.startsWith(":root"));
}

function allDescriptions() {
  return Object.keys(ROLES).flatMap((role) =>
    [false, true].map((compact) => button({ role, compact, label: "x", icon: "<svg/>" })),
  );
}
