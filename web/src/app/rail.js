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
  CHEVRON_ICON,
  COPY_ICON,
  COPIED_ICON,
  REDRAFT_ICON,
} from "./dom.js";
import { button } from "../ui/button.js";
import { render, restyle } from "../ui/render.js";
import { webUrl } from "../domain/url.js";

/**
 * Fold the pane's content away, or bring it back. View-only state kept on the
 * app beside app.filter and app.editing, so a redraw remembers it without a
 * second place to keep it in step.
 *
 * @param {object} app the application
 * @returns {boolean} the new state
 */
export function togglePaneCollapsed(app) {
  app.paneCollapsed = !app.paneCollapsed;

  return app.paneCollapsed;
}

/**
 * Draw the whole left pane.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function drawRail(app) {
  drawPaneBar(app);
  drawBlurb(app);
  drawSections(app);
  drawKinds(app);
  drawFiles(app);
}

/**
 * The mobile-only bar above the pane's content.
 *
 * It draws on every platform - the description is cheap and #pane-toggle
 * matters nowhere the bar itself is display:none - rather than branching on
 * viewport width, which is a thing CSS already decided and JS has no business
 * deciding again.
 *
 * @param {object} app the application
 * @returns {void}
 */
function drawPaneBar(app) {
  const collapsed = Boolean(app.paneCollapsed);
  const pane = document.querySelector(".pane");

  if (pane) pane.classList.toggle("is-collapsed", collapsed);

  const label = collapsed ? "Show the review panel" : "Hide the review panel";
  const toggle = restyle(
    button({ role: "icon", icon: CHEVRON_ICON, pressed: collapsed, title: label }),
    find("pane-toggle"),
  );

  toggle.setAttribute("aria-label", label);
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

  const address = webUrl(pull.url);

  const line = document.createElement("span");
  line.className = "pull-line";
  line.append(pullName(pull, address));

  // Nothing to copy, so nothing offering to. A button that put a url the
  // reader cannot follow on their clipboard would be offering a dead end.
  if (address) line.append(copyButton(address));

  // Only where there is a document to throw away. With nothing written yet the
  // pull request is already waiting to be picked up, and a button offering to
  // ask for that again would be offering nothing.
  if (pull.draft) line.append(redraftButton(app, pull));

  provenance.append(line);

  inner.append(provenance);
  blurb.append(inner);
}

/**
 * Which pull request this is, as a link where there is one to follow.
 *
 * The url comes out of a draft, and a draft is written by an agent reading
 * somebody else's branch. Anything but an http(s) address is named rather than
 * linked: the reader still sees which pull request they are reading, and a
 * scheme the browser would run as code never reaches an href. A link drawn
 * over a url nothing can follow would only be a lie the reader clicks.
 *
 * @param {object} pull the pull request being read
 * @param {string} address its url, or "" when it is not one a link may follow
 * @returns {HTMLElement} the anchor, or the same words as plain text
 */
function pullName(pull, address) {
  const words = `${pull.repo}#${pull.number}`;

  if (!address) return element("span", "summary-meta mono", words);

  const link = document.createElement("a");

  link.className = "summary-meta mono pull-link";
  link.href = address;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = words;

  return link;
}

/**
 * Put the pull request's url on the clipboard.
 *
 * @param {string} address the url, already checked
 * @returns {HTMLElement} the button
 */
function copyButton(address) {
  const copy = render(
    button({ role: "icon", icon: COPY_ICON, title: "Copy the pull request url" }),
  );

  copy.classList.add("copy-url");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(address);

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

  return copy;
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
  const again = render(
    button({
      role: "icon",
      icon: REDRAFT_ICON,
      arms: true,
      title: "Delete this draft, so this pull request is reviewed again",
    }),
  );

  again.classList.add("clear-review");
  again.setAttribute("aria-label", "Review again");

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
  } else if (pull) {
    // Mirrors the word the queue popover already uses for the same absence
    // (stateOf, header.js): nothing has started, which is not what isDrafting
    // means and not what an empty pane would otherwise say by saying nothing.
    rows.append(element("div", "rail-waiting", "not started"));
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
