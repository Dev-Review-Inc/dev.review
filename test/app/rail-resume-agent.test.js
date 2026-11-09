// The rail's way back to the agent that wrote the draft.
//
// Exactly when the draft names the session that wrote it, and the build has no
// terminal dock to resume it in, the rail offers to copy the command that does.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { drawRail } from "../../web/src/app/rail.js";
import { MemoryAdapter } from "../../web/src/adapters/memory.js";
import { aDraft, aPull, agentWrites, theApp } from "../use-cases/helper.js";

function stub(tag = "div") {
  return {
    tag,
    className: "",
    textContent: "",
    innerHTML: "",
    title: "",
    hidden: false,
    children: [],
    dataset: {},
    style: { cssText: "", setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    addEventListener() {},
    setAttribute(name, value) {
      this[name] = value;
    },
    removeAttribute() {},
  };
}

function fakeDocument() {
  const byId = new Map();

  return {
    createElement: (tag) => stub(tag),
    querySelector: () => null,
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, stub());

      return byId.get(id);
    },
    everything: () => [...byId.values()],
  };
}

function marks(node) {
  return [node.title, node.innerHTML, node["aria-label"], ...(node.children || []).flatMap(marks)].filter(Boolean);
}

async function railMarks(draft, terminal = null) {
  const adapter = new MemoryAdapter();

  await agentWrites(adapter, draft);

  const app = await theApp({ adapter, pulls: [aPull()] });

  app.terminal = terminal;
  await app.select(app.queue()[0]);

  const doc = fakeDocument();

  globalThis.document = doc;
  drawRail(app);

  return doc.everything().flatMap(marks).join("\n");
}

describe("the rail over a draft", () => {
  afterEach(() => {
    delete globalThis.document;
  });

  test("offers to copy the resume command when the draft names its agent", async () => {
    const agent = { session: "3f2a9c1e-0b4d-4e8a-9f6c-2d1e7b5a8c90", cwd: "/Users/me/apps/app" };

    assert.match(await railMarks(aDraft({ agent })), /resumes the agent/);
  });

  test("offers nothing to resume when the draft names no agent", async () => {
    assert.doesNotMatch(await railMarks(aDraft()), /resumes the agent/);
    assert.doesNotMatch(await railMarks(aDraft(), { open() {} }), /in a terminal/);
  });

  test("leaves the agent to the terminal dock where the build has one", async () => {
    const agent = { session: "3f2a9c1e-0b4d-4e8a-9f6c-2d1e7b5a8c90", cwd: "/Users/me/apps/app" };
    const drawn = await railMarks(aDraft({ agent }), { open() {} });

    assert.doesNotMatch(drawn, /in a terminal/);
    assert.doesNotMatch(drawn, /resumes the agent/);
  });
});
