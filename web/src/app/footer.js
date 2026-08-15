// The footer: what would be sent, what it would do, and the button that sends.
//
// Posting reads as a consequence of the verdict rather than as a fourth,
// differently-coloured button, so the verdict tints the button.

import { find } from "./dom.js";
import { button } from "../ui/button.js";
import { restyle } from "../ui/render.js";
import { postLabel } from "./words.js";

// Which tone each verdict carries, in the confirmation sheet and the footer.
export const VERDICT_TONE = { APPROVE: "ok", COMMENT: "accent", REQUEST_CHANGES: "critical" };

// Taking the pull request off the queue, chosen the way a verdict is chosen.
//
// It is not a verdict and it shares their control group anyway: nothing is
// sent, and the record of it is this app's own log rather than anything on
// GitHub. It earns its place there because the reader is answering one
// question, "what am I doing with this pull request", and "I don't want to
// review this one" is a true answer regardless of who opened it - so unlike
// the verdicts, it is never withheld for authorship.
export const DISMISS = "DISMISS";

// What each choice does to the pull request, stated once.
const CONSEQUENCE = {
  APPROVE: "approves for merge",
  COMMENT: "leaves the PR unblocked",
  REQUEST_CHANGES: "blocks merge until resolved",
  DISMISS: "sends nothing and takes it off your queue",
};

/**
 * The one line the footer and the sheet both say about a proposed close.
 *
 * A duplicate names the ticket it duplicates, because the number is the whole
 * of what makes the close followable. A dropped close is stated as what it
 * leaves behind rather than as an absence, so the line never goes quiet about
 * a decision the reader made.
 *
 * @param {{reason: string, of: number|null}|null} close the draft's proposal
 * @param {boolean} dropped whether the reader left the close out
 * @returns {string} the line, "" when the draft proposes no close
 */
export function closeWords(close, dropped) {
  if (!close) return "";
  if (dropped) return "the ticket stays open";
  if (close.reason === "duplicate") return `closes as duplicate of #${close.of}`;

  return `closes as ${close.reason.replace("_", " ")}`;
}

/**
 * What the one send button says, and whether there is anything for it to do.
 *
 * Approving waits on a draft the agent finished, because approving implies
 * having seen the whole review. Commenting or requesting changes can be about
 * the part already drafted, and does not claim to have seen the rest, so
 * either can go out while the agent is still writing. Dismissing waits on
 * nothing, because the case it exists for is a pull request with nothing
 * worth drafting.
 *
 * @param {object|null} pull the open pull request, if one is open
 * @param {string} chosen a verdict, or DISMISS
 * @param {boolean} posted whether the review already went out
 * @returns {{label: string, disabled: boolean}} what to draw the button as
 */
export function commitButton(pull, chosen, posted) {
  if (!pull) return { label: "Post review", disabled: true };

  if (chosen === DISMISS) return { label: "Dismiss", disabled: false };

  const needsFinish = chosen === "APPROVE";
  const notReady = !pull.draft || (needsFinish && !pull.draft.finishedAt);

  return { label: "Post review", disabled: notReady || posted };
}

/**
 * The send button over an issue, which takes no verdict.
 *
 * A draft file is the whole condition: parsing guarantees it proposes a
 * description or a comment, and either is worth sending. Dismissing waits on
 * nothing, as ever.
 *
 * @param {object|null} pull the open issue, if one is open
 * @param {string} chosen "" or DISMISS
 * @param {boolean} posted whether the triage already went out
 * @param {string} label the destination's own word for posting
 * @returns {{label: string, disabled: boolean}} what to draw the button as
 */
export function triageButton(pull, chosen, posted, label) {
  if (chosen === DISMISS) return { label: "Dismiss", disabled: false };

  return { label, disabled: !pull?.draft || posted };
}

/**
 * Whether a choice in the footer's button row is offered.
 *
 * The destination refuses an approval or a change request on your own pull
 * request, so verdictFor already narrows those to a comment; this only has to
 * hide the buttons that agree. Dismissing answers a different question, "do I
 * want to review this at all", which authorship never settles - so it is
 * offered regardless of whose pull request is open.
 *
 * @param {string} event a verdict, or DISMISS
 * @param {boolean} own whether the reader authored the open pull request
 * @returns {boolean} true when the choice should not be shown
 */
export function choiceHidden(event, own) {
  return event === DISMISS ? false : own && event !== "COMMENT";
}

/**
 * Draw the footer.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function drawFooter(app) {
  drawStaged(app);
  drawVerdict(app);
}

function drawStaged(app) {
  const staged = find("staged");
  const counts = find("counts");
  const pull = app.selected;

  if (!pull || !pull.draft) {
    staged.textContent = "";
    counts.textContent = "";

    return;
  }

  // An issue stages no line comments, so the counters would only ever say a
  // confusing zero. What it can stage is a close, and the staged line is where
  // what-would-be-sent lives.
  if (pull.isIssue) {
    staged.textContent = closeWords(
      pull.draft.close,
      app.queries.closeDropped(app.source, pull),
    );
    counts.textContent = "";

    return;
  }

  const posting = app.queries.findingsToPost(app.source, pull);

  if (!posting.length && !pull.draft.findings.length) {
    staged.textContent = "no inline comments";
    counts.textContent = "";

    return;
  }

  const blocking = app.queries.blockingCount(app.source, pull);
  const notes = posting.length - blocking;

  staged.textContent = `${posting.length} ${posting.length === 1 ? "comment" : "comments"} staged`;
  counts.textContent = `${blocking} blocking · ${notes} ${notes === 1 ? "note" : "notes"}`;
}

function drawVerdict(app) {
  const pull = app.selected;
  const post = find("post");
  const consequence = find("consequence");

  consequence.classList.remove("is-warn");
  consequence.textContent = "";

  // The destination refuses an approval or change request on your own pull request,
  // so on your own the only verdict offered is a comment. verdictFor already
  // settles that; the buttons only have to reflect it.
  const own = Boolean(app.login) && pull?.author === app.login;

  // An issue takes no verdict at all, so asking verdictFor would invent a
  // COMMENT nothing is going to send.
  const issue = Boolean(pull?.isIssue);

  // A chosen dismissal is held on the app rather than written down, because
  // nothing has been decided until the send button commits it. That is the
  // same shape as a verdict, which is only what would be sent.
  const verdict = pull && !issue ? app.queries.verdictFor(app.source, pull, app.login) : "";
  const chosen = app.dismissing ? DISMISS : verdict;

  for (const choice of find("verdicts").children) {
    choice.hidden = issue
      ? choice.dataset.event !== DISMISS
      : choiceHidden(choice.dataset.event, own);
    choice.setAttribute("aria-pressed", String(choice.dataset.event === chosen));
    choice.disabled = !pull;
  }

  const posted = Boolean(pull) && app.queries.isPosted(app.source, pull);
  const commit = issue
    ? triageButton(pull, chosen, posted, postLabel(app))
    : commitButton(pull, chosen, posted);

  // The verdict tints the send button. "accent" is the primary's own fill, so
  // it is said by saying nothing. Dismissing sends nothing at all, so it does
  // not wear the send colour: it steps down to an ordinary action rather than
  // being a filled button repainted to look like it is not one.
  const tone = VERDICT_TONE[chosen] || "";

  restyle(
    button({
      label: commit.label,
      role: chosen === DISMISS ? "ghost" : "primary",
      tone: tone === "accent" ? "" : tone,
      disabled: commit.disabled,
    }),
    post,
  );

  if (!pull || !chosen) return;

  const blocking = app.queries.blockingCount(app.source, pull);

  if (chosen === "APPROVE" && blocking) {
    consequence.textContent = `overrides ${blocking} blocking`;
    consequence.classList.add("is-warn");
  } else {
    consequence.textContent = CONSEQUENCE[chosen];
  }

}
