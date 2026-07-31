// What a caller can and cannot ask a button for.
//
// The point of the component is the second half. A caller that can pass a
// height will eventually pass a new one, and then there are nine.

import test from "node:test";
import assert from "node:assert/strict";

import { button } from "../../web/src/ui/button.js";

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
  assert.equal(primary.style["font-weight"], "700");
  assert.equal(primary.style.background, "var(--accent)");
});

test("danger reads as danger in the border and the ink, not in the shape", () => {
  const danger = button({ label: "Remove", role: "danger" });

  assert.equal(danger.style.color, "var(--red)");
  assert.equal(danger.style.height, button({ label: "Remove" }).style.height);
});

test("a quiet button carries no border and no fill", () => {
  const quiet = button({ label: "Cancel", role: "quiet" });

  assert.equal(quiet.style.border, "none");
  assert.equal(quiet.style.background, "none");
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
