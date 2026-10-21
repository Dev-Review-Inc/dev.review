// Talking to the agent that wrote a draft.
//
// The first message forks the agent's session, so the sweep's own transcript
// is never appended to. The fork's ID is a decision on the pull request: it
// lives in the event log, survives a reload, and every later message resumes
// it. A redraft by a different session is a different agent to talk to.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { anApp, agentWrites, aDraft } from "./helper.js";

const WROTE = "3f2a9c1e-0b4d-4e8a-9f6c-2d1e7b5a8c90";
const FORK = "19797bee-6b80-43dd-a1ea-78dc19610696";
const agent = (session = WROTE) => ({ session, cwd: "/Users/priya/apps/app" });

describe("the forked session of a chat", () => {
  let app;

  beforeEach(async () => {
    app = await anApp();
    await agentWrites(app.adapter, aDraft({ agent: agent() }));
    await app.drafts.loadAll();
  });

  test("is nothing before the first message", () => {
    assert.equal(app.queries.agentFork(app.source, app.open()), null);
  });

  test("is what the first run reported, and survives the app being closed", async () => {
    app.commands.recordAgentFork(app.source, app.open(), FORK);
    await app.state.settled();
    await app.state.restore();

    assert.equal(app.queries.agentFork(app.source, app.open()), FORK);
  });

  test("survives the agent rewriting the draft in the same session", async () => {
    app.commands.recordAgentFork(app.source, app.open(), FORK);

    await agentWrites(app.adapter, aDraft({ agent: agent(), summary: "Second look." }));
    await app.drafts.loadAll();

    assert.equal(app.queries.agentFork(app.source, app.open()), FORK);
  });

  test("is forgotten when a different session redrafts", async () => {
    app.commands.recordAgentFork(app.source, app.open(), FORK);

    await agentWrites(app.adapter, aDraft({ agent: agent("aaaaaaaa-0b4d-4e8a-9f6c-2d1e7b5a8c90") }));
    await app.drafts.loadAll();

    assert.equal(app.queries.agentFork(app.source, app.open()), null);
  });
});
