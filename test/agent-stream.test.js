// What the agent says while the reader talks to it.
//
// Each run of `claude -p --output-format stream-json --verbose` writes one
// JSON object per line. The chat drawer shows the agent's words, a short note
// for each tool it used, and nothing else.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { firstPrompt, parseLine, toolNote } from "../web/src/domain/agent-stream.js";

const SESSION = "19797bee-6b80-43dd-a1ea-78dc19610696";
const line = (object) => JSON.stringify(object);

describe("reading the agent's stream", () => {
  test("the init line names the session the run is in", () => {
    assert.deepEqual(parseLine(line({ type: "system", subtype: "init", session_id: SESSION, tools: [] })), [
      { kind: "session", id: SESSION },
    ]);
  });

  test("an assistant message gives its words and a note per tool use, in order", () => {
    const said = parseLine(
      line({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "" },
            { type: "text", text: "Running the tests." },
            { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          ],
        },
      }),
    );

    assert.deepEqual(said, [
      { kind: "text", text: "Running the tests." },
      { kind: "tool", note: "ran npm test" },
    ]);
  });

  test("a text delta is a piece of the reply still arriving", () => {
    const said = parseLine(
      line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Run" } } }),
    );

    assert.deepEqual(said, [{ kind: "delta", text: "Run" }]);
  });

  test("a finished run gives the result and the session it ended in", () => {
    const said = parseLine(line({ type: "result", subtype: "success", is_error: false, result: "Done.", session_id: SESSION }));

    assert.deepEqual(said, [
      { kind: "session", id: SESSION },
      { kind: "result", ok: true, text: "Done." },
    ]);
  });

  test("a session the CLI has never seen is the other-machine case, not a new session", () => {
    const said = parseLine(
      line({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        session_id: "a537bc64-5854-43f7-a7ef-a2b39e505643",
        errors: [`No conversation found with session ID: ${SESSION}`],
      }),
    );

    assert.deepEqual(said, [{ kind: "missing" }]);
  });

  test("the same error on stderr reads the same way", () => {
    assert.deepEqual(parseLine(`No conversation found with session ID: ${SESSION}`), [{ kind: "missing" }]);
  });

  test("a failed run says why", () => {
    const said = parseLine(line({ type: "result", subtype: "error_max_turns", is_error: true, errors: ["Reached max turns"] }));

    assert.deepEqual(said, [{ kind: "result", ok: false, text: "Reached max turns" }]);
  });

  test("everything else is nothing to show", () => {
    assert.deepEqual(parseLine(line({ type: "system", subtype: "thinking_tokens" })), []);
    assert.deepEqual(parseLine(line({ type: "user", message: { content: [{ type: "tool_result" }] } })), []);
    assert.deepEqual(parseLine("not json"), []);
    assert.deepEqual(parseLine(""), []);
  });
});

describe("the one-line note for a tool use", () => {
  test("names the file an edit or a write touched, not its whole path", () => {
    assert.equal(toolNote("Edit", { file_path: "/drafts/org--app-42/review.json" }), "edited review.json");
    assert.equal(toolNote("Write", { file_path: "/drafts/org--app-42/review.json" }), "wrote review.json");
    assert.equal(toolNote("Read", { file_path: "/src/app.js" }), "read app.js");
  });

  test("keeps a command to its first line", () => {
    assert.equal(toolNote("Bash", { command: "npm test\necho done" }), "ran npm test");
  });

  test("says what a search looked for", () => {
    assert.equal(toolNote("Grep", { pattern: "rescue" }), "searched for rescue");
    assert.equal(toolNote("Glob", { pattern: "**/*.rb" }), "listed **/*.rb");
  });

  test("names any other tool", () => {
    assert.equal(toolNote("WebFetch", {}), "used WebFetch");
  });
});

describe("the first message of a chat", () => {
  const prompt = firstPrompt("Is the second finding right?", "/Users/me/drafts/org--app-42/review.json");

  test("names the draft the agent may edit, and how", () => {
    assert.match(prompt, /\/Users\/me\/drafts\/org--app-42\/review\.json/);
    assert.match(prompt, /dev-review skill/);
    assert.match(prompt, /finishedAt/);
  });

  test("ends with what the reader said", () => {
    assert.ok(prompt.endsWith("Is the second finding right?"));
  });
});
