// The left pane: what this review is, and every way into it.
//
// There is deliberately no diff row. The diff is reached by picking a file or
// by following a finding's anchor, both of which say which file they mean; a
// bare "Diff" row would only ever mean "all of it", which is the one thing
// nobody wants to read.

import {
  GLYPH,
  age,
  arm,
  element,
  find,
  say,
  tabRow,
  worstTone,
  COPY_ICON,
  COPIED_ICON,
  REDRAFT_ICON,
} from "./dom.js";

/**
 * Draw the whole left pane.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function drawRail(app) {
  drawBlurb(app);
  drawSections(app);
  drawKinds(app);
  drawFiles(app);
}

function drawBlurb(app) {
  const blurb = find("blurb");
  const pull = app.selected;

  blurb.replaceChildren();
  find("blurb-head").hidden = !pull;

  if (!pull) return;

  const inner = document.createElement("div");
  inner.className = "rail rail-summary";

  if (pull.draft?.summary) inner.append(element("div", "summary", pull.draft.summary));

  const provenance = document.createElement("div");
  provenance.className = "provenance";
  provenance.append(
    element(
      "span",
      "summary-meta mono",
      [pull.author, pull.createdAt ? `opened ${age(pull.createdAt)} ago` : null]
        .filter(Boolean)
        .join(" · "),
    ),
  );

  const link = document.createElement("a");
  link.className = "summary-meta mono pull-link";
  link.href = pull.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = `${pull.repo}#${pull.number}`;

  const copy = document.createElement("button");
  copy.className = "copy-url";
  copy.title = "Copy the pull request url";
  copy.innerHTML = COPY_ICON;
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pull.url);

      // The button itself says it worked, right where the eye already is.
      copy.classList.add("is-copied");
      copy.innerHTML = COPIED_ICON;

      setTimeout(() => {
        if (!copy.isConnected) return;

        copy.classList.remove("is-copied");
        copy.innerHTML = COPY_ICON;
      }, 1400);
    } catch {
      say("could not reach the clipboard", "error");
    }
  });

  const line = document.createElement("span");
  line.className = "pull-line";
  line.append(link, copy);

  // Only where there is a document to throw away. With nothing written yet the
  // pull request is already waiting to be picked up, and a button offering to
  // ask for that again would be offering nothing.
  if (pull.draft) line.append(redraftButton(app, pull));

  provenance.append(line);

  inner.append(provenance);
  blurb.append(inner);
}

/**
 * Throw this review away and wait for another.
 *
 * Two clicks, because it is not undoable: the draft it deletes is the only copy
 * and the one that replaces it is written from scratch. It sits beside the link
 * and the copy button because those three are what the reader does with the
 * pull request itself rather than with anything in it.
 *
 * @param {object} app the application
 * @param {object} pull the pull request being read
 * @returns {HTMLElement} the button
 */
function redraftButton(app, pull) {
  const again = document.createElement("button");

  again.className = "clear-review";
  again.title = "Delete this draft, so this pull request is reviewed again";
  again.setAttribute("aria-label", "Review again");
  again.innerHTML = REDRAFT_ICON;

  const restore = () => {
    again.innerHTML = REDRAFT_ICON;
  };

  again.addEventListener("click", async () => {
    if (!arm(again, "Delete?", restore)) return;

    try {
      await app.clearDraft();
      // Nothing is under way, so the words do not claim one is. The next sweep
      // is what picks this up, and it is not this app's to start or to time.
      say(`draft cleared - #${pull.number} goes back for review`, "ok");
    } catch (failure) {
      say(failure.message, "error");
      restore();
    }
  });

  return again;
}

function drawSections(app) {
  const analysis = find("analysis");
  const rows = document.createElement("div");

  analysis.replaceChildren();
  rows.className = "rail";

  const pull = app.selected;
  const draft = pull?.draft;
  // Nothing is attached on a first run, and a reading mode is a thing a
  // source has rather than a thing the app has.
  const onlyFlagged = Boolean(app.source) && app.queries.isFlaggedOnly(app.source);

  if (draft) {
    rows.append(
      tabRow({
        active: app.tab === "summary" && !app.filter.section && !app.filter.kind,
        tone: "neutral",
        glyph: "☰",
        label: "Summary",
        count: "",
        onClick: () => app.show("summary"),
      }),
    );

    for (const section of draft.sections) {
      const active = app.filter.section === section.key;
      const count = app.queries.findingsMatching(app.source, pull, {
        section: section.key,
      }).length;

      // Flagged-only trims the rail to lenses with something to read - the open
      // one stays, or the filter would strand itself.
      if (onlyFlagged && !count && !active) continue;

      rows.append(
        tabRow({
          active,
          tone: section.color,
          glyph: GLYPH[section.color],
          label: section.label,
          count: String(count),
          onClick: () => app.show("summary", { section: section.key }),
        }),
      );
    }

    const { note, scenarios } = draft.qa;

    if (note || scenarios.length) {
      const failed = scenarios.some((run) => run.verdict === "fail");
      const tone = failed ? "critical" : scenarios.length ? "ok" : "neutral";

      rows.append(
        tabRow({
          active: app.tab === "qa",
          tone,
          glyph: GLYPH[tone],
          label: "👓 QA evidence",
          count: "",
          onClick: () => app.show("qa"),
        }),
      );
    }
  }

  analysis.append(rows);
}

/**
 * The themes rail - one row per coined finding kind, as a filter.
 */
function drawKinds(app) {
  const list = find("kinds");
  const pull = app.selected;

  list.replaceChildren();

  const kinds = pull ? app.queries.kindsForPull(app.source, pull) : [];

  find("kinds-head").hidden = !kinds.length;

  for (const { kind, count, color } of kinds) {
    list.append(
      tabRow({
        active: app.filter.kind === kind,
        tone: color,
        glyph: GLYPH[color],
        label: kind,
        count: String(count),
        onClick: () => app.show("summary", { kind }),
      }),
    );
  }
}

function drawFiles(app) {
  const list = find("files");
  const pull = app.selected;

  list.replaceChildren();
  find("files-head").hidden = !app.files.length;
  find("file-count").textContent = app.files.length ? String(app.files.length) : "";

  // The toggle only means something once there is a draft to flag files.
  const draft = Boolean(pull?.draft);
  const onlyFlagged = Boolean(app.source) && app.queries.isFlaggedOnly(app.source) && draft;
  const toggle = find("files-flagged");

  toggle.hidden = !draft;
  toggle.setAttribute(
    "aria-pressed",
    String(Boolean(app.source) && app.queries.isFlaggedOnly(app.source)),
  );

  for (const file of app.files) {
    const active = app.filter.path === file.filename;
    const anchored = pull
      ? app.queries.findingsMatching(app.source, pull, { path: file.filename })
      : [];

    // The open file stays listed however the toggle is set, or hiding it would
    // strand the filter with no way to see or clear it.
    if (onlyFlagged && !anchored.length && !active) continue;

    const row = document.createElement("button");
    row.className = "file";
    row.setAttribute("aria-pressed", String(active));
    row.append(
      element("span", "path", file.filename),
      element("span", "spacer", ""),
      element("span", "adds", `+${file.additions}`),
      element("span", "dels", `−${file.deletions}`),
    );

    if (anchored.length) {
      // The badge carries the tone of the worst finding on the file, so an
      // amber question does not read as a red blocker from the list.
      row.append(element("span", `n is-${worstTone(anchored)}`, String(anchored.length)));
    }

    row.addEventListener("click", () => app.show("diff", { path: file.filename }));

    list.append(row);
  }

  // An empty list under an active filter looks like a bug, not a filter. Say
  // what happened and offer the way out in place.
  if (onlyFlagged && app.files.length && !list.children.length) {
    const hint = document.createElement("button");
    hint.className = "file filter-hint";
    hint.append(
      element("span", "path", `${app.files.length} files hidden - nothing is flagged yet`),
      element("span", "spacer", ""),
      element("span", "show", "show all"),
    );
    hint.addEventListener("click", () => {
      app.commands.showFlaggedOnly(app.source, false);
      app.changed();
    });
    list.append(hint);
  }
}
