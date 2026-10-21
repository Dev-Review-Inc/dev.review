// The board: every pull request on the queue, and the recently dismissed, as
// cards in columns by state. A card opens in place onto its findings; its
// title opens it in the reader.

import { element, find, say } from "./dom.js";
import { VERDICT_TONE } from "./footer.js";
import { boardColumns, findingsByKind, firstLine } from "./board-layout.js";

/**
 * Show the board or the reader, and draw the board when it is the one shown.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function drawBoard(app) {
  const board = find("board");
  const toggle = find("board-button");

  toggle.setAttribute("aria-pressed", String(Boolean(app.board)));
  board.hidden = !app.board;
  document.querySelector("main").hidden = Boolean(app.board);

  if (!app.board) return;

  board.replaceChildren(
    ...boardColumns([...app.queue(), ...app.dismissed()]).map((column) => drawColumn(app, column)),
  );
}

function drawColumn(app, column) {
  const node = element("section", "board-column", "");
  node.dataset.state = column.key;

  const head = element("div", "board-column-head mono", "");
  head.append(element("span", "", column.key), element("span", "board-count", String(column.entries.length)));

  node.append(head, ...column.entries.map((entry) => drawCard(app, entry)));

  return node;
}

function drawCard(app, entry) {
  const card = element("article", "board-card", "");
  card.dataset.key = entry.key;

  const open = app.boardOpen.has(entry.key);
  const findings = entry.draft?.findings || [];
  const verdict = entry.draft?.verdict || "";

  const top = element("div", "board-card-top", "");
  top.append(element("span", "board-repo mono", `${entry.owner}/${entry.repo}#${entry.number}`), element("span", "spacer", ""));
  if (verdict) {
    top.append(element("span", `verdict-badge mono is-${VERDICT_TONE[verdict] || "neutral"}`, verdict.replace("_", " ")));
  }

  const title = element("button", "board-title", entry.title || entry.key);
  title.addEventListener("click", () => app.select(entry).catch((failure) => say(failure.message, "error")));

  const expand = element("button", "board-expand mono", `${open ? "▾" : "▸"} ${findings.length} finding${findings.length === 1 ? "" : "s"}`);
  expand.setAttribute("aria-expanded", String(open));
  expand.disabled = !findings.length;
  expand.addEventListener("click", () => {
    if (open) app.boardOpen.delete(entry.key);
    else app.boardOpen.add(entry.key);

    app.changed();
  });

  const meta = element("div", "board-card-meta", "");
  meta.append(element("span", "board-author", entry.author || ""), element("span", "spacer", ""), expand);

  card.append(top, title, meta);

  if (open) card.append(...findingsByKind(findings).map(drawKind));

  return card;
}

function drawKind(group) {
  const node = element("div", "board-kind", "");

  node.append(element("div", "board-kind-name mono", group.kind || "other"));

  for (const finding of group.findings) {
    const card = element("div", "board-finding", "");

    card.append(
      element("div", "board-finding-at mono", `${finding.path}:${finding.line}`),
      element("div", "board-finding-body", firstLine(finding.body)),
    );
    node.append(card);
  }

  return node;
}
