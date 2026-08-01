// What the interface is allowed to promise about sending a review.
//
// The sheet used to say "Post to GitHub" whatever it was about to do, which is
// a lie in front of a demo that posts nowhere. The words come from the
// destination now, so the sheet cannot be right about GitHub and wrong about
// everything else - and neither can the screen after it, nor the banner the
// review wears from then on.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  commentWords,
  draftProblemWords,
  postLabel,
  postNote,
  postedWords,
  leaveWords,
  dismissedWords,
} from "../../web/src/app/words.js";
import { UNREAD, UNPARSED } from "../../web/src/state/drafts.js";
import { GitHubDestination } from "../../web/src/destinations/github-destination.js";
import { DemoDestination } from "../../web/src/destinations/demo.js";

describe("the words on the send", () => {
  test("names GitHub when GitHub is where this is going", () => {
    const app = { destination: new GitHubDestination({ token: "x" }) };

    assert.equal(postLabel(app), "Post to GitHub");
    assert.equal(postNote(app), "nothing has been sent yet");
  });

  test("promises the demo nothing more than the demo can do", () => {
    const app = { destination: new DemoDestination({ seed: "/demo/queue.json" }) };

    assert.equal(postLabel(app), "Post review");
    assert.match(postNote(app), /nothing is sent/i);
  });

  test("says something neutral when there is no destination to ask", () => {
    assert.equal(postLabel({ destination: null }), "Post review");
    assert.equal(postNote({ destination: null }), "nothing has been sent yet");
  });
});

// The send on a single comment, which sits beside Edit and Drop on the card and
// used to read "Post". Beside a footer button reading "Post review", one word
// leaves the reader guessing which of the two they are about to do, and the two
// are not the same: this one sends one comment on its own, before the review.
describe("the words on a single comment's send", () => {
  test("say which of the two sends this is, and that it happens now", () => {
    const words = commentWords({ destination: new GitHubDestination({ token: "x" }) });

    assert.equal(words.label, "Post this comment");
    assert.match(words.title, /one comment/i);
    assert.match(words.title, /ahead of the review/i);
  });

  test("name the destination when confirming a send that really goes there", () => {
    assert.equal(
      commentWords({ destination: new GitHubDestination({ token: "x" }) }).question,
      "Post to GitHub?",
    );
  });

  test("promise the demo nowhere to send it, because it has nowhere", () => {
    const question = commentWords({ destination: new DemoDestination({ seed: "/demo/queue.json" }) }).question;

    assert.equal(question, "Post it now?");
    assert.equal(commentWords({ destination: null }).question, "Post it now?");
  });
});

// What is said after the send, which is the harder half.
//
// The sheet promised the demo sends nothing. The screen that follows it used to
// answer with "Review posted" and a link reading "read it on GitHub", pointed at
// a real pull request that has no such review on it. A visitor who followed that
// link found nothing, having been told two opposite things one click apart.
describe("the words after the send", () => {
  test("GitHub reports the send it actually made, and links to it", () => {
    const words = postedWords({ destination: new GitHubDestination({ token: "x" }) });

    assert.equal(words.title, "Review posted");
    assert.equal(words.link, "read it on GitHub");
    assert.equal(words.sent, true);
  });

  test("the demo never claims a send it did not make", () => {
    const words = postedWords({ destination: new DemoDestination({ seed: "/demo/queue.json" }) });

    assert.equal(words.sent, false);
    assert.doesNotMatch(words.title, /posted|sent/i);
    assert.match(words.note, /nothing (was|is) sent/i);
  });

  test("the demo spends the moment on the invitation rather than on a dead link", () => {
    const words = postedWords({ destination: new DemoDestination({ seed: "/demo/queue.json" }) });

    // The one moment a visitor has finished the job and wants to send it for
    // real. It is the whole reason the button is not simply disabled.
    assert.ok(words.cta.href, "the demo must offer somewhere to go next");
    assert.doesNotMatch(words.cta.href, /github\.com/, "and it is not off to GitHub");
  });

  test("falls back to saying nothing was sent when there is no destination", () => {
    const words = postedWords({ destination: null });

    assert.equal(words.sent, false);
  });

  // The banner that stays on a review after the fact is the same claim as the
  // celebration, made permanently, so it answers to the same rule.
  test("the standing record says what happened, and links only when there is something to link to", () => {
    const github = postedWords({ destination: new GitHubDestination({ token: "x" }) });
    const demo = postedWords({ destination: new DemoDestination({ seed: "/demo/queue.json" }) });

    assert.match(github.record, /posted \{age\} ago/);
    assert.doesNotMatch(demo.record, /posted/i);
  });
});

// The control in the corner beside the destination.
describe("the way out", () => {
  test("signs out of a destination that holds a token", () => {
    const words = leaveWords({ destination: new GitHubDestination({ token: "x" }) });

    assert.equal(words.label, "Sign out");
    assert.equal(words.resets, false);
  });

  test("offers the demo a way to start again, having no token to forget", () => {
    const words = leaveWords({ destination: new DemoDestination({ seed: "/demo/queue.json" }) });

    assert.equal(words.resets, true);
    assert.doesNotMatch(words.label, /sign out/i);
  });
});

// Dismissing closes a pull request off exactly as posting does, so it borrows
// the same screen. What it must not borrow is the claim: nothing left for the
// destination, so there is no link to a review and nothing to say about where
// it went. The cheering is honest either way, because what is being marked is
// the reader finishing with a pull request, not a packet leaving the machine.
describe("the words on a dismissal", () => {
  test("says what happened without claiming anything was sent", () => {
    const words = dismissedWords();

    assert.equal(words.sent, false);
    assert.equal(words.link, "");
    assert.equal(words.cta.href, "");
    assert.match(words.title, /dismiss/i);
  });

  test("crosses it off and cheers, because the reader is done with it", () => {
    const words = dismissedWords();

    assert.equal(words.struck, true);
    assert.equal(words.cheer, true);
  });

  test("a posted review still cheers only when something was really sent", () => {
    const real = postedWords({ destination: new GitHubDestination({ token: "x" }) });
    const demo = postedWords({ destination: new DemoDestination() });

    assert.equal(real.cheer, true);
    assert.equal(demo.cheer, false);
  });
});

// A draft nobody could read and a draft nobody could understand arrive at the
// same empty state, and used to leave it wearing the same sentence: "the agent
// wrote something this app cannot act on". That is true of one of them. A
// bucket refusing a connection is the storage's fault, fixes itself, and had
// the reader hunting an agent that did nothing wrong.
describe("the words on a draft that did not arrive", () => {
  test("blame the storage, and say it is coming back, when the read failed", () => {
    const words = draftProblemWords({ cause: UNREAD, detail: "that bucket refused the connection" });

    assert.match(words.note, /that bucket refused the connection/);
    assert.doesNotMatch(words.title, /agent/i);
    assert.doesNotMatch(words.note, /the agent wrote/i);
  });

  test("blame the draft, and say waiting will not help, when it did not parse", () => {
    const words = draftProblemWords({ cause: UNPARSED, detail: "unknown schema 99" });

    assert.match(words.note, /unknown schema 99/);
    assert.match(words.note, /the agent wrote/i);
  });

  test("do not put one failure's sentence on the other", () => {
    const unread = draftProblemWords({ cause: UNREAD, detail: "that bucket refused the connection" });
    const unparsed = draftProblemWords({ cause: UNPARSED, detail: "unknown schema 99" });

    assert.notEqual(unread.title, unparsed.title);
    assert.notEqual(unread.note, unparsed.note);
  });
});
