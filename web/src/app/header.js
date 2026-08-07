// The header: what is being read, what is waiting, and the settings panel.
//
// Drafts come from a source and reviews go to a destination. They are separate
// choices, so they are separate groups in one panel rather than one merged
// idea: a team can keep drafts in a bucket and post to GitHub, or keep them on
// disk and post somewhere else, and neither decision constrains the other.
//
// The panel is master–detail: every source and destination on the left, one of
// them opened on the right. The configured state is the resting state - the
// forms only appear for the item being looked at, and nothing saves until the
// footer says so.

import { adapterTypes, chooseFolder } from "../adapters/index.js";
import { destinationTypes } from "../destinations/index.js";
import { age, arm, element, find, initials, say, LEAVE_ICON } from "./dom.js";
import { button } from "../ui/button.js";
import { render, restyle } from "../ui/render.js";
import { leaveWords } from "./words.js";

// What the detail header calls a backend, under the item's name.
const TYPE_WORDS = {
  filesystem: "local folder",
  tauri: "this computer",
  s3: "s3",
  github: "github repo",
  git: "git repo",
};

// Where each backend's full setup page lives on the marketing site - the
// fields here are only ever the ones the form needs, not the CORS rule or the
// token scope a reader hits trouble without. Two adapter types share a page
// because the app already offers them as one option, "a folder on this
// computer" (see adapterTypes() in ../adapters/index.js).
const ADAPTER_DOCS = {
  filesystem: "folder",
  tauri: "folder",
  icloud: "icloud",
  github: "github",
  git: "git",
  s3: "s3",
};

/**
 * A blank source form.
 *
 * @returns {object} the state a source form draws from
 */
export function newSourceSetup() {
  return {
    editing: null,
    name: "",
    type: "",
    values: {},
    handle: null,
    root: "",
    secretsSet: {},
    problem: "",
  };
}

/**
 * Whether a folder has been chosen for this form.
 *
 * @param {object} setup the form's state
 * @returns {boolean} true once either kind of chooser has answered
 */
export function folderChosen(setup) {
  return Boolean(setup.handle || setup.root);
}

/**
 * The folder the form is holding, written the way that backend can write it.
 *
 * A browser handle carries no path, only the name the browser granted, so the
 * name is all there is to show. The desktop app has the real path and showing
 * less of it would hide which of two folders with the same name was chosen.
 *
 * @param {object} setup the form's state
 * @returns {string} the folder, without a trailing separator, "" when none
 */
export function folderPath(setup) {
  if (setup.handle) return setup.handle.name;

  return String(setup.root || "").replace(/[/\\]+$/, "");
}

/**
 * What to call a source whose name the reader has not typed.
 *
 * @param {object} setup the form's state
 * @returns {string} the folder's own name, "" when none is chosen
 */
export function folderName(setup) {
  return folderPath(setup).split(/[/\\]/).pop() || "";
}

/**
 * What a chosen folder adds to the adapter's stored configuration.
 *
 * A path is configuration and is written down. A directory handle is a live
 * object that no log can hold, so it goes to the handle store instead and
 * nothing about it is written here.
 *
 * Editing a source without touching its folder keeps the folder it has, so a
 * rename does not quietly unpoint it. Switching it to another backend does not:
 * that path means nothing to whatever was chosen instead.
 *
 * @param {object} setup the form's state
 * @param {object} [stored] the adapter as it is saved, when one is being edited
 * @returns {object} the configuration to merge, empty when there is nothing to store
 */
export function folderConfig(setup, stored = {}) {
  const root = setup.root || (stored.type === setup.type ? stored.root : "") || "";

  return root ? { root } : {};
}

/**
 * A blank destination form.
 *
 * @returns {object} the state a destination form draws from
 */
export function newDestinationSetup() {
  return { editing: null, label: "", type: "", values: {}, secretsSet: {}, problem: "" };
}

/**
 * Draw the header.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function drawHeader(app) {
  find("source-name").textContent = app.source ? app.source.name : "none";

  drawSettings(app);
  drawQueue(app);
  drawOpen(app);

  const leave = leaveWords(app);
  // An icon rather than a label: this is the one action on the row that is
  // not what a reader came here to do, and a label on it was wide enough to
  // push the title it sits beside onto a second row before the title had
  // given up any of its own space.
  const control = restyle(
    button({ role: "icon", icon: LEAVE_ICON, title: leave.title }),
    find("signout"),
  );

  control.setAttribute("aria-label", leave.label);
  control.hidden = !app.destination;
}

/**
 * Open the sources and destinations panel.
 *
 * Opened without a target, it rests on what is being read, so the reader lands
 * on the source they are using rather than on an empty pane.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function openSetup(app) {
  find("setup-popover").hidden = false;
  find("setup-backdrop").hidden = false;
  find("source-button").setAttribute("aria-expanded", "true");

  if (!app.settingsSelection?.kind) {
    const destination = app.queries.findDestination(app.destinationId);

    if (app.source) {
      focusSource(app, app.source)
        .then(() => app.changed())
        .catch((failure) => say(failure.message, "error"));
    } else if (destination) {
      focusDestination(app, destination)
        .then(() => app.changed())
        .catch((failure) => say(failure.message, "error"));
    }
  }

  app.changed();
}

/**
 * @returns {void}
 */
export function closeSetup() {
  find("setup-popover").hidden = true;
  find("setup-backdrop").hidden = true;
  find("source-button").setAttribute("aria-expanded", "false");
}

/**
 * @param {object} app the application
 * @returns {void}
 */
export function toggleSetup(app) {
  if (find("setup-popover").hidden) openSetup(app);
  else closeSetup();
}

/**
 * @returns {void}
 */
export function closeQueue() {
  find("queue-popover").hidden = true;
  find("queue-backdrop").hidden = true;
  find("queue-button").setAttribute("aria-expanded", "false");
}

/**
 * @param {object} app the application
 * @returns {void}
 */
export function toggleQueue(app) {
  const open = find("queue-popover").hidden;

  find("queue-popover").hidden = !open;
  find("queue-backdrop").hidden = !open;
  find("queue-button").setAttribute("aria-expanded", String(open));
  app.changed();
}

/**
 * Open the panel on a source's detail, ready to be corrected.
 *
 * Exported because a source that cannot be read says so in the pane, and the
 * fix has to be reachable from there rather than only from this panel.
 *
 * @param {object} app the application
 * @param {object} source which source
 * @returns {Promise<void>} when the panel is showing it
 */
export async function editSource(app, source) {
  await focusSource(app, source);
  openSetup(app);
}

// ---- The open pull request

function drawOpen(app) {
  const pull = app.selected;
  const stats = find("head-stats");

  find("head-title").textContent = pull ? pull.title : "";
  stats.replaceChildren();

  if (!pull || !app.files.length) return;

  const added = app.files.reduce((total, file) => total + file.additions, 0);
  const removed = app.files.reduce((total, file) => total + file.deletions, 0);

  const plus = element("span", "", `+${added}`);
  const minus = element("span", "", `−${removed}`);

  plus.style.color = "var(--green)";
  minus.style.color = "var(--red)";

  stats.append(plus, document.createTextNode(" "), minus);
}

// ---- The queue

function drawQueue(app) {
  const list = find("queue");
  const entries = app.queue();
  const ready = entries.filter((entry) => entry.isReady).length;

  list.replaceChildren();

  find("queue-count").textContent = `${ready}/${entries.length} drafted`;
  find("queue-waiting").textContent = entries.length
    ? `${entries.length} to review`
    : "nothing to review";

  const badge = find("queue-ready");
  badge.textContent = ready ? String(ready) : "";
  badge.title = ready ? `${ready} ready to read` : "";
  badge.hidden = !ready;

  // Everything that is not drafted is waiting, and no more can be said than
  // that in one number: some of it is being reviewed now and some of it no
  // agent has picked up, which is a difference each row makes for itself.
  find("queue-foot").textContent = entries.length
    ? `${ready} drafted · ${entries.length - ready} waiting`
    : app.destination
      ? app.destination.emptyQueueHint() || "Nothing has been requested of you here."
      : "No destination is configured, so nothing can be waiting yet.";

  drawDismissed(app);

  for (const entry of entries) {
    list.append(queueRow(app, entry));
  }
}

/**
 * The pull requests taken off the queue, and the way back.
 *
 * Below the queue rather than among them, because these are not waiting on the
 * reader and listing them together would undo the thing dismissing is for. It
 * is absent entirely when nothing has been dismissed lately, so the common case
 * is not asked to carry a heading about a decision nobody made.
 *
 * @param {object} app the running app
 * @returns {void}
 */
function drawDismissed(app) {
  const section = find("dismissed");
  const entries = app.dismissed();

  section.replaceChildren();
  section.hidden = entries.length === 0;

  if (!entries.length) return;

  section.append(
    element("div", "popover-head", `dismissed · ${entries.length}`),
  );

  for (const entry of entries) {
    const line = document.createElement("div");
    line.className = "setup-line";

    // Openable, like every other pull request in this popover. Dismissing
    // answers "I am not reviewing this", which is not "I never want to look
    // at it again" - and restoring it to the queue is a heavier answer than
    // another look asks for.
    const row = document.createElement("button");

    row.className = "setup-row";
    row.type = "button";
    row.title = "Open this pull request without putting it back on the queue";
    row.append(
      element("div", "top", ""),
      element("div", "dir mono", `${entry.owner}/${entry.repo}#${entry.number}`),
    );
    row.firstChild.append(element("span", "name", entry.title));
    row.addEventListener("click", () => {
      closeQueue();
      app.select(entry).catch((failure) => say(failure.message, "error"));
    });

    // `restore` says whatever went wrong itself, so the promise a listener
    // cannot return is one nothing is waiting on rather than one nobody holds.
    const edit = render(
      button({
        label: "Restore",
        compact: true,
        title: "Put this pull request back on the queue",
        onClick: () => restore(app, entry),
      }),
    );

    edit.classList.add("setup-edit");
    line.append(row, edit);
    section.append(line);
  }
}

/**
 * Put a dismissed pull request back on the queue.
 *
 * @param {object} app the application
 * @param {object} entry the dismissed pull request
 * @returns {Promise<void>} when it is back, or has said why it is not
 */
export async function restore(app, entry) {
  try {
    await app.commands.restorePull(app.source, entry);
  } catch (failure) {
    // The row stays in the dismissed list, which is the truth: a restore that
    // was not written down did not happen, and redrawing the pull request onto
    // the queue would put it somewhere it will not be after a reload.
    say(failure.message, "error");

    return;
  }

  app.changed();
}

function queueRow(app, entry) {
  const row = document.createElement("button");

  row.className = `row${entry.isReady ? " is-ready" : ""}`;
  row.setAttribute("aria-current", String(app.selected?.key === entry.key));

  const top = document.createElement("div");
  top.className = "row-top";

  if (entry.isReady) top.append(element("span", "ready-dot", "●"));

  top.append(element("span", "row-title", entry.title));

  const who = document.createElement("span");
  who.className = "who";
  who.append(
    element("span", "avatar", initials(entry.author)),
    element("span", "", `${entry.author} · ${age(entry.updatedAt)}`),
  );

  const meta = document.createElement("div");
  meta.className = "row-meta";
  meta.append(who, element("span", "spacer", ""), stateLabel(entry));

  row.append(
    top,
    element("div", "row-repo", `${entry.owner}/${entry.repo}#${entry.number}`),
    meta,
  );

  const tones = (entry.draft?.sections || []).map((section) => section.color);

  if (tones.length) {
    const bars = document.createElement("div");
    bars.className = "bars";

    for (const tone of tones) bars.append(element("span", `is-${tone}`, ""));

    row.append(bars);
  }

  row.addEventListener("click", () => {
    closeQueue();
    app.select(entry).catch((failure) => say(failure.message, "error"));
  });

  return row;
}

/**
 * What a queue row says about where a pull request has got to.
 *
 * The wording is decided apart from the drawing because it is the whole of what
 * this says: the tone is a colour, and a reader on a screen reader gets none of
 * it. Two of these states are quiet for the same reason, so they share a tone
 * and are told apart by the only thing that carries anywhere, the word.
 *
 * @param {object} entry one entry from the queue
 * @returns {{tone: string, word: string}} the class to tone it with, and what it says
 */
export function stateOf(entry) {
  if (entry.postedAt) return { tone: "posted", word: "posted" };

  // A draft mid-write is the agent still at work, with its own progress note
  // when it wrote one, however much of the draft has landed. Not being ready is
  // not enough to say that: a pull request no agent has claimed is not ready
  // either, and calling that "reviewing" tells the reader work is under way on
  // the one thing in the queue that nothing has started. The queue takes the
  // pane's words for it, because they are describing the same absence.
  if (entry.isDrafting) {
    return { tone: "pending", word: entry.draft.progress.note || "reviewing" };
  }

  if (!entry.isReady) return { tone: "pending", word: "not started" };

  const verdict = entry.draft.verdict || "";
  const words = { APPROVE: "looks good", COMMENT: "comment", REQUEST_CHANGES: "changes" };

  return { tone: verdict.toLowerCase() || "drafted", word: words[verdict] || "drafted" };
}

function stateLabel(entry) {
  const { tone, word } = stateOf(entry);

  return element("span", `state ${tone}`, word);
}

// ---- The settings panel

/**
 * What a backend needs asking for. The adapter declares it, so this form knows
 * nothing about any particular storage.
 */
function fieldsForAdapter(type) {
  return adapterTypes().find((candidate) => candidate.type === type)?.fields || [];
}

/**
 * Put a source into the detail, prefilled from what is stored.
 */
async function focusSource(app, source) {
  const fields = fieldsForAdapter(source.adapter.type);

  app.setup = {
    editing: source,
    name: source.name,
    type: source.adapter.type,
    // Only what is not a credential: a stored secret never reaches the page.
    values: Object.fromEntries(
      fields
        .filter((field) => !field.secret)
        .map((field) => [field.key, source.adapter[field.key] || ""]),
    ),
    handle: null,
    root: "",
    secretsSet: await app.secretsSetFor(source),
    problem: "",
  };
  app.settingsSelection = { kind: "source", id: source.id };
}

async function focusDestination(app, destination) {
  app.destinationSetup = {
    editing: destination,
    label: destination.label || destination.name || "",
    type: destination.type,
    values: {},
    secretsSet: await app.secretsSetFor(destination),
    problem: "",
  };
  app.settingsSelection = { kind: "destination", id: destination.id };
}

/**
 * Begin adding, with blank forms and a pending row in the nav.
 */
function startAdd(app, kind) {
  app.setup = newSourceSetup();
  app.destinationSetup = newDestinationSetup();
  app.settingsSelection = { kind: "add", adding: kind, id: null };
  app.changed();
}

function dropSelection(app) {
  app.setup = newSourceSetup();
  app.destinationSetup = newDestinationSetup();
  app.settingsSelection = { kind: "", id: null };
  app.changed();
}

function drawSettings(app) {
  const sources = app.queries.allSources();
  const destinations = app.queries.allDestinations();
  const selection = app.settingsSelection || { kind: "" };

  drawNav(app, sources, destinations, selection);

  const add = find("settings-add");

  // With nothing attached yet it is the one thing to press, which is what the
  // primary role is. Attached, it is one action among the rows above it.
  restyle(
    button({
      label: "+ Add",
      role: sources.length || destinations.length ? "ghost" : "primary",
      compact: true,
    }),
    add,
  );

  add.classList.add("settings-add");
  add.onclick = () => startAdd(app, "source");

  const teaching = !sources.length && !destinations.length && selection.kind !== "add";
  const blank = !teaching && !selection.kind;

  drawTeach(app, teaching);
  find("settings-blank").hidden = !blank;

  // Both forms are always in the page - hidden, they still declare what they
  // would ask - and exactly one of them can be showing.
  drawSourceForm(app);
  drawDestinationForm(app);

  find("source-form").hidden =
    !(selection.kind === "source" || (selection.kind === "add" && selection.adding === "source"));
  find("destination-form").hidden =
    !(selection.kind === "destination" ||
      (selection.kind === "add" && selection.adding === "destination"));
}

// ---- The nav

/**
 * What a nav row says a source resolves to, under its name.
 *
 * Never the backend's label: the reader knows what kind of storage they
 * attached, what they forget is which storage. The browser's folder handles
 * carry no path at all, so the remembered folder's name stands in, and when
 * even that is gone the row says so honestly rather than inventing a path.
 *
 * @param {object} source the stored source
 * @param {string} handleName the remembered folder's name, "" when unknown
 * @returns {string} one line of where it points
 */
export function resolvedSource(source, handleName) {
  const adapter = source.adapter;

  if (adapter.type === "s3") {
    const prefix = String(adapter.prefix || "").replace(/\/+$/, "");

    return prefix ? `s3://${adapter.bucket}/${prefix}` : `s3://${adapter.bucket}`;
  }

  if (adapter.type === "github" && adapter.owner && adapter.repo) {
    return inRepository(`github.com/${adapter.owner}/${adapter.repo}`, adapter);
  }

  if (adapter.type === "git" && adapter.url) return inRepository(remoteName(adapter.url), adapter);

  if (adapter.type === "tauri") return adapter.root || "";
  if (adapter.type === "filesystem") return handleName ? `${handleName}/` : "folder on this computer";

  return adapter.type;
}

/**
 * Which spot in a repository a source reads, as one line.
 *
 * The prefix reads as a path because that is what it is. The branch is only
 * named when it is not the default, because a row that says "on main" about
 * every repository has spent a line saying nothing.
 *
 * @param {string} repository the repository, already readable
 * @param {{branch?: string, prefix?: string}} adapter the stored configuration
 * @returns {string} where it points
 */
function inRepository(repository, adapter) {
  const prefix = String(adapter.prefix || "").replace(/^\/+|\/+$/g, "");
  const branch = adapter.branch || "main";
  const where = prefix ? `${repository}/${prefix}` : repository;

  return branch === "main" ? where : `${where}#${branch}`;
}

/**
 * A remote as a person names it rather than as a url.
 *
 * The same repository can be written https, ssh or scp-style, and all three are
 * one place, so all three reduce to one line. What is left out is what carries
 * nothing: the port is how the connection is made rather than where the drafts
 * are, and git@ is the user every ssh remote has. The credential is dropped
 * rather than shortened, because a url can be pasted with one in it and this
 * line is on screen whenever the panel is open.
 *
 * @param {string} url the remote url
 * @returns {string} something like git.example.com/org/reviews
 */
function remoteName(url) {
  return String(url)
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^/]*@/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/^([^/:]+):(\d+)(?=\/|$)/, "$1")
    // What is left of a colon after the port has gone is scp-style, where the
    // colon does the job a slash does everywhere else.
    .replace(/^([^/:]+):/, "$1/");
}

/**
 * The count a group header carries: how many rows need attention, wearing the
 * worst colour present, and nothing at all when everything is fine.
 *
 * @param {({state: string}|null)[]} healths one health record per row, null when unprobed
 * @returns {{count: number, tone: string}} what the header shows
 */
export function attention(healths) {
  let count = 0;
  let tone = "";

  for (const health of healths) {
    if (!health || health.state === "ok") continue;

    count += 1;
    tone = health.state === "broken" ? "bad" : tone || "warn";
  }

  return { count, tone };
}

/**
 * How a destination is doing. There is no probe for these: the only one the
 * app can vouch for is the open one, which either said who it signed in as or
 * said what went wrong. The others are unknown, and unknown draws no dot.
 */
function destinationHealth(app, destination) {
  if (app.destinationId !== destination.id) return null;
  if (app.problems.destination) return { state: "broken", reason: app.problems.destination };
  if (app.login) return { state: "ok", reason: "" };

  return null;
}

function drawNav(app, sources, destinations, selection) {
  const sourceList = find("source-list");
  const destinationList = find("destination-list");
  const addingSource = selection.kind === "add" && selection.adding === "source";
  const addingDestination = selection.kind === "add" && selection.adding === "destination";

  drawAttention(find("source-attention"), attention(sources.map((source) => app.healthOf(source))));
  drawAttention(
    find("destination-attention"),
    attention(destinations.map((destination) => destinationHealth(app, destination))),
  );

  sourceList.replaceChildren();

  for (const source of sources) sourceList.append(sourceRow(app, source, selection));

  if (addingSource) sourceList.append(pendingRow(app.setup.name || "new source"));
  else if (!sources.length) sourceList.append(element("div", "mono settings-none", "none yet"));

  destinationList.replaceChildren();

  for (const destination of destinations) {
    destinationList.append(destinationRow(app, destination, selection));
  }

  if (addingDestination) {
    destinationList.append(pendingRow(app.destinationSetup.label || "new destination"));
  } else if (!destinations.length) {
    destinationList.append(element("div", "mono settings-none", "none yet"));
  }
}

function drawAttention(span, { count, tone }) {
  span.textContent = count ? String(count) : "";
  span.className = `mono${tone ? ` is-${tone}` : ""}`;
}

function healthDot(health) {
  if (!health) return null;

  const tone = health.state === "ok" ? "ok" : health.state === "warn" ? "warn" : "bad";
  const dot = element("span", `settings-dot is-${tone}`, "");

  dot.title = health.reason || "";

  return dot;
}

function sourceRow(app, source, selection) {
  const row = document.createElement("button");

  row.type = "button";
  row.className = "settings-row";
  row.setAttribute(
    "aria-current",
    String(selection.kind === "source" && selection.id === source.id),
  );

  const text = element("div", "text", "");

  text.append(
    element("span", "name", source.name),
    element("span", "dir mono", resolvedSource(source, app.handleNames?.[source.id] || "")),
  );
  row.append(text, element("span", "spacer", ""));

  const dot = healthDot(app.healthOf(source));

  if (dot) row.append(dot);

  // One click does both things a row means: show me this one, and read from it.
  row.addEventListener("click", () => {
    focusSource(app, source)
      .then(() => app.changed())
      .catch((failure) => say(failure.message, "error"));
    app.switchSource(source).catch((failure) => say(failure.message, "error"));
  });

  return row;
}

function destinationRow(app, destination, selection) {
  const open = app.destinationId === destination.id;
  const row = document.createElement("button");

  row.type = "button";
  row.className = "settings-row";
  row.setAttribute(
    "aria-current",
    String(selection.kind === "destination" && selection.id === destination.id),
  );

  const dir = element("span", "dir mono", "");

  // The visible line is the account; "signed in as" rides along for a screen
  // reader, where a bare login under a label answers nothing.
  if (open && app.login) {
    dir.append(element("span", "said", "signed in as "), document.createTextNode(app.login));
  } else {
    dir.textContent = destination.type;
  }

  const text = element("div", "text", "");

  text.append(element("span", "name", destination.label || destination.name), dir);
  row.append(text, element("span", "spacer", ""));

  const dot = healthDot(destinationHealth(app, destination));

  if (dot) row.append(dot);

  row.addEventListener("click", () => {
    focusDestination(app, destination)
      .then(() => app.changed())
      .catch((failure) => say(failure.message, "error"));
    app.switchDestination(destination).catch((failure) => say(failure.message, "error"));
  });

  return row;
}

/**
 * The row an add-in-progress holds in the nav: the typed name over a promise
 * that nothing has been saved, with a hollow dot where health will go.
 */
function pendingRow(name) {
  const row = element("div", "settings-row is-pending", "");

  row.setAttribute("aria-current", "true");

  const text = element("div", "text", "");

  text.append(
    element("span", "name", name),
    element("span", "dir mono is-new", "new — unsaved"),
  );
  row.append(text, element("span", "spacer", ""), element("span", "settings-dot is-hollow", ""));

  return row;
}

// ---- The teaching state

function drawTeach(app, show) {
  const pane = find("settings-teach");

  pane.hidden = !show;
  pane.replaceChildren();

  if (!show) return;

  const intro = element("div", "teach-intro", "");

  intro.append(
    element("div", "teach-title", "Nothing connected yet."),
    element(
      "div",
      "teach-text",
      "Two halves, and you need one of each. Sources are where drafts come from; destinations are where your decisions end up.",
    ),
  );

  const halves = element("div", "teach-halves", "");
  const sourceCard = element("div", "teach-card", "");

  sourceCard.append(
    element("span", "mono kicker", "a source"),
    element("span", "what", "reads drafts"),
    element("span", "mono how", "a folder on this computer, or an S3 bucket"),
  );

  const destinationCard = element("div", "teach-card", "");

  destinationCard.append(
    element("span", "mono kicker", "a destination"),
    element("span", "what", "posts decisions"),
    element("span", "mono how", "GitHub, so reviews land on the real PR"),
  );

  halves.append(sourceCard, element("div", "teach-joint", ""), destinationCard);

  const consequence = element(
    "div",
    "teach-text",
    "Without a destination, everything stays on this machine — you can read and decide, but nothing reaches your team.",
  );

  const actions = element("div", "teach-actions", "");
  const addSource = render(
    button({
      label: "Add a source",
      role: "primary",
      compact: true,
      onClick: () => startAdd(app, "source"),
    }),
  );

  const connect = render(
    button({ label: "Connect GitHub", compact: true, onClick: () => startAdd(app, "destination") }),
  );

  actions.append(
    addSource,
    connect,
    element("span", "spacer", ""),
    element("span", "mono either", "either order"),
  );

  pane.append(intro, halves, consequence, actions);
}

// ---- The source form

/**
 * Whether the source form differs from the stored record.
 *
 * A blank secret box means "keep what is held", so only a typed secret counts.
 * A freshly picked folder always counts: picking is the change.
 *
 * @param {object} setup the form's state
 * @param {object[]} fields what this backend declares
 * @returns {boolean} true when saving would change something
 */
export function sourceDirty(setup, fields) {
  if (!setup.editing) return false;
  if (setup.name !== setup.editing.name) return true;
  if (setup.type !== setup.editing.adapter.type) return true;
  if (folderChosen(setup)) return true;

  return fields.some((field) => {
    const value = setup.values[field.key] || "";

    return field.secret ? Boolean(value) : value !== (setup.editing.adapter[field.key] || "");
  });
}

/**
 * Whether the destination form differs from the stored record.
 *
 * @param {object} setup the form's state
 * @returns {boolean} true when saving would change something
 */
export function destinationDirty(setup) {
  if (!setup.editing) return false;
  if (setup.label !== (setup.editing.label || setup.editing.name || "")) return true;

  return Object.values(setup.values).some((value) => (value || "").trim() !== "");
}

/**
 * The one status line under the fields, built from the last probe.
 *
 * A healthy source quotes what is true of it; anything else is the probe's own
 * sentence, verbatim, because the probe already states the remedy.
 *
 * @param {{state: string, reason: string, drafts: number, at: number}|null} health the last probe
 * @param {string} reads what a healthy line says is being read
 * @returns {{text: string, tone: string}} the line and its colour
 */
export function statusLine(health, reads) {
  if (!health) return { text: "", tone: "" };

  if (health.state === "ok") {
    const drafts = `${health.drafts} draft${health.drafts === 1 ? "" : "s"}`;

    return { text: `reads ${reads} · ${drafts} · checked ${age(health.at)} ago`, tone: "" };
  }

  return { text: health.reason, tone: health.state === "warn" ? "warn" : "bad" };
}

/**
 * Everything this app touches inside a source, named.
 *
 * Storage the reader owns is storage they are entitled to an inventory of, and
 * three facts are worth more than any reassurance: the drafts are only ever
 * read, the decisions written are this device's alone, and the other files in
 * there are its other browsers. Explaining that convention in the abstract is
 * the paragraph this pane deleted, so it is a list of real paths or it is
 * nothing: a folder handle the browser has forgotten leaves nothing to quote.
 *
 * @param {object} source the stored source
 * @param {string} handleName the remembered folder's name, "" when unknown
 * @param {string} deviceId this browser
 * @returns {{at: string, does: {path: string, doing: string}[]}|null} the inventory
 */
export function folderWork(source, handleName, deviceId) {
  const at = resolvedSource(source, handleName);

  if (!at || at === "folder on this computer") return null;

  return {
    at: `${at.replace(/\/+$/, "")}/`,
    does: [
      { path: "drafts/", doing: "read · the agent writes these, this app never does" },
      { path: `.reviewer/events/${deviceId}.jsonl`, doing: "written · your decisions on this device" },
      { path: ".reviewer/events/", doing: "read · what you decided on your other devices" },
    ],
  };
}

function folderInventory(work) {
  const list = element("div", "settings-work", "");

  list.append(element("div", "mono settings-work-at", `in ${work.at}`));

  for (const entry of work.does) {
    const row = element("div", "settings-work-row", "");
    const path = element("span", "mono settings-work-path", entry.path);

    // This device's file is a uuid, which is too long to read and not worth
    // widening the column for. It truncates, and hovering gives it back whole.
    path.title = `${work.at}${entry.path}`;

    row.append(path, element("span", "mono settings-work-doing", entry.doing));
    list.append(row);
  }

  return list;
}

/**
 * What a healthy status line says is being read.
 *
 * A backend that asks for its location in a form is one whose location is worth
 * quoting back; storage that was picked is already named by the row above, and
 * saying it twice would only make the line longer. That is the same distinction
 * the form draws when it offers a folder button instead of fields, so no
 * particular backend is named here.
 *
 * @param {object} source the stored source
 * @param {object[]} fields what its backend declares
 * @returns {string} the location, ending in the folder the drafts are in
 */
export function readsWhat(source, fields) {
  return fields.length ? `${resolvedSource(source, "")}/drafts/` : "drafts/";
}

function sourceStatus(app, setup) {
  if (!setup.editing) {
    // A folder is chosen, not probed: nothing can be counted before it is
    // attached, so nothing is invented.
    if (folderChosen(setup)) {
      return { text: `will read ${folderPath(setup)}/drafts/`, tone: "" };
    }

    return { text: "", tone: "" };
  }

  return statusLine(
    app.healthOf(setup.editing),
    readsWhat(setup.editing, fieldsForAdapter(setup.editing.adapter.type)),
  );
}

/**
 * The detail's first line: name, how it is doing, what kind of thing it is,
 * and the way to forget it.
 */
function detailHead(app, name, health, typeWord, onRemove) {
  const head = element("div", "settings-head", "");

  head.append(element("span", "settings-title", name));

  if (health) {
    const tone = health.state === "ok" ? "ok" : health.state === "warn" ? "warn" : "bad";
    const word =
      health.state === "ok" ? "connected" : health.state === "warn" ? "misconfigured" : "broken";
    const state = element("span", `mono settings-state is-${tone}`, "");

    state.append(element("span", "settings-dot", ""), document.createTextNode(word));
    state.title = health.reason || "";
    head.append(state);
  }

  head.append(element("span", "mono settings-type", typeWord), element("span", "spacer", ""));

  const remove = element("button", "mono settings-remove", "Remove");

  remove.type = "button";
  remove.title = "Forget this here. Nothing in the storage itself is touched";
  remove.addEventListener("click", () => {
    if (arm(remove, "Forget it?", "Remove")) onRemove();
  });

  head.append(remove);

  return head;
}

/**
 * The segmented choice the one Add button opens onto: which half is being
 * added. Exactly two options, so it is a pair of buttons rather than a select.
 */
function kindControl(app, active) {
  const control = element("div", "settings-kind mono", "");

  for (const [kind, label] of [["source", "draft source"], ["destination", "destination"]]) {
    const option = element("button", "", label);

    option.type = "button";
    option.setAttribute("aria-pressed", String(kind === active));
    option.addEventListener("click", () => {
      app.settingsSelection = { kind: "add", adding: kind, id: null };
      app.changed();
    });
    control.append(option);
  }

  return control;
}

/**
 * What a saved source's form says about decisions waiting to reach its storage.
 *
 * The only place this app ever tells a reader their decisions are written, so
 * it has to have three things to say and not two. The count behind it is
 * itself a read of storage, and a read that failed answers null: saying "saved"
 * on the strength of a question that could not be asked is how work sitting
 * only in this browser gets reported as safe.
 *
 * @param {number|null} waiting how many are waiting, or null when unknown
 * @returns {{text: string, tone: string}} the word and the tone to wear
 */
export function syncWord(waiting) {
  if (waiting === null || waiting === undefined) {
    return { text: "could not be checked for unsynced decisions", tone: "bad" };
  }

  if (!waiting) return { text: "saved", tone: "" };

  return {
    text: `${waiting} decision${waiting === 1 ? "" : "s"} waiting to sync`,
    tone: "bad",
  };
}

function footWord(text, tone) {
  return element("span", `mono settings-word${tone ? ` is-${tone}` : ""}`, text);
}

// The settings panel's footer buttons were a private factory taking a variant
// string, which is a role by another name. Now they are the roles: the way out
// is quiet, the thing being asked for fills, and Done is an ordinary action.
const FOOT_ROLE = { plain: "quiet", fill: "primary" };

function footButton(text, variant, onClick) {
  return render(
    button({
      label: text,
      role: FOOT_ROLE[variant] || "ghost",
      compact: true,
      submits: !onClick,
      onClick,
    }),
  );
}

function drawSourceForm(app) {
  const form = find("source-form");
  const setup = app.setup;
  const editing = Boolean(setup.editing);
  const types = [...adapterTypes()];

  // A source attached against a backend this build no longer offers keeps that
  // backend as an option while it is being edited. Dropping it from the list
  // would silently repoint the source at something else on the next save.
  if (editing && !types.some((type) => type.type === setup.editing.adapter.type)) {
    types.push({
      type: setup.editing.adapter.type,
      label: setup.editing.adapter.type,
      fields: [],
      reason: "",
      hint: "",
    });
  }

  if (!types.some((type) => type.type === setup.type)) setup.type = firstUsable(types);

  const chosen = types.find((type) => type.type === setup.type);
  const fields = chosen?.fields || [];

  form.replaceChildren();

  const body = element("div", "settings-body", "");

  if (editing) {
    body.append(
      detailHead(
        app,
        setup.editing.name,
        app.healthOf(setup.editing),
        TYPE_WORDS[setup.editing.adapter.type] || setup.editing.adapter.type,
        () => removeSource(app, setup.editing),
      ),
    );
  } else {
    body.append(element("div", "settings-title", "New draft source"));
  }

  const grid = element("div", "settings-fields", "");

  if (!editing) {
    grid.append(element("span", "mono settings-key", "Add"), kindControl(app, "source"));
  }

  grid.append(textField(app, setup, { key: "name", label: "Name", placeholder: "work" }, "source"));
  grid.append(
    picker("Stored in", storageOptions(types), setup.type, (value) => {
      setup.type = value;
      setup.problem = "";
      app.changed();
    }),
  );

  // Where to go and switch a backend on, for the one case that has such a
  // place. It sits under the picker rather than inside the option because an
  // option is a line of text and this is a sentence with a url in it. At most
  // one backend has a hint, so this is one line, not a list of caveats.
  for (const type of types) {
    if (type.hint) grid.append(element("div", "mono settings-hint", `${type.label}: ${type.hint}`));
  }

  for (const field of fields) {
    grid.append(
      textField(
        app,
        setup.values,
        { ...field, label: labelWord(field.label) },
        "source",
        setup.secretsSet[field.key],
      ),
    );
  }

  // A usable backend that asks nothing is one whose storage is chosen rather
  // than typed, so the folder row stands in for its fields. A backend this
  // build no longer offers, or one that cannot be used here, gets neither: it
  // can be renamed, not repointed.
  const usable = adapterTypes().some((type) => type.type === setup.type && !type.reason);

  if (usable && !fields.length) {
    grid.append(element("span", "mono settings-key", "Folder"), folderRow(app, setup, editing));
  }

  // What a field list cannot carry: the CORS rule a bucket needs, the token
  // scope GitHub wants, which of these need the desktop app. One line to the
  // page that does, for whichever backend is chosen right now.
  const docSlug = ADAPTER_DOCS[setup.type];

  if (docSlug) {
    const link = document.createElement("a");

    link.className = "settings-doc-link mono";
    link.href = `https://dev.review/adapters/${docSlug}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `Full setup for ${chosen?.label || setup.type} →`;
    grid.append(link);
  }

  body.append(grid);

  const status = sourceStatus(app, setup);

  if (status.text) {
    body.append(element("div", `mono settings-status${status.tone ? ` is-${status.tone}` : ""}`, status.text));
  }

  const work = editing
    ? folderWork(setup.editing, app.handleNames?.[setup.editing.id] || "", app.deviceId || "")
    : null;

  if (work) body.append(folderInventory(work));

  if (setup.problem) body.append(element("div", "mono settings-status is-warn", setup.problem));

  const foot = element("div", "settings-foot", "");
  const dirty = editing && sourceDirty(setup, fields);

  if (!editing) {
    foot.append(footWord("nothing saved yet", ""), element("span", "spacer", ""));
    foot.append(footButton("Cancel", "plain", () => dropSelection(app)));
    foot.append(footButton("Add source", "fill"));
  } else if (dirty) {
    foot.append(footWord("unsaved changes", ""), element("span", "spacer", ""));
    foot.append(
      footButton("Cancel", "plain", () => {
        focusSource(app, setup.editing)
          .then(() => app.changed())
          .catch((failure) => say(failure.message, "error"));
      }),
    );
    foot.append(footButton("Save", "fill"));
  } else {
    // Undefined until the first sweep has answered, which reads the same way a
    // failed read does: nothing is known yet, so nothing is claimed.
    const { text, tone } = syncWord(app.unsyncedCounts?.[setup.editing.id] ?? null);

    foot.append(footWord(text, tone), element("span", "spacer", ""));
    foot.append(footButton("Done", ""));
  }

  form.append(body, foot);

  form.onsubmit = (event) => {
    event.preventDefault();

    // A clean form's submit is the Done button: there is nothing to save.
    if (editing && !sourceDirty(setup, fieldsForAdapter(setup.type))) {
      closeSetup();

      return;
    }

    saveSource(app);
  };
}

// Field labels arrive lowercase from the adapters; the 74px column reads
// better carrying a capital, the way the design writes them.
function labelWord(label) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function folderRow(app, setup, editing) {
  const row = element("div", "settings-folder", "");
  // The picker only opens inside a user gesture, which is why this is its own
  // button rather than something the submit handler does. Re-picking is also
  // how a folder whose permission has lapsed is granted again.
  const choose = render(button({ label: "Choose…", compact: true }));

  choose.addEventListener("click", async () => {
    try {
      const picked = await chooseFolder(setup.type);

      if (!picked) return;

      setup.handle = picked.handle || null;
      setup.root = picked.root || "";
      setup.problem = "";
      if (!setup.name) setup.name = folderName(setup);
    } catch (failure) {
      // The button is inside the panel and the footer is not, so the failure is
      // put where the reader is looking as well as in the status line.
      setup.problem = failure.message;
      say(failure.message, "error");
    }

    app.changed();
  });

  const name = folderChosen(setup)
    ? `${folderPath(setup)}/`
    : editing
      ? resolvedSource(setup.editing, app.handleNames?.[setup.editing.id] || "")
      : "";

  row.append(choose, element("span", "mono settings-path", name));

  return row;
}

function removeSource(app, source) {
  app.removeSource(source)
    .then(() => {
      say(`${source.name} is no longer read here`, "ok");
      dropSelection(app);
    })
    .catch((failure) => say(failure.message, "error"));
}

/**
 * What the reader typed, split into configuration and credentials.
 *
 * A secret left blank means unchanged rather than emptied, so it is left out of
 * the change entirely and the data layer keeps whatever it already held.
 *
 * @param {object[]} fields what was asked for
 * @param {object} values what was typed
 * @param {{required: boolean}} options whether every required field must be answered
 * @returns {{config: object, secret: object}} the two halves
 * @throws {Error} if a required field was left blank
 */
function readFields(fields, values, { required }) {
  const config = {};
  const secret = {};

  for (const field of fields) {
    const value = (values[field.key] || "").trim();

    if (!value) {
      if (required && field.required) throw new Error(`${field.label} is required`);

      continue;
    }

    if (field.secret) secret[field.key] = value;
    else config[field.key] = value;
  }

  return { config, secret };
}

/**
 * Whether an edited configuration says the same thing as the stored one.
 *
 * Only the type and the declared non-secret fields are compared, because they
 * are the whole of what the form can change. Credentials are handled apart:
 * a blank secret box means unchanged, not emptied.
 *
 * @param {object} stored the source's current adapter configuration
 * @param {object} edited what the form would save
 * @param {object[]} fields what this backend declares
 * @returns {boolean} true when nothing about the storage moved
 */
function sameConfig(stored, edited, fields) {
  if (stored.type !== edited.type) return false;

  // A chosen folder is configuration the form never asks for as a field, so
  // comparing only the fields would call a repointed source unchanged.
  if ((stored.root || "") !== (edited.root || "")) return false;

  return fields
    .filter((field) => !field.secret)
    .every((field) => (stored[field.key] || "") === (edited[field.key] || ""));
}

async function saveSource(app) {
  const setup = app.setup;
  const fields = fieldsForAdapter(setup.type);

  setup.problem = "";

  try {
    if (!setup.name.trim()) throw new Error("a source needs a name");

    // Editing leaves a stored credential in place when its box is blank, so
    // only a new source has to have every required field answered.
    const { config, secret } = readFields(fields, setup.values, { required: !setup.editing });

    if (!fields.length && !setup.editing && !folderChosen(setup)) {
      throw new Error("choose a folder first");
    }

    if (setup.editing) {
      const adapter = { type: setup.type, ...config, ...folderConfig(setup, setup.editing.adapter) };

      // Only what actually changed. Sending the configuration unchanged would
      // make the storage prove itself again, so a source that is temporarily
      // unreachable could not even be renamed.
      await app.editSource(setup.editing, {
        name: setup.name.trim(),
        ...(sameConfig(setup.editing.adapter, adapter, fields) ? {} : { adapter }),
        ...(Object.keys(secret).length ? { secret } : {}),
        ...(setup.handle ? { handle: setup.handle } : {}),
      });

      say(`saved ${setup.name.trim()}`, "ok");
      await focusSource(app, app.queries.findSource(setup.editing.id) || setup.editing);
    } else {
      const source = await app.addSource({
        name: setup.name.trim(),
        adapter: { type: setup.type, ...config, ...folderConfig(setup) },
        secret: Object.keys(secret).length ? secret : undefined,
        handle: setup.handle,
      });

      // Attaching storage that cannot be reached is a failure worth saying out
      // loud, rather than one the pane has to be read carefully to notice.
      say(app.problem, app.problem ? "error" : "");

      // One half attached and the other still missing is the teaching state's
      // own sequence, mid-way: the pane offers the missing half next.
      if (!app.queries.allDestinations().length) {
        app.setup = newSourceSetup();
        app.destinationSetup = newDestinationSetup();
        app.settingsSelection = { kind: "add", adding: "destination", id: null };
      } else {
        await focusSource(app, source);
      }
    }

    app.changed();
  } catch (failure) {
    // Nothing was saved, so nothing is cleared: the form keeps every word the
    // reader typed and says why it would not go.
    setup.problem = failure.message;
    say(failure.message, "error");
    app.changed();
  }
}

// ---- The destination form

function drawDestinationForm(app) {
  const form = find("destination-form");
  const types = destinationTypes();
  const setup = app.destinationSetup;
  const editing = Boolean(setup.editing);
  const chosen = editing
    ? types.find((type) => type.type === setup.editing.type)
    : types.find((type) => type.type === setup.type) || types[0];

  if (!editing) setup.type = chosen ? chosen.type : "";

  form.replaceChildren();

  const body = element("div", "settings-body", "");

  if (editing) {
    body.append(
      detailHead(
        app,
        setup.editing.label || setup.editing.name,
        destinationHealth(app, setup.editing),
        setup.editing.type,
        () => removeDestination(app, setup.editing),
      ),
    );
  } else {
    body.append(element("div", "settings-title", "New destination"));
  }

  const grid = element("div", "settings-fields", "");

  if (!editing) {
    grid.append(element("span", "mono settings-key", "Add"), kindControl(app, "destination"));
  }

  // The kind is what the stored credential belongs to, so it is settled when a
  // destination is added and not reopened afterwards.
  if (types.length > 1 && !editing) {
    grid.append(
      picker(
        "Kind",
        types.map((type) => ({ value: type.type, label: type.label })),
        setup.type,
        (value) => {
          setup.type = value;
          setup.problem = "";
          app.changed();
        },
      ),
    );
  }

  grid.append(
    textField(
      app,
      setup,
      { key: "label", label: "Name", placeholder: chosen?.label || "" },
      "destination",
    ),
  );

  for (const field of chosen?.fields || []) {
    grid.append(
      textField(
        app,
        setup.values,
        {
          key: field.key,
          label: labelWord(field.label),
          mono: true,
          secret: field.secret,
          required: true,
        },
        "destination",
        setup.secretsSet[field.key],
      ),
    );

    if (field.hint) grid.append(element("div", "mono settings-hint", field.hint));
  }

  body.append(grid);

  if (setup.problem) body.append(element("div", "mono settings-status is-warn", setup.problem));

  const foot = element("div", "settings-foot", "");
  const dirty = editing && destinationDirty(setup);

  if (!editing) {
    foot.append(footWord("nothing saved yet", ""), element("span", "spacer", ""));
    foot.append(footButton("Cancel", "plain", () => dropSelection(app)));
    foot.append(footButton("Add destination", "fill"));
  } else if (dirty) {
    foot.append(footWord("unsaved changes", ""), element("span", "spacer", ""));
    foot.append(
      footButton("Cancel", "plain", () => {
        focusDestination(app, setup.editing)
          .then(() => app.changed())
          .catch((failure) => say(failure.message, "error"));
      }),
    );
    foot.append(footButton("Save", "fill"));
  } else {
    foot.append(footWord("saved", ""), element("span", "spacer", ""));
    foot.append(footButton("Done", ""));
  }

  form.append(body, foot);

  form.onsubmit = (event) => {
    event.preventDefault();

    if (editing && !destinationDirty(setup)) {
      closeSetup();

      return;
    }

    saveDestination(app, chosen);
  };
}

function removeDestination(app, destination) {
  app.removeDestination(destination)
    .then(() => {
      say(`${destination.label || destination.name} will not be posted to from here`, "ok");
      dropSelection(app);
    })
    .catch((failure) => say(failure.message, "error"));
}

async function saveDestination(app, type) {
  const setup = app.destinationSetup;

  setup.problem = "";

  try {
    if (!type) throw new Error("this build knows no destination to add");

    const { secret } = readFields(type.fields, setup.values, { required: !setup.editing });

    if (setup.editing) {
      await app.editDestination(setup.editing, {
        label: setup.label.trim() || type.label,
        secret: Object.keys(secret).length ? secret : undefined,
      });

      say(`saved ${setup.label.trim() || type.label}`, "ok");
      await focusDestination(
        app,
        app.queries.findDestination(setup.editing.id) || setup.editing,
      );
    } else {
      const destination = await app.addDestination({
        type: type.type,
        label: setup.label.trim() || type.label,
        secret,
      });

      say(app.problem, app.problem ? "error" : "");

      if (!app.queries.allSources().length) {
        app.setup = newSourceSetup();
        app.destinationSetup = newDestinationSetup();
        app.settingsSelection = { kind: "add", adding: "source", id: null };
      } else {
        await focusDestination(app, destination);
      }
    }

    app.changed();
  } catch (failure) {
    setup.problem = failure.message;
    say(failure.message, "error");
    app.changed();
  }
}

// ---- Fields

/**
 * A labelled text input whose value lives on the app, so a redraw underneath
 * the reader's hands does not empty the form they are filling in. Typing
 * redraws, because the footer and the pending nav row answer to every
 * keystroke; the reader's place survives it through the focus key.
 *
 * @param {object} app the application, told when a keystroke lands
 * @param {object} holder where the typed value is kept
 * @param {object} field what to ask for
 * @param {string} scope which form this belongs to, for focus restoration
 * @param {boolean} [stored] whether a credential is already held for this field
 * @returns {HTMLElement} the labelled input
 */
function textField(app, holder, field, scope, stored = false) {
  const label = document.createElement("label");
  const caption = element("span", "mono settings-key", field.label);

  // A stored credential is never rendered. Saying that one is held, and that an
  // empty box keeps it, is everything the reader needs and hands nothing back.
  if (stored) caption.append(element("span", "settings-set", "set"));

  label.append(caption);

  const input = document.createElement("input");

  input.className = field.mono ? "mono" : "";
  input.type = field.secret ? "password" : "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  // A credential already held is not required again: blank means keep it. The
  // submit checks this as well, because these fields sit in a panel and the
  // native check cannot be the only thing standing between a typo and a source
  // that silently reads nothing.
  input.required = Boolean(field.required) && !stored;
  input.placeholder = stored ? "leave blank to keep" : field.placeholder || "";
  input.value = holder[field.key] || "";
  input.dataset.focusKey = `${scope}:${field.key}`;
  input.addEventListener("input", () => {
    holder[field.key] = input.value;
    app.changed();
  });

  label.append(input);

  return label;
}

/**
 * The storage options a source form draws, unusable ones included.
 *
 * The reason goes into the option's own text. Greying an option out says
 * something is wrong with it and nothing about what, and a reader who cannot
 * see the grey is told nothing at all, so the sentence has to be in the text
 * where a screen reader will read it out with the rest of the option.
 *
 * @param {{type: string, label: string, reason: string}[]} types from adapterTypes
 * @returns {{value: string, label: string, disabled: boolean}[]} what the picker draws
 */
export function storageOptions(types) {
  return types.map((type) => ({
    value: type.type,
    label: type.reason ? `${type.label} (${type.reason})` : type.label,
    disabled: Boolean(type.reason),
  }));
}

/**
 * The backend a form should start on.
 *
 * Not simply the first one listed, because the first one listed is now allowed
 * to be one that cannot be used here, and opening the form onto a disabled
 * option would leave the reader looking at a form with no way forward.
 *
 * @param {{type: string, reason: string}[]} types from adapterTypes
 * @returns {string} the type to select, or "" when nothing here works
 */
export function firstUsable(types) {
  return types.find((type) => !type.reason)?.type || "";
}

/**
 * A labelled select.
 *
 * An option marked disabled is unreachable by mouse, by keyboard and by the
 * form's own value, which is the point: a backend that cannot be used here must
 * be visible and inert, not visible and half-working.
 *
 * @param {string} label the field's name
 * @param {{value: string, label: string, disabled?: boolean}[]} options what to offer
 * @param {string} chosen the selected value
 * @param {(value: string) => void} onChange what a change does
 * @returns {HTMLElement} the field
 */
export function picker(label, options, chosen, onChange) {
  const wrapper = document.createElement("label");

  wrapper.append(element("span", "mono settings-key", label));

  const select = document.createElement("select");

  for (const option of options) {
    const node = document.createElement("option");

    node.value = option.value;
    node.textContent = option.label;
    node.selected = option.value === chosen;
    node.disabled = Boolean(option.disabled);
    select.append(node);
  }

  select.addEventListener("change", () => onChange(select.value));
  wrapper.append(select);

  return wrapper;
}
