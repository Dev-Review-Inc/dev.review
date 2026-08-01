// What a caller can and cannot ask a button for.
//
// The point of the component is the second half. A caller that can pass a
// height will eventually pass a new one, and then there are nine.

import test from "node:test";
import assert from "node:assert/strict";

import { button, ROLES } from "../../web/src/ui/button.js";

test("a ghost is the standard height, in mono, at the label size", () => {
  const described = button({ label: "Edit" });

  assert.equal(described.text, "Edit");
  assert.equal(described.style.height, "var(--ctlStandard)");
  assert.equal(described.style["font-family"], "var(--mono)");
  assert.equal(described.style["font-size"], "var(--textSmall)");
});

test("a button sets its own line height, so the label cannot move the box", () => {
  // Not one control rule in the stylesheet sets line-height, which is why the
  // ones with no height at all size themselves from whatever font loaded.
  assert.equal(button({ label: "Edit" }).style["line-height"], "var(--leadControl)");
});

test("compact shortens a button without changing anything else about it", () => {
  const standard = button({ label: "Save" });
  const compact = button({ label: "Save", compact: true });

  assert.equal(compact.style.height, "var(--ctlCompact)");
  assert.equal(compact.style["font-size"], standard.style["font-size"]);
  assert.equal(compact.style["border-radius"], standard.style["border-radius"]);
  assert.equal(compact.style["font-family"], standard.style["font-family"]);
});

test("the primary action differs by weight and fill, not by size", () => {
  const primary = button({ label: "Post review", role: "primary" });
  const ghost = button({ label: "Edit" });

  assert.equal(primary.style.height, ghost.style.height);
  assert.equal(primary.style["font-size"], ghost.style["font-size"]);
  assert.equal(ROLES.primary.weight, "700");
  assert.equal(ROLES.primary.background, "var(--accent)");
});

test("danger reads as danger in the border and the ink, not in the shape", () => {
  const danger = button({ label: "Remove", role: "danger" });

  assert.equal(ROLES.danger.color, "var(--red)");
  assert.equal(danger.style.height, button({ label: "Remove" }).style.height);
});

test("a quiet button carries no border and no fill", () => {
  assert.equal(ROLES.quiet.border, "none");
  assert.equal(ROLES.quiet.background, "none");
});

test("an icon button is a square and takes markup, not a label", () => {
  const icon = button({ role: "icon", icon: "<svg/>" });

  assert.equal(icon.style.height, "var(--ctlIcon)");
  assert.equal(icon.style.width, "var(--ctlIcon)");
  assert.equal(icon.icon, "<svg/>");
  assert.equal(icon.text, "");
});

test("a toggle says whether it is pressed", () => {
  assert.equal(button({ label: "Approve", pressed: true }).attributes["aria-pressed"], "true");
  assert.equal(button({ label: "Approve", pressed: false }).attributes["aria-pressed"], "false");
  assert.ok(!("aria-pressed" in button({ label: "Approve" }).attributes));
});

test("a button that is not a toggle is a button, and one in a form can submit", () => {
  assert.equal(button({ label: "Edit" }).attributes.type, "button");
  assert.equal(button({ label: "Save", submits: true }).attributes.type, "submit");
});

test("disabled, a title and a click all reach the description", () => {
  const onClick = () => {};
  const described = button({ label: "Send", title: "posts one comment", disabled: true, onClick });

  assert.equal(described.attributes.disabled, "");
  assert.equal(described.attributes.title, "posts one comment");
  assert.equal(described.onClick, onClick);
});

test("the verdict tints the primary without resizing it", () => {
  // The footer's send button wears the verdict it would send. That was three
  // id rules stacked on a fourth, each free to set a height none of the others
  // knew about.
  const plain = button({ label: "Post review", role: "primary" });
  const ok = button({ label: "Post review", role: "primary", tone: "ok" });
  const critical = button({ label: "Post review", role: "primary", tone: "critical" });

  assert.ok(!plain.className.includes("is-ok"));
  assert.match(ok.className, /ui-button--primary .*is-ok/);
  assert.match(critical.className, /ui-button--primary .*is-critical/);
  assert.equal(ok.style.height, plain.style.height);
  assert.equal(critical.style.padding, plain.style.padding);
});

test("a tone nobody agreed to is refused, and only a fill can carry one", () => {
  assert.throws(() => button({ label: "Post", role: "primary", tone: "loud" }), /loud/);
  assert.throws(() => button({ label: "Edit", tone: "ok" }), /ghost/);
});

test("the filled button is read against its fill, not against the page", () => {
  // --postFg is near-white and the dark accent is a light blue, which is the
  // one pairing in the palette that cannot be read. Every other filled control
  // already used --accentFg.
  assert.equal(ROLES.primary.color, "var(--accentFg)");
});

test("a description carries no colour, because colour has states", () => {
  // An inline background beats every :hover this app could write, and the two
  // states that matter - hovering, and armed for a second click - are both
  // colour. So the role is a class and the sheet answers it.
  for (const role of Object.keys(ROLES)) {
    const { style } = button({ role, label: "x", icon: "<svg/>" });

    for (const property of ["background", "color", "border", "font-weight"]) {
      assert.ok(!(property in style), `${role} sets ${property} inline`);
    }
  }
});

test("a button that arms says so before it is armed", () => {
  // arm() writes data-armed on the first click. A button that starts without
  // the attribute is a button whose armed look nothing declared.
  assert.equal(button({ label: "Delete", role: "danger", arms: true }).attributes["data-armed"], "false");
  assert.ok(!("data-armed" in button({ label: "Delete", role: "danger" }).attributes));
});

test("an icon button that arms is at least a square, because the question is words", () => {
  // arm() replaces the glyph with "Delete?". A fixed 20px square clips it.
  const armed = button({ role: "icon", icon: "<svg/>", arms: true });

  assert.equal(armed.style["min-width"], "var(--ctlIcon)");
  assert.equal(armed.style.height, "var(--ctlIcon)");
  assert.ok(!("width" in armed.style));
  assert.equal(armed.style.padding, "0 var(--space1)");
});

test("a link can wear a button's clothes without becoming a button", () => {
  // The celebration's invitation is an anchor: it navigates, so a middle click
  // has to open it. It sits beside a button doing the same job and had no
  // height at all.
  const link = button({ label: "Read the docs", role: "primary", link: true });

  assert.equal(link.tag, "a");
  assert.ok(!("type" in link.attributes));
  assert.equal(link.style.height, button({ label: "x", role: "primary" }).style.height);
  assert.equal(button({ label: "x" }).tag, "button");
});

test("a role nobody agreed to is refused", () => {
  assert.throws(() => button({ label: "Edit", role: "tertiary" }), /tertiary/);
});

test("a caller cannot smuggle in its own geometry", () => {
  // The exception a caller wants is the signal that the roles are wrong. It
  // gets fixed here, once, rather than at the call site, eight times.
  assert.throws(() => button({ label: "Edit", height: "22px" }), /height/);
  assert.throws(() => button({ label: "Edit", style: {} }), /style/);
});

test("a labelled button needs a label and an icon button needs an icon", () => {
  assert.throws(() => button({}), /label/);
  assert.throws(() => button({ role: "icon" }), /icon/);
});
