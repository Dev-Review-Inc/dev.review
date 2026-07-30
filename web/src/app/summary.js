// The summary pane: the comments, then the review body, then the recordings.
//
// It is also where every absence is explained. A blank pane is the one thing
// this app must never show, because "no source attached", "no destination",
// "the agent has not started" and "the draft is unreadable" are four different
// problems with four different fixes.

import { adapterTypes } from "../adapters/index.js";
import { renderBody } from "../domain/render.js";
import { age, element, emptyState, find, say } from "./dom.js";
import { findingCard } from "./findings.js";
import { qaContent } from "./qa.js";
import { editSource, openSetup } from "./header.js";
import { postedWords } from "./words.js";

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
 * Switch between the rendered comment and the editor, keeping any edit.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function toggleEditor(app) {
  const pull = app.selected;

  if (!pull || !pull.draft) return;

  if (app.editing) {
    app.commands.editComment(app.source, pull, find("editor").value);
    app.editing = false;
    app.reselect();

    return;
  }

  find("editor").value = app.queries.commentFor(app.source, pull);
  app.editing = true;
  app.changed();
}

/**
 * Draw the summary pane.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function drawSummary(app) {
  const body = find("comment-body");
  const cards = find("comment-cards");
  const extra = find("comment-extra");
  const editor = find("editor");

  body.replaceChildren();
  cards.replaceChildren();
  extra.replaceChildren();

  body.hidden = app.editing;
  editor.hidden = !app.editing;
  find("edit").hidden = true;

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

  // The comment is editable once it is real, on the unfiltered summary - and no
  // longer once it has been sent.
  find("edit").hidden = filtered || unfinished || posted;
  find("edit").textContent = app.editing ? "Done" : "Edit";

  // A posted review reads as the record it now is, in the destination's own
  // words: one that sent nothing must not leave a standing claim that it did,
  // nor a link to a review nobody wrote.
  if (posted && !filtered) {
    const words = postedWords(app);
    const note = document.createElement(words.sent ? "a" : "div");

    note.className = "posted-note mono";

    if (words.sent) {
      note.href = pull.postedUrl || pull.url;
      note.target = "_blank";
      note.rel = "noreferrer";
    }

    note.append(
      element("span", "", "✓"),
      element("span", "", words.record.replace("{age}", age(pull.postedAt))),
    );
    cards.append(note);
  }

  // Unfinished but readable: say so above the prose, with the agent's own note
  // on where it has got to.
  if (unfinished && !filtered) cards.append(progressBanner(draft));

  // A filtered view reads like the summary it replaces: the lens's or theme's
  // own written analysis as plain prose, then its cards.
  const filterBody = app.filter.section
    ? draft.sections.find((candidate) => candidate.key === app.filter.section)?.body
    : app.filter.kind
      ? draft.kinds.find((candidate) => candidate.key === app.filter.kind)?.body
      : "";

  if (filtered && filterBody) {
    const note = document.createElement("div");
    note.innerHTML = renderBody(filterBody);
    cards.append(note);
  }

  // The comments lead, each on the code it is about - the very same cards the
  // diff renders, Edit/Post/Drop and all.
  for (const finding of app.queries.findingsMatching(app.source, pull, app.filter)) {
    cards.append(findingCard(app, pull, finding, { snippet: true, actions: !posted }));
  }

  if (filtered) return;

  // The summary reads after the particulars - Edit sits right beside it - then
  // the recordings close as the proof.
  const text = reviewText(app);

  if (text.trim()) {
    body.innerHTML = renderBody(text);
  } else {
    // No summary is a fine review - the comments carry it - but the space says
    // so rather than just ending, and is itself the way to write one.
    const slate = document.createElement("button");
    slate.className = "blank-summary";
    slate.append(
      element("div", "title", "No summary."),
      element("div", "text", "The comments above carry this review. Click to write one anyway."),
    );
    slate.addEventListener("click", () => toggleEditor(app));
    body.append(slate);
  }

  extra.append(...qaContent(app, { report: false }));
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
function blankState(app) {
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
  const problem = app.drafts ? app.drafts.problem(pull.key) : "";

  if (!pull.draft) {
    if (problem) {
      return emptyState(
        "⚠",
        "That draft cannot be read.",
        `The agent wrote something this app cannot act on: ${problem}`,
      );
    }

    return emptyState(
      "◌",
      "No review has started.",
      "No agent has claimed this pull request yet - its review begins the moment one writes a draft file.",
    );
  }

  // An unfinished draft with real content - lenses done, QA still running -
  // reads as the summary it is becoming, under an in-progress banner. Only a
  // draft with nothing to show yet gets the waiting state.
  const substantive = pull.draft.sections.length || pull.draft.findings.length;
  const looking = app.filter.section || app.filter.kind;

  if (pull.draft.finishedAt || substantive || looking) return null;

  const waiting = emptyState(
    "⏳",
    "Still being reviewed.",
    pull.draft.progress.note ||
      "The agent is writing this review now - sections appear in the rail as each one lands.",
  );

  if (pull.draft.progress.percent !== null) {
    waiting.querySelector(".empty-inner").append(progressBar(pull.draft.progress.percent));
  }

  return waiting;
}

function withAction(empty, label, onClick) {
  const button = document.createElement("button");

  button.className = "ghost";
  button.textContent = label;
  button.addEventListener("click", onClick);
  empty.querySelector(".empty-inner").append(button);

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
