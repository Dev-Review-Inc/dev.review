// The demo seed, held to the same reading as a real drafts directory.
//
// The seed is checked in and served statically, so the only thing standing
// between a bad edit and a broken pane in front of a customer is this run. The
// assertions live in web/demo/validate.mjs, next to the files they describe, so
// the script and the suite cannot drift; this is the hook that makes `npm test`
// carry them.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../web/demo/validate.mjs";

describe("the demo seed", () => {
  test("parses as drafts and patches, with every finding anchored", () => {
    assert.deepEqual(check(), []);
  });
});
