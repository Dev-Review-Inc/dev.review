// The footer: what would be sent, what it would do, and the button that sends.
//
// The send button says which verdict it would send rather than a fixed
// "Post review" - the word itself is the plainest report of what is about to
// happen, ahead of tone or a second line of prose saying the same thing
// again.

import { find } from "./dom.js";
import { button } from "../ui/button.js";
import { restyle } from "../ui/render.js";

// Which tone each verdict carries, in the confirmation sheet and the footer.
export const VERDICT_TONE = { APPROVE: "ok", COMMENT: "accent", REQUEST_CHANGES: "critical" };

// The word on the send button once a choice is made.
const VERDICT_LABEL = {
  APPROVE: "Approve",
  COMMENT: "Comment",
  REQUEST_CHANGES: "Request changes",
};

// Taking the pull request off the queue, chosen the way a verdict is chosen.
//
// It is not a verdict and it shares their control group anyway: nothing is
// sent, and the record of it is this app's own log rather than anything on
// GitHub. It earns its place there because the reader is answering one
// question, "what am I doing with this pull request", and "I don't want to
// review this one" is a true answer regardless of who opened it - so unlike
// the verdicts, it is never withheld for authorship.
export const DISMISS = "DISMISS";

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
 * A review carrying nothing cannot be sent either: the summary and every
 * comment are opted in one at a time, so "nothing chosen yet" is a state the
 * reader can be in, and the destination refuses a review with no words and no
 * comments. Dismissing is untouched by that - it sends nothing by design.
 *
 * @param {object|null} pull the open pull request, if one is open
 * @param {string} chosen a verdict, or DISMISS
 * @param {boolean} posted whether the review already went out
 * @param {boolean} [carrying] whether anything has been opted into the review
 * @returns {{label: string, disabled: boolean}} what to draw the button as
 */
export function commitButton(pull, chosen, posted, carrying = true) {
  if (!pull) return { label: "Post review", disabled: true };

  if (chosen === DISMISS) return { label: "Dismiss", disabled: false };

  const needsFinish = chosen === "APPROVE";
  const notReady = !pull.draft || (needsFinish && !pull.draft.finishedAt);

  return {
    label: VERDICT_LABEL[chosen] || "Post review",
    disabled: notReady || posted || !carrying,
  };
}

/**
 * What the send button is painted as.
 *
 * One control whatever is chosen: the verdict changes its colour and nothing
 * else, because a button that changes shape underneath the reader is a
 * different button. Dismissing sends nothing anywhere, so it is the one
 * choice that does not wear a verdict's colour - grey says "this is still the
 * action" without claiming to be one.
 *
 * @param {string} chosen a verdict, or DISMISS
 * @returns {{role: string, tone: string}} how to describe it
 */
export function commitLook(chosen) {
  if (chosen === DISMISS) return { role: "primary", tone: "neutral" };

  // "accent" is the primary's own fill, so it is said by saying nothing.
  const tone = VERDICT_TONE[chosen] || "";

  return { role: "primary", tone: tone === "accent" ? "" : tone };
}

/**
 * Whether a choice in the verdict sheet is offered.
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
 * @returns {void}
 */
export function closeVerdictMenu() {
  find("verdict-popover").hidden = true;
  find("verdict-backdrop").hidden = true;
  find("verdict-button").setAttribute("aria-expanded", "false");
}

/**
 * @returns {void}
 */
export function toggleVerdictMenu() {
  const open = find("verdict-popover").hidden;

  find("verdict-popover").hidden = !open;
  find("verdict-backdrop").hidden = !open;
  find("verdict-button").setAttribute("aria-expanded", String(open));

  if (open) positionVerdictMenu();
}

/**
 * Put the verdict sheet where it reads as coming out of the caret that opened
 * it, rather than sliding up from the edge of the screen.
 *
 * Measured after the sheet is un-hidden - a hidden element has no box to
 * measure - and placed with fixed coordinates rather than anchored under a
 * relatively positioned parent, which is what lets it sit above the footer
 * without being clipped by the footer's own horizontal scrolling on a narrow
 * viewport.
 *
 * @returns {void}
 */
function positionVerdictMenu() {
  const anchor = find("verdict-button").getBoundingClientRect();
  const sheet = find("verdict-popover");
  const margin = 8;

  // Right-aligned to the caret, the same edge #post-split ends on, and
  // clamped so a caret hard against the left edge does not push the sheet
  // off the other side of the screen.
  const left = Math.max(
    margin,
    Math.min(anchor.right - sheet.offsetWidth, window.innerWidth - sheet.offsetWidth - margin),
  );

  sheet.style.left = `${left}px`;
  sheet.style.top = `${anchor.top - sheet.offsetHeight - margin}px`;
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
  const verdictButton = find("verdict-button");

  consequence.classList.remove("is-warn");
  consequence.textContent = "";

  // The destination refuses an approval or change request on your own pull request,
  // so on your own the only verdict offered is a comment. verdictFor already
  // settles that; the buttons only have to reflect it.
  const own = Boolean(app.login) && pull?.author === app.login;

  // A chosen dismissal is held on the app rather than written down, because
  // nothing has been decided until the send button commits it. That is the
  // same shape as a verdict, which is only what would be sent.
  const verdict = pull ? app.queries.verdictFor(app.source, pull, app.login) : "";
  const chosen = app.dismissing ? DISMISS : verdict;

  for (const choice of find("verdict-popover").children) {
    choice.hidden = choiceHidden(choice.dataset.event, own);
    choice.setAttribute("aria-pressed", String(choice.dataset.event === chosen));
  }

  const carrying = Boolean(
    pull &&
      (app.queries.commentToPost(app.source, pull).trim() ||
        app.queries.findingsToPost(app.source, pull).length),
  );

  const commit = commitButton(
    pull,
    chosen,
    Boolean(pull) && app.queries.isPosted(app.source, pull),
    carrying,
  );

  const described = button({
    label: commit.label,
    ...commitLook(chosen),
    disabled: commit.disabled,
  });

  restyle(described, post);

  // #post's own inline border-radius (see labelStyle() in ui/button.js) beats
  // the stylesheet's .split #post { border-radius: 0 }, because an inline
  // style always outranks a selector no matter how specific - restyle() sets
  // it fresh on every draw, so it has to be squared off again here every time
  // too, or the seam against the caret shows a rounded notch instead of a
  // straight join.
  post.style.borderTopRightRadius = "0";
  post.style.borderBottomRightRadius = "0";

  // The caret rides #post's own class rather than choosing a colour of its
  // own, so the two read as one filled button wearing the verdict's tone
  // instead of two buttons that happen to touch. Its disabled state does not
  // follow #post's, though: commit.disabled covers "nothing drafted yet",
  // which would otherwise lock a reader with nothing drafted out of ever
  // reaching Dismiss - the one choice that never needs a draft.
  verdictButton.className = described.className;
  verdictButton.disabled = !pull;

  if (!pull || !chosen) return;

  // The verdict's own word already says what would happen. The one thing it
  // cannot say by itself is that approving here specifically overrides
  // blocking comments still open - that is the one case worth a second line.
  const blocking = app.queries.blockingCount(app.source, pull);

  if (chosen === "APPROVE" && blocking) {
    consequence.textContent = `overrides ${blocking} blocking`;
    consequence.classList.add("is-warn");
  }
}
