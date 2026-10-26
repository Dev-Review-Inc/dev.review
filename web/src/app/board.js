// The board: every pull request on the queue, and the recently dismissed, as
// cards in columns by state. A card opens in place onto its findings; its
// title opens it in the reader.

import { CLOSE_ICON, element, find, say } from "./dom.js";
import { VERDICT_TONE } from "./footer.js";
import { copyButton } from "./rail.js";
import { AgentChat } from "./agent-chat.js";
import { boardColumns, findingsByKind, firstLine } from "./board-layout.js";
import { button } from "../ui/button.js";
import { render } from "../ui/render.js";
import { resumeCommand } from "../domain/draft.js";
import { draftPath } from "../domain/draft-path.js";

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

  // The footer acts on the review in the reader; with none on screen, only
  // its status line stays.
  for (const id of ["post-split", "consequence", "staged", "counts"]) find(id).hidden = Boolean(app.board);

  if (!app.board) return;

  const entries = [...app.queue(), ...app.dismissed()];
  const chatting = entries.find((entry) => entry.key === app.boardChat);
  const columns = element("div", "board-columns", "");

  // A chat redraws on every line it streams, so the columns keep their place.
  const left = board.querySelector(".board-columns")?.scrollLeft || 0;
  const tops = new Map([...board.querySelectorAll(".board-column")].map((node) => [node.dataset.state, node.scrollTop]));

  columns.append(...boardColumns(entries).map((column) => drawColumn(app, column)));
  board.classList.toggle("is-chatting", Boolean(chatting));
  board.replaceChildren(columns, ...(chatting ? [drawChat(app, chatting)] : []));

  columns.scrollLeft = left;
  for (const node of columns.children) node.scrollTop = tops.get(node.dataset.state) || 0;

  const log = board.querySelector(".board-chat-log");

  if (log) log.scrollTop = log.scrollHeight;
}

/**
 * The drawer for talking to the agent that wrote a card's draft.
 *
 * @param {object} app the application
 * @param {object} entry the card being chatted about
 * @returns {HTMLElement} the drawer
 */
function drawChat(app, entry) {
  const drawer = element("aside", "board-chat", "");
  drawer.id = "board-chat";

  const head = element("div", "board-chat-head", "");
  const close = render(button({ role: "icon", icon: CLOSE_ICON, title: "Close the chat" }));

  close.classList.add("board-chat-close");
  close.addEventListener("click", () => {
    app.boardChat = null;
    app.changed();
  });
  head.append(element("span", "board-repo mono", `agent · ${entry.owner}/${entry.repo}#${entry.number}`), element("span", "spacer", ""), close);
  drawer.append(head);

  const agent = entry.draft?.agent;

  if (!agent) {
    drawer.append(element("p", "board-chat-note", "No agent to talk to: this draft does not name the one that wrote it."));
    return drawer;
  }

  const elsewhere = (words) => {
    const note = element("p", "board-chat-note", words);

    note.append(copyButton(resumeCommand(agent), "Copy the command that resumes the agent that wrote this"));
    drawer.append(note);

    return drawer;
  };

  if (!app.agentRunner) return elsewhere("Talking to the agent needs the desktop app. Resume it in a terminal instead.");
  if (typeof app.adapter?.absolute !== "function") {
    return elsewhere("The agent can edit only a draft in a folder on this computer. Resume it in a terminal instead.");
  }

  const chat = chatFor(app, entry);

  if (chat.elsewhere) return elsewhere("The agent ran on another machine. Resume it there.");

  const log = element("div", "board-chat-log", "");

  log.append(...chat.said.map((said) => element("div", `board-chat-line is-${said.who}${said.who === "tool" ? " mono" : ""}`, said.text)));

  const input = element("textarea", "board-chat-input", "");

  input.dataset.focusKey = "board-chat";
  input.rows = 2;
  input.value = chat.typing;
  input.disabled = chat.busy;
  input.placeholder = chat.busy ? "The agent is working…" : "Ask the agent about its review";
  input.addEventListener("input", () => (chat.typing = input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

    event.preventDefault();
    chat.send(input.value);
  });

  const act = chat.busy
    ? button({ role: "ghost", compact: true, label: "Cancel", onClick: () => chat.cancel() })
    : button({ role: "primary", compact: true, label: "Send", onClick: () => chat.send(input.value) });

  const form = element("div", "board-chat-form", "");

  form.append(input, render(act));
  drawer.append(log, form);

  return drawer;
}

function chatFor(app, entry) {
  const key = entry.key;
  const id = `${app.source?.id}|${key}`;

  if (!app.chats.has(id)) {
    app.chats.set(
      id,
      new AgentChat({
        runner: app.agentRunner,
        commands: app.commands,
        queries: app.queries,
        source: app.source,
        entry: () => [...app.queue(), ...app.dismissed()].find((found) => found.key === key) || entry,
        review: app.adapter.absolute(draftPath(entry.owner, entry.repo, entry.number)),
        changed: () => app.changed(),
      }),
    );
  }

  return app.chats.get(id);
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
  const card = element("article", `board-card${app.boardChat === entry.key ? " is-chatting" : ""}`, "");
  card.dataset.key = entry.key;
  card.tabIndex = 0;

  // The card, away from its buttons, opens the chat with its agent.
  const choose = () => {
    app.boardChat = app.boardChat === entry.key ? null : entry.key;
    app.changed();
  };

  card.addEventListener("click", (event) => {
    if (!event.target.closest("button")) choose();
  });
  card.addEventListener("keydown", (event) => {
    if (event.target === card && event.key === "Enter") choose();
  });

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
