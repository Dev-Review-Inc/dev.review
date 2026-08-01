// The one piece that touches a document.
//
// The smallest document the renderer touches, for the same reason picker.test.js
// hand-rolls one: a real DOM would prove no more here and would mean a
// dependency in a project that has none.

import test from "node:test";
import assert from "node:assert/strict";

import { button } from "../../web/src/ui/button.js";
import { render, restyle } from "../../web/src/ui/render.js";

function fakeDocument() {
  return {
    createElement(tag) {
      return {
        tag,
        className: "",
        textContent: "",
        innerHTML: "",
        attributes: {},
        style: {
          declarations: {},
          get cssText() {
            return Object.entries(this.declarations)
              .map(([property, value]) => `${property}: ${value}`)
              .join("; ");
          },
          set cssText(value) {
            if (!value) this.declarations = {};
          },
          setProperty(name, value) {
            this.declarations[name] = value;
          },
        },
        listeners: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        removeAttribute(name) {
          delete this.attributes[name];
        },
        addEventListener(name, handler) {
          this.listeners[name] = handler;
        },
      };
    },
  };
}

test("a description becomes a button carrying its class, text and style", () => {
  const node = render(button({ label: "Edit" }), fakeDocument());

  assert.equal(node.tag, "button");
  assert.equal(node.textContent, "Edit");
  assert.match(node.className, /ui-button/);
  assert.equal(node.style.declarations.height, "var(--ctlStandard)");
});

test("attributes reach the element", () => {
  const node = render(button({ label: "Approve", pressed: true, title: "why" }), fakeDocument());

  assert.equal(node.attributes["aria-pressed"], "true");
  assert.equal(node.attributes.title, "why");
  assert.equal(node.attributes.type, "button");
});

test("a click handler is bound once", () => {
  let clicks = 0;
  const node = render(button({ label: "Edit", onClick: () => (clicks += 1) }), fakeDocument());

  node.listeners.click();

  assert.equal(clicks, 1);
});

test("a link is rendered as an anchor", () => {
  const node = render(button({ label: "Read the docs", role: "primary", link: true }), fakeDocument());

  assert.equal(node.tag, "a");
  assert.equal(node.textContent, "Read the docs");
});

test("a button already in the page is restyled where it stands", () => {
  // The send button, the confirm sheet's two and the celebration's are written
  // in index.html and wired by id at boot. Rebuilding them would drop the
  // listeners; describing them and applying the description does not.
  const node = fakeDocument().createElement("button");

  node.className = "old";
  node.setAttribute("disabled", "");

  restyle(button({ label: "Post review", role: "primary" }), node);

  assert.match(node.className, /ui-button--primary/);
  assert.ok(!node.className.includes("old"));
  assert.equal(node.textContent, "Post review");
  assert.equal(node.style.declarations.height, "var(--ctlStandard)");

  // An attribute the description no longer carries has to leave the element,
  // or a button drawn once as disabled never becomes pressable again.
  assert.ok(!("disabled" in node.attributes));
});

test("a button restyled keeps nothing of the shape it had before", () => {
  // The roles do not all set the same properties - an armed square has a
  // minimum width where a plain one has a width - so writing the new
  // description over the old one is not enough to be rid of the old one.
  const node = fakeDocument().createElement("button");

  restyle(button({ role: "icon", icon: "<svg/>", arms: true }), node);
  restyle(button({ role: "icon", icon: "<svg/>" }), node);

  assert.ok(!("min-width" in node.style.declarations));
  assert.equal(node.style.declarations.width, "var(--ctlIcon)");
});

test("an icon button gets markup and a labelled one never does", () => {
  const icon = render(button({ role: "icon", icon: "<svg/>" }), fakeDocument());
  const labelled = render(button({ label: "<b>Edit</b>" }), fakeDocument());

  assert.equal(icon.innerHTML, "<svg/>");
  assert.equal(icon.textContent, "");

  // Text, never markup, for the same reason element() in dom.js sets
  // textContent: every label here could have come from a draft.
  assert.equal(labelled.innerHTML, "");
  assert.equal(labelled.textContent, "<b>Edit</b>");
});
