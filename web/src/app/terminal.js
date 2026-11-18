// The agent that wrote the selected draft, in a terminal: `claude --resume` in
// its own folder, drawn by xterm.js in the dock beside the code.
//
// The dock is in index.html, outside everything render() redraws. It shows
// folded beside any item whose agent it can resume and loads nothing until
// unfolded. Folding keeps claude running, and so does selecting another item:
// its dock is put aside and comes back as it was. A dock out of sight goes
// once its terminal has been quiet for QUIET ms. Unfolding turns the header's
// mic off: both resume the session, and two writers fork it.

import { element } from "./dom.js";
import { resizableDock } from "./resize.js";
import { finishVoice, sharedAgent } from "./voice.js";

const QUIET = 30_000;

// Every dock drawn, by item key; `current` is the one in sight.
const docks = new Map();
let current = null;

/**
 * Draw the dock for the item selected.
 *
 * @param {object} app the application; `app.terminal` is the opener
 * @returns {void}
 */
export function drawTerminal(app) {
  const dock = document.getElementById("terminal-dock");
  const agent = app.terminal ? app.selected?.draft?.agent : null;
  const key = agent ? app.selected.key : null;

  if (current?.key === key) return;

  current?.aside();
  current = key ? docks.get(key) || mount(app, dock, key, sharedAgent(app)) : null;
  if (current) docks.set(key, current);
  dock.hidden = !key;
  if (current) current.show();
  else dock.replaceChildren();
}

/**
 * Stop a running terminal and fold the dock, for the mic to take over.
 *
 * @returns {void}
 */
export function stopTerminal() {
  current?.stop();
}

/**
 * Take every dock down, in sight or not.
 *
 * @returns {void}
 */
export function closeTerminals() {
  for (const it of docks.values()) it?.teardown();
  docks.clear();
  current = null;
}

// The folded dock for one agent: what stops its terminal, and what takes it
// down. Voice moves `agent.session` on, so the terminal resumes where the talk
// left off.
function mount(app, dock, key, agent) {
  const head = element("div", "terminal-head", "");
  const host = element("div", "terminal-host", "");
  const grip = element("div", "grip terminal-grip", "");
  const fold = document.createElement("button");
  const title = element("span", "terminal-title mono", "");
  let running = null;
  let quiet = null;
  let inSight = true;
  let shut = true;

  const teardown = () => {
    clearTimeout(quiet);
    running?.teardown();
    running = null;
    docks.delete(key);
  };
  // Out of sight, each word from claude puts the reaping off again.
  const heard = () => {
    if (inSight) return;
    clearTimeout(quiet);
    quiet = setTimeout(teardown, QUIET);
  };

  const begin = () => {
    const it = start(app, host, agent, () => running === it && (running = null), heard);

    return it;
  };

  const folded = (yes) => {
    shut = yes;
    if (yes) dock.classList.add("collapsed");
    else dock.classList.remove("collapsed");
    fold.textContent = yes ? "‹" : "›";
    fold.title = yes ? "Expand the terminal" : "Collapse the terminal";
    fold.setAttribute("aria-expanded", String(!yes));
  };

  fold.type = "button";
  fold.className = "terminal-fold";
  fold.addEventListener("click", () => {
    const unfolding = dock.classList.contains("collapsed");

    folded(!unfolding);
    if (unfolding && !running) {
      const voice = finishVoice();

      if (voice) {
        const waiting = (running = { teardown() {} });

        voice.then(() => running === waiting && (running = begin()));
      } else running = begin();
    }
    running?.focus?.();
  });
  folded(true);
  resizableDock(grip);
  title.textContent = `claude --resume · ${agent.cwd}`;
  head.append(fold, title);

  return {
    key,
    teardown,
    show() {
      inSight = true;
      clearTimeout(quiet);
      dock.replaceChildren(grip, head, host);
      folded(shut);
    },
    aside() {
      inSight = false;
      if (running) heard();
      else teardown();
    },
    stop() {
      running?.teardown();
      running = null;
      folded(true);
    },
  };
}

// claude in xterm, in `host`. `exited` is told when claude stops on its own,
// `heard` each time it writes.
function start(app, host, agent, exited, heard) {
  let term = null;
  let observer = null;
  let pty = null;
  let closed = false;
  let settle;

  host.replaceChildren();
  stylesheet();

  const teardown = () => {
    closed = true;
    clearTimeout(settle);
    observer?.disconnect();
    pty?.close();
    term?.dispose();
    host.replaceChildren();
  };

  (async () => {
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import("../../vendor/xterm.js"),
      import("../../vendor/xterm-addon-fit.js"),
    ]);

    if (closed) return;

    const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    term = new Terminal({
      cursorBlink: true,
      fontFamily: token("--mono"),
      fontSize: 13,
      scrollback: 10000,
      theme: { background: token("--bg"), foreground: token("--text"), cursor: token("--accent"), selectionBackground: token("--hl") },
    });
    const fit = new FitAddon();
    let size = "";

    term.loadAddon(fit);
    term.open(host);

    // Never while the host has no area: fit would size it to one column and
    // claude would redraw at that width.
    const refit = () => {
      if (!host.clientWidth || !host.clientHeight) return;

      fit.fit();

      const now = `${term.cols}x${term.rows}`;

      if (pty && now !== size) pty.resize(term.cols, term.rows);
      size = now;
    };
    observer = new ResizeObserver(() => {
      clearTimeout(settle);
      settle = setTimeout(refit, 100);
    });

    // Fit after layout settles, so claude starts at the width it is drawn at.
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    if (closed) return;
    refit();
    observer.observe(host);
    term.onData((data) => pty?.write(data));
    term.focus();

    try {
      const asked = { session: agent.session, cwd: agent.cwd, cols: term.cols, rows: term.rows };
      const opened = await app.terminal.open(
        asked,
        (bytes) => {
          if (closed) return;
          term.write(bytes);
          heard();
        },
        (code) => {
          if (closed) return;
          term.write(`\r\n[claude exited${code == null ? "" : ` with ${code}`}; fold and unfold to start it again]\r\n`);
          pty = null;
          exited();
        },
      );

      if (closed) return opened.close();

      // Catch up on any resize made while it opened.
      pty = opened;
      size = `${asked.cols}x${asked.rows}`;
      refit();
    } catch (failure) {
      if (!closed) term.write(`${failure.message}\r\n`);
      exited();
    }
  })().catch((failure) => {
    if (!closed) host.textContent = failure.message;
    exited();
  });

  return { teardown, focus: () => term?.focus() };
}

// xterm's own stylesheet, once, and only once a terminal is wanted.
function stylesheet() {
  if (document.getElementById("xterm-css")) return;

  const link = document.createElement("link");

  link.id = "xterm-css";
  link.rel = "stylesheet";
  link.href = new URL("../../vendor/xterm.css", import.meta.url).href;
  document.head.append(link);
}
