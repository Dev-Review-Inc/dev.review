// Writing. Every change the reader makes goes through one of these.
//
// None of them writes to the agent's draft. That file has one author and this
// app is not it, which is the whole point of the rework: the reader's decisions
// and the agent's document no longer share a set of bytes to fight over.

import { draftKey } from "../domain/draft-path.js";
import { READING } from "../queries/index.js";

export class Commands {
  /**
   * @param {object} options what to write through
   * @param {import("../state/multi-event-store.js").MultiEventStore} options.state the logs
   * @param {import("../queries/index.js").Queries} options.queries how to read back
   * @param {object} [options.sync] pushes a source's log to its adapter
   */
  constructor({ state, queries, sync }) {
    this.state = state;
    this.queries = queries;
    this.sync = sync;
    this._pending = {};
  }

  // ---- Sources

  /**
   * Add a source: a name and the storage its drafts come from.
   *
   * @param {{name: string, adapter: object}} source the source
   * @param {object} [secret] adapter credentials, kept out of the log
   * @returns {Promise<object>} the source, as it now reads
   */
  async addSource(source, secret) {
    const event = this.state.track(null, "sources", null, "create", {
      name: source.name,
      adapter: source.adapter,
    });

    if (secret) await this.state.setSecret(event.objectId, secret);

    this.state.open(event.objectId);

    return this.queries.findSource(event.objectId);
  }

  /**
   * @param {object} source which source
   * @param {string} name the new name
   * @returns {void}
   */
  renameSource(source, name) {
    this.state.track(null, "sources", source.id, "rename", { name });
  }

  /**
   * Point a source at different storage.
   *
   * @param {object} source which source
   * @param {object} adapter the adapter configuration, without credentials
   * @param {object} [secret] adapter credentials, kept out of the log
   * @returns {Promise<void>} when it is recorded
   */
  async configureSource(source, adapter, secret) {
    this.state.track(null, "sources", source.id, "configure", { adapter });

    if (secret) await this.state.setSecret(source.id, secret);
  }

  /**
   * Remove a source, its decisions, and its credentials.
   *
   * Nothing is deleted from the customer's storage. The drafts are the agent's
   * and the synced log is theirs; forgetting a source here is this browser
   * forgetting, not a deletion on their behalf.
   *
   * @param {object} source which source
   * @returns {Promise<void>} when it is gone from here
   */
  async removeSource(source) {
    this.state.track(null, "sources", source.id, "delete");

    await this.state.forgetSecret(source.id);
    await this.state.close(source.id);
  }

  // ---- Destinations

  /**
   * Add somewhere reviews can be posted.
   *
   * Whatever configuration the destination carries is recorded with it, the way
   * a source records its adapter's, so it can be rebuilt on the next load. The
   * credential is not part of that and arrives separately.
   *
   * @param {{type: string, label: string}} destination the destination
   * @param {object} [secret] the token, kept out of the log
   * @returns {Promise<object>} the destination, as it now reads
   */
  async addDestination(destination, secret) {
    const event = this.state.track(null, "destinations", null, "create", {
      ...destination,
      name: destination.label,
    });

    if (secret) await this.state.setSecret(event.objectId, secret);

    return this.queries.findDestination(event.objectId);
  }

  /**
   * Give a destination a different name.
   *
   * @param {object} destination which destination
   * @param {string} label the new name
   * @returns {void}
   */
  renameDestination(destination, label) {
    this.state.track(null, "destinations", destination.id, "rename", { label });
  }

  /**
   * Replace a destination's credential, keeping the destination itself.
   *
   * A rotated token is the same destination with a new key, so its id stands
   * and nothing recorded against it is disturbed.
   *
   * @param {object} destination which destination
   * @param {object} secret the credential, merged over what is stored
   * @returns {Promise<void>} when it is written
   */
  async recredentialDestination(destination, secret) {
    await this.mergeSecret(destination.id, secret);
  }

  /**
   * @param {object} destination which destination
   * @returns {Promise<void>} when it and its token are gone
   */
  async removeDestination(destination) {
    this.state.track(null, "destinations", destination.id, "delete");

    await this.state.forgetSecret(destination.id);
  }

  // ---- Reading a pull request

  /**
   * Take a pull request off the queue.
   *
   * Answers when the dismissal is written down, not when it is decided, so a
   * caller about to show the queue without it can wait for that to be true.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @returns {Promise<void>} when it is in local storage
   */
  dismissPull(source, pull) {
    this.track(source, "pulls", pull.key, "dismiss");

    return this.state.settled();
  }

  /**
   * Put a dismissed pull request back.
   *
   * Posting is what dismisses most of these, so most of what comes back this
   * way was posted - and the banner saying so exists to stop a second review
   * going out by accident, not to stop the one the reader just asked for by
   * restoring it on purpose. The posted record goes with the dismissal.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @returns {Promise<void>} when it is in local storage
   */
  restorePull(source, pull) {
    this.track(source, "pulls", pull.key, "restore");
    this.track(source, "pulls", pull.key, "redraft");

    return this.state.settled();
  }

  /**
   * Forget that a review already went out for this pull request, because the
   * reader just asked for a fresh one.
   *
   * Without this, a pull request the reader has already posted a review for
   * stays locked as posted forever, even after the draft it described is
   * gone and replaced - the buttons and the comment box read "already sent"
   * against a review that, as far as the reader is concerned, has not
   * happened yet.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @returns {void}
   */
  forgetPost(source, pull) {
    this.track(source, "pulls", pull.key, "redraft");
  }

  /**
   * Rewriting the summary is opting it in - a reader does not bother wording a
   * summary they do not intend to send.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {string} body the review body as the reader wants it
   * @returns {void}
   */
  editComment(source, pull, body) {
    this.track(source, "pulls", pull.key, "editComment", { body });
    this.track(source, "pulls", pull.key, "includeSummary");
  }

  /**
   * Put the review body in what gets sent. Like a finding, the summary the
   * agent drafted is readable from the moment it lands and goes nowhere until
   * the reader says it should.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @returns {void}
   */
  includeSummary(source, pull) {
    this.track(source, "pulls", pull.key, "includeSummary");
  }

  /**
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @returns {void}
   */
  excludeSummary(source, pull) {
    this.track(source, "pulls", pull.key, "excludeSummary");
  }

  /**
   * Put the review body back to what the agent drafted.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @returns {void}
   */
  resetComment(source, pull) {
    this.track(source, "pulls", pull.key, "resetComment");
  }

  /**
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {string} event APPROVE, COMMENT or REQUEST_CHANGES
   * @returns {void}
   */
  chooseVerdict(source, pull, event) {
    this.track(source, "pulls", pull.key, "chooseVerdict", { event });
  }

  /**
   * Record that the review went out.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {{url: string, event: string}} review what was sent, and where it landed
   * @returns {Promise<void>} when it is in local storage
   */
  recordPostedReview(source, pull, review) {
    this.track(source, "pulls", pull.key, "post", review);
    // A sent review is done with, so it leaves the queue without the reader
    // having to say so twice.
    this.track(source, "pulls", pull.key, "dismiss");

    return this.state.settled();
  }

  // ---- Findings

  /**
   * Opt a finding into the review. Nothing is sent until this is called: a
   * finding starts out excluded, the same as one never drafted at all.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {object} finding which finding
   * @returns {void}
   */
  includeFinding(source, pull, finding) {
    this.track(source, "findings", this._finding(pull, finding), "include");
  }

  /**
   * Take a finding back out of what would be sent, whether it was ever opted
   * in or came included by default under an app version before this one.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {object} finding which finding
   * @returns {void}
   */
  excludeFinding(source, pull, finding) {
    this.track(source, "findings", this._finding(pull, finding), "exclude");
  }

  /**
   * Rewriting a finding is opting it in, the same reasoning as {@link editComment}.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {object} finding which finding
   * @param {string} body the comment as the reader wants it
   * @returns {void}
   */
  editFinding(source, pull, finding, body) {
    this.track(source, "findings", this._finding(pull, finding), "editBody", { body });
    this.track(source, "findings", this._finding(pull, finding), "include");
  }

  /**
   * Put a finding back to what the agent wrote.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {object} finding which finding
   * @returns {void}
   */
  resetFinding(source, pull, finding) {
    this.track(source, "findings", this._finding(pull, finding), "resetBody");
  }

  /**
   * Write a comment of the reader's own, anchored to a line.
   *
   * The id comes from the event store rather than from the path and line, so
   * two comments on the same line are two comments.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {{path: string, line: number, body: string}} comment what and where
   * @returns {object} the finding, as it now reads
   */
  addFinding(source, pull, comment) {
    const event = this.track(source, "findings", null, "create", {
      pull: pull.key,
      path: comment.path,
      line: comment.line,
      body: comment.body,
      mine: true,
    });

    return this.queries
      .findingsForPull(source, pull)
      .find((finding) => finding.id === event.objectId);
  }

  /**
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {object} finding one of the reader's own findings
   * @returns {void}
   */
  removeFinding(source, pull, finding) {
    this.track(source, "findings", this._finding(pull, finding), "delete");
  }

  /**
   * Record that one finding went out on its own, ahead of the review.
   *
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {object} finding which finding
   * @param {{url: string}} comment where it landed
   * @returns {void}
   */
  recordPostedFinding(source, pull, finding, comment) {
    this.track(source, "findings", this._finding(pull, finding), "post", comment);
  }

  /**
   * Show only the files and lenses carrying a finding, or show everything.
   *
   * @param {object} source the source being read
   * @param {boolean} only whether to narrow the view
   * @returns {void}
   */
  showFlaggedOnly(source, only) {
    this.track(source, "preferences", READING, only ? "flagOnly" : "showAll");
  }

  // ---- Reading the diff

  /**
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {string} path which file
   * @param {boolean} viewed whether it has now been read
   * @returns {void}
   */
  markFile(source, pull, path, viewed) {
    const action = viewed ? "markViewed" : "markUnviewed";

    this.track(source, "files", `${pull.key}:${path}`, action);
  }

  /**
   * @param {object} source the source being read
   * @param {object} pull which pull request
   * @param {string} path which file
   * @param {boolean} collapsed whether it is now folded away
   * @returns {void}
   */
  collapseFile(source, pull, path, collapsed) {
    const action = collapsed ? "collapse" : "expand";

    this.track(source, "files", `${pull.key}:${path}`, action);
  }

  /**
   * Merge a credential over what is already stored.
   *
   * A field submitted empty means "leave this alone", not "blank this". A
   * reader correcting a bucket name should not have to retype a secret key
   * they cannot see to avoid destroying it.
   *
   * @param {string} id whose credential
   * @param {object} secret the parts being changed
   * @returns {Promise<void>} when it is written
   */
  async mergeSecret(id, secret) {
    if (!secret) return;

    const kept = await this.state.secret(id);
    const merged = { ...kept };

    for (const [key, value] of Object.entries(secret)) {
      if (value === "" || value === null || value === undefined) continue;

      merged[key] = value;
    }

    await this.state.setSecret(id, merged);
  }

  // ---- The one place any of this is written down

  /**
   * Record an event against a source, and get it synced.
   *
   * @param {object} source the source being read
   * @param {string} collection which collection
   * @param {string|null} objectId what it concerns
   * @param {string} action what was done
   * @param {*} [data] the payload
   * @returns {object} the event
   */
  track(source, collection, objectId, action, data) {
    const event = this.state.track(source.id, collection, objectId, action, data);

    this._laterSync(source);

    return event;
  }

  /**
   * Bring every log back from local storage.
   *
   * @returns {Promise<void>} when the app has its state again
   */
  restore() {
    return this.state.restore();
  }

  // Syncing is debounced because dropping four findings in a row is one thought
  // and should be one write, not four. Nothing is caught here because there is
  // nothing to catch: `push` answers that it did not land rather than throwing,
  // and records that it did not, so the reader can be told how much is waiting.
  // That is a contract `push` keeps, not an assumption made here - a timer's
  // callback has nobody to hand a rejection to.
  _laterSync(source) {
    if (!this.sync) return;

    clearTimeout(this._pending[source.id]);

    this._pending[source.id] = setTimeout(() => this.sync.push(source), 1000);
  }

  _finding(pull, finding) {
    // A finding the reader wrote has an id of its own already; one the agent
    // wrote is identified by the pull request it belongs to and the agent's
    // stable id, so the decision survives a redraft.
    return finding.mine ? finding.id : `${pull.key}:${finding.id}`;
  }
}

export { draftKey };
