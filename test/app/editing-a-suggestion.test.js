// The suggestion on a finding card, and the way into rewriting it.
//
// The committable block is part of what gets posted, so it is editable the
// same way the prose is: an affordance on the card, a monospace editor, the
// same save gesture, and a revert back to the agent's. Read-only surfaces
// show the merged suggestion and offer no way in - the sheet is the last
// look, not a second place to work.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { findingCard } from "../../web/src/app/findings.js";

// The smallest document the card touches. A real DOM would prove no more here
// and would mean a dependency in a project that has none.
function stub(tag = "div") {
  const listeners = {};

  return {
    tag,
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    title: "",
    hidden: false,
    disabled: false,
    spellcheck: true,
    children: [],
    dataset: {},
    style: { cssText: "", setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    append(...nodes) {
      this.children.push(...nodes);
    },
    addEventListener(name, handler) {
      (listeners[name] = listeners[name] || []).push(handler);
    },
    click() {
      for (const handler of listeners.click || []) handler({ target: this });
    },
    setAttribute() {},
    removeAttribute() {},
    setSelectionRange() {},
    focus() {},
    querySelector() {
      return null;
    },
  };
}

function fakeDocument() {
  return {
    createElement: (tag) => stub(tag),
    createTextNode: (text) => ({ textContent: text }),
  };
}

// Every element in the card whose className carries the given class.
function all(node, className, found = []) {
  if (typeof node !== "object" || !node) return found;
  if (String(node.className || "").split(" ").includes(className)) found.push(node);

  for (const child of node.children || []) all(child, className, found);

  return found;
}

function buttonsIn(node) {
  return all(node, "finding-actions")
    .flatMap((row) => row.children)
    .filter((child) => child.tag === "button");
}

function buttonNamed(node, label) {
  return buttonsIn(node).find((candidate) => candidate.textContent === label);
}

const aFinding = (overrides = {}) => ({
  id: "inert-catch-all",
  path: "lib/error.rb",
  line: 12,
  kind: "bug",
  color: "critical",
  body: "The rescue clause now parses and never matches.",
  suggestion: "rescue Error => e\n",
  editedAt: null,
  suggestionEditedAt: null,
  includedAt: null,
  postedAt: null,
  mine: false,
  ...overrides,
});

describe("the suggestion on a finding card", () => {
  let app;
  let recorded;
  let pull;

  beforeEach(() => {
    globalThis.document = fakeDocument();

    recorded = [];
    pull = { key: "org/app#42", number: 42 };
    app = {
      source: { id: "s" },
      files: [],
      editingFinding: null,
      editingSuggestion: null,
      changed() {},
      reselect() {},
      commands: {
        editSuggestion: (...args) => recorded.push(["editSuggestion", ...args]),
        resetSuggestion: (...args) => recorded.push(["resetSuggestion", ...args]),
      },
    };
  });

  afterEach(() => {
    delete globalThis.document;
  });

  test("shows the merged suggestion, and says when it is the reader's", () => {
    const card = findingCard(app, pull, aFinding({ suggestion: "raise Error\n", suggestionEditedAt: 1 }));

    const [block] = all(card, "suggestion");
    const pre = block.children.find((child) => child.tag === "pre");
    assert.equal(pre.textContent, "raise Error\n");

    const chips = all(card, "edited").map((chip) => chip.textContent);
    assert.ok(chips.includes("suggestion edited"));
  });

  test("offers the way into editing the suggestion", () => {
    const card = findingCard(app, pull, aFinding());

    const edit = buttonNamed(card, "Edit suggestion");
    assert.ok(edit, "no Edit suggestion affordance on the card");

    edit.click();
    assert.deepEqual(app.editingSuggestion, {
      id: "inert-catch-all",
      body: "rescue Error => e\n",
      focus: true,
    });
  });

  test("a finding with no suggestion offers no way into one", () => {
    const card = findingCard(app, pull, aFinding({ suggestion: null }));

    assert.equal(buttonNamed(card, "Edit suggestion"), undefined);
    assert.equal(all(card, "suggestion").length, 0);
  });

  test("a read-only card shows the suggestion with no way in", () => {
    const card = findingCard(app, pull, aFinding(), { actions: false });

    assert.equal(all(card, "suggestion").length, 1);
    assert.equal(buttonNamed(card, "Edit suggestion"), undefined);
  });

  test("saving the editor records the edit through the command", () => {
    app.editingSuggestion = { id: "inert-catch-all", body: "raise Error\n", focus: false };

    const card = findingCard(app, pull, aFinding());
    const editor = all(card, "finding-editor")[0];
    assert.equal(editor.value, "raise Error\n");

    buttonNamed(card, "Save").click();
    assert.deepEqual(recorded, [
      ["editSuggestion", app.source, pull, aFinding(), "raise Error\n"],
    ]);
    assert.equal(app.editingSuggestion, null);
  });

  test("the editor offers revert only once the suggestion was edited", () => {
    app.editingSuggestion = { id: "inert-catch-all", body: "raise Error\n", focus: false };

    const untouched = findingCard(app, pull, aFinding());
    assert.equal(buttonNamed(untouched, "Revert to drafted"), undefined);

    const edited = findingCard(app, pull, aFinding({ suggestionEditedAt: 1 }));
    buttonNamed(edited, "Revert to drafted").click();
    assert.equal(recorded[0][0], "resetSuggestion");
    assert.equal(app.editingSuggestion, null);
  });

  test("a suggestion edited away still offers the way back", () => {
    const card = findingCard(app, pull, aFinding({ suggestion: "", suggestionEditedAt: 1 }));

    // The block itself is gone from the card as from the send...
    assert.equal(all(card, "suggestion").length, 0);
    // ...but the affordance stays, and opens on the removed (empty) text.
    const edit = buttonNamed(card, "Edit suggestion");
    assert.ok(edit, "no way back to a removed suggestion");

    edit.click();
    assert.equal(app.editingSuggestion.body, "");
  });
});
