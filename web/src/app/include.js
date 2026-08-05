// The opt-in control, wherever something can be opted in.
//
// A review goes out carrying only what the reader said it should, so the same
// question gets asked of the summary and of every finding - and asking it the
// same way twice is one control, not two that look alike until one of them is
// changed.

import { element } from "./dom.js";

/**
 * @param {boolean} included whether the thing is in what gets sent
 * @param {Function} onToggle what to do when the reader changes their mind
 * @returns {HTMLElement} the toggle
 */
export function includeToggle(included, onToggle) {
  // A toggle button rather than a native checkbox, the same recipe
  // #files-flagged already uses (a styled box plus a label), so "on or off"
  // reads the same wherever it shows up.
  const toggle = document.createElement("button");

  toggle.type = "button";
  toggle.className = "finding-include";
  toggle.setAttribute("aria-pressed", String(included));
  toggle.append(element("span", "box", ""), document.createTextNode("Include"));
  toggle.addEventListener("click", onToggle);

  return toggle;
}
