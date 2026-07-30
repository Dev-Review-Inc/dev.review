// What the storage picker does with a backend that cannot be used here.
//
// The rule under test is that an unusable option stays on the list and says
// why, and that saying so is not enough on its own: the option must also be
// genuinely unselectable, and the reason must be in the text rather than in a
// colour, because a reader on a screen reader gets the text and nothing else.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { picker, storageOptions, firstUsable } from "../../web/src/app/header.js";

// The smallest document these two functions touch. A real DOM would prove no
// more here and would mean a dependency in a project that has none.
function fakeDocument() {
  const make = (tag) => ({
    tag,
    className: "",
    textContent: "",
    value: "",
    selected: false,
    disabled: false,
    children: [],
    listeners: {},
    append(...nodes) {
      this.children.push(...nodes);
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
  });

  return { createElement: make };
}

const someTypes = [
  { type: "filesystem", label: "A folder on this computer", fields: [], reason: "", hint: "" },
  { type: "tauri", label: "This computer", fields: [], reason: "needs the desktop app", hint: "" },
  { type: "s3", label: "S3 bucket", fields: [{ key: "bucket" }], reason: "", hint: "" },
];

describe("the storage options a form draws", () => {
  test("puts the reason in the option's own text, never only in how it looks", () => {
    const options = storageOptions(someTypes);

    assert.equal(options[1].label, "This computer (needs the desktop app)");
    assert.equal(options[0].label, "A folder on this computer");
  });

  test("marks an unusable option disabled so it cannot be chosen at all", () => {
    const options = storageOptions(someTypes);

    assert.equal(options[1].disabled, true);
    assert.equal(options[0].disabled, false);
    assert.equal(options[2].disabled, false);
  });

  test("starts the form on a backend that works, not on the first one listed", () => {
    const unusableFirst = [{ ...someTypes[0], reason: "no picker here" }, ...someTypes.slice(1)];

    assert.equal(firstUsable(someTypes), "filesystem");
    assert.equal(firstUsable(unusableFirst), "s3");
    assert.equal(firstUsable([]), "");
  });
});

describe("the picker element", () => {
  let restore;

  afterEach(() => {
    restore();
  });

  function draw(options, chosen = "filesystem", onChange = () => {}) {
    const was = globalThis.document;
    globalThis.document = fakeDocument();
    restore = () => {
      globalThis.document = was;
    };

    const wrapper = picker("storage", options, chosen, onChange);

    return wrapper.children.find((child) => child.tag === "select");
  }

  test("renders a disabled option for a backend that cannot be used here", () => {
    const select = draw(storageOptions(someTypes));
    const tauri = select.children.find((option) => option.value === "tauri");

    assert.equal(tauri.disabled, true);
    assert.equal(tauri.textContent, "This computer (needs the desktop app)");
  });

  test("leaves a usable option selectable", () => {
    const select = draw(storageOptions(someTypes));
    const s3 = select.children.find((option) => option.value === "s3");

    assert.equal(s3.disabled, false);
  });
});
