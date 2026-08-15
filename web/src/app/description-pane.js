// The proposed rewrite of a ticket's body, hunk by hunk.
//
// The agent proposes a whole replacement body; the differ cuts that into hunks
// against the live ticket, and the reader keeps or rejects each one. Below the
// hunks sits what would actually be written: the kept hunks applied to the live
// body, until the reader writes their own words over the top. The body is shown
// verbatim rather than rendered, because it is about to be written verbatim.

import { applyHunks, diffText } from "../domain/text-diff.js";
import { element, emptyState, find } from "./dom.js";

/**
 * What posting would do to the ticket's description.
 *
 * One computation for the pane, the footer's sheet and the send itself, so the
 * preview can never promise a body the post would not write.
 *
 * @param {object} app the application
 * @returns {{changed: boolean, kept: number, total: number, body: string}} the plan
 */
export function descriptionPlan(app) {
  const pull = app.selected;
  const proposed = pull?.draft?.description || "";

  if (!proposed || !app.issue) return { changed: false, kept: 0, total: 0, body: "" };

  const hunks = diffText(app.issue.body, proposed);
  const rejected = app.queries.rejectedHunks(app.source, pull);
  const edited = app.queries.descriptionFor(app.source, pull);
  const body = edited === null ? applyHunks(app.issue.body, hunks, [...rejected]) : edited;

  return {
    changed: body !== app.issue.body,
    kept: hunks.filter((hunk) => !rejected.has(hunk.id)).length,
    total: hunks.length,
    body,
  };
}

/**
 * Draw the description pane.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function drawDescription(app) {
  const pane = find("description");
  const editor = find("description-editor");
  const pull = app.selected;

  pane.replaceChildren();
  editor.hidden = !app.editingDescription;

  if (!pull?.draft?.description) {
    app.editingDescription = false;
    editor.hidden = true;

    return;
  }

  // A body that never arrived is refused rather than diffed against "": a diff
  // against nothing reads as a proposal to delete the whole ticket.
  if (!app.issue) {
    app.editingDescription = false;
    editor.hidden = true;
    pane.append(
      emptyState(
        "⚠",
        "The live ticket could not be fetched.",
        `${app.issueProblem || "the destination did not say why"}. The proposal rewrites the ticket as it stands, and what it stands at is not here to diff against.`,
      ),
    );

    return;
  }

  const hunks = diffText(app.issue.body, pull.draft.description);
  const rejected = app.queries.rejectedHunks(app.source, pull);
  const posted = app.queries.isPosted(app.source, pull);

  for (const hunk of hunks) {
    pane.append(hunkBlock(app, pull, hunk, rejected.has(hunk.id), posted));
  }

  if (app.editingDescription) return;

  pane.append(resultBox(app, pull, descriptionPlan(app), posted, hunks.length));
}

function hunkBlock(app, pull, hunk, isRejected, readOnly) {
  const block = document.createElement("div");

  block.className = `diff-file description-hunk${isRejected ? " is-rejected" : ""}`;

  const head = document.createElement("div");

  head.className = "hunk-head";
  head.append(element("span", "", hunk.header), element("span", "spacer", ""));

  if (readOnly) {
    if (isRejected) head.append(element("span", "", "rejected"));
  } else {
    const toggle = document.createElement("button");

    toggle.className = "hunk-toggle";
    toggle.textContent = isRejected ? "Restore" : "Reject";
    toggle.addEventListener("click", () => {
      if (isRejected) app.commands.restoreHunk(app.source, pull, hunk.id);
      else app.commands.rejectHunk(app.source, pull, hunk.id);

      app.reselect();
    });

    head.append(toggle);
  }

  block.append(head);

  // The rows live in their own box so rejection can fade them as one, leaving
  // the head - and its Restore button - at full strength.
  const lines = document.createElement("div");

  lines.className = "hunk-lines";

  for (const line of hunk.lines) {
    const row = document.createElement("div");

    row.className = `line ${line.kind}`;
    row.append(
      element("span", "old", line.oldLine === null ? "" : String(line.oldLine)),
      element("span", "new", line.newLine === null ? "" : String(line.newLine)),
      element("span", "text", line.text),
    );
    lines.append(row);
  }

  block.append(lines);

  return block;
}

/**
 * What would be written, which is also the way into writing it by hand.
 *
 * The same gesture as the summary: click to edit, leave to keep.
 */
function resultBox(app, pull, plan, posted, total) {
  const box = document.createElement("div");

  box.className = "summary-box description-result";

  const edited = app.queries.descriptionFor(app.source, pull) !== null;

  if (!plan.changed && !edited) {
    box.append(
      element("div", "title", "Nothing would change."),
      element(
        "div",
        "text",
        total
          ? "Every proposed change is rejected, so the ticket keeps its body."
          : "The proposed description matches the ticket as it stands.",
      ),
    );
  } else {
    box.append(element("div", "head mono", edited ? "final body - yours" : "final body"));
    box.append(element("div", "body", plan.body));
  }

  if (edited && !posted) {
    const reset = document.createElement("button");

    reset.className = "description-reset";
    reset.textContent = "use the kept changes instead";
    reset.addEventListener("click", (event) => {
      event.stopPropagation();
      app.commands.resetDescription(app.source, pull);
      app.reselect();
    });
    box.append(reset);
  }

  if (posted) return box;

  box.setAttribute("role", "button");
  box.title = "Click to write the body yourself";
  box.addEventListener("click", () => openDescriptionEditor(app));

  return box;
}

/**
 * Put the cursor in the ticket body, which is how rewriting one by hand begins.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function openDescriptionEditor(app) {
  const pull = app.selected;

  if (!pull?.draft?.description || !app.issue || app.editingDescription) return;
  if (app.queries.isPosted(app.source, pull)) return;

  const editor = find("description-editor");

  editor.value = descriptionPlan(app).body;
  app.editingDescription = true;
  app.changed();

  queueMicrotask(() => {
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  });
}

/**
 * Keep what was typed and go back to reading it.
 *
 * An untouched box records nothing, so the hunk controls keep deciding the
 * body until the reader actually changes a word.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function closeDescriptionEditor(app) {
  if (!app.editingDescription) return;

  const pull = app.selected;

  app.editingDescription = false;

  if (!pull?.draft?.description || !app.issue) {
    app.changed();

    return;
  }

  const value = find("description-editor").value;

  if (value !== descriptionPlan(app).body) {
    app.commands.editDescription(app.source, pull, value);
  }

  app.reselect();
}
