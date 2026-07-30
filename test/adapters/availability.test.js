// What this browser can offer, and what it must say when it cannot.
//
// The interesting cases are all about globals a browser either has or does not,
// so every test here stubs one and puts it back. A leaked stub would make the
// next test pass for the wrong reason, which on a feature detect is the exact
// bug we are trying to stop shipping.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { isSupported, unavailability } from "../../web/src/adapters/filesystem.js";
import { unavailability as tauriUnavailability } from "../../web/src/adapters/tauri.js";
import { adapterTypes } from "../../web/src/adapters/index.js";

// defineProperty rather than assignment because node's own `navigator` is a
// getter with no setter, and plain assignment throws against it.
//
// Deleting a global and setting it to undefined are different things to a
// `typeof` check and to `in`, so the restore has to know which it was.
function stub(name, value) {
  const was = Object.getOwnPropertyDescriptor(globalThis, name);

  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });

  return () => {
    if (was) Object.defineProperty(globalThis, name, was);
    else delete globalThis[name];
  };
}

describe("whether a folder on this computer can be offered", () => {
  const undo = [];

  afterEach(() => {
    while (undo.length) undo.pop()();
  });

  function browser({ picker = false, secure = true, chromium = false }) {
    undo.push(stub("showDirectoryPicker", picker ? () => {} : undefined));
    undo.push(stub("isSecureContext", secure));
    undo.push(stub("navigator", chromium ? { userAgentData: { brands: [] } } : {}));
  }

  test("is supported when the browser has the directory picker", () => {
    browser({ picker: true });

    assert.equal(isSupported(), true);
    assert.equal(unavailability().reason, "");
    assert.equal(unavailability().hint, "");
  });

  test("is unsupported when the browser has no directory picker", () => {
    browser({ picker: false });

    assert.equal(isSupported(), false);
  });

  test("blames the connection first, because that is the one the reader can fix", () => {
    browser({ picker: false, secure: false, chromium: true });

    assert.match(unavailability().reason, /secure/i);
    assert.match(unavailability().reason, /localhost|https/i);
    assert.equal(unavailability().hint, "");
  });

  test("says the browser has it switched off when this is a Chromium browser", () => {
    browser({ picker: false, secure: true, chromium: true });

    assert.match(unavailability().reason, /switched off/i);
    assert.match(unavailability().hint, /brave:\/\/flags\/#file-system-access-api/);
  });

  test("says which browsers have it at all when this is not a Chromium browser", () => {
    browser({ picker: false, secure: true, chromium: false });

    assert.match(unavailability().reason, /Chrome|Chromium/);
    assert.equal(unavailability().hint, "");
  });

  test("never asserts a cause it cannot see, so an unrecognised brand list is the plain case", () => {
    undo.push(stub("showDirectoryPicker", undefined));
    undo.push(stub("isSecureContext", true));
    undo.push(stub("navigator", { userAgentData: { brands: "not a list" } }));

    assert.match(unavailability().reason, /Chrome|Chromium/);
    assert.equal(unavailability().hint, "");
  });
});

describe("whether this computer can be offered", () => {
  const undo = [];

  afterEach(() => {
    while (undo.length) undo.pop()();
  });

  test("is available inside the desktop shell", () => {
    undo.push(stub("__TAURI__", { core: { invoke: () => {} } }));

    assert.equal(tauriUnavailability().reason, "");
  });

  test("says it needs the desktop app in an ordinary tab", () => {
    undo.push(stub("__TAURI__", undefined));

    assert.match(tauriUnavailability().reason, /desktop app/i);
  });
});

describe("the storage backends a build offers", () => {
  const undo = [];

  afterEach(() => {
    while (undo.length) undo.pop()();
  });

  test("keeps an unusable backend on the list, carrying why it cannot be used", () => {
    undo.push(stub("showDirectoryPicker", undefined));
    undo.push(stub("isSecureContext", true));
    undo.push(stub("navigator", {}));
    undo.push(stub("__TAURI__", undefined));

    const offered = adapterTypes();

    assert.match(offered.find((type) => type.type === "filesystem").reason, /Chrome|Chromium/);
    assert.match(offered.find((type) => type.type === "tauri").reason, /desktop app/i);
    assert.equal(
      offered.find((type) => type.type === "s3").reason,
      "",
      "an S3 bucket works in every browser",
    );
  });

  test("keeps the in-memory backend off the list even so", () => {
    undo.push(stub("showDirectoryPicker", () => {}));

    assert.equal(
      adapterTypes().some((type) => type.type === "memory"),
      false,
      "not offered is not the same as unavailable, and greying it out would advertise it",
    );
  });

  test("keeps the demo backend off the list too, since the demo attaches it itself", () => {
    undo.push(stub("showDirectoryPicker", () => {}));

    assert.equal(
      adapterTypes().some((type) => type.type === "demo"),
      false,
    );
  });
});
