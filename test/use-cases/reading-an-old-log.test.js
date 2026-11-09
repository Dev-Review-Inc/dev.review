// Reading a log written by an older version of the app.
//
// An action this version retired stays in the log and syncs on, but folds into
// nothing: the pull reads as if it had never been written.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { anApp, agentWrites, aDraft } from "./helper.js";

const agent = { session: "3f2a9c1e-0b4d-4e8a-9f6c-2d1e7b5a8c90", cwd: "/Users/priya/apps/app" };

describe("a log holding a retired action", () => {
  test("keeps the event and reads the pull as if it were never written", async () => {
    const app = await anApp();
    await agentWrites(app.adapter, aDraft({ agent }));
    await app.drafts.loadAll();
    const before = app.open();

    app.commands.track(app.source, "pulls", before.key, "forkAgent", {
      from: agent.session,
      session: "19797bee-6b80-43dd-a1ea-78dc19610696",
    });
    await app.state.settled();
    await app.state.restore();

    assert.ok(app.state.allEvents(app.source.id).some((event) => event.action === "forkAgent"));
    assert.ok(app.state.findAll(app.source.id, "pulls").every((pull) => !("agentFork" in pull)));
    assert.deepEqual(app.open(), before);
  });
});
