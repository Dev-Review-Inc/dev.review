// The last look before a review leaves, and the moment after it has.

import { renderBody } from "../domain/render.js";
import { reviewPayload, withPrefix } from "../domain/review.js";
import { element, find, say } from "./dom.js";
import { button } from "../ui/button.js";
import { restyle } from "../ui/render.js";
import { descriptionPlan } from "./description-pane.js";
import { findingCard } from "./findings.js";
import { VERDICT_TONE, closeWords } from "./footer.js";
import { reviewText } from "./summary.js";
import { dismissedWords, postLabel, postNote, postedWords } from "./words.js";

// The one line the sheet and the footer both say about the rewrite.
function planWords(plan) {
  return plan.changed
    ? `description: ${plan.kept} of ${plan.total} changes kept`
    : "description unchanged";
}

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
  // Described rather than reset field by field: the spinner the send put in
  // its place goes with the description, and so does the tint.
  const send = restyle(button({ label: postLabel(app), role: "primary" }), find("confirm-post"));
  const cancel = restyle(button({ label: "Keep editing" }), find("confirm-cancel"));

  send.disabled = false;
  cancel.disabled = false;
}

/**
 * @param {object} app the application
 * @returns {void}
 */
export function closeConfirm(app) {
  settle(app);
  app.editingConfirm = false;
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

  find("confirm-target").textContent = `${pull.owner}/${pull.repo}#${pull.number}`;

  const verdict = find("confirm-verdict");

  // An issue carries no verdict, so the badge would only ever wear a guess.
  verdict.hidden = Boolean(pull.isIssue);

  if (pull.isIssue) {
    openTriageConfirm(app);

    return;
  }

  const event = app.queries.verdictFor(app.source, pull, app.login);
  const posting = app.queries.findingsToPost(app.source, pull);

  verdict.textContent = event.replace("_", " ");
  verdict.className = `verdict-badge mono is-${VERDICT_TONE[event] || "neutral"}`;

  const summary = app.queries.commentToPost(app.source, pull);

  // Said by listing what is actually in this send. A summary the reader never
  // opted in is not in it, and a sheet that claims otherwise is describing a
  // different review than the one about to go.
  const carrying = [
    summary ? "the summary" : "",
    posting.length ? `${posting.length} line ${posting.length === 1 ? "comment" : "comments"}` : "",
  ].filter(Boolean);

  find("confirm-count").textContent = carrying.length
    ? `posts ${carrying.join(" and ")}`
    : "posts the verdict, with nothing written";

  // The preview is the summary page over again, carrying only what this send
  // will actually do: a finding already posted on its own, or never opted in,
  // is not part of it. The findings are read-only here - the sheet is the last
  // look, not a second place to work - but the summary is not, because the
  // sentence a reader wants to change is the one they are reading right now.
  const preview = find("confirm-preview");

  preview.replaceChildren();

  // Shown with the prefix already leading it, because this is the one place
  // that promises to say exactly what would be sent - the summary box still
  // edits the reader's own words alone, unprefixed, so saving an edit here
  // can never write the prefix into the stored comment. The prefix marks the
  // agent's words, so a body the reader rewrote goes without it, and each
  // finding decides for itself the same way.
  const prefix = app.queries.commentPrefixFor(app.source);
  const bodyPrefix = app.queries.isCommentEdited(app.source, pull) ? "" : prefix;

  if (summary) preview.append(summaryBox(app, pull, summary, bodyPrefix));

  for (const finding of posting) {
    preview.append(findingCard(app, pull, finding, { snippet: true, actions: false, prefix }));
  }

  find("confirm-note").textContent = postNote(app);
  find("confirm").hidden = false;
  settle(app);
}

/**
 * Show exactly what a triage would send: the comment, and one line saying what
 * happens to the ticket's body.
 *
 * @param {object} app the application
 * @returns {void}
 */
function openTriageConfirm(app) {
  const pull = app.selected;
  const plan = descriptionPlan(app);
  const comment = reviewText(app);
  const close = pull.draft.close;
  const dropped = close ? app.queries.closeDropped(app.source, pull) : false;

  find("confirm-count").textContent = [
    comment.trim() ? "posts a comment" : "posts no comment",
    planWords(plan),
    ...(close ? [closeWords(close, dropped)] : []),
  ].join(" · ");

  const preview = find("confirm-preview");

  // Shown with the prefix already leading it, the same promise the review
  // sheet makes: this is exactly what would be sent - and an edited comment
  // is the reader's own words, which the agent's mark does not lead.
  preview.innerHTML = renderBody(withPrefix(triagePrefix(app, pull), comment));
  preview.append(element("div", "description-plan mono", planWords(plan)));

  if (close) preview.append(closeLine(app, pull, close, dropped));

  find("confirm-note").textContent = postNote(app);
  find("confirm").hidden = false;
  settle(app);
}

/**
 * The prefix a triage send carries: the reader's, unless the comment is
 * already the reader's own words.
 *
 * @param {object} app the application
 * @param {object} pull the open issue
 * @returns {string} the prefix, or nothing
 */
function triagePrefix(app, pull) {
  return app.queries.isCommentEdited(app.source, pull)
    ? ""
    : app.queries.commentPrefixFor(app.source);
}

/**
 * The close as one line on the sheet, with the decision beside it.
 *
 * The control lives here rather than in the footer because this app puts
 * decisions on the content they decide - findings carry their own Drop, hunks
 * their own Reject - and the sheet's plan line is the one place the close is
 * stated as content. The verbs are the findings' own: Drop, and Restore.
 *
 * @param {object} app the application
 * @param {object} pull the open issue
 * @param {{reason: string, of: number|null}} close the draft's proposal
 * @param {boolean} dropped whether the reader left the close out
 * @returns {HTMLElement} the line
 */
function closeLine(app, pull, close, dropped) {
  const line = element("div", "description-plan mono close-plan", "");

  line.append(element("span", "", closeWords(close, dropped)), element("span", "spacer", ""));

  const toggle = document.createElement("button");

  toggle.className = "hunk-toggle";
  toggle.textContent = dropped ? "Restore" : "Drop";
  toggle.addEventListener("click", async () => {
    if (dropped) app.commands.restoreClose(app.source, pull);
    else app.commands.dropClose(app.source, pull);

    // The sheet is drawn imperatively, so the redraw the reselect triggers
    // does not reach it: it is reopened over the decision just made.
    await app.reselect();
    openConfirm(app);
  });

  line.append(toggle);

  return line;
}

/**
 * The review body in the sheet: read, until it is clicked, and then written.
 *
 * Its own editor rather than the summary pane's, which is behind the sheet and
 * so cannot be typed into from here. Leaving the box is what keeps the edit,
 * the same gesture the pane's box asks for.
 *
 * @param {object} app the application
 * @param {object} pull the pull request being posted
 * @param {string} summary the body as it stands
 * @param {string} prefix the reader's prefix, shown leading the read-only box only -
 *   the editor beneath it edits the reader's own words alone, so saving it can
 *   never write the prefix into the stored comment
 * @returns {HTMLElement} the box, or the editor open over it
 */
function summaryBox(app, pull, summary, prefix) {
  if (app.editingConfirm) {
    const editor = document.createElement("textarea");

    editor.className = "finding-editor mono";
    editor.spellcheck = false;
    editor.value = summary;
    editor.addEventListener("blur", () => {
      app.commands.editComment(app.source, pull, editor.value);
      app.editingConfirm = false;
      app.reselect();
      openConfirm(app);
    });

    queueMicrotask(() => {
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    });

    return editor;
  }

  const box = document.createElement("div");

  box.className = "summary-box";
  box.innerHTML = renderBody(withPrefix(prefix, summary));
  box.role = "button";
  box.tabIndex = 0;
  box.title = "Click to write in the summary";

  // Nobody expects the last look before sending to be a place they can write,
  // so the box says so on hover the same way the pane's does. Hidden from a
  // screen reader: the title already names what this decorates.
  const hint = element("div", "summary-edit-hint", "click to edit");

  hint.setAttribute("aria-hidden", "true");
  box.append(hint);
  box.addEventListener("click", (event) => {
    // A link in the summary goes where it points; only the prose around it
    // opens the editor.
    if (event.target.closest("a")) return;

    app.editingConfirm = true;
    openConfirm(app);
  });

  return box;
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

  const send = find("confirm-post");

  send.disabled = true;
  send.innerHTML = '<span class="spin" aria-hidden="true"></span>Posting…';
  find("confirm-cancel").disabled = true;
  find("confirm-note").textContent = "sending…";
  say("posting…");

  // An edit still sitting in an open editor is part of the review. Recording
  // it before the send is what stops the destination and this app disagreeing
  // about what was said. Either editor: the pane's, left open behind the
  // sheet, and the sheet's own.
  const open = app.editingConfirm ? find("confirm-preview").querySelector("textarea") : null;

  if (open) {
    app.commands.editComment(app.source, pull, open.value);
    app.editingConfirm = false;
  } else if (app.editing) {
    app.commands.editComment(app.source, pull, find("editor").value);
    app.editing = false;
  }

  if (pull.isIssue) return postTriage(app, pull);

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
        body: app.queries.commentToPost(app.source, pull),
        event,
        prefix: app.queries.commentPrefixFor(app.source),
        bodyEdited: app.queries.isCommentEdited(app.source, pull),
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
 * Send the triage: the rewrite first, then the comment, then the record.
 *
 * The rewrite replaces the whole body, so it alone gets a guard: the ticket is
 * fetched again at the last moment, and one that moved since the reader read
 * it is re-read rather than overwritten - the sheet closes, the pane rediffs
 * against what is actually there, and the reader's kept and rejected hunks
 * carry over on their content ids.
 *
 * Nothing is recorded until everything staged has landed. A patch that went
 * out before a comment was refused stays honest either way: re-patching the
 * same body is idempotent, so the retry the queue offers is safe.
 *
 * @param {object} app the application
 * @param {object} pull the open issue
 * @returns {Promise<void>} when it has landed, or failed out loud
 */
async function postTriage(app, pull) {
  let patched = null;
  let commented = null;
  let commentStaged = false;

  try {
    const plan = descriptionPlan(app);

    if (plan.changed) {
      const fresh = await app.destination.issue(pull);

      if (fresh.body !== app.issue.body) {
        app.issue = fresh;
        closeConfirm(app);
        say("the ticket changed since you read it - look it over again", "error");
        await app.reselect();

        return;
      }

      patched = await app.destination.patchDescription(pull, plan.body);
    }

    // The reader's prefix leads the triage comment the same way it leads the
    // review body and every line comment: applied at the send, never stored -
    // and never over an edited comment, which is the reader's own words.
    const comment = withPrefix(
      triagePrefix(app, pull),
      app.queries.commentFor(app.source, pull),
    );

    commentStaged = Boolean(comment.trim());
    commented = commentStaged ? await app.destination.commentOnIssue(pull, comment) : null;

    // The close goes last, after the comment that explains it, so the ticket
    // is never shut on a reporter before the reason is on it.
    const close = pull.draft.close;

    if (close && !app.queries.closeDropped(app.source, pull)) {
      await app.destination.closeIssue(pull, close.reason);
    }

    // The comment's url is the deeper link, so it wins when both went. A
    // close's url is the ticket itself, which pull.url already is, so it
    // never overrides either.
    const url = commented?.url || patched?.url || pull.url;

    await app.commands.recordPostedTriage(app.source, pull, { url });
    await app.reselect();

    closeConfirm(app);
    say(postedWords(app).sent ? `posted to #${pull.number}` : "nothing was sent", "ok");
    celebrate(app, pull, url);
  } catch (failure) {
    // The sheet stays open and says how far it got: a patch or a comment that
    // landed before a later step failed is not "nothing". Posting again sends
    // everything staged - re-patching the same body changes nothing.
    say(failure.message, "error");
    settle(app);

    const landed = [
      patched && "the description was updated",
      commented && "the comment was posted",
    ].filter(Boolean);

    find("confirm-note").textContent = landed.length
      ? `${landed.join("; ")}; ${
          commentStaged && !commented ? "the comment was not sent" : "the ticket was not closed"
        }`
      : "nothing has been sent";
  }
}

/**
 * Take a pull request off the queue, with nothing sent anywhere.
 *
 * There is no sheet to confirm because there is nothing to send: the decision is
 * local, and the way back is the restore the queue offers.
 *
 * @param {object} app the application
 * @returns {Promise<void>} when it is off the queue, or has said why it is not
 */
export async function dismiss(app) {
  const pull = app.selected;

  if (!pull) return;

  try {
    // Waited for rather than fired off, so the queue never shows a pull request
    // gone before the reason it is gone has been written down. Closing the tab
    // on that screen would otherwise bring it back.
    await app.commands.dismissPull(app.source, pull);
  } catch (failure) {
    // Nothing is closed and nothing is celebrated. A dismissal that was not
    // written down did not happen, and taking the review off screen for it
    // would leave the reader sure they had dealt with a pull request that is
    // still on the queue.
    say(failure.message, "error");

    return;
  }

  app.dismissing = false;
  // Answering "nothing" leaves nothing to look at, so the review is closed
  // rather than left open under a footer offering to post it after all.
  app.selected = null;
  app.changed();

  // The same screen a posted review gets. Finishing with a pull request is the
  // thing being marked, and deciding there was nothing to say is a way of
  // finishing with it. The words are the dismissal's own, so nothing here
  // claims a review went anywhere.
  celebrate(app, pull, pull.url, dismissedWords());
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

  restyle(button({ label: "Back to the queue" }), find("cheer-close"));

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

  // The one thing being asked for on a page that sent nothing, so it wears the
  // primary's clothes. It stays an anchor: it navigates, and a middle click on
  // it has to open a tab the way every other link here does.
  if (words.cta.href) {
    restyle(button({ label: words.cta.text, role: "primary", link: true }), cta);
    cta.classList.add("cheer-cta");
    cta.href = words.cta.href;
  }

  // Crossing the title out reads as "done, and gone". Nothing left the demo, so
  // there is nothing to strike through.
  find("cheer-pr").classList.toggle("cheer-struck", words.struck);

  const next = app.queue().find((entry) => entry.isReady);
  const onward = restyle(
    button({ label: "Next ready review \u2192", role: "primary" }),
    find("cheer-next"),
  );

  onward.hidden = !next;
  onward.onclick = () => {
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
