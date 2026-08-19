// Reading. Nothing in here changes anything.
//
// The interesting work is the merge. A finding as the reader sees it is the
// agent's finding from the draft with the reader's decision laid over it, and
// those two come from different places for a reason: the draft is a file the
// agent owns and rewrites, the decision is an event this app owns and appends.
// Joining them here rather than in storage is what lets the agent rewrite its
// draft mid-read without touching what the reader decided.

import { draftKey } from "../domain/draft-path.js";
import { bodyOf, withPrefix } from "../domain/review.js";

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

/**
 * A pull request's identity, recovered from the key its decisions are filed
 * under, for one whose draft is gone.
 *
 * Owner, repository and number are all a diff or a head commit ever asks of a
 * pull request, so the title going unknown does not stop either from loading -
 * only the row loses a name until the reader opens it.
 *
 * @param {string} key what {@link draftKey} produced
 * @returns {object} enough of a pull request to read
 */
function pullFromKey(key) {
  const [, owner, repo, number] = /^(.+)\/(.+)#(\d+)$/.exec(key) || [];

  return {
    owner,
    repo,
    number: Number(number),
    title: "",
    author: "",
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
    updatedAt: "",
    createdAt: "",
    isRequested: false,
  };
}

// What a draft's url says it is. The sweep records the html url of the thing
// it drafted, and that is the one place a queue entry's kind can come from.
const ISSUE_URL = /\/issues\/\d+(?:[/?#]|$)/;
const PULL_URL = /\/pull\/\d+(?:[/?#]|$)/;

/**
 * The queue, derived from the drafts the reader's storage holds.
 *
 * Nothing is searched for: an entry exists because the sweep drafted it, and
 * it stays until it is posted, dismissed, or its draft is cleared. A draft
 * whose url names neither a pull request nor an issue is the one remaining
 * invisibility, because it names nothing this app could open or post to.
 *
 * @param {Map<string, object>} drafts parsed drafts by key, from Drafts#all
 * @returns {object[]} one queue entry per draft
 */
export function pullsFromDrafts(drafts) {
  const queue = [];

  for (const [key, draft] of drafts) {
    const url = draft.url || "";
    const isIssue = ISSUE_URL.test(url);

    if (!isIssue && !PULL_URL.test(url)) continue;

    const [, owner, repo, number] = /^(.+)\/(.+)#(\d+)$/.exec(key) || [];

    queue.push({
      owner,
      repo,
      number: Number(number),
      title: draft.title,
      author: draft.author || "",
      url,
      // The revival rule reads this: a draft other than the one a dismissal
      // answered is a new question, and reaches the reader again.
      updatedAt: draft.draftedAt,
      createdAt: "",
      // A draft is, by definition, waiting on the reader.
      isRequested: true,
      isIssue,
    });
  }

  return queue;
}

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
   * @param {object[]} pulls the drafted entries, from {@link pullsFromDrafts}
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
   * Read from what this app decided, not from the drafts still held. A draft
   * is eventually pruned or cleared, so filtering the drafted entries the way
   * {@link queue} does would drop a pull request from this list the moment
   * its draft went, taking the record of ever having reviewed it along.
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
   * Each entry carries `restorable`: whether a draft still holds a place this
   * app could put the pull request back on the queue. Restoring clears the
   * one field keeping a pull request in this list, so restoring one whose
   * draft is gone would not put it back on the queue - it would only make it
   * disappear from here too, with no way back.
   *
   * @param {object} source the source being read
   * @param {object[]} pulls the drafted entries, for whichever of these the
   *   storage still holds a draft
   * @param {number} [now] the moment to measure the week back from
   * @returns {object[]} the recently dismissed ones, each carrying its state
   */
  dismissed(source, pulls, now = Date.now()) {
    const since = now - DISMISSED_WINDOW;
    const live = new Map(pulls.map((pull) => [draftKey(pull.owner, pull.repo, pull.number), pull]));

    return this.state
      .findAll(source.id, "pulls")
      .map((decision) => {
        const pull = live.get(decision.id);

        return { ...this.pullState(source, pull || pullFromKey(decision.id)), restorable: Boolean(pull) };
      })
      .filter((entry) => entry.dismissedAt && entry.dismissedAt > since)
      .sort((a, b) => b.dismissedAt - a.dismissedAt);
  }

  /**
   * Everything the app knows about one pull request.
   *
   * @param {object} source the source being read
   * @param {object} pull one entry from the queue
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
   * On a draft-driven queue the new question is a redraft. The dismissal
   * wrote down the draftedAt it answered, so a different stamp - newer,
   * older, it does not matter - is a different draft and revives the entry,
   * and the same stamp is the question already answered. No clock gets a
   * vote: an agent stamping its draft in the future cannot spend the
   * dismissal the instant it is made.
   *
   * Unless the reader posted. A posted review answered for good, and the
   * sweep pruning the handled draft then drafting the pull request again
   * must not reopen it. Reviewing again after a post is the reader's own
   * gesture - clearing the draft, which forgets the post - never a redraft.
   *
   * Deciding it here is what keeps the queue and the dismissed list from
   * disagreeing: they are one decision read twice.
   *
   * @param {object} pull one entry from the queue
   * @param {object} decision what the reader decided about it
   * @returns {number|null} when it was dismissed, or null once that is spent
   */
  _dismissal(pull, decision) {
    const dismissedAt = decision.dismissedAt || null;

    if (!dismissedAt || !pull.isRequested) return dismissedAt;

    // Posted spends nothing: no redraft revives an answered review.
    if (decision.postedAt) return dismissedAt;

    // A different draft is a new question; the same one is answered.
    if (decision.dismissedSeen !== undefined) {
      return pull.updatedAt !== decision.dismissedSeen ? null : dismissedAt;
    }

    // A dismissal from before it recorded what it saw. The old time
    // comparison decides, except that a stamp from the future is a lie
    // about the clock and does not outvote the reader.
    const movedAt = Date.parse(pull.updatedAt || "");

    return movedAt > dismissedAt && movedAt <= Date.now() ? null : dismissedAt;
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
   * Without the reader's prefix, on purpose: this is also what {@link
   * reviewPayload} takes as `options.body`, and that is where the prefix is
   * applied - to it and to every comment alike, in the one place responsible
   * for both. Applying it here too would send it twice.
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

  // ---- Triaging an issue

  /**
   * The hunks of the proposed ticket body the reader has rejected.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {Set<string>} the differ's ids for the rejected hunks
   */
  rejectedHunks(source, pull) {
    const prefix = `${pull.key}:`;

    return new Set(
      this.state
        .findAll(source.id, "hunks")
        .filter((hunk) => hunk.rejectedAt && hunk.id.startsWith(prefix))
        .map((hunk) => hunk.id.slice(prefix.length)),
    );
  }

  /**
   * The ticket body as the reader rewrote it, or null while the kept hunks
   * still decide what it says.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {string|null} the reader's body, or null to derive it from hunks
   */
  descriptionFor(source, pull) {
    const edited = this._pullDecision(source, pull.key).description;

    return edited === null || edited === undefined ? null : edited;
  }

  /**
   * Whether the reader has left the proposed close out of the triage.
   *
   * @param {object} source the source being read
   * @param {object} pull the pull request
   * @returns {boolean} whether the close was dropped
   */
  closeDropped(source, pull) {
    return Boolean(this._pullDecision(source, pull.key).closeDroppedAt);
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
   * @param {object} source the source being read
   * @param {object} finding the finding being posted
   * @returns {string} the markdown to send
   */
  bodyToPost(source, finding) {
    // The prefix marks the agent's words; one the reader rewrote is theirs,
    // and one they wrote themselves never was the agent's at all.
    const theirs = finding.editedAt || finding.mine;

    return withPrefix(theirs ? "" : this.commentPrefixFor(source), bodyOf(finding));
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
   * What the reader wants ahead of the review body and every comment, empty
   * when they have not configured one.
   *
   * @param {object} source the source being read
   * @returns {string} the prefix
   */
  commentPrefixFor(source) {
    return this._object(source, "preferences", READING).commentPrefix || "";
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
