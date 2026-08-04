// The home screen widget is told the queue count, not asked for it.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { syncWidget } from "../../web/src/app/widget.js";

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15";

function fakeNavigator(userAgent) {
  Object.defineProperty(globalThis, "navigator", { value: { userAgent }, configurable: true });
}

describe("syncWidget()", () => {
  let realNavigator;

  beforeEach(() => {
    realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", realNavigator);
    delete globalThis.__TAURI__;
  });

  test("tells the iOS app how many are waiting", async () => {
    fakeNavigator(IOS_UA);

    const calls = [];

    globalThis.__TAURI__ = {
      core: {
        async invoke(command, args) {
          calls.push({ command, args });
        },
      },
    };

    await syncWidget(3);

    assert.deepEqual(calls, [{ command: "widget_update", args: { count: 3 } }]);
  });

  test("does nothing outside the iOS app, rather than throwing", async () => {
    fakeNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");

    globalThis.__TAURI__ = {
      core: {
        async invoke() {
          throw new Error("should not have been called");
        },
      },
    };

    await syncWidget(3);
  });

  test("does nothing in a browser tab with no Tauri global at all", async () => {
    fakeNavigator(IOS_UA);
    delete globalThis.__TAURI__;

    await syncWidget(3);
  });
});
