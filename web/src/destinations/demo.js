// Somewhere for the demo to post that is nowhere at all.
//
// This is the writing half of the demo. It answers the queue, the diff and the
// head commit out of the same kind of static file the demo reader uses, and it
// posts nothing: a visitor to a marketing page has given us no token and no
// permission, so the send has to be a no-op that says so in its own words
// rather than a send that quietly fails.

import { readSeed, seedKey } from "../demo/seed.js";

export class DemoDestination {
  static type = "demo";
  static label = "Demo";

  // Never offered in the interface. The demo attaches it, and a reader who
  // picked it by hand would get a destination that cannot post.
  static selectable = false;
  static fields = [];

  // What this destination calls the send, and what it can honestly promise
  // about it. The confirmation sheet asks the destination rather than deciding
  // for itself, so a new destination brings its own words with it.
  static postLabel = "Post review";
  static postNote = "this is the demo, so nothing is sent anywhere";

  // And what it says afterwards, which is where this matters most. The screen
  // after the send used to read "Review posted" over a link to the real pull
  // request, which has no such review on it: the sheet promised nothing would
  // be sent and the next screen took the promise back.
  //
  // So it says what happened, which is nothing, and spends the moment on the
  // one thing worth asking for. Somebody who has just triaged a review and
  // reached for the send is as interested as they are going to get.
  static sent = false;
  static postedTitle = "That is where a real review leaves";
  static postedNote = "Nothing was sent. There is no token on this page and the demo has nowhere to post.";
  static postedCta = {
    text: "Point it at your own pull requests →",
    href: "/docs.html#start",
  };
  static postedRecord = "you triaged this one {age} ago - nothing was sent";

  // There is no token here to sign out of, so the control in that corner puts
  // the demo back instead.
  static resets = true;

  /**
   * @param {object} [config] how to build it
   * @param {string} [config.label] what to call it
   * @param {string} [config.seed] where the sample data is served
   * @param {(url: string) => Promise<object>} [config.fetch] how to fetch it
   */
  constructor(config = {}) {
    this.config = config;
    this._label = config.label || DemoDestination.label;
    this._seed = config.seed || "";
    this._fetch = config.fetch || ((url) => globalThis.fetch(url));

    this._document = {};
    this._problem = "";
    this._loading = null;
  }

  /**
   * Who the demo is signed in as, which is whoever the sample data says.
   *
   * @returns {Promise<{login: string, avatar: string}>} the account
   * @throws {Error} when the sample data was never deployed
   */
  async identify() {
    await this._loaded();

    if (this._problem) throw new Error(this._problem);

    return { login: this._document.login || "", avatar: "" };
  }

  /**
   * @returns {Promise<object[]>} the pull requests the sample data carries
   */
  async queue() {
    await this._loaded();

    // Seeds predate issues, so an entry that does not say is a pull request.
    return (this._document.pulls || []).map((pull) => ({ isIssue: false, ...pull }));
  }

  /**
   * @param {object} pull which pull request
   * @returns {Promise<string>} the commit a review would be pinned to
   */
  async headCommit(pull) {
    await this._loaded();

    return (this._document.commits || {})[seedKey(pull)] || "";
  }

  /**
   * @param {object} pull which pull request
   * @returns {Promise<object[]>} one entry per changed file
   */
  async files(pull) {
    await this._loaded();

    return (this._document.files || {})[seedKey(pull)] || [];
  }

  /**
   * Take a comment nowhere.
   *
   * No network, deliberately, and not even a seed to load: the demo must not be
   * able to reach GitHub even by accident.
   *
   * @param {object} pull which pull request
   * @returns {Promise<{url: string}>} where the reader can see the real thing
   */
  async comment(pull) {
    return { url: pull.url || "" };
  }

  /**
   * Take a review nowhere.
   *
   * @param {object} pull which pull request
   * @returns {Promise<{url: string}>} where the reader can see the real thing
   */
  async review(pull) {
    return { url: pull.url || "" };
  }

  /**
   * Answer an issue's live body out of the seed.
   *
   * The tour diffs a proposed rewrite against this, so the seed carries the
   * body under `issues`, keyed the way `files` and `commits` are. An issue the
   * seed does not carry gets a canned body, enough for the path to walk on.
   *
   * @param {object} target which issue
   * @returns {Promise<{body: string, title: string, isPull: boolean, url: string}>} the issue
   */
  async issue(target) {
    await this._loaded();

    const body = (this._document.issues || {})[seedKey(target)];

    if (body === undefined) {
      return {
        body: "A sample issue, standing in for one of yours.",
        title: "A sample issue",
        isPull: false,
        url: target.url || "",
      };
    }

    return {
      body,
      title: target.title || "",
      isPull: false,
      url: target.url || "",
    };
  }

  /**
   * Take a description rewrite nowhere.
   *
   * @param {object} target which issue
   * @returns {Promise<{url: string}>} where the reader can see the real thing
   */
  async patchDescription(target) {
    return { url: target.url || "" };
  }

  /**
   * Take a close nowhere.
   *
   * @param {object} target which issue
   * @returns {Promise<{url: string}>} where the reader can see the real thing
   */
  async closeIssue(target) {
    return { url: target.url || "" };
  }

  /**
   * Take an issue comment nowhere.
   *
   * @param {object} target which issue
   * @returns {Promise<{url: string}>} where the reader can see the real thing
   */
  async commentOnIssue(target) {
    return { url: target.url || "" };
  }

  /**
   * @returns {string} nothing: an empty demo queue is an empty file, and says so
   */
  emptyQueueHint() {
    return "";
  }

  _loaded() {
    if (!this._loading) this._loading = this._load();

    return this._loading;
  }

  async _load() {
    const { document, problem } = await readSeed(this._seed, this._fetch);

    this._document = document;
    this._problem = problem;
  }
}
