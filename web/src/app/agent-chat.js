// One chat with the agent that wrote a draft.
//
// Each message is one run. The first forks the draft's session and the fork's
// ID goes into the event log; later ones resume the fork. The transcript lives
// here, in memory, for as long as the page does.

import { firstPrompt, parseLine } from "../domain/agent-stream.js";

export class AgentChat {
  /**
   * @param {object} options what the chat runs through
   * @param {{start: Function}} options.runner starts one run: (request, onLine) => {started, done, cancel}
   * @param {object} options.commands the app's commands
   * @param {object} options.queries the app's queries
   * @param {object} options.source the source being read
   * @param {() => object} options.entry the pull request, as it reads now
   * @param {string} options.review the draft's review.json, absolute
   * @param {() => void} options.changed asks for a redraw
   */
  constructor({ runner, commands, queries, source, entry, review, changed }) {
    Object.assign(this, { runner, commands, queries, source, entry, review, changed });
    this.said = [];
    this.busy = false;
    this.elsewhere = false;
    this.typing = "";
    this._run = null;
  }

  /**
   * Send one message, and resolve when the run is over.
   *
   * @param {string} text what the reader typed
   * @returns {Promise<void>}
   */
  async send(text) {
    if (this.busy || this.elsewhere || !text.trim()) return;

    const pull = this.entry();
    const agent = pull.draft.agent;
    const fork = this.queries.agentFork(this.source, pull);
    const request = {
      message: fork ? text : firstPrompt(text, this.review),
      session: fork || agent.session,
      fork: !fork,
      cwd: agent.cwd,
      folder: this.review.replace(/\/[^/]*$/, ""),
    };

    this.said.push({ who: "reader", text });
    this.typing = "";
    this.busy = true;
    this._streaming = null;
    this._ended = false;
    this._forked = Boolean(fork);
    this.changed();

    try {
      this._run = this.runner.start(request, (line) => this._line(line, pull));
      await this._run.started;
    } catch (refusal) {
      this.busy = false;
      this._run = null;
      if (refusal?.code === "elsewhere") this.elsewhere = true;
      else this.said.push({ who: "error", text: refusal?.message || String(refusal) });
      this.changed();
      return;
    }

    const { code } = await this._run.done;

    this.busy = false;
    this._run = null;
    if (code !== 0 && !this._ended && !this.elsewhere) {
      this.said.push({ who: "error", text: code == null ? "the agent was stopped" : `the agent stopped (exit ${code})` });
    }
    this.changed();
  }

  /** Stop the run in flight, if one is. */
  cancel() {
    this._run?.cancel();
  }

  _line(line, pull) {
    for (const event of parseLine(line)) {
      if (event.kind === "session" && !this._forked && event.id !== pull.draft.agent.session) {
        this.commands.recordAgentFork(this.source, pull, event.id);
        this._forked = true;
      } else if (event.kind === "delta") {
        if (!this._streaming) this.said.push((this._streaming = { who: "agent", text: "" }));
        this._streaming.text += event.text;
      } else if (event.kind === "text") {
        if (this._streaming) this._streaming.text = event.text;
        else this.said.push({ who: "agent", text: event.text });
        this._streaming = null;
      } else if (event.kind === "tool") {
        this._streaming = null;
        this.said.push({ who: "tool", text: event.note });
      } else if (event.kind === "missing") {
        this.elsewhere = true;
      } else if (event.kind === "result") {
        this._ended = true;
        if (!event.ok) this.said.push({ who: "error", text: event.text });
      }
    }

    this.changed();
  }
}
