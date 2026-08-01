// The folder a source form has had chosen for it.
//
// Two backends have their storage chosen rather than typed, and what each
// chooser hands back is a different shape: a browser gives a directory handle
// with a name and no path, and the desktop app gives an absolute path. The form
// draws one row and saves one source either way, so the difference is settled
// here, in functions that take plain values.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  folderChosen,
  folderConfig,
  folderName,
  folderPath,
  newSourceSetup,
  sourceDirty,
} from "../../web/src/app/header.js";

function chosen(what) {
  return { ...newSourceSetup(), ...what };
}

describe("what the form has been given", () => {
  test("nothing chosen is nothing chosen", () => {
    assert.equal(folderChosen(newSourceSetup()), false);
    assert.equal(folderPath(newSourceSetup()), "");
    assert.equal(folderName(newSourceSetup()), "");
  });

  test("a browser handle is its name, because it carries no path at all", () => {
    const setup = chosen({ handle: { name: "Reviews" } });

    assert.equal(folderChosen(setup), true);
    assert.equal(folderPath(setup), "Reviews");
    assert.equal(folderName(setup), "Reviews");
  });

  test("a desktop folder is its whole path, named by its last part", () => {
    const setup = chosen({ root: "/Users/someone/Reviews" });

    assert.equal(folderChosen(setup), true);
    assert.equal(folderPath(setup), "/Users/someone/Reviews");
    assert.equal(folderName(setup), "Reviews");
  });

  test("a trailing separator is not a folder called nothing", () => {
    assert.equal(folderName(chosen({ root: "/Users/someone/Reviews/" })), "Reviews");
  });
});

describe("what saving a chosen folder writes down", () => {
  test("a desktop folder is part of the adapter's configuration", () => {
    assert.deepEqual(folderConfig(chosen({ root: "/Users/someone/Reviews" })), {
      root: "/Users/someone/Reviews",
    });
  });

  test("a browser handle is not, because a handle cannot be serialised", () => {
    assert.deepEqual(folderConfig(chosen({ handle: { name: "Reviews" } })), {});
    assert.deepEqual(folderConfig(newSourceSetup()), {});
  });

  test("editing a source without touching its folder keeps the folder it has", () => {
    const stored = { type: "tauri", root: "/Users/someone/Reviews" };

    assert.deepEqual(folderConfig({ ...newSourceSetup(), type: "tauri" }, stored), {
      root: "/Users/someone/Reviews",
    });
  });

  test("repointing a source at another backend does not carry the old path over", () => {
    const stored = { type: "tauri", root: "/Users/someone/Reviews" };

    assert.deepEqual(folderConfig({ ...newSourceSetup(), type: "filesystem" }, stored), {});
  });

  test("choosing a folder is a change worth saving, whichever kind it is", () => {
    const editing = { name: "work", adapter: { type: "tauri", root: "/Users/someone/Old" } };

    assert.equal(sourceDirty({ ...chosen({ editing }), name: "work", type: "tauri" }, []), false);
    assert.equal(
      sourceDirty(
        { ...chosen({ editing, root: "/Users/someone/Reviews" }), name: "work", type: "tauri" },
        [],
      ),
      true,
    );
  });
});
