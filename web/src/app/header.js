// The header: what is being read, what is waiting, and the two setup flows.
//
// Drafts come from a source and reviews go to a destination. They are separate
// choices, so they are separate lists in one popover rather than one merged
// idea: a team can keep drafts in a bucket and post to GitHub, or keep them on
// disk and post somewhere else, and neither decision constrains the other.
//
// Adding and editing share one form. They differ in what it is prefilled with
// and what the submit does, and in nothing else, because a second form is a
// second place for the two to drift apart.

import { adapterTypes } from "../adapters/index.js";
import { pickDirectory } from "../adapters/filesystem.js";
import { destinationTypes } from "../destinations/index.js";
import { age, element, find, initials, say } from "./dom.js";
import { leaveWords } from "./words.js";

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
    secretsSet: {},
    problem: "",
  };
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
  drawSources(app);
  drawDestinations(app);
  drawQueue(app);
  drawOpen(app);

  const leave = leaveWords(app);
  const control = find("signout");

  control.hidden = !app.destination;
  control.textContent = leave.label;
  control.title = leave.title;
}

/**
 * Open the sources and destinations popover.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function openSetup(app) {
  find("setup-popover").hidden = false;
  find("setup-backdrop").hidden = false;
  find("source-button").setAttribute("aria-expanded", "true");
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
 * Put a source into the form to be corrected, and show it.
 *
 * Exported because a source that cannot be read says so in the pane, and the
 * fix has to be reachable from there rather than only from this popover.
 *
 * @param {object} app the application
 * @param {object} source which source
 * @returns {Promise<void>} when the form is showing it
 */
export async function editSource(app, source) {
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
    secretsSet: await app.secretsSetFor(source),
    problem: "",
  };

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
 * is absent entirely when nothing has been dismissed, so the common case is not
 * asked to carry a heading about a decision nobody made.
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

    const row = document.createElement("div");
    row.className = "setup-row";
    row.append(
      element("div", "top", ""),
      element("div", "dir mono", `${entry.owner}/${entry.repo}#${entry.number}`),
    );
    row.firstChild.append(element("span", "name", entry.title));

    const restore = document.createElement("button");
    restore.className = "ghost setup-edit";
    restore.textContent = "Restore";
    restore.title = "Put this pull request back on the queue";
    restore.addEventListener("click", () => {
      app.commands.restorePull(app.source, entry);
      app.changed();
    });

    line.append(row, restore);
    section.append(line);
  }
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

// ---- Sources

/**
 * What a backend needs asking for. The adapter declares it, so this form knows
 * nothing about any particular storage.
 */
function fieldsForAdapter(type) {
  return adapterTypes().find((candidate) => candidate.type === type)?.fields || [];
}

function drawSources(app) {
  const list = find("source-list");
  const sources = app.queries.allSources();

  find("source-name").textContent = app.source ? app.source.name : "none";

  list.replaceChildren();

  for (const source of sources) {
    list.append(sourceRow(app, source));
  }

  if (!sources.length) {
    list.append(
      element(
        "div",
        "popover-foot",
        "Nothing attached yet. A draft source is the storage your review agent writes to.",
      ),
    );
  }

  drawSourceForm(app);
}

function sourceRow(app, source) {
  const line = document.createElement("div");
  line.className = "setup-line";

  const row = document.createElement("button");
  row.className = "setup-row";
  row.setAttribute("aria-current", String(app.source?.id === source.id));

  const top = document.createElement("div");
  top.className = "top";
  top.append(element("span", "name", source.name));

  row.append(top, element("div", "dir", describeAdapter(source.adapter)));
  row.addEventListener("click", () => {
    app.switchSource(source).catch((failure) => say(failure.message, "error"));
  });

  const edit = document.createElement("button");
  edit.className = "ghost setup-edit";
  edit.textContent = "Edit";
  edit.title = "Correct this source's storage or credentials";
  edit.addEventListener("click", () => {
    editSource(app, source).catch((failure) => say(failure.message, "error"));
  });

  line.append(row, edit, removeSourceButton(app, source));

  return line;
}

/**
 * Forget a source, after asking once.
 *
 * It arms before it acts, the way the per-finding send does. What it undoes is
 * this app's knowledge of the storage: the credential is forgotten and the
 * store is closed. The drafts themselves are the reader's and are left exactly
 * where they are, which is why this asks once rather than dwelling on it, and
 * why the second press says what is actually being forgotten.
 *
 * @param {object} app the running app
 * @param {object} source the source to forget
 * @returns {HTMLElement} the button
 */
function removeSourceButton(app, source) {
  const remove = document.createElement("button");

  remove.className = "ghost danger setup-edit";
  remove.textContent = "Remove";
  remove.title = "Forget this source here. The drafts in it are left alone";

  remove.addEventListener("click", async () => {
    if (remove.dataset.armed !== "true") {
      remove.dataset.armed = "true";
      remove.textContent = "Forget it?";

      setTimeout(() => {
        remove.dataset.armed = "false";
        remove.textContent = "Remove";
      }, 2500);

      return;
    }

    remove.disabled = true;

    try {
      await app.removeSource(source);
      say(`${source.name} is no longer read here`, "ok");
    } catch (failure) {
      say(failure.message, "error");
      remove.disabled = false;
      remove.dataset.armed = "false";
      remove.textContent = "Remove";
    }
  });

  return remove;
}

function describeAdapter(adapter) {
  const type = adapterTypes().find((candidate) => candidate.type === adapter.type);

  return type ? type.label : adapter.type;
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
  form.append(
    element("div", "card-head", editing ? `edit ${setup.editing.name}` : "new draft source"),
  );
  form.append(textField(setup, { key: "name", label: "name", placeholder: "work" }, "source"));
  form.append(
    picker("storage", storageOptions(types), setup.type, (value) => {
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
    if (type.hint) form.append(element("div", "mono scan-note", `${type.label}: ${type.hint}`));
  }

  for (const field of fields) {
    form.append(textField(setup.values, field, "source", setup.secretsSet[field.key]));
  }

  // A usable backend that asks nothing is one whose storage is chosen rather
  // than typed, so the picker stands in for the whole form. A backend this
  // build no longer offers, or one that cannot be used here, gets neither: it
  // can be renamed, not repointed.
  const usable = adapterTypes().some((type) => type.type === setup.type && !type.reason);

  if (usable && !fields.length) form.append(folderButton(app, setup, editing));

  if (setup.problem) form.append(element("div", "mono scan-note is-warn", setup.problem));

  form.append(
    element(
      "div",
      "mono scan-note",
      "Drafts are read from a drafts/ directory at the root of this storage, and this app's own decisions are synced back beside them.",
    ),
  );

  const actions = document.createElement("div");
  actions.className = "setup-actions";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "ghost";
  submit.textContent = editing ? "Save changes" : "+ Add source";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ghost";
  cancel.textContent = editing ? "Cancel" : "Done";
  cancel.addEventListener("click", () => {
    if (!editing) {
      closeSetup();

      return;
    }

    app.setup = newSourceSetup();
    app.changed();
  });

  actions.append(submit, element("span", "spacer", ""), cancel);
  form.append(actions);

  form.onsubmit = (event) => {
    event.preventDefault();
    saveSource(app);
  };
}

function folderButton(app, setup, editing) {
  const choose = document.createElement("button");

  choose.type = "button";
  choose.className = "ghost";
  choose.textContent = setup.handle
    ? `Folder: ${setup.handle.name}`
    : editing
      ? "Choose the folder again…"
      : "Choose folder…";

  // The picker only opens inside a user gesture, which is why this is its own
  // button rather than something the submit handler does. Re-picking is also
  // how a folder whose permission has lapsed is granted again.
  choose.addEventListener("click", async () => {
    try {
      setup.handle = await pickDirectory();
      setup.problem = "";
      if (!setup.name) setup.name = setup.handle.name;
      app.changed();
    } catch (failure) {
      if (failure.name !== "AbortError") say(failure.message, "error");
    }
  });

  return choose;
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

    if (!fields.length && !setup.editing && !setup.handle) {
      throw new Error("choose a folder first");
    }

    if (setup.editing) {
      const adapter = { type: setup.type, ...config };

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
    } else {
      await app.addSource({
        name: setup.name.trim(),
        adapter: { type: setup.type, ...config },
        secret: Object.keys(secret).length ? secret : undefined,
        handle: setup.handle,
      });

      // Attaching storage that cannot be reached is a failure worth saying out
      // loud, rather than one the pane has to be read carefully to notice.
      say(app.problem, app.problem ? "error" : "");
    }

    const kind = setup.type;

    app.setup = newSourceSetup();
    app.setup.type = kind;
    app.changed();
  } catch (failure) {
    // Nothing was saved, so nothing is cleared: the form keeps every word the
    // reader typed and says why it would not go.
    setup.problem = failure.message;
    say(failure.message, "error");
    app.changed();
  }
}

// ---- Destinations

function drawDestinations(app) {
  const list = find("destination-list");
  const destinations = app.queries.allDestinations();

  list.replaceChildren();

  for (const destination of destinations) {
    list.append(destinationRow(app, destination));
  }

  if (!destinations.length) {
    list.append(
      element(
        "div",
        "popover-foot",
        "Nowhere to post yet. Reviews go to whichever destination is chosen here.",
      ),
    );
  }

  drawDestinationForm(app);
}

function destinationRow(app, destination) {
  const open = app.destinationId === destination.id;

  const line = document.createElement("div");
  line.className = "setup-line";

  const row = document.createElement("button");
  row.className = "setup-row";
  row.setAttribute("aria-current", String(open));

  const top = document.createElement("div");
  top.className = "top";
  top.append(element("span", "name", destination.label || destination.name));

  row.append(
    top,
    element("div", "dir", open && app.login ? `signed in as ${app.login}` : destination.type),
  );
  row.addEventListener("click", () => {
    app.switchDestination(destination).catch((failure) => say(failure.message, "error"));
  });

  const edit = document.createElement("button");
  edit.className = "ghost setup-edit";
  edit.textContent = "Edit";
  edit.title = "Rename this destination or rotate its token";
  edit.addEventListener("click", () => {
    editDestination(app, destination).catch((failure) => say(failure.message, "error"));
  });

  line.append(row, edit);

  return line;
}

async function editDestination(app, destination) {
  app.destinationSetup = {
    editing: destination,
    label: destination.label || destination.name || "",
    type: destination.type,
    values: {},
    secretsSet: await app.secretsSetFor(destination),
    problem: "",
  };

  openSetup(app);
}

function drawDestinationForm(app) {
  const form = find("destination-form");
  const types = destinationTypes();
  const setup = app.destinationSetup;
  const chosen = types.find((type) => type.type === setup.type) || types[0];
  const editing = Boolean(setup.editing);

  setup.type = chosen ? chosen.type : "";

  form.replaceChildren();
  form.append(
    element(
      "div",
      "card-head",
      editing ? `edit ${setup.editing.label || setup.editing.name}` : "new destination",
    ),
  );

  // The kind is what the stored credential belongs to, so it is settled when a
  // destination is added and not reopened afterwards.
  if (types.length > 1 && !editing) {
    form.append(
      picker(
        "kind",
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

  form.append(
    textField(setup, { key: "label", label: "name", placeholder: chosen?.label || "" }, "destination"),
  );

  for (const field of chosen?.fields || []) {
    form.append(
      textField(
        setup.values,
        {
          key: field.key,
          label: field.label.toLowerCase(),
          mono: true,
          secret: field.secret,
          required: true,
        },
        "destination",
        setup.secretsSet[field.key],
      ),
    );

    if (field.hint) form.append(element("div", "mono scan-note", field.hint));
  }

  if (setup.problem) form.append(element("div", "mono scan-note is-warn", setup.problem));

  const actions = document.createElement("div");
  actions.className = "setup-actions";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "ghost";
  submit.textContent = editing ? "Save changes" : "+ Add destination";

  actions.append(submit);

  if (editing) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      app.destinationSetup = newDestinationSetup();
      app.changed();
    });

    actions.append(element("span", "spacer", ""), cancel);
  }

  form.append(actions);

  form.onsubmit = (event) => {
    event.preventDefault();
    saveDestination(app, chosen);
  };
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
    } else {
      await app.addDestination({
        type: type.type,
        label: setup.label.trim() || type.label,
        secret,
      });

      say(app.problem, app.problem ? "error" : "");
    }

    const kind = type.type;

    app.destinationSetup = newDestinationSetup();
    app.destinationSetup.type = kind;
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
 * the reader's hands does not empty the form they are filling in.
 *
 * @param {object} holder where the typed value is kept
 * @param {object} field what to ask for
 * @param {string} scope which form this belongs to, for focus restoration
 * @param {boolean} [stored] whether a credential is already held for this field
 * @returns {HTMLElement} the labelled input
 */
function textField(holder, field, scope, stored = false) {
  const label = document.createElement("label");
  const caption = element("span", "mono field-label", field.label);

  // A stored credential is never rendered. Saying that one is held, and that an
  // empty box keeps it, is everything the reader needs and hands nothing back.
  if (stored) caption.append(element("span", "field-set", "set"));

  label.append(caption);

  const input = document.createElement("input");

  input.className = field.mono ? "mono" : "";
  input.type = field.secret ? "password" : "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  // A credential already held is not required again: blank means keep it. The
  // submit checks this as well, because these fields sit in a popover and the
  // native check cannot be the only thing standing between a typo and a source
  // that silently reads nothing.
  input.required = Boolean(field.required) && !stored;
  input.placeholder = stored ? "leave blank to keep" : field.placeholder || "";
  input.value = holder[field.key] || "";
  input.dataset.focusKey = `${scope}:${field.key}`;
  input.addEventListener("input", () => {
    holder[field.key] = input.value;
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

  wrapper.append(element("span", "mono field-label", label));

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
