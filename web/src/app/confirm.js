// The last look before a review leaves, and the moment after it has.

import { renderBody } from "../domain/render.js";
import { reviewPayload } from "../domain/review.js";
import { find, say } from "./dom.js";
import { findingCard } from "./findings.js";
import { VERDICT_TONE } from "./footer.js";
import { reviewText } from "./summary.js";
import { postLabel, postNote, postedWords } from "./words.js";

/**
 * Put the confirmation sheet back to a state it can be used from.
 *
 * Module scope on purpose: the sheet is closed by its own cancel button and by
 * a click on the backdrop, and both have to leave the button usable. A settle
 * that only existed inside the posting function meant the backdrop threw
 * instead of closing.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function settle(app) {
  const button = find("confirm-post");

  button.disabled = false;
  button.classList.remove("is-posting");
  button.textContent = postLabel(app);
  find("confirm-cancel").disabled = false;
}

/**
 * @param {object} app the application
 * @returns {void}
 */
export function closeConfirm(app) {
  settle(app);
  find("confirm").hidden = true;
}

/**
 * Show exactly what would be sent.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function openConfirm(app) {
  const pull = app.selected;

  if (!pull || !pull.draft) return;

  const event = app.queries.verdictFor(app.source, pull, app.login);
  const posting = app.queries.findingsToPost(app.source, pull);

  const verdict = find("confirm-verdict");
  verdict.textContent = event.replace("_", " ");
  verdict.className = `verdict-badge mono is-${VERDICT_TONE[event] || "neutral"}`;

  find("confirm-target").textContent = `${pull.owner}/${pull.repo}#${pull.number}`;
  find("confirm-count").textContent = posting.length
    ? `posts the summary and ${posting.length} line ${posting.length === 1 ? "comment" : "comments"}`
    : "posts the summary only";

  // The preview is the summary page over again, read-only, and carries only
  // what this send will actually do: a finding already posted on its own, or
  // dropped, is not part of it.
  const preview = find("confirm-preview");

  preview.innerHTML = renderBody(reviewText(app));

  for (const finding of posting) {
    preview.append(findingCard(app, pull, finding, { snippet: true, actions: false }));
  }

  find("confirm-note").textContent = postNote(app);
  find("confirm").hidden = false;
  settle(app);
}

/**
 * Send the review.
 *
 * @param {object} app the application
 * @returns {Promise<void>} when it has landed, or failed out loud
 */
export async function post(app) {
  const pull = app.selected;

  if (!pull) return;

  const button = find("confirm-post");

  button.disabled = true;
  button.classList.add("is-posting");
  button.innerHTML = '<span class="spin" aria-hidden="true"></span>Posting…';
  find("confirm-cancel").disabled = true;
  find("confirm-note").textContent = "sending…";
  say("posting…");

  // An edit still sitting in the open editor is part of the review. Recording
  // it before the send is what stops the destination and this app disagreeing
  // about what was said.
  if (app.editing) {
    app.commands.editComment(app.source, pull, find("editor").value);
    app.editing = false;
  }

  try {
    const event = app.queries.verdictFor(app.source, pull, app.login);

    const payload = reviewPayload(
      {
        findings: app.queries.findingsToPost(app.source, pull),
        comment: "",
        verdict: event,
      },
      {
        commitId: app.headCommit,
        dropped: new Set(),
        body: app.queries.commentFor(app.source, pull),
        event,
      },
    );

    const posted = await app.postReview(payload);

    closeConfirm(app);
    say(postedWords(app).sent ? `posted to #${pull.number}` : "nothing was sent", "ok");
    celebrate(app, pull, posted.url || pull.url);
  } catch (failure) {
    // Nothing is redrawn as though this worked: the sheet stays open, saying
    // so, and the review is still exactly where it was.
    say(failure.message, "error");
    settle(app);
    find("confirm-note").textContent = "nothing has been sent";
  }
}

/**
 * Close a review off: the pull request crossed off, and the way to the next one.
 *
 * What is said here comes from the destination, because only the destination
 * knows whether anything actually went anywhere. One that sent nothing says so
 * and offers the way to send for real, instead of a link to a review that was
 * never written.
 *
 * @param {object} app the application
 * @param {object} pull the pull request just posted
 * @param {string} url where the posted review lives
 * @param {object} [words] what to say, when it was not a posting that closed this off
 * @returns {void}
 */
export function celebrate(app, pull, url, words = postedWords(app)) {

  find("cheer-slug").textContent = `${pull.owner}/${pull.repo}#${pull.number}`;
  find("cheer-pr").textContent = pull.title;
  find("cheer-title").textContent = words.title;

  const note = find("cheer-note");

  note.textContent = words.note;
  note.hidden = !words.note;

  // A link to the sent review, for a destination that sent one.
  const link = find("cheer-link");

  link.hidden = !words.link;
  link.textContent = words.link;
  if (words.link) link.href = url;

  // And the invitation, for one that did not. It leaves the demo frame rather
  // than loading the documentation inside it.
  const cta = find("cheer-cta");

  cta.hidden = !words.cta.href;
  cta.textContent = words.cta.text;
  if (words.cta.href) cta.href = words.cta.href;

  // Crossing the title out reads as "done, and gone". Nothing left the demo, so
  // there is nothing to strike through.
  find("cheer-pr").classList.toggle("cheer-struck", words.struck);

  const next = app.queue().find((entry) => entry.isReady);
  const button = find("cheer-next");

  button.hidden = !next;
  button.onclick = () => {
    find("celebrate").hidden = true;

    if (next) app.select(next).catch((failure) => say(failure.message, "error"));
  };

  find("celebrate").hidden = false;

  // Confetti over a send that never happened is the same lie as the words were.
  // A destination that posted nowhere gets an explanation, not a party.
  find("cheer-mark").hidden = !words.cheer;
  if (words.cheer) confetti();
}

/**
 * Throw confetti - a posted review is the whole point of the day.
 *
 * Self-contained on a canvas: the content security policy allows no outside
 * script, and none is needed. Skipped entirely for a reader who asked the
 * system for reduced motion.
 *
 * @returns {void}
 */
function confetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = find("confetti");
  const context = canvas.getContext("2d");

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  const styles = getComputedStyle(document.documentElement);
  const colors = ["--accent", "--green", "--amber", "--red"].map((name) =>
    styles.getPropertyValue(name).trim(),
  );

  const pieces = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.5,
    w: 5 + Math.random() * 5,
    h: 8 + Math.random() * 6,
    vy: 2 + Math.random() * 3,
    vx: -1.2 + Math.random() * 2.4,
    spin: -0.2 + Math.random() * 0.4,
    angle: Math.random() * Math.PI,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const started = performance.now();

  const tick = (now) => {
    context.clearRect(0, 0, canvas.width, canvas.height);

    for (const piece of pieces) {
      piece.y += piece.vy;
      piece.x += piece.vx;
      piece.angle += piece.spin;

      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.angle);
      context.fillStyle = piece.color;
      context.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      context.restore();
    }

    // Long enough to feel like a moment, short enough to never be in the way.
    if (now - started < 3200 && !find("celebrate").hidden) {
      requestAnimationFrame(tick);
    } else {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  requestAnimationFrame(tick);
}
