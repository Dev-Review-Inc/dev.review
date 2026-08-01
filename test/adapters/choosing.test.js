// Which folder chooser a shell gets.
//
// The browser reaches a folder through the File System Access API and the
// desktop app reaches one through its own dialog on the Rust side. They return
// different things, so the caller cannot simply pick either: the backend the
// reader chose decides, and what comes back says which it was.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { chooseFolder } from "../../web/src/adapters/index.js";

const undo = [];

function stub(name, value) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, name);
  const was = globalThis[name];

  if (value === undefined) delete globalThis[name];
  else globalThis[name] = value;

  return () => {
    if (had) globalThis[name] = was;
    else delete globalThis[name];
  };
}

function inDesktop(invoke) {
  undo.push(stub("__TAURI__", { core: { invoke } }));
  undo.push(stub("showDirectoryPicker", undefined));
}

function inBrowser(picker) {
  undo.push(stub("__TAURI__", undefined));
  undo.push(stub("showDirectoryPicker", picker));
}

afterEach(() => {
  while (undo.length) undo.pop()();
});

describe("choosing a folder", () => {
  test("the desktop app asks its own dialog and answers with the path", async () => {
    const asked = [];

    inDesktop((command) => {
      asked.push(command);

      return "/Users/someone/Reviews";
    });

    assert.deepEqual(await chooseFolder("tauri"), { root: "/Users/someone/Reviews" });
    assert.deepEqual(asked, ["storage_pick_root"]);
  });

  test("a browser asks the File System Access API and answers with the handle", async () => {
    const handle = { name: "Reviews" };

    inBrowser(() => handle);

    assert.deepEqual(await chooseFolder("filesystem"), { handle });
  });

  test("a dismissed dialog is nothing chosen, whichever dialog it was", async () => {
    inDesktop(() => null);
    assert.equal(await chooseFolder("tauri"), null);

    while (undo.length) undo.pop()();

    inBrowser(() => {
      const stop = new Error("The user aborted a request.");

      stop.name = "AbortError";
      throw stop;
    });
    assert.equal(await chooseFolder("filesystem"), null);
  });

  test("the desktop chooser is never used from a browser tab", async () => {
    inBrowser(() => ({ name: "Reviews" }));

    await assert.rejects(() => chooseFolder("tauri"), /desktop app/);
  });
});
