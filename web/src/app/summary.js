// The summary pane: the comments, then the review body, then the recordings.
//
// It is also where every absence is explained. A blank pane is the one thing
// this app must never show, because "no source attached", "no destination",
// "the agent has not started" and "the draft is unreadable" are four different
// problems with four different fixes.

import { adapterTypes } from "../adapters/index.js";
import { renderBody } from "../domain/render.js";
import { webUrl } from "../domain/url.js";
import { age, element, emptyState, find, say } from "./dom.js";
import { button } from "../ui/button.js";
import { render } from "../ui/render.js";
import { findingCard } from "./findings.js";
import { qaContent } from "./qa.js";
import { editSource, openSetup } from "./header.js";
import { draftProblemWords, postedWords } from "./words.js";

/**
 * The review body as it would be posted, including an edit still in the editor.
 *
 * @param {object} app the application
 * @returns {string} the markdown bound for the destination
 */
export function reviewText(app) {
  if (app.editing) return find("editor").value;
  if (!app.selected) return "";

  return app.queries.commentFor(app.source, app.selected);
}

/**
 * Put the cursor in the summary, which is how writing one begins.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function openEditor(app) {
  const pull = app.selected;

  if (!pull || !pull.draft || app.editing) return;

  const editor = find("editor");

  editor.value = app.queries.commentFor(app.source, pull);
  app.editing = true;
  app.changed();

  queueMicrotask(() => {
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  });
}

/**
 * Keep what was written and go back to reading it.
 *
 * Leaving the box is the whole gesture: there is no save button to press, so
 * an edit is never sitting in an editor the reader has walked away from.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function closeEditor(app) {
  if (!app.editing) return;

  const pull = app.selected;

  app.editing = false;

  if (!pull || !pull.draft) {
    app.changed();

    return;
  }

  app.commands.editComment(app.source, pull, find("editor").value);
  app.reselect();
}

/**
 * Whether the summary text can still be written.
 *
 * The same rule as the send button: approving implies having read the whole
 * review, so only approve waits on the draft finishing. A reader posting a
 * comment or a request for changes before the agent is done needs somewhere
 * to write it, so those verdicts do not wait.
 *
 * @param {object} draft the draft
 * @param {string} chosen the verdict about to be sent
 * @param {boolean} posted whether the review already went out
 * @param {boolean} filtered whether a lens or theme is narrowing the view
 * @returns {boolean} whether the box can be typed in
 */
export function summaryWritable(draft, chosen, posted, filtered) {
  if (filtered || posted) return false;

  return chosen !== "APPROVE" || Boolean(draft?.finishedAt);
}

/**
 * Draw the summary pane.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function drawSummary(app) {
  const notes = find("comment-notes");
  const body = find("comment-body");
  const cards = find("comment-cards");
  const extra = find("comment-extra");
  const editor = find("editor");

  notes.replaceChildren();
  body.replaceChildren();
  cards.replaceChildren();
  extra.replaceChildren();

  body.hidden = app.editing;
  editor.hidden = !app.editing;

  const nothing = blankState(app);

  if (nothing) {
    // There is nothing to edit, so an editor left open over the last review
    // would be editing a review that is no longer on screen.
    app.editing = false;
    body.hidden = false;
    editor.hidden = true;
    body.append(nothing);

    return;
  }

  const pull = app.selected;
  const draft = pull.draft;
  const posted = app.queries.isPosted(app.source, pull);
  const unfinished = !draft.finishedAt;
  const filtered = Boolean(app.filter.section || app.filter.kind);

  // The comment is writable once it is real, on the unfiltered summary - and no
  // longer once it has been sent. An editor open over words that just became
  // unwritable would be editing something this app can no longer change. Which
  // verdicts wait on the draft finishing is the send button's own call
  // (footer.js); this follows the same one, so a reader choosing a verdict
  // that can go out early has somewhere to write what it says.
  const chosen = app.queries.verdictFor(app.source, pull, app.login);
  const writable = summaryWritable(draft, chosen, posted, filtered);

  if (!writable && app.editing) {
    app.editing = false;
    body.hidden = false;
    editor.hidden = true;
  }

  // A posted review reads as the record it now is, in the destination's own
  // words: one that sent nothing must not leave a standing claim that it did,
  // nor a link to a review nobody wrote.
  if (posted && !filtered) {
    const words = postedWords(app);
    // The review went out either way, so the record stands either way. A url
    // that is not an http(s) address costs the link and nothing else: it was
    // written into a draft or an event by an agent reading somebody else's
    // branch, and a browser runs some schemes as code on this origin.
    const address = webUrl(pull.postedUrl) || webUrl(pull.url);
    const note = document.createElement(words.sent && address ? "a" : "div");

    note.className = "posted-note mono";

    if (words.sent && address) {
      note.href = address;
      note.target = "_blank";
      note.rel = "noreferrer";
    }

    note.append(
      element("span", "", "✓"),
      element("span", "", words.record.replace("{age}", age(pull.postedAt))),
    );
    notes.append(note);
  }

  // Unfinished but readable: say so above the prose, with the agent's own note
  // on where it has got to.
  if (unfinished && !filtered) notes.append(progressBanner(draft));

  // A filtered view reads like the summary it replaces: the lens's or theme's
  // own written analysis as plain prose in the summary's place, then its cards.
  const filterBody = app.filter.section
    ? draft.sections.find((candidate) => candidate.key === app.filter.section)?.body
    : app.filter.kind
      ? draft.kinds.find((candidate) => candidate.key === app.filter.kind)?.body
      : "";

  if (filtered) {
    if (filterBody) {
      const note = document.createElement("div");
      note.innerHTML = renderBody(filterBody);
      body.append(note);
    }
  } else {
    // The summary leads: it is what the review says, and the comments below
    // are its particulars.
    body.append(summaryBox(app, reviewText(app), writable));
  }

  // The comments, each on the code it is about - the very same cards the diff
  // renders, Edit/Post/Drop and all.
  for (const finding of app.queries.findingsMatching(app.source, pull, app.filter)) {
    cards.append(findingCard(app, pull, finding, { snippet: true, actions: !posted }));
  }

  if (filtered) return;

  // The recordings close as the proof.
  extra.append(...qaContent(app, { report: false }));
}

/**
 * The summary as a box, which is also the way into writing one.
 *
 * There is no edit button and no save button: clicking the box puts a cursor
 * in it, and leaving it keeps what was typed.
 *
 * @param {object} app the application
 * @param {string} text the review body as it stands
 * @param {boolean} writable whether these words can still be changed
 * @returns {HTMLElement} the box
 */
function summaryBox(app, text, writable) {
  // No summary is a fine review - the comments carry it - but the space says
  // so rather than just ending, and is itself the way to write one.
  if (!text.trim()) {
    const slate = document.createElement(writable ? "button" : "div");

    slate.className = "summary-box is-blank";
    slate.append(
      element("div", "title", "No summary."),
      element(
        "div",
        "text",
        writable
          ? "The comments below carry this review. Click to write one anyway."
          : "The comments below carry this review.",
      ),
    );

    if (writable) slate.addEventListener("click", () => openEditor(app));

    return slate;
  }

  const box = document.createElement("div");

  box.className = "summary-box";
  box.innerHTML = renderBody(text);

  if (!writable) return box;

  box.role = "button";
  box.tabIndex = 0;
  box.title = "Click to write in the summary";
  // The title says the same thing, but a native tooltip needs a hover and a
  // wait. A blank summary already says how to write one; a written one should
  // say just as plainly that it can be changed. Hidden from a screen reader:
  // the title on the box already names what this decorates.
  const hint = element("div", "summary-edit-hint", "click to edit");

  hint.setAttribute("aria-hidden", "true");
  box.append(hint);
  box.addEventListener("click", (event) => {
    // A link in the summary goes where it points; only the prose around it
    // opens the editor.
    if (event.target.closest("a")) return;

    openEditor(app);
  });
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    openEditor(app);
  });

  return box;
}

/**
 * What a draft source is, told so that this reader can act on it.
 *
 * Reading a folder needs the File System Access API, which Chromium has and
 * Firefox and Safari do not, and which Brave switches off by default - so the
 * folder half of the sentence is a promise to some readers and a wild goose
 * chase for the rest. The desktop app reads a folder by another route entirely,
 * and it counts.
 *
 * Whether either is on offer is already decided by the adapters, so this asks
 * them rather than feature detecting a second time and drifting from the list
 * the picker draws.
 *
 * @param {{type: string, reason: string}[]} [types] what can be attached here
 * @returns {string} the sentence under "No draft source attached"
 */
export function sourceHint(types = adapterTypes()) {
  const folder = types.some(
    (candidate) => ["filesystem", "tauri"].includes(candidate.type) && !candidate.reason,
  );

  if (folder) {
    return "A draft source is the storage your review agent writes to - a folder on this computer, or a bucket you own.";
  }

  return "A draft source is the storage your review agent writes to. A bucket you own works in any browser; a folder on this computer needs the desktop app or a Chromium browser.";
}

/**
 * Whichever nothing is true right now, as a composed state.
 *
 * @param {object} app the application
 * @returns {HTMLElement|null} the empty state, or null when there is a review
 */
export function blankState(app) {
  if (!app.source) {
    return withAction(
      emptyState(
        "◇",
        "No draft source attached.",
        sourceHint(),
      ),
      "Attach a source",
      () => openSetup(app),
    );
  }

  if (app.problem) {
    // A lapsed folder permission is the common case here, and it is fixed by
    // choosing the folder again. The fix belongs where the problem is stated.
    return withAction(
      emptyState("⚠", "That source cannot be read.", app.problem),
      "Fix this source",
      () => editSource(app, app.source).catch((failure) => say(failure.message, "error")),
    );
  }

  if (!app.destination) {
    return withAction(
      emptyState(
        "◌",
        "No destination configured.",
        "A destination is where reviews are posted. Add one with a personal access token, which stays in this browser and is sent only there.",
      ),
      "Add a destination",
      () => openSetup(app),
    );
  }

  const queue = app.queue();

  if (!app.selected) {
    if (!queue.length) {
      return emptyState(
        "○",
        "Nothing waiting.",
        app.destination.emptyQueueHint() || "No pull request here is waiting on you.",
      );
    }

    return emptyState(
      "⌥",
      "Nothing open.",
      "Pick a pull request from the queue in the header to read what the agent drafted.",
    );
  }

  const pull = app.selected;
  const problem = app.drafts ? app.drafts.problem(pull.key) : null;

  if (!pull.draft) {
    if (problem) {
      const words = draftProblemWords(problem);

      return emptyState("⚠", words.title, words.note);
    }

    return emptyState(
      "◌",
      "No review has started.",
      "No agent has claimed this pull request yet - its review begins the moment one writes a draft file.",
    );
  }

  // A draft file existing is the line: from here the pane is its own to draw,
  // however little is filled in yet. drawSummary's own progress banner says
  // what is still coming.
  return null;
}

function withAction(empty, label, onClick) {
  empty.querySelector(".empty-inner").append(render(button({ label, onClick })));

  return empty;
}

function progressBanner(draft) {
  const banner = document.createElement("div");

  banner.className = "wip mono";
  banner.append(
    element("span", "", "⏳"),
    element(
      "span",
      "",
      draft.progress.note || "review in progress - this summary is still being written",
    ),
  );

  if (draft.progress.percent !== null) banner.append(progressBar(draft.progress.percent));

  return banner;
}

function progressBar(percent) {
  const bar = document.createElement("div");

  bar.className = "progress";
  bar.append(element("span", "", ""));
  bar.firstChild.style.width = `${percent}%`;

  return bar;
}
