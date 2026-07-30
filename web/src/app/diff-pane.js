// The diff, with each finding sitting under the line it is about.

import { parsePatch } from "../domain/diff.js";
import { renderBody } from "../domain/render.js";
import { element, find } from "./dom.js";
import { addBox, findingCard } from "./findings.js";

/**
 * Draw the diff pane.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function drawDiff(app) {
  const diff = find("diff");
  const pull = app.selected;

  diff.replaceChildren();

  if (!pull) return;

  const draft = pull.draft;
  const filter = app.filter;
  const filtered = Boolean(filter.section || filter.kind || filter.path);
  const showing = app.queries.findingsMatching(app.source, pull, filter);
  const readOnly = app.queries.isPosted(app.source, pull);

  // A lens can carry its own written analysis, not just the findings it
  // anchors - shown once, above the diff it filters to.
  if (filter.section) {
    const section = draft?.sections.find((candidate) => candidate.key === filter.section);

    if (section?.body) {
      const body = document.createElement("div");
      body.className = "lens-body lens-note";
      body.innerHTML = renderBody(section.body);
      diff.append(body);
    }
  }

  // A clean lens is a statement, not a diff to scroll: say so and stop. A file
  // with no comments needs no banner - its patch speaks for itself.
  if (draft && filtered && !filter.path && !showing.length) {
    const label =
      draft.sections.find((section) => section.key === filter.section)?.label ||
      filter.section ||
      filter.kind;

    const empty = document.createElement("div");
    empty.className = "filter-empty";
    empty.append(
      element("div", "title", `Nothing flagged in ${label}.`),
      element("div", "text", "This section ran clean - no comments were drafted against it."),
    );

    diff.append(empty);

    return;
  }

  for (const file of app.files) {
    if (filter.path && file.filename !== filter.path) continue;

    const findings = showing.filter((finding) => finding.path === file.filename);

    // A section or theme filter hides whole files rather than showing them
    // empty: the point of the filter is to see only what it matched.
    if ((filter.section || filter.kind) && !findings.length) continue;

    diff.append(fileBlock(app, pull, file, findings, readOnly));
  }
}

function fileBlock(app, pull, file, findings, readOnly) {
  const state = app.queries.fileState(app.source, pull, file.filename);
  const isViewed = Boolean(state.viewedAt);
  const isFolded = Boolean(state.collapsedAt);
  const isCollapsed = isFolded || isViewed;

  const block = document.createElement("div");
  block.className = `diff-file${isViewed ? " is-viewed" : ""}`;

  const head = document.createElement("button");
  head.className = "diff-head";
  head.append(
    element("span", "caret", isCollapsed ? "▸" : "▾"),
    element("span", "", file.filename),
    element("span", "adds", `+${file.additions}`),
    element("span", "dels", `−${file.deletions}`),
    element("span", "spacer", ""),
  );
  head.addEventListener("click", () => {
    app.commands.collapseFile(app.source, pull, file.filename, !isFolded);
    app.reselect();
  });

  const tick = document.createElement("span");
  tick.className = "viewed";
  tick.setAttribute("role", "button");
  tick.setAttribute("aria-pressed", String(isViewed));
  tick.append(element("span", "box", isViewed ? "✓" : ""), element("span", "", "viewed"));
  tick.addEventListener("click", (event) => {
    // The header toggles collapse; the tick must not do both.
    event.stopPropagation();
    app.commands.markFile(app.source, pull, file.filename, !isViewed);
    app.reselect();
  });

  head.append(tick);
  block.append(head);

  if (isCollapsed) return block;

  const hunks = parsePatch(file.patch);

  for (const hunk of hunks) {
    block.append(element("div", "hunk-head", hunk.header));

    for (const line of hunk.lines) {
      const anchored = findings.filter((finding) => finding.line === line.newLine);

      const row = document.createElement("div");
      row.className = `line ${line.kind}${anchored.length ? " anchored" : ""}`;

      const gutter = element("span", "new", line.newLine === null ? "" : String(line.newLine));

      // Only the new side can carry a comment: a deleted line is not in the
      // file the review is about.
      if (line.newLine !== null) {
        gutter.title = "Comment on this line";
        gutter.addEventListener("click", () => {
          app.addingAt = { path: file.filename, line: line.newLine, body: "", focus: true };
          app.changed();
        });
      }

      row.append(
        element("span", "old", line.oldLine === null ? "" : String(line.oldLine)),
        gutter,
        element("span", "text", line.text),
      );
      block.append(row);

      for (const finding of anchored) {
        block.append(findingCard(app, pull, finding, { actions: !readOnly }));
      }

      if (app.addingAt && app.addingAt.path === file.filename && app.addingAt.line === line.newLine) {
        block.append(addBox(app, pull));
      }
    }
  }

  // A finding whose line is not in the patch still has to be readable, or
  // dropping it would be impossible.
  const shown = new Set(hunks.flatMap((hunk) => hunk.lines.map((line) => line.newLine)));

  for (const finding of findings.filter((candidate) => !shown.has(candidate.line))) {
    block.append(findingCard(app, pull, finding, { actions: !readOnly }));
  }

  const hint = element("div", "add-hint", "");
  hint.append(
    element("span", "plus", "+"),
    element("span", "", "add your own comment - click any line number"),
  );
  block.append(hint);

  return block;
}
