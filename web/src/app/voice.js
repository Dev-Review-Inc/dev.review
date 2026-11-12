// The agent by voice, from a microphone in the header: listen, ask, speak,
// listen again. The mic is all that is drawn; its look says which of those it
// is doing, and the footer says what went wrong.
//
// Recognition rests while the agent thinks. It listens while the agent speaks,
// so the reader can cut in; what it hears of the agent's own voice is ignored.
// Each answer hands back the session the next turn resumes, kept on the copy of
// the agent the terminal resumes too. The two never run at once: both resume
// the session, and two writers fork it.

import { button } from "../ui/button.js";
import { restyle } from "../ui/render.js";
import { find, say, MIC_ICON } from "./dom.js";
import { stopTerminal } from "./terminal.js";

const tokens = (text) =>
  text
    .toLowerCase()
    .replace(/['’]/g, "")
    .match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Whether `heard` is only the mic picking up `spoken`: most of its words are in it.
 *
 * @param {string} heard what recognition heard
 * @param {string} spoken what the agent is saying
 * @returns {boolean} true when it is an echo, or has no words at all
 */
export function echoes(heard, spoken) {
  const said = new Set(tokens(spoken));
  const mine = tokens(heard);

  return mine.filter((word) => said.has(word)).length >= mine.length * 0.6;
}

const TITLES = {
  off: "Talk to the agent by voice",
  listening: "Listening: click to stop talking to the agent",
  thinking: "Thinking: click to stop talking to the agent",
  speaking: "Speaking: click to stop talking to the agent",
};

// The agent both the terminal and the voice resume, for the item selected.
let shared = null;
// The conversation running: which item it is for, its state, and its teardown.
let talk = null;

/**
 * The copy of the selected item's agent the terminal and the voice resume.
 * Voice moves its session on; the draft's own agent stays as written.
 *
 * @param {object} app the application
 * @returns {{session: string, cwd: string}|null} the copy, or null with no agent
 */
export function sharedAgent(app) {
  const agent = app.selected?.draft?.agent;

  if (!agent) return null;
  if (shared?.key !== app.selected.key) shared = { key: app.selected.key, agent: { ...agent } };

  return shared.agent;
}

/**
 * Draw the mic for the item selected; selecting another item ends the talk.
 *
 * @param {object} app the application; `app.voice` asks, says and hushes
 * @returns {void}
 */
export function drawVoice(app) {
  const key = app.voice && sharedAgent(app) ? app.selected.key : null;

  if (talk && talk.key !== key) stopVoice();
  paint();
  find("voice-mic").hidden = !key;
}

/**
 * Turn the talk on, stopping any terminal, or off.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function toggleVoice(app) {
  if (talk) return stopVoice();

  stopTerminal();

  const conversation = { key: app.selected.key, state: "off" };

  talk = conversation;
  const started = startVoice(app, sharedAgent(app), (now) => {
    if (talk !== conversation) return;
    if (now === "off") return stopVoice();
    conversation.state = now;
    paint();
  });

  conversation.teardown = started?.teardown;
  conversation.finish = started?.finish;
  if (!started) stopVoice();
}

/**
 * End the talk. A turn being thought about gets its answer first, so whatever
 * resumes the session next finds that turn in it.
 *
 * @returns {Promise<void>|null} settled once the talk has ended, or null when it ended now
 */
export function finishVoice() {
  const ending = talk;

  if (ending?.state !== "thinking") {
    stopVoice();

    return null;
  }

  return ending.finish().then(() => talk === ending && stopVoice());
}

/**
 * End the talk, if there is one.
 *
 * @returns {void}
 */
export function stopVoice() {
  const ending = talk;

  talk = null;
  ending?.teardown?.();
  paint();
}

function paint() {
  const mic = find("voice-mic");

  if (!mic) return;

  const state = talk?.state ?? "off";

  restyle(button({ role: "icon", icon: MIC_ICON, title: TITLES[state], pressed: Boolean(talk) }), mic);
  mic.className += ` voice-mic is-${state}`;
}

/**
 * Start a voice conversation with the agent.
 *
 * @param {object} app the application; `app.voice` asks, says and hushes
 * @param {{session: string, cwd: string}} agent the agent to resume; its session moves on
 * @param {Function} report told each state: listening, thinking, speaking, or off
 * @param {Function|null} Recognition the web view's speech recognition, if any
 * @returns {{teardown: Function}|null} what takes it down, or null where it cannot listen
 */
export function startVoice(
  app,
  agent,
  report,
  Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
) {
  if (!Recognition) {
    say("This build's web view cannot listen, so the agent cannot be talked to here.", "error");

    return null;
  }

  const recognition = new Recognition();
  // The draft goes with the first thing said, so the agent starts from its own review.
  let draft = app.selected?.draft;
  const briefed = (words) => {
    if (!draft) return words;

    const brief = `The review draft you wrote for this pull request, for context:\n${JSON.stringify(draft)}\n\nThe reader says: ${words}`;

    draft = null;

    return brief;
  };
  let state = "";
  let closed = false;
  // Set when the terminal is waiting for this turn; its answer is then not spoken.
  let finishing = false;
  // The turn in flight, settled once its session has moved on.
  let pending = Promise.resolve();
  // Bumped when a turn is no longer wanted, so it goes quiet.
  let turn = 0;
  // The reply being spoken, to tell its echo from the reader.
  let reply = "";

  const show = (now) => {
    state = now;
    report(now);
  };

  const hear = () => {
    try {
      recognition.start();
    } catch {
      // Already listening.
    }
  };

  const listen = () => {
    show("listening");
    hear();
  };

  const teardown = () => {
    closed = true;
    turn += 1;
    recognition.abort();
    app.voice.hush().catch(() => {});
  };

  const ask = async (words) => {
    const mine = ++turn;
    const wanted = () => !closed && !finishing && turn === mine;

    recognition.stop();
    show("thinking");

    try {
      const answer = await app.voice.ask({ session: agent.session, cwd: agent.cwd, words: briefed(words) });

      agent.session = answer.session || agent.session;
      if (!wanted()) return;
      reply = answer.reply;
      show("speaking");
      hear();
      await app.voice.say(answer.reply);
    } catch (failure) {
      if (!wanted()) return;
      say(failure.message, "error");
    }

    if (wanted()) listen();
  };

  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = globalThis.navigator?.language || "en-US";
  recognition.onresult = (event) => {
    const results = Array.from(event.results);
    const heard = results.map((result) => result[0].transcript).join("").trim();

    if (state === "speaking") {
      if (echoes(heard, reply)) return;
      // The reader cut in: hush, and the turn in flight goes quiet.
      turn += 1;
      app.voice.hush().catch(() => {});
      show("listening");
    }
    if (state !== "listening") return;

    if (results.at(-1)?.isFinal && heard) pending = ask(heard);
  };
  // Silence ends a session; hands-free means starting another.
  recognition.onend = () => {
    if (!closed && (state === "listening" || state === "speaking")) hear();
  };
  recognition.onerror = (event) => {
    if (!/not-allowed/.test(event.error)) return;
    say("The microphone is not allowed for this app.", "error");
    teardown();
    show("off");
  };

  listen();

  // Let a turn being thought about finish, without speaking it.
  const finish = () => {
    if (state !== "thinking") return Promise.resolve();

    finishing = true;
    recognition.abort();

    return pending;
  };

  return { teardown, finish };
}
