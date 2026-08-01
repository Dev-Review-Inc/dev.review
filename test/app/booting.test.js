// Arriving all at once.
//
// Starting up reads the log, then the destination, then every source, then the
// first ready review - four rounds of disk and network, and each one used to
// paint the moment it landed. The reader watched the interface assemble itself
// out of parts, over a shell whose hardcoded defaults claimed there was no
// source and nothing to review while both were still being fetched.
//
// So nothing is drawn until all of it is in. One curtain, lifted once, over an
// interface that is already whole behind it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { FLOOR, startup } from "../../web/src/app/booting.js";

/**
 * A startup with everything recorded and nothing real behind it.
 *
 * @param {object} [overrides] what to do differently
 * @returns {object} the run, its log, and the clock it was given
 */
function aStartup(overrides = {}) {
  const log = [];
  let clock = 0;

  const run = startup({
    boot: async () => {
      log.push("boot");
    },
    open: async () => {
      log.push("open");
    },
    render: () => log.push("render"),
    reveal: () => log.push("reveal"),
    failed: (failure) => log.push(`failed:${failure.message}`),
    now: () => clock,
    wait: async (ms) => {
      log.push(`wait:${ms}`);
      clock += ms;
    },
    ...overrides,
  });

  return { run, log, tick: (ms) => (clock += ms) };
}

describe("starting the interface up", () => {
  test("draws nothing until everything is in", async () => {
    const { run, log } = aStartup();

    assert.equal(log.includes("render"), false, "drew before the work had finished");
    assert.equal(log.includes("reveal"), false, "lifted the curtain before the work had finished");

    await run;

    assert.deepEqual(log.indexOf("render") > log.indexOf("boot"), true);
    assert.deepEqual(log.indexOf("render") > log.indexOf("open"), true);
  });

  test("draws once, and only once", async () => {
    const { run, log } = aStartup();

    await run;

    assert.equal(log.filter((entry) => entry === "render").length, 1);
  });

  test("opens the first ready review before drawing, so it is not a second arrival", async () => {
    const { run, log } = aStartup();

    await run;

    assert.deepEqual(
      log.filter((entry) => !entry.startsWith("wait")),
      ["boot", "open", "render", "reveal"],
    );
  });

  test("lifts the curtain last, over an interface already drawn", async () => {
    const { run, log } = aStartup();

    await run;

    assert.equal(log.indexOf("reveal") > log.indexOf("render"), true);
  });
});

describe("when starting up goes wrong", () => {
  test("still lifts the curtain, rather than leaving the reader under it", async () => {
    const { run, log } = aStartup({
      boot: async () => {
        throw new Error("no network");
      },
    });

    await run;

    assert.deepEqual(
      log.filter((entry) => !entry.startsWith("wait")),
      ["failed:no network", "render", "reveal"],
    );
  });

  test("does not open a review when there was no boot to open one from", async () => {
    const { run, log } = aStartup({
      boot: async () => {
        throw new Error("no network");
      },
    });

    await run;

    assert.equal(log.includes("open"), false);
  });

  // A curtain that never lifts is the whole app lost, and the reader has no way
  // out of it but a reload that lands them in the same place.
  test("still lifts the curtain when drawing the interface throws", async () => {
    const { run, log } = aStartup({
      render: () => {
        throw new Error("the rail would not draw");
      },
    });

    await run;

    assert.deepEqual(
      log.filter((entry) => !entry.startsWith("wait")),
      ["boot", "open", "failed:the rail would not draw", "reveal"],
    );
  });

  test("lifts the curtain when the review it tried to open will not load", async () => {
    const { run, log } = aStartup({
      open: async () => {
        throw new Error("rate limited");
      },
    });

    await run;

    assert.deepEqual(
      log.filter((entry) => !entry.startsWith("wait")),
      ["boot", "failed:rate limited", "render", "reveal"],
    );
  });
});

describe("how long the curtain is held", () => {
  test("holds a fast start up to the floor, so the interface does not flash", async () => {
    const { run, log } = aStartup();

    await run;

    assert.equal(log.includes(`wait:${FLOOR}`), true);
  });

  test("adds nothing to a start up that already outran the floor", async () => {
    const log = [];
    let clock = 0;

    await startup({
      boot: async () => {
        clock += FLOOR * 3;
      },
      open: async () => {},
      render: () => log.push("render"),
      reveal: () => log.push("reveal"),
      failed: () => {},
      now: () => clock,
      wait: async (ms) => log.push(`wait:${ms}`),
    });

    assert.deepEqual(log, ["render", "wait:0", "reveal"]);
  });
});
