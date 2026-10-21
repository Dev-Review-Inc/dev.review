// The desktop runner for the agent chat, without a desktop.
//
// agent.rs has its own tests. These prove the JavaScript half asks the build
// whether it can run the agent, and turns the channel's messages into lines
// and an exit.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { agentRunner, TauriAdapter } from "../../web/src/adapters/tauri.js";

const was = Object.getOwnPropertyDescriptor(globalThis, "__TAURI__");

function shell(commands) {
  const calls = [];

  class Channel {}

  globalThis.__TAURI__ = {
    core: {
      Channel,
      invoke: async (name, args) => {
        calls.push({ name, args });
        return commands[name]?.(args);
      },
    },
  };

  return calls;
}

afterEach(() => {
  if (was) Object.defineProperty(globalThis, "__TAURI__", was);
  else delete globalThis.__TAURI__;
});

describe("the runner the agent chat uses", () => {
  test("is nothing in a browser tab", async () => {
    delete globalThis.__TAURI__;

    assert.equal(await agentRunner(), null);
  });

  test("is nothing in a build that cannot spawn the agent", async () => {
    shell({ agent_chat_available: () => false });

    assert.equal(await agentRunner(), null);
  });

  test("starts a run and hands back its lines and its exit", async () => {
    const calls = shell({ agent_chat_available: () => true, agent_chat_start: () => null });
    const runner = await agentRunner();
    const lines = [];
    const run = runner.start({ session: "s" }, (line) => lines.push(line));

    await run.started;

    const { run: id, request, events } = calls.find((call) => call.name === "agent_chat_start").args;

    assert.deepEqual(request, { session: "s" });
    events.onmessage({ kind: "line", text: "{}" });
    events.onmessage({ kind: "exit", code: 0 });

    assert.deepEqual(lines, ["{}"]);
    assert.deepEqual(await run.done, { code: 0 });

    await run.cancel();
    assert.deepEqual(calls.at(-1), { name: "agent_chat_cancel", args: { run: id } });
  });
});

describe("a folder on this computer", () => {
  test("names a file in it by its absolute path", () => {
    const adapter = new TauriAdapter({ root: "/Users/me/Reviews/" });

    assert.equal(adapter.absolute("drafts/org--app-42/review.json"), "/Users/me/Reviews/drafts/org--app-42/review.json");
  });
});
