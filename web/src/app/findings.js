// The finding card, which is the same card wherever a comment is shown.
//
// The summary lists them, the diff hangs them under the line they are about,
// and the confirmation sheet previews them read-only. One builder, so what the
// reader approves in the sheet is literally what they read in the pane.

import { parsePatch } from "../domain/diff.js";
import { renderBody } from "../domain/render.js";
import { withPrefix } from "../domain/review.js";
import { arm, element, say } from "./dom.js";
import { includeToggle } from "./include.js";
import { button } from "../ui/button.js";
import { render } from "../ui/render.js";
import { commentWords } from "./words.js";

/**
 * The last few diff lines leading to an anchor, for a card shown away from the
 * diff itself.
 *
 * @param {object} app the application
 * @param {string} path the file
 * @param {number} line the anchor, in the file's new state
 * @returns {object[]} up to three hunk lines ending at the anchor
 */
function snippetFor(app, path, line) {
  const file = app.files.find((candidate) => candidate.filename === path);

  if (!file) return [];

  for (const hunk of parsePatch(file.patch)) {
    const index = hunk.lines.findIndex((candidate) => candidate.newLine === line);

    if (index === -1) continue;

    const lines = hunk.lines.slice(Math.max(0, index - 2), index + 1);

    // Dedented: the card is a quotation, not the file, and deep nesting would
    // only spend its width on leading spaces.
    const indents = lines
      .filter((one) => one.text.trim())
      .map((one) => one.text.match(/^\s*/)[0].length);
    const trim = indents.length ? Math.min(...indents) : 0;

    return lines.map((one) => ({ ...one, text: one.text.slice(trim) }));
  }

  return [];
}

/**
 * Open the diff at a file, from a card that is not in the diff.
 *
 * @param {object} app the application
 * @param {string} path the file to open
 * @returns {void}
 */
function openInDiff(app, path) {
  // show() clears a filter that is picked twice, which is right for the rail
  // and wrong here: an anchor always means "take me there".
  if (app.filter.path === path) {
    app.tab = "diff";
    app.changed();

    return;
  }

  app.show("diff", { path });
}

/**
 * A textarea that keeps what has been typed into it across a redraw.
 *
 * The panes are rebuilt whenever anything changes, including a draft landing
 * under the reader's feet, so an editor's contents live on the app rather than
 * in the element.
 *
 * @param {object} app the application
 * @param {object} holder the state object carrying `body` and `focus`
 * @param {string} key what identifies this editor between redraws
 * @returns {HTMLTextAreaElement} the editor
 */
function editorFor(app, holder, key) {
  const editor = document.createElement("textarea");

  editor.className = "finding-editor mono";
  editor.spellcheck = false;
  editor.value = holder.body;
  editor.dataset.focusKey = key;
  editor.addEventListener("input", () => {
    holder.body = editor.value;
  });

  if (holder.focus) {
    holder.focus = false;
    queueMicrotask(() => {
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    });
  }

  return editor;
}

/**
 * Build the card for one finding.
 *
 * @param {object} app the application
 * @param {object} pull the pull request the finding belongs to
 * @param {object} finding a finding as the reader sees it
 * @param {{snippet?: boolean, actions?: boolean, prefix?: string}} [options] `snippet` brings
 *   the code context along; `actions: false` makes the card read-only, for surfaces
 *   that only preview; `prefix` leads the read-only body with the reader's configured
 *   prefix, for the one surface promising to show exactly what would be sent
 * @returns {HTMLElement} the card
 */
export function findingCard(app, pull, finding, { snippet = false, actions = true, prefix = "" } = {}) {
  const card = document.createElement("div");
  card.className = `finding is-${finding.color}${finding.includedAt ? " is-included" : ""}`;

  const head = document.createElement("div");
  head.className = "finding-head";

  // The anchor is the way from a card to the code it is about.
  const anchor = document.createElement("button");
  anchor.className = "anchor";
  anchor.textContent = `${finding.path}:${finding.line}`;
  anchor.title = "Open this file's diff";
  anchor.addEventListener("click", () => openInDiff(app, finding.path));

  head.append(anchor, element("span", "spacer", ""));

  if (finding.kind) head.append(element("span", `kind is-${finding.color}`, finding.kind));
  if (finding.editedAt) head.append(element("span", "edited mono", "edited"));
  if (finding.postedAt) head.append(element("span", "sent mono", "posted ✓"));

  card.append(head);

  if (snippet) {
    const lines = snippetFor(app, finding.path, finding.line);

    if (lines.length) {
      const pre = document.createElement("pre");
      pre.className = "finding-code mono";

      for (const line of lines) {
        pre.append(element("div", `code-line ${line.kind}`, line.text || " "));
      }

      card.append(pre);
    }
  }

  const body = document.createElement("div");
  body.className = "finding-body";

  if (actions && app.editingFinding && app.editingFinding.id === finding.id) {
    body.append(editorFor(app, app.editingFinding, `finding:${finding.id}`));
    body.append(editorActions(app, pull, finding));
    card.append(body);

    return card;
  }

  const prose = document.createElement("div");
  prose.innerHTML = renderBody(withPrefix(prefix, finding.body));
  body.append(prose);

  if (finding.suggestion) {
    const block = document.createElement("div");
    block.className = "suggestion";
    block.append(element("div", "suggestion-head", "suggested change · committable"));

    const pre = document.createElement("pre");
    pre.textContent = finding.suggestion;
    block.append(pre);

    body.append(block);
  }

  // Already on the destination: nothing here can change that, so nothing pretends to.
  if (actions && finding.postedAt) card.classList.add("is-posted");
  if (actions && !finding.postedAt) body.append(cardActions(app, pull, finding));

  card.append(body);

  return card;
}

function editorActions(app, pull, finding) {
  const actions = document.createElement("div");
  actions.className = "finding-actions";

  const save = render(
    button({
      label: "Save",
      onClick: () => {
        app.commands.editFinding(app.source, pull, finding, app.editingFinding.body);
        app.editingFinding = null;
        app.reselect();
      },
    }),
  );

  const cancel = render(
    button({
      label: "Cancel",
      onClick: () => {
        app.editingFinding = null;
        app.changed();
      },
    }),
  );

  actions.append(save, cancel, element("span", "spacer", ""));

  if (finding.editedAt) {
    const revert = render(
      button({
        label: "Revert to drafted",
        onClick: () => {
          app.commands.resetFinding(app.source, pull, finding);
          app.editingFinding = null;
          app.reselect();
        },
      }),
    );

    actions.append(revert);
  }

  return actions;
}

/**
 * The opt-in control every finding carries: unchecked, and nothing this
 * finding says goes out, until the reader says it should.
 *
 * @param {object} app the application
 * @param {object} pull the pull request the finding belongs to
 * @param {object} finding the finding the toggle is for
 * @returns {HTMLElement} the toggle
 */
function findingInclude(app, pull, finding) {
  const included = Boolean(finding.includedAt);

  return includeToggle(included, () => {
    if (included) {
      app.commands.excludeFinding(app.source, pull, finding);
    } else {
      app.commands.includeFinding(app.source, pull, finding);
    }

    app.reselect();
  });
}

function cardActions(app, pull, finding) {
  const controls = document.createElement("div");
  controls.className = "finding-actions";

  const edit = render(
    button({
      label: "Edit",
      onClick: () => {
        app.editingFinding = { id: finding.id, body: finding.body, focus: true };
        app.changed();
      },
    }),
  );

  const include = findingInclude(app, pull, finding);

  const words = commentWords(app);
  const send = render(button({ label: words.label, title: words.title, arms: true }));

  send.addEventListener("click", async () => {
    if (!arm(send, words.question, words.label)) return;

    send.disabled = true;
    send.textContent = "Posting…";

    try {
      await app.postFinding(finding);
      say(`posted one comment to #${pull.number}`, "ok");
    } catch (failure) {
      say(failure.message, "error");
      send.disabled = false;
      send.textContent = words.label;
    }
  });

  controls.append(edit, send, element("span", "spacer", ""), include);

  // An excluded comment of your own can go entirely - unlike the agent's,
  // which stay readable so what it said is never lost.
  if (!finding.includedAt && finding.mine) {
    const remove = render(
      button({
        label: "Delete",
        role: "danger",
        onClick: () => {
          app.commands.removeFinding(app.source, pull, finding);
          app.reselect();
        },
      }),
    );

    controls.append(remove);
  }

  return controls;
}

/**
 * The box for writing your own comment on a line.
 *
 * @param {object} app the application
 * @param {object} pull the pull request being read
 * @returns {HTMLElement} the box
 */
export function addBox(app, pull) {
  const { path, line } = app.addingAt;

  const box = document.createElement("div");
  box.className = "add-comment";

  box.append(element("div", "card-head", `your comment on ${path}:${line}`));

  const editor = editorFor(app, app.addingAt, `add:${path}:${line}`);
  box.append(editor);

  const actions = document.createElement("div");
  actions.className = "finding-actions";

  const add = render(
    button({
      label: "Add comment",
      onClick: () => {
        const body = app.addingAt.body;

        app.addingAt = null;

        if (!body.trim()) {
          app.changed();

          return;
        }

        app.commands.addFinding(app.source, pull, { path, line, body });
        app.reselect();
      },
    }),
  );

  const cancel = render(
    button({
      label: "Cancel",
      onClick: () => {
        app.addingAt = null;
        app.changed();
      },
    }),
  );

  actions.append(add, cancel);
  box.append(actions);

  return box;
}
