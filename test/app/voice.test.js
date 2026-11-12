// The agent by voice, from a microphone in the header: hands-free turns of
// listen, ask, speak. Recognition rests while the agent thinks, and listens
// while it speaks so the reader can cut in; what is only the agent's own voice
// is ignored. The mic says which of those it is in, and nothing else is drawn.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { drawVoice, echoes, sharedAgent, startVoice, stopVoice, toggleVoice } from "../../web/src/app/voice.js";

function stub(tag = "div") {
  const listeners = {};

  return {
    tag,
    className: "",
    textContent: "",
    innerHTML: "",
    title: "",
    hidden: false,
    children: [],
    style: { cssText: "", setProperty() {} },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
    addEventListener(name, handler) {
      (listeners[name] = listeners[name] || []).push(handler);
    },
    click() {
      for (const handler of listeners.click || []) handler({ target: this });
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    removeAttribute(name) {
      delete this[name];
    },
  };
}

// Waits out every promise already settled.
const settle = () => new Promise((done) => setTimeout(done, 0));

// A promise and the hand that settles it.
function later() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

// The web view's recognition, driven by hand.
class FakeRecognition {
  static last = null;

  constructor() {
    this.listening = false;
    this.aborted = false;
    FakeRecognition.last = this;
  }

  start() {
    if (this.listening) throw new Error("InvalidStateError");
    this.listening = true;
  }

  stop() {
    this.listening = false;
  }

  abort() {
    this.aborted = true;
    this.listening = false;
  }

  hear(words, isFinal = true) {
    const result = [{ transcript: words }];

    result.isFinal = isFinal;
    this.onresult({ resultIndex: 0, results: [result] });
  }

  // The engine ending a session on its own, as it does after silence.
  end() {
    this.listening = false;
    this.onend?.();
  }
}

const agent = () => ({ session: "first", cwd: "/Users/me/apps/app" });

describe("the agent by voice", () => {
  let app;
  let asked;
  let answers;
  let spoken;
  let hushed;
  let states;
  let footer;
  let view;

  const state = () => states.at(-1);

  beforeEach(() => {
    asked = [];
    answers = [];
    spoken = [];
    hushed = 0;
    states = [];
    footer = stub("p");
    app = {
      voice: {
        ask: (request) => {
          asked.push(request);
          const answer = later();

          answers.push(answer);
          return answer.promise;
        },
        say: (words) => {
          const done = later();

          spoken.push({ words, done });
          return done.promise;
        },
        hush: async () => {
          hushed += 1;
        },
      },
    };
    globalThis.document = { createElement: (tag) => stub(tag), getElementById: (id) => (id === "status" ? footer : null) };
  });

  afterEach(() => {
    view?.teardown();
    view = null;
    delete globalThis.document;
  });

  const begin = (draft = agent()) => {
    view = startVoice(app, draft, (now) => states.push(now), FakeRecognition);

    return FakeRecognition.last;
  };

  test("asks what was said, with the draft's session and folder", () => {
    const recognition = begin();

    assert.equal(recognition.listening, true);
    assert.equal(state(), "listening");

    recognition.hear("why rename the column", false);
    assert.deepEqual(asked, []);

    recognition.hear("why rename the column");

    assert.deepEqual(asked, [{ session: "first", cwd: "/Users/me/apps/app", words: "why rename the column" }]);
    assert.equal(state(), "thinking");
  });

  test("hands the agent its review draft with the first thing said, and only the first", async () => {
    app.selected = { draft: { title: "Rename the column", verdict: "comment" } };
    const recognition = begin();

    recognition.hear("why rename the column");
    assert.equal(
      asked[0].words,
      'The review draft you wrote for this pull request, for context:\n{"title":"Rename the column","verdict":"comment"}\n\nThe reader says: why rename the column',
    );

    answers[0].resolve({ reply: "Clarity.", session: "first" });
    await settle();
    spoken[0].done.resolve();
    await settle();
    recognition.hear("and the index");

    assert.equal(asked[1].words, "and the index");
  });

  test("never listens while it thinks, listens while it speaks, and again after", async () => {
    const recognition = begin();

    recognition.hear("why rename the column");
    assert.equal(recognition.listening, false);

    // Ending on its own while the agent thinks does not wake it.
    recognition.end();
    assert.equal(recognition.listening, false);

    answers[0].resolve({ reply: "The old name collided.", session: "second" });
    await settle();

    assert.deepEqual(spoken.map((say) => say.words), ["The old name collided."]);
    assert.equal(state(), "speaking");
    assert.equal(recognition.listening, true);

    // Silence ends a session while it speaks; it keeps listening.
    recognition.end();
    assert.equal(recognition.listening, true);

    spoken[0].done.resolve();
    await settle();

    assert.equal(recognition.listening, true);
    assert.deepEqual(states, ["listening", "thinking", "speaking", "listening"]);
  });

  test("ignores its own voice heard while it speaks", async () => {
    const recognition = begin();

    recognition.hear("why");
    answers[0].resolve({ reply: "The old name collided with a reserved word.", session: "first" });
    await settle();

    recognition.hear("the old name", false);
    recognition.hear("The old name collided.");

    assert.equal(hushed, 0);
    assert.equal(asked.length, 1);
    assert.equal(state(), "speaking");
  });

  test("the reader cuts in: it hushes at once and asks what they said", async () => {
    const recognition = begin();

    recognition.hear("why");
    answers[0].resolve({ reply: "Because the old name collided.", session: "second" });
    await settle();

    recognition.hear("wait, what about", false);
    assert.equal(hushed, 1);
    assert.equal(state(), "listening");

    recognition.hear("wait, what about the index");
    assert.deepEqual(asked.at(-1), { session: "second", cwd: "/Users/me/apps/app", words: "wait, what about the index" });
    assert.equal(state(), "thinking");

    // The hushed reply ends; that starts no second listen or turn.
    spoken[0].done.resolve();
    await settle();

    assert.equal(asked.length, 2);
    assert.equal(recognition.listening, false);
    assert.equal(state(), "thinking");
  });

  test("resumes the session the last reply handed back", async () => {
    const draft = agent();
    const recognition = begin(draft);

    recognition.hear("first question");
    answers[0].resolve({ reply: "One.", session: "second" });
    await settle();
    spoken[0].done.resolve();
    await settle();

    recognition.hear("second question");

    assert.equal(asked[1].session, "second");
    // The terminal resumes the same conversation after.
    assert.equal(draft.session, "second");
  });

  test("keeps listening, hands-free, when a session ends with nothing heard", () => {
    const recognition = begin();

    recognition.end();

    assert.equal(recognition.listening, true);
  });

  test("a failed question says why in the footer and listens again", async () => {
    const recognition = begin();

    recognition.hear("why");
    answers[0].reject(new Error("claude is not signed in"));
    await settle();

    assert.equal(footer.textContent, "claude is not signed in");
    assert.equal(footer.className, "error");
    assert.deepEqual(spoken, []);
    assert.equal(recognition.listening, true);
    assert.equal(state(), "listening");
  });

  test("a microphone not allowed says so and turns off", () => {
    const recognition = begin();

    recognition.onerror({ error: "not-allowed" });

    assert.match(footer.textContent, /microphone/);
    assert.equal(recognition.listening, false);
    assert.equal(state(), "off");
  });

  test("teardown stops listening, hushes, and ignores a late reply", async () => {
    const recognition = begin();

    recognition.hear("why");
    view.teardown();
    view = null;

    assert.equal(recognition.aborted, true);
    assert.equal(hushed, 1);

    answers[0].resolve({ reply: "Because.", session: "first" });
    await settle();

    assert.deepEqual(spoken, []);
    assert.equal(recognition.listening, false);
  });

  test("echoes: most of the heard words are in what is spoken", () => {
    assert.equal(echoes("The old name, collided!", "the old name collided with a word"), true);
    assert.equal(echoes("wait the old name", "the old name collided"), true);
    assert.equal(echoes("wait what about the index", "the old name collided"), false);
    assert.equal(echoes("", "anything"), true);
    assert.equal(echoes("don't", "Don’t do that."), true);
  });

  test("says so in the footer where the web view cannot listen, and starts nothing", () => {
    view = startVoice(app, agent(), (now) => states.push(now), null);

    assert.equal(view, null);
    assert.match(footer.textContent, /cannot listen/);
    assert.equal(footer.className, "error");
  });
});

describe("the mic in the header", () => {
  let app;
  let mic;
  let footer;

  beforeEach(() => {
    mic = stub("button");
    footer = stub("p");
    app = {
      voice: { ask: () => new Promise(() => {}), say: async () => {}, hush: async () => {} },
      selected: { key: "a", draft: { agent: agent() } },
    };
    globalThis.SpeechRecognition = FakeRecognition;
    globalThis.document = {
      createElement: (tag) => stub(tag),
      getElementById: (id) => ({ "voice-mic": mic, status: footer })[id] ?? null,
    };
  });

  afterEach(() => {
    stopVoice();
    delete globalThis.SpeechRecognition;
    delete globalThis.document;
  });

  const on = () => mic.className.split(" ").find((name) => name.startsWith("is-"));

  test("shows only where the build has the agent by voice and the item has an agent", () => {
    drawVoice(app);
    assert.equal(mic.hidden, false);
    assert.equal(on(), "is-off");
    assert.equal(mic.title, "Talk to the agent by voice");
    assert.equal(mic["aria-pressed"], "false");

    app.selected = { key: "b", draft: {} };
    drawVoice(app);
    assert.equal(mic.hidden, true);

    app.selected = { key: "a", draft: { agent: agent() } };
    app.voice = null;
    drawVoice(app);
    assert.equal(mic.hidden, true);
  });

  test("follows the loop: off, listening, thinking, and back off", () => {
    drawVoice(app);

    toggleVoice(app);
    assert.equal(on(), "is-listening");
    assert.equal(mic["aria-pressed"], "true");
    assert.match(mic.title, /Listening/);

    FakeRecognition.last.hear("why");
    assert.equal(on(), "is-thinking");

    toggleVoice(app);
    assert.equal(on(), "is-off");
    assert.equal(FakeRecognition.last.aborted, true);
  });

  test("selecting another item turns it off", () => {
    drawVoice(app);
    toggleVoice(app);
    const recognition = FakeRecognition.last;

    app.selected = { key: "b", draft: { agent: agent() } };
    drawVoice(app);

    assert.equal(recognition.aborted, true);
    assert.equal(on(), "is-off");
  });

  test("where the web view cannot listen it says so and stays off", () => {
    delete globalThis.SpeechRecognition;
    drawVoice(app);

    toggleVoice(app);

    assert.match(footer.textContent, /cannot listen/);
    assert.equal(on(), "is-off");
  });

  test("moves the shared copy of the agent on, never the draft's own", async () => {
    app.voice.ask = async () => ({ reply: "One.", session: "second" });
    drawVoice(app);
    toggleVoice(app);
    FakeRecognition.last.hear("why");
    await settle();

    assert.equal(sharedAgent(app).session, "second");
    assert.equal(app.selected.draft.agent.session, "first");
  });
});

describe("the mic, while the agent thinks", () => {
  test("spins a ring, so the wait can be seen", async () => {
    const { readFileSync } = await import("node:fs");
    const sheet = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");

    assert.match(sheet, /\.voice-mic\.is-thinking::after \{[^}]*animation: spin/);
    assert.match(sheet, /\.voice-mic\[aria-pressed="true"\] \{[^}]*background:/);
  });
});
