// A chat with the agent that wrote a draft, driven against a fake runner.
//
// The real runner spawns `claude` from Rust, which no test here can do. The
// fake takes the same request, hands back the lines a real run would print,
// and says when it exits.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { AgentChat } from "../../web/src/app/agent-chat.js";
import { anApp, agentWrites, aDraft } from "../use-cases/helper.js";

const WROTE = "3f2a9c1e-0b4d-4e8a-9f6c-2d1e7b5a8c90";
const FORK = "19797bee-6b80-43dd-a1ea-78dc19610696";
const REVIEW = "/Users/priya/drafts/org--app-42/review.json";
const line = (object) => JSON.stringify(object);

/** A runner that records each request and lets the test play the run. */
function fakeRunner() {
  const runs = [];

  return {
    runs,
    start(request, onLine) {
      let exit;
      const run = {
        request,
        cancelled: false,
        say: (text) => onLine(text),
        exit: (code) => exit({ code }),
        started: Promise.resolve(),
        done: new Promise((resolve) => (exit = resolve)),
        cancel() {
          run.cancelled = true;
        },
      };

      runs.push(run);

      return run;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("talking to the agent that wrote the draft", () => {
  let app;
  let runner;
  let chat;

  beforeEach(async () => {
    app = await anApp();
    await agentWrites(app.adapter, aDraft({ agent: { session: WROTE, cwd: "/Users/priya/apps/app" } }));
    await app.drafts.loadAll();

    runner = fakeRunner();
    chat = new AgentChat({
      runner,
      commands: app.commands,
      queries: app.queries,
      source: app.source,
      entry: () => app.open(),
      review: REVIEW,
      changed() {},
    });
  });

  test("the first message forks the draft's session, in its folder, saying what it may edit", async () => {
    chat.send("Is the second finding right?");
    await settle();

    const { request } = runner.runs[0];

    assert.equal(request.session, WROTE);
    assert.equal(request.fork, true);
    assert.equal(request.cwd, "/Users/priya/apps/app");
    assert.equal(request.folder, "/Users/priya/drafts/org--app-42");
    assert.match(request.message, /review\.json/);
    assert.ok(request.message.endsWith("Is the second finding right?"));
  });

  test("the fork the run reports is recorded, and the next message resumes it as it was typed", async () => {
    chat.send("First.");
    await settle();
    runner.runs[0].say(line({ type: "system", subtype: "init", session_id: FORK }));
    runner.runs[0].exit(0);
    await settle();

    assert.equal(app.queries.agentFork(app.source, app.open()), FORK);

    chat.send("Second.");
    await settle();

    assert.deepEqual(
      { session: runner.runs[1].request.session, fork: runner.runs[1].request.fork, message: runner.runs[1].request.message },
      { session: FORK, fork: false, message: "Second." },
    );
  });

  test("shows the reader's words, the agent's, and a note per tool", async () => {
    chat.send("Run the tests.");
    await settle();
    runner.runs[0].say(
      line({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Running them." },
            { type: "tool_use", name: "Edit", input: { file_path: REVIEW } },
          ],
        },
      }),
    );
    runner.runs[0].say(line({ type: "result", is_error: false, result: "Running them.", session_id: FORK }));
    runner.runs[0].exit(0);
    await settle();

    assert.deepEqual(chat.said, [
      { who: "reader", text: "Run the tests." },
      { who: "agent", text: "Running them." },
      { who: "tool", text: "edited review.json" },
    ]);
  });

  test("is busy while a run is going, takes no second message, and cancels", async () => {
    chat.send("One.");
    await settle();

    assert.equal(chat.busy, true);

    chat.send("Two.");
    await settle();
    assert.equal(runner.runs.length, 1);

    chat.cancel();
    assert.equal(runner.runs[0].cancelled, true);

    runner.runs[0].exit(null);
    await settle();

    assert.equal(chat.busy, false);
    assert.equal(chat.said.at(-1).who, "error");
  });

  test("a session the CLI does not know means the agent ran on another machine", async () => {
    chat.send("Hello?");
    await settle();
    runner.runs[0].say(`No conversation found with session ID: ${WROTE}`);
    runner.runs[0].exit(1);
    await settle();

    assert.equal(chat.elsewhere, true);
    assert.equal(app.queries.agentFork(app.source, app.open()), null);
  });

  test("a folder that is not on this machine means the same", async () => {
    runner.start = () => ({ started: Promise.reject({ code: "elsewhere", message: "the agent ran on another machine" }) });

    await chat.send("Hello?");

    assert.equal(chat.elsewhere, true);
    assert.equal(chat.busy, false);
  });
});
