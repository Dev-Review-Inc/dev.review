// The agent's stream, as the chat drawer reads it.
//
// One run of `claude -p --output-format stream-json --verbose` writes one JSON
// object per line on stdout. parseLine turns a line into what the drawer shows:
// words, a note per tool use, the session the run is in, and how it ended.

const MISSING = /No conversation found/;

/**
 * What one line of the stream says.
 *
 * @param {string} text one line, from stdout or stderr
 * @returns {object[]} zero or more of {kind: "session", id}, {kind: "text"|"delta", text},
 *   {kind: "tool", note}, {kind: "result", ok, text}, {kind: "missing"}
 */
export function parseLine(text) {
  if (MISSING.test(text) && !text.startsWith("{")) return [{ kind: "missing" }];

  let event;

  try {
    event = JSON.parse(text);
  } catch {
    return [];
  }

  if (event?.type === "system" && event.subtype === "init" && event.session_id) {
    return [{ kind: "session", id: event.session_id }];
  }

  if (event?.type === "assistant") return (event.message?.content || []).flatMap(block);

  if (event?.type === "stream_event") {
    const delta = event.event?.type === "content_block_delta" ? event.event.delta : null;

    return delta?.type === "text_delta" ? [{ kind: "delta", text: delta.text }] : [];
  }

  if (event?.type === "result") return result(event);

  return [];
}

function block(part) {
  if (part.type === "text" && part.text) return [{ kind: "text", text: part.text }];
  if (part.type === "tool_use") return [{ kind: "tool", note: toolNote(part.name, part.input) }];

  return [];
}

function result(event) {
  const errors = Array.isArray(event.errors) ? event.errors : [];

  if (!event.is_error) {
    const ended = { kind: "result", ok: true, text: event.result || "" };

    return event.session_id ? [{ kind: "session", id: event.session_id }, ended] : [ended];
  }

  // The session_id on this line is one the CLI made up for the failed run.
  if (errors.some((error) => MISSING.test(error))) return [{ kind: "missing" }];

  return [{ kind: "result", ok: false, text: errors.join("; ") || event.result || event.subtype || "the run failed" }];
}

const base = (path) => String(path || "").split("/").pop();

/**
 * One line for one tool use, such as "ran npm test".
 *
 * @param {string} name the tool
 * @param {object} [input] what it was given
 * @returns {string} the note
 */
export function toolNote(name, input = {}) {
  switch (name) {
    case "Bash":
      return `ran ${String(input.command || "").split("\n")[0]}`;
    case "Edit":
    case "MultiEdit":
      return `edited ${base(input.file_path)}`;
    case "Write":
      return `wrote ${base(input.file_path)}`;
    case "Read":
      return `read ${base(input.file_path)}`;
    case "Grep":
      return `searched for ${input.pattern}`;
    case "Glob":
      return `listed ${input.pattern}`;
    default:
      return `used ${name}`;
  }
}

/**
 * The first message of a chat: what the agent may do, then what the reader said.
 *
 * @param {string} message the reader's words
 * @param {string} review the draft's review.json, absolute
 * @returns {string} the prompt
 */
export function firstPrompt(message, review) {
  return [
    `The reader of your review is talking to you from the Reviewer app. Your draft is ${review}.`,
    "You may update its findings and comment there, following the dev-review skill's format.",
    "Keep finishedAt set on every write. The reader said:",
    "",
    message,
  ].join("\n");
}
