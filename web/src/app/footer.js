// The footer: what would be sent, what it would do, and the button that sends.
//
// Posting reads as a consequence of the verdict rather than as a fourth,
// differently-coloured button, so the verdict tints the button.

import { find } from "./dom.js";

// Which tone each verdict carries, in the confirmation sheet and the footer.
export const VERDICT_TONE = { APPROVE: "ok", COMMENT: "accent", REQUEST_CHANGES: "critical" };

// Taking the pull request off the queue, chosen the way a verdict is chosen.
//
// It is not a verdict and it shares their control group anyway: nothing is
// sent, and the record of it is this app's own log rather than anything on
// GitHub. It earns its place there because the reader is answering one
// question, "what am I doing with this pull request", and on your own pull
// request with nothing to say, dropping it is the only true answer to it.
export const DISMISS = "DISMISS";

// What each choice does to the pull request, stated once.
const CONSEQUENCE = {
  APPROVE: "approves for merge",
  COMMENT: "leaves the PR unblocked",
  REQUEST_CHANGES: "blocks merge until resolved",
  DISMISS: "sends nothing and takes it off your queue",
};

/**
 * What the one send button says, and whether there is anything for it to do.
 *
 * Posting waits on a draft the agent finished, because until then there is
 * nothing to send. Dismissing waits on nothing, because the case it exists for
 * is a pull request with nothing worth drafting.
 *
 * @param {object|null} pull the open pull request, if one is open
 * @param {string} chosen a verdict, or DISMISS
 * @param {boolean} posted whether the review already went out
 * @returns {{label: string, disabled: boolean}} what to draw the button as
 */
export function commitButton(pull, chosen, posted) {
  if (!pull) return { label: "Post review", disabled: true };

  if (chosen === DISMISS) return { label: "Dismiss", disabled: false };

  return { label: "Post review", disabled: !pull.draft?.finishedAt || posted };
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

  post.classList.remove("is-ok", "is-critical", "is-quiet");
  consequence.classList.remove("is-warn");
  consequence.textContent = "";

  // The destination refuses an approval or change request on your own pull request,
  // so on your own the only verdict offered is a comment. verdictFor already
  // settles that; the buttons only have to reflect it. Dismissing is the
  // opposite way round: it is offered only on your own, where it is the answer
  // a comment cannot be.
  const own = Boolean(app.login) && pull?.author === app.login;

  // A chosen dismissal is held on the app rather than written down, because
  // nothing has been decided until the send button commits it. That is the
  // same shape as a verdict, which is only what would be sent.
  const verdict = pull ? app.queries.verdictFor(app.source, pull, app.login) : "";
  const chosen = app.dismissing ? DISMISS : verdict;

  for (const button of find("verdicts").children) {
    const dismiss = button.dataset.event === DISMISS;

    button.hidden = dismiss ? !own : own && button.dataset.event !== "COMMENT";
    button.setAttribute("aria-pressed", String(button.dataset.event === chosen));
    button.disabled = !pull;
  }

  const commit = commitButton(pull, chosen, Boolean(pull) && app.queries.isPosted(app.source, pull));

  post.textContent = commit.label;
  post.disabled = commit.disabled;

  if (!pull || !chosen) return;

  const blocking = app.queries.blockingCount(app.source, pull);

  if (chosen === "APPROVE" && blocking) {
    consequence.textContent = `overrides ${blocking} blocking`;
    consequence.classList.add("is-warn");
  } else {
    consequence.textContent = CONSEQUENCE[chosen];
  }

  // A button that sends nothing must not wear the colour of the one that does.
  const tone = chosen === DISMISS ? "quiet" : VERDICT_TONE[chosen];

  if (tone && tone !== "accent") post.classList.add(`is-${tone}`);
}
