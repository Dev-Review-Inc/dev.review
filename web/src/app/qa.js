// What was actually run against the change.
//
// The recordings no longer come over HTTP. They are bytes read through the
// source's adapter and handed to the page as object URLs, which means every
// one of them has to be given back: an object URL that is never released holds
// its blob in memory for the life of the tab.

import { renderBody } from "../domain/render.js";
import { GLYPH, element, find, say } from "./dom.js";

// How a scenario's outcome reads. A run nobody claimed passed is a skip.
const QA_TONE = { pass: "ok", fail: "critical", skip: "neutral" };
const QA_WORD = { pass: "passed", fail: "failed", skip: "not run" };

// Where a draft's video paths are relative to, matching what Drafts reads.
const ROOT = "drafts/";

// Every recording currently held, keyed by the owning draft's draftedAt plus
// the path. Held across draws on purpose: the interface redraws whole on every
// change, and a recording re-fetched each time flashes blank and forgets its
// place, which reads as the app reloading. The draftedAt in the key is the
// honest invalidation - a redraft is the one moment the bytes may genuinely
// differ, so it reads again; every other redraw reuses the url synchronously.
const held = new Map();

// Where the reader had got to in each recording, by path rather than by draw,
// so their place survives both a redraw and a redraft.
const places = new Map();

/**
 * Give back every recording the last draw did not use.
 *
 * Called at the top of each draw. An entry the previous draw used is kept and
 * its mark cleared, so one draw's grace is the most any unused blob outlives
 * its last appearance.
 *
 * @returns {void}
 */
export function releaseMedia() {
  for (const [key, entry] of held) {
    if (entry.used) {
      entry.used = false;

      continue;
    }

    entry.release?.();
    held.delete(key);
  }
}

/**
 * Draw the QA pane.
 *
 * @param {object} app the application
 * @returns {void}
 */
export function drawQa(app) {
  const qa = find("qa");

  qa.replaceChildren();
  qa.append(...qaContent(app));
}

/**
 * The QA evidence as renderable pieces - header, scenario cards, note.
 *
 * One builder because the evidence shows in two places: its own tab, and the
 * tail of the summary.
 *
 * @param {object} app the application
 * @param {{report?: boolean}} [options] `report: false` leaves out the header
 *   and the written note - the summary wants only the recordings
 * @returns {HTMLElement[]} the pieces, or none when there is nothing to say
 */
export function qaContent(app, { report = true } = {}) {
  const draft = app.selected?.draft;

  if (!draft) return [];

  const { note, scenarios } = draft.qa;

  // Without the report, only the recordings are worth a section at all.
  if (!scenarios.length && (!note || !report)) return [];

  const out = [];

  const head = document.createElement("div");
  head.className = "qa-head";
  head.append(element("span", "", "👓 qa evidence"));

  if (scenarios.length) {
    const failed = scenarios.filter((run) => run.verdict === "fail").length;

    head.append(
      element(
        "span",
        "note",
        failed ? `${scenarios.length} run · ${failed} failing` : `${scenarios.length} run`,
      ),
    );
  }

  if (report) out.push(head);

  // A failing scenario is the most valuable thing a review carries, so it sorts
  // first rather than being left in the order it happened to run.
  const ordered = [...scenarios].sort(
    (one, two) => (two.verdict === "fail") - (one.verdict === "fail"),
  );

  for (const run of ordered) {
    const tone = QA_TONE[run.verdict] || "neutral";

    const block = document.createElement("div");
    block.className = `scenario is-${tone}`;

    const bar = document.createElement("div");
    bar.className = "scenario-head";
    bar.append(element("span", "glyph", GLYPH[tone]));

    if (run.url) bar.append(element("span", "url", run.url));
    if (run.what) bar.append(element("span", "what", run.what));

    bar.append(element("span", "verdict", QA_WORD[run.verdict] || "not run"));
    block.append(bar);

    block.append(run.video ? recording(app, run) : element("div", "scenario-missing", "no recording"));

    const foot = document.createElement("div");
    foot.className = "scenario-foot";

    if (run.frames !== null) foot.append(element("span", "", `frames · ${run.frames}`));
    if (run.durationMs !== null) {
      foot.append(element("span", "", `duration · ${(run.durationMs / 1000).toFixed(1)}s`));
    }

    block.append(foot);
    out.push(block);
  }

  if (note && report) {
    const block = document.createElement("div");
    block.className = "qa-note";
    block.innerHTML = renderBody(note);
    out.push(block);
  }

  return out;
}

/**
 * A scenario's recording, fetched through the adapter rather than the network.
 *
 * @param {object} app the application
 * @param {object} run the scenario
 * @returns {HTMLElement} the video, or a note saying why there is none
 */
function recording(app, run) {
  const video = document.createElement("video");

  video.controls = true;
  video.preload = "metadata";

  // Put the reader back where they were once the new element can seek.
  video.addEventListener("timeupdate", () => places.set(run.video, video.currentTime));
  video.addEventListener("loadedmetadata", () => {
    const place = places.get(run.video);

    if (place) video.currentTime = place;
  });

  const key = `${app.selected?.draft?.draftedAt || ""}|${run.video}`;
  const kept = held.get(key);

  if (kept) {
    kept.used = true;

    // Synchronously: an async re-fetch here is a blank frame on every redraw.
    if (kept.url) video.src = kept.url;

    return video;
  }

  const entry = { url: "", release: null, used: true };

  held.set(key, entry);

  app.adapter
    .media(`${ROOT}${run.video}`)
    .then((media) => {
      if (!media) {
        held.delete(key);
        video.replaceWith(element("div", "scenario-missing", "recording is missing"));

        return;
      }

      entry.url = media.url;
      entry.release = media.release;

      // Even when this draw has already been replaced: the entry owns the
      // blob now, the next draw reuses its url, and releaseMedia gives it
      // back once no draw does.
      video.src = media.url;
    })
    .catch((failure) => {
      held.delete(key);
      say(`could not read the recording: ${failure.message}`, "error");
      video.replaceWith(element("div", "scenario-missing", "recording could not be read"));
    });

  return video;
}
