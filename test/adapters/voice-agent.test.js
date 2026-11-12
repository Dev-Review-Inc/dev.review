// The agent by voice, without a desktop. voice.rs has its own tests; these
// prove the JavaScript half asks the build first and passes the calls through.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { voiceAgent } from "../../web/src/adapters/tauri.js";

const was = Object.getOwnPropertyDescriptor(globalThis, "__TAURI__");

function shell(commands) {
  const calls = [];

  globalThis.__TAURI__ = {
    core: {
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

describe("the agent by voice", () => {
  test("is nothing in a browser tab", async () => {
    delete globalThis.__TAURI__;

    assert.equal(await voiceAgent(), null);
  });

  test("is nothing in a build that cannot run the agent", async () => {
    shell({ terminal_available: () => false });

    assert.equal(await voiceAgent(), null);
  });

  test("asks, says, and hushes through the build", async () => {
    const calls = shell({
      terminal_available: () => true,
      voice_ask: () => ({ reply: "It renames a column.", session: "next" }),
    });
    const voice = await voiceAgent();
    const request = { session: "s", cwd: "/repo", words: "what does it do" };

    assert.deepEqual(await voice.ask(request), { reply: "It renames a column.", session: "next" });
    await voice.say("It renames a column.");
    await voice.hush();

    assert.deepEqual(
      calls.slice(-3).map((call) => [call.name, call.args]),
      [
        ["voice_ask", { request }],
        ["voice_say", { text: "It renames a column." }],
        ["voice_hush", undefined],
      ],
    );
  });

  test("says why the build would not answer", async () => {
    shell({
      terminal_available: () => true,
      voice_ask: () => Promise.reject({ code: "elsewhere", message: "the agent ran on another machine" }),
    });

    const voice = await voiceAgent();

    await assert.rejects(voice.ask({}), /another machine/);
  });
});
