// Reading. Nothing in here changes anything.
//
// The interesting work is the merge. A finding as the reader sees it is the
// agent's finding from the draft with the reader's decision laid over it, and
// those two come from different places for a reason: the draft is a file the
// agent owns and rewrites, the decision is an event this app owns and appends.
// Joining them here rather than in storage is what lets the agent rewrite its
// draft mid-read without touching what the reader decided.

import { draftKey } from "../domain/draft-path.js";
import { bodyOf } from "../domain/review.js";

// A finding the reader wrote themselves belongs to the pull request it names.
const SORT_BY_NAME = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));

// Worst first, for picking the tone of a chip that stands for several findings.
const TONES = ["critical", "warn", "accent", "ok", "neutral"];

// How far back the dismissed list reaches. A mis-hit is noticed within days, so
// a week is long enough to undo one and short enough that the list stays a list
// of recent mistakes rather than every pull request ever resolved this way.
const DISMISSED_WINDOW = 7 * 24 * 60 * 60 * 1000;

// There is one of these per source, so it needs a name rather than an id.
export const READING = "reading";

export class Queries {
  /**
   * @param {object} options what to read from
   * @param {import("../state/multi-event-store.js").MultiEventStore} options.state the logs
   * @param {object} options.drafts the drafts read through the adapter
   */
  constructor({ state, drafts }) {
    this.state = state;
    this.drafts = drafts;
  }

  // ---- Sources and destinations

  /**
   * @returns {object[]} every source, by name
   */
  allSources() {
    return this.state.findAll(null, "sources").sort(SORT_BY_NAME);
  }

  /**
   * @param {string} id which source
   * @returns {object|undefined} the source
   */
  findSource(id) {
    return this.allSources().find((source) => source.id === id);
  }

  /**
   * @returns {object[]} every destination, by name
   */
  allDestinations() {
    return this.state.findAll(null, "destinations").sort(SORT_BY_NAME);
  }

  /**
   * @param {string} id which destination
   * @returns {object|undefined} the destination
   */
  findDestination(id) {
    return this.allDestinations().find((destination) => destination.id === id);
  }

  // ---- The queue

  /**
   * The pull requests to show, in the order to show them.
   *
   * Ready ones first, because a drafted review is the thing the reader came
   * for. Dismissed ones are left out entirely rather than dimmed.
   *
   * @param {object} source the source being read
   * @param {object[]} pulls what the destination said is waiting
   * @returns {object[]} the queue, each entry carrying its own reading state
   */
  queue(source, pulls) {
    return pulls
      .map((pull) => this.pullState(source, pull))
      .filter((entry) => !entry.dismissedAt)
      .sort((a, b) => Number(b.isReady) - Number(a.isReady));
  }

  /**
   * The pull requests the reader recently took off the queue.
   *
   * The way back from what queue leaves out. Dismissing is the only resolution
   * for a pull request there is nothing to say about, so it is used often and
   * mis-hit sometimes, and a row that simply vanishes leaves a reader with
   * nothing to undo.
   *
   * Newest first: the one to put back is almost always the one just dismissed.
   *
   * Only the last week of them. A dismissal older than that is a decision the
   * reader has lived with, not a slip to undo, and listing every one forever
   * turns the way back into an archive.
   *
   * The window is over this listing and nothing else. Dropping off it does not
   * expire the dismissal: the event stays in the log, still syncs, and still
   * keeps its pull request out of {@link queue} for good.
   *
   * @param {object} source the source being read
   * @param {object[]} pulls what the destination said is waiting
   * @param {number} [now] the moment to measure the week back from
   * @returns {object[]} the recently dismissed ones, each carrying its state
   */
  dismissed(source, pulls, now = Date.now()) {
    const since = now - DISMISSED_WINDOW;

    return pulls
      .map((pull) => this.pullState(source, pull))
      .filter((entry) => entry.dismissedAt && entry.dismissedAt > since)
      .sort((a, b) => b.dismissedAt - a.dismissedAt);
  }

  /**
   * Everything the app knows about one pull request.
   *
   * @param {object} source the source being read
   * @param {object} pull one entry from the destination's queue
   * @returns {object} the pull request, its draft, and what the reader decided
   */
  pullState(source, pull) {
    const key = draftKey(pull.owner, pull.repo, pull.number);
    const draft = this.drafts.find(key);
    const decision = this._pullDecision(source, key);

    return {
      ...pull,
      key,
      draft,
      // A draft is worth opening once the agent has finished writing it. An
      // unfinished one still shows its progress, but is not what "ready" means.
      isReady: Boolean(draft && draft.finishedAt),
      isDrafting: Boolean(draft && !draft.finishedAt),
      dismissedAt: this._dismissal(pull, decision),
      postedAt: decision.postedAt || null,
      postedUrl: decision.postedUrl || "",
    };
  }

  /**
   * When the reader dismissed this pull request, unless that is spent.
   *
   * A dismissal answers one question, and posting a review records one too, so
   * every pull request the reader has ever reviewed carries one for ever. Being
   * asked to look again is a new question, and it has to be able to reach them.
   *
   * It takes both halves. A review requested with nothing new behind it is the
   * request the dismissal already answered, and work that moved without a
   * request is the reader's own pull request, which they took off the queue
   * knowing they would go on pushing to it.
   *
   * Deciding it here is what keeps the queue and the dismissed list from
   * disagreeing: they are one decision read twice.
   *
   * @param {object} pull one entry from the destination's queue
   * @param {object} decision what the reader decided about it
   * @returns {number|null} when it was dismissed, or null once that is spent
   */
  _dismissal(pull, decision) {
    const dismissedAt = decision.dismissedAt || null;

    if (!dismissedAt || !pull.isRequested) return dismissedAt;

    // The destination reports an ISO 8601 string; a dismissal is this app's own
    // clock, in milliseconds. Neither is comparable until one of them moves.
    const movedAt = Date.parse(pull.updatedAt || "");

    return movedAt > dismissedAt ? null : dismissedAt;
  }

  /**
   * Whether the reader has already sent this review.
   *
   * The event log is the record, not the draft: an agent quietly rewriting
   * its draft (new commits landing, a scheduled sweep re-running) does not
   * un-post a review the reader already sent. Asking for a fresh draft from
   * inside the app is different - see commands.forgetPost, fired from the
   * same action that throws the old draft away - because that is the reader
   * saying the posted review no longer describes what is here.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {boolean} whether it went out
   */
  isPosted(source, pull) {
    return Boolean(this._pullDecision(source, pull.key).postedAt);
  }

  /**
   * The verdict that would be sent: the reader's if they chose one, the
   * agent's otherwise.
   *
   * A reader cannot approve or request changes on their own pull request, so
   * that case is settled here rather than in the view.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @param {string} login who is signed in
   * @returns {string} a GitHub review event
   */
  verdictFor(source, pull, login) {
    if (login && pull.author === login) return "COMMENT";

    const chosen = this._pullDecision(source, pull.key).verdict;

    return chosen || pull.draft?.verdict || "COMMENT";
  }

  /**
   * The review body that would be sent: the reader's edit, or the agent's.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {string} markdown
   */
  commentFor(source, pull) {
    const edited = this._pullDecision(source, pull.key).comment;

    return edited === null || edited === undefined ? pull.draft?.comment || "" : edited;
  }

  /**
   * Whether the reader has put the review body in what gets sent.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {boolean} whether the summary is included
   */
  isSummaryIncluded(source, pull) {
    return Boolean(this._pullDecision(source, pull.key).summaryIncludedAt);
  }

  /**
   * The review body this send would actually carry: the words on screen, or
   * nothing at all while the reader has not opted them in.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {string} markdown
   */
  commentToPost(source, pull) {
    return this.isSummaryIncluded(source, pull) ? this.commentFor(source, pull) : "";
  }

  /**
   * Whether the reader has edited the review body away from what was drafted.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {boolean} whether it was edited
   */
  isCommentEdited(source, pull) {
    return Boolean(this._pullDecision(source, pull.key).commentEditedAt);
  }

  // ---- Findings

  /**
   * The findings for a pull request, as the reader sees them.
   *
   * The agent's findings in the order the agent wrote them, because that order
   * is the agent's severity signal, followed by anything the reader added.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {object[]} the merged findings
   */
  findingsForPull(source, pull) {
    const drafted = (pull.draft?.findings || []).map((finding) =>
      this._merge(source, pull, finding),
    );

    return [...drafted, ...this._ownFindings(source, pull)];
  }

  /**
   * The findings that would actually be posted with the review.
   *
   * Opt-in: a finding the reader has not said yes to is exactly as absent
   * from what gets sent as one the agent never drafted. Silence is never
   * agreement here, the same way an unchecked box never submits a form.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {object[]} the findings to send
   */
  findingsToPost(source, pull) {
    return this.findingsForPull(source, pull).filter(
      (finding) => finding.includedAt && !finding.postedAt,
    );
  }

  /**
   * What a finding's comment actually says once it is posted.
   *
   * Folding the suggestion in lives here rather than at each call site, because
   * a finding posted on its own and the same finding posted with the review
   * must say the same thing. A committable suggestion is the difference between
   * a comment someone reads and a fix they apply in one click.
   *
   * @param {object} finding the finding being posted
   * @returns {string} the markdown to send
   */
  bodyToPost(finding) {
    return bodyOf(finding);
  }

  /**
   * The kinds this review actually coined, worst tone first within each.
   *
   * Read off the findings rather than off the draft, because a draft may name
   * kinds it did not end up using, and a comment the reader writes coins one
   * the agent never mentioned.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {{kind: string, count: number, color: string}[]} one entry per kind
   */
  kindsForPull(source, pull) {
    const tally = new Map();

    for (const finding of this.findingsForPull(source, pull)) {
      if (!finding.kind) continue;

      const seen = tally.get(finding.kind) || { kind: finding.kind, count: 0, color: "neutral" };

      seen.count += 1;
      // The worst tone among the findings sharing a kind, so a chip can never
      // read calmer than the findings behind it.
      if (TONES.indexOf(finding.color) < TONES.indexOf(seen.color)) seen.color = finding.color;

      tally.set(finding.kind, seen);
    }

    return [...tally.values()];
  }

  /**
   * Whether the reader is looking only at what carries a finding.
   *
   * A reading mode rather than a transient filter: it survives a reload and
   * follows the reader to their other devices, as every other decision does.
   *
   * @param {object} source the source being read
   * @returns {boolean} whether the flagged-only mode is on
   */
  isFlaggedOnly(source) {
    return Boolean(this._object(source, "preferences", READING).flaggedOnlyAt);
  }

  /**
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {number} how many of the findings to send hold up merge on their own
   */
  blockingCount(source, pull) {
    return this.findingsToPost(source, pull).filter((finding) => finding.blocking).length;
  }

  /**
   * The findings matching whatever the reader is currently filtering by.
   *
   * Filtering lives here rather than in the view, so the footer counts and the
   * list can never disagree about what is being looked at.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @param {{section?: string, kind?: string, path?: string}} filter what is selected
   * @returns {object[]} the findings to show
   */
  findingsMatching(source, pull, filter = {}) {
    return this.findingsForPull(source, pull).filter((finding) => {
      if (filter.section && finding.section !== filter.section) return false;
      if (filter.kind && finding.kind !== filter.kind) return false;
      if (filter.path && finding.path !== filter.path) return false;

      return true;
    });
  }

  /**
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @param {string} path a file in the diff
   * @returns {object} what the reader has done with that file
   */
  fileState(source, pull, path) {
    const state = this._object(source, "files", `${pull.key}:${path}`);

    return {
      path,
      viewedAt: state.viewedAt || null,
      collapsedAt: state.collapsedAt || null,
    };
  }

  _merge(source, pull, finding) {
    const decision = this._object(source, "findings", `${pull.key}:${finding.id}`);
    const edited = decision.body !== null && decision.body !== undefined;

    return {
      ...finding,
      // The agent's own text is never lost, because this app never wrote over
      // it: what is drafted is what is in the file, always.
      drafted: edited ? finding.body : null,
      body: edited ? decision.body : finding.body,
      editedAt: decision.editedAt || null,
      includedAt: decision.includedAt || null,
      postedAt: decision.postedAt || null,
      postedUrl: decision.postedUrl || "",
      mine: false,
    };
  }

  _ownFindings(source, pull) {
    return this.state
      .findAll(source.id, "findings")
      .filter((finding) => finding.mine && finding.pull === pull.key)
      .map((finding) => ({
        section: "",
        kind: "yours",
        color: "accent",
        blocking: false,
        suggestion: null,
        drafted: null,
        ...finding,
        includedAt: finding.includedAt || null,
        postedAt: finding.postedAt || null,
        postedUrl: finding.postedUrl || "",
        mine: true,
      }));
  }

  _pullDecision(source, key) {
    return this._object(source, "pulls", key);
  }

  _object(source, collection, id) {
    return (
      this.state.findAll(source.id, collection).find((item) => item.id === id) || {}
    );
  }
}
