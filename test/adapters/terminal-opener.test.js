// The desktop terminal for the agent, without a desktop.
//
// terminal.rs has its own tests. These prove the JavaScript half asks the
// build whether it can spawn the agent, and turns the channel's messages into
// output bytes and an exit.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { terminalOpener } from "../../web/src/adapters/tauri.js";

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

describe("the terminal the agent opens in", () => {
  test("is nothing in a browser tab", async () => {
    delete globalThis.__TAURI__;

    assert.equal(await terminalOpener(), null);
  });

  test("is nothing in a build that cannot spawn the agent", async () => {
    shell({ terminal_available: () => false });

    assert.equal(await terminalOpener(), null);
  });

  test("opens claude, passes its output and exit through, and closes it", async () => {
    const calls = shell({ terminal_available: () => true, terminal_open: () => 7 });
    const opener = await terminalOpener();
    const output = [];
    let exit;
    const request = { session: "s", cwd: "/repo", cols: 80, rows: 24 };
    const pty = await opener.open(request, (bytes) => output.push(bytes), (code) => (exit = code));

    const { events } = calls.find((call) => call.name === "terminal_open").args;

    assert.deepEqual(calls.at(-1).args.request, request);
    events.onmessage(new Uint8Array([104, 105]).buffer);
    events.onmessage({ exit: 0 });

    assert.deepEqual(output, [new Uint8Array([104, 105])]);
    assert.equal(exit, 0);

    await pty.write("y\r");
    await pty.resize(100, 30);
    await pty.close();

    assert.deepEqual(
      calls.slice(-3).map((call) => [call.name, call.args]),
      [
        ["terminal_write", { id: 7, data: "y\r" }],
        ["terminal_resize", { id: 7, cols: 100, rows: 30 }],
        ["terminal_close", { id: 7 }],
      ],
    );
  });

  test("says why the build would not open it", async () => {
    shell({
      terminal_available: () => true,
      terminal_open: () => Promise.reject({ code: "elsewhere", message: "the agent ran on another machine" }),
    });

    const opener = await terminalOpener();

    await assert.rejects(opener.open({}, () => {}, () => {}), /another machine/);
  });
});
