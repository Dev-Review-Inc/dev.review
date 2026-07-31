// The one piece that touches a document.
//
// The smallest document the renderer touches, for the same reason picker.test.js
// hand-rolls one: a real DOM would prove no more here and would mean a
// dependency in a project that has none.

import test from "node:test";
import assert from "node:assert/strict";

import { button } from "../../web/src/ui/button.js";
import { render } from "../../web/src/ui/render.js";

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
          setProperty(name, value) {
            this.declarations[name] = value;
          },
        },
        listeners: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
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
