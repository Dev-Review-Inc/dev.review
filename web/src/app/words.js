// What the interface is allowed to say about sending a review.
//
// Every one of these asks the destination rather than deciding for itself,
// because only the destination knows where a review went, or whether it went
// anywhere at all. The demo posts nowhere, so a sheet promising GitHub, a
// celebration of a send that never happened, or a standing "posted" banner over
// a link to a review nobody wrote are all the same bug: the interface claiming
// something the destination did not do.
//
// They live in their own module so that both the sheet and the summary can ask,
// without the two importing each other.

import { UNREAD } from "../state/drafts.js";

/**
 * What the screen says about a draft it has not got.
 *
 * The storage refusing a read and the agent writing something unparseable both
 * end at the same empty state, and they are not the same news. One is an outage
 * that mends itself and is nobody's mistake; the other is a file that will stay
 * broken until it is written again. The cause comes from the projection rather
 * than from reading the sentence, because a sentence that has to be sniffed is
 * a sentence that will be sniffed wrong.
 *
 * @param {{cause: string, detail: string}} problem what the projection found
 * @returns {{title: string, note: string}} what the empty state says
 */
export function draftProblemWords(problem) {
  if (problem.cause === UNREAD) {
    return {
      title: "That draft could not be fetched.",
      note: `The storage would not hand it over: ${problem.detail}. The review itself is fine, and this app keeps asking, so it appears again as soon as the storage answers.`,
    };
  }

  return {
    title: "That draft cannot be read.",
    note: `The agent wrote something this app cannot act on: ${problem.detail}. Waiting will not mend it - the draft has to be written again.`,
  };
}

/**
 * What this destination calls the send, in its own words.
 *
 * A destination that names itself - "Post to GitHub" - says something true of
 * a triage too, so its word stands. "Post review" is the one word that claims
 * a review, and over an issue there is none, so it becomes the triage's own.
 *
 * @param {object} app the application
 * @returns {string} the button's text
 */
export function postLabel(app) {
  const label = app.destination?.constructor.postLabel || "Post review";

  return app.selected?.isIssue && label === "Post review" ? "Post triage" : label;
}

/**
 * What the send on a single comment is called, and what it asks before sending.
 *
 * Two sends are on the screen at once, and they do different things: the footer
 * sends the review, this one sends one comment on its own, ahead of it. So the
 * button says which it is rather than leaving "Post" beside "Post review" for
 * the reader to guess at. The confirmation names the destination only where the
 * comment really lands there.
 *
 * @param {object} app the application
 * @returns {{label: string, title: string, question: string}} what the button says
 */
export function commentWords(app) {
  const destination = app.destination?.constructor;

  return {
    label: "Post this comment",
    title: "Post this one comment now, ahead of the review",
    question: destination?.sent ? `${destination.postLabel}?` : "Post it now?",
  };
}

/**
 * What this destination can honestly say has happened so far.
 *
 * @param {object} app the application
 * @returns {string} the note under the sheet
 */
export function postNote(app) {
  return app.destination?.constructor.postNote || "nothing has been sent yet";
}

/**
 * What the control beside the destination does, and what it is called.
 *
 * Signing out of the demo is meaningless: there is no token to forget, and
 * doing it leaves a visitor holding an app with nowhere to post. What that
 * visitor wants from the same corner is the way to start the demo again, having
 * triaged everything in it.
 *
 * @param {object} app the application
 * @returns {{label: string, title: string, resets: boolean}} the control
 */
export function leaveWords(app) {
  const destination = app.destination?.constructor;

  if (!destination?.resets) {
    return {
      label: "Sign out",
      title: "Forget this destination's token and sign in again",
      resets: false,
    };
  }

  return {
    label: "Start over",
    title: "Put the demo back the way it was written, decisions and all",
    resets: true,
  };
}

/**
 * What this destination can honestly say once the send has been made.
 *
 * A destination that sends nowhere gets the moment instead of a link. Someone
 * who has just finished triaging a review and reached for the send is as
 * interested as they will ever be, so the screen asks them to point it at their
 * own work rather than congratulating them on nothing.
 *
 * @param {object} app the application
 * @returns {{sent: boolean, title: string, note: string, link: string, cta: {text: string, href: string}, record: string}} what to say
 */
export function postedWords(app) {
  const destination = app.destination?.constructor;

  return {
    sent: destination?.sent ?? false,
    // Crossing the title out and throwing confetti both mean "you are done with
    // this one". For a posted review that is exactly when something was sent,
    // so they follow it here. They are separate fields because dismissing is
    // also being done with a pull request, and sends nothing.
    struck: destination?.sent ?? false,
    cheer: destination?.sent ?? false,
    title: destination?.postedTitle || "Nothing was sent",
    note: destination?.postedNote || "",
    link: destination?.postedLink || "",
    cta: destination?.postedCta || { text: "", href: "" },
    // What the review says about itself from then on. {age} is filled in where
    // it is drawn, because only the drawing knows how long ago it was.
    record: destination?.postedRecord || "read {age} ago",
  };
}

/**
 * What the screen says when a pull request was dismissed rather than reviewed.
 *
 * The same screen posting uses, because the reader has finished with the pull
 * request either way and the way on to the next one is the same. What it must
 * not borrow is the claim: nothing was sent, so there is no link to a review
 * and nothing for a destination to say about where it went.
 *
 * It is still crossed off and still cheered. What that marks is the reader
 * being done, and deciding there is nothing to say is a decision, not a
 * failure to make one.
 *
 * @returns {{sent: boolean, struck: boolean, cheer: boolean, title: string, note: string, link: string, cta: {text: string, href: string}, record: string}}
 */
export function dismissedWords() {
  return {
    sent: false,
    struck: true,
    cheer: true,
    title: "Dismissed",
    note: "Nothing was sent. It is off your queue, and the queue is where it would come back.",
    link: "",
    cta: { text: "", href: "" },
    record: "dismissed {age} ago",
  };
}
