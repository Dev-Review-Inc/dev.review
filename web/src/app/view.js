// The interface.
//
// One rule holds the whole thing together: the view never decides anything. It
// reads through `app.queries`, writes through `app.commands`, and redraws when
// `app` says something moved. Nothing here filters, sorts or counts what a
// query already answers, so the footer's numbers and the pane's list can never
// disagree about what is being looked at.

import { App } from "./app.js";
import { startup } from "./booting.js";
import { demoWanted, installDemo, resetDemo } from "./demo.js";
import { find, say } from "./dom.js";
import { dismissedWords, leaveWords } from "./words.js";
import { celebrate, closeConfirm, openConfirm, post } from "./confirm.js";
import {
  closeQueue,
  closeSetup,
  drawHeader,
  newDestinationSetup,
  newSourceSetup,
  toggleQueue,
  toggleSetup,
} from "./header.js";
import { drawDiff } from "./diff-pane.js";
import { DISMISS, drawFooter } from "./footer.js";
import { drawQa, releaseMedia } from "./qa.js";
import { drawRail } from "./rail.js";
import { drawSummary, toggleEditor } from "./summary.js";

// A page that asked for the demo gets sample data attached on its first load.
// Every other page gets an app with nothing in it, as before.
const app = new App({ install: demoWanted(location.search) ? installDemo : null });

// View-only state, kept on the app beside the rest of what is being looked at
// rather than in a second state object the panes would have to keep in step.
app.editing = false;
app.editingFinding = null;
app.addingAt = null;
app.setup = newSourceSetup();
app.destinationSetup = newDestinationSetup();
// Which item the settings panel's detail is showing: a source, a destination,
// an add in progress, or nothing.
app.settingsSelection = { kind: "", id: null };

// Whether the first finished review has been opened for the reader. Opening
// cold, that review is the obvious next action, so it is opened rather than
// pointed at - but only ever once, and never over an open one.
let opened = false;

/**
 * Draw everything.
 *
 * A redraw is whole rather than surgical, which is affordable because it only
 * happens when something actually moved. What it must not do is lose the
 * reader's place or what they were typing, so the scroll offsets and the
 * focused field are carried across it.
 *
 * @returns {void}
 */
function render() {
  const places = keepPlace();

  releaseMedia();

  drawHeader(app);
  drawRail(app);
  drawTab();
  drawSummary(app);
  drawDiff(app);
  drawQa(app);
  drawFooter(app);

  restorePlace(places);
  autoOpen();
}

function drawTab() {
  find("tab-summary").hidden = app.tab !== "summary";
  find("tab-diff").hidden = app.tab !== "diff";
  find("tab-qa").hidden = app.tab !== "qa";
}

/**
 * Open the first finished review, if one is waiting and none is open.
 *
 * Awaited on the way in, so the review the reader lands on is part of the one
 * arrival rather than the thing that turns up after it. Later on it is called
 * from a redraw and its promise dropped, because by then a review becoming
 * ready is a change like any other.
 *
 * @returns {Promise<void>} when it is open
 */
function autoOpen() {
  if (opened || app.selected) return Promise.resolve();

  const ready = app.queue().find((entry) => entry.isReady);

  if (!ready) return Promise.resolve();

  opened = true;

  return open(ready);
}

function keepPlace() {
  const active = document.activeElement;

  return {
    pane: document.querySelector(".pane")?.scrollTop || 0,
    comment: find("comment").scrollTop,
    focusKey: active?.dataset?.focusKey || "",
    start: active?.selectionStart ?? null,
    end: active?.selectionEnd ?? null,
  };
}

function restorePlace(places) {
  const pane = document.querySelector(".pane");

  if (pane) pane.scrollTop = places.pane;
  find("comment").scrollTop = places.comment;

  if (!places.focusKey) return;

  const field = document.querySelector(`[data-focus-key="${places.focusKey}"]`);

  if (!field) return;

  field.focus();

  if (places.start !== null) field.setSelectionRange(places.start, places.end);
}

/**
 * Open a pull request, clearing whatever was half-written about the last one.
 *
 * @param {object} pull one entry from the queue
 * @returns {Promise<void>} when its draft and diff are in
 */
function open(pull) {
  app.editing = false;
  app.editingFinding = null;
  app.addingAt = null;
  say("");

  return app.select(pull).catch((failure) => say(failure.message, "error"));
}

// ---- Wiring

find("source-button").addEventListener("click", () => toggleSetup(app));
find("setup-backdrop").addEventListener("click", closeSetup);
find("queue-button").addEventListener("click", () => toggleQueue(app));
find("queue-backdrop").addEventListener("click", closeQueue);

find("files-flagged").addEventListener("click", () => {
  if (!app.source) return;

  app.commands.showFlaggedOnly(app.source, !app.queries.isFlaggedOnly(app.source));
  app.changed();
});

find("edit").addEventListener("click", () => toggleEditor(app));

find("post").addEventListener("click", () => {
  if (!app.dismissing) return openConfirm(app);

  // There is no sheet to confirm because there is nothing to send: the
  // decision is local, and the way back is the restore the queue offers.
  const pull = app.selected;

  app.commands.dismissPull(app.source, pull);
  app.dismissing = false;
  // Answering "nothing" leaves nothing to look at, so the review is closed
  // rather than left open under a footer offering to post it after all.
  app.selected = null;
  app.changed();

  // The same screen a posted review gets. Finishing with a pull request is the
  // thing being marked, and deciding there was nothing to say is a way of
  // finishing with it. The words are the dismissal's own, so nothing here
  // claims a review went anywhere.
  celebrate(app, pull, pull.url, dismissedWords());
});

find("verdicts").addEventListener("click", (event) => {
  const button = event.target.closest("button");

  if (!button || !app.selected) return;

  app.dismissing = button.dataset.event === DISMISS;

  if (!app.dismissing) app.commands.chooseVerdict(app.source, app.selected, button.dataset.event);

  app.reselect();
});

find("confirm-post").addEventListener("click", () => post(app));
find("confirm-cancel").addEventListener("click", () => closeConfirm(app));

find("confirm").addEventListener("click", (event) => {
  // Clicking the backdrop is a way out, but a click inside the sheet is not.
  if (event.target === find("confirm")) closeConfirm(app);
});

find("cheer-close").addEventListener("click", () => (find("celebrate").hidden = true));

find("celebrate").addEventListener("click", (event) => {
  if (event.target === find("celebrate")) find("celebrate").hidden = true;
});

find("signout").addEventListener("click", async () => {
  // The demo has no token to forget, so the same corner puts it back instead.
  // Signing out of it would leave a visitor holding an app with nowhere to post.
  if (leaveWords(app).resets) {
    try {
      await resetDemo(app);
      say("the demo is back to how it started", "ok");
    } catch (failure) {
      say(failure.message, "error");
    }

    return;
  }

  const destination = app.queries.findDestination(app.destinationId);

  if (!destination) return;

  try {
    await app.removeDestination(destination);
    say("signed out", "ok");
  } catch (failure) {
    say(failure.message, "error");
  }
});

// A window coming back to the front is the cheapest moment to notice that the
// queue moved while it was away.
window.addEventListener("focus", () => {
  app.loadQueue().catch((failure) => say(failure.message, "error"));
});

// Nothing redraws while the curtain is up: the interface is drawn once, whole,
// underneath it. Only after it lifts does a change mean a redraw, so `render`
// is subscribed then rather than now.
startup({
  boot: async () => {
    await app.boot();

    if (app.problem) say(app.problem, "error");
  },
  open: autoOpen,
  render,
  reveal: () => (find("curtain").hidden = true),
  failed: (failure) => say(failure.message, "error"),
}).then(() => app.onChange(render));
