// Command-K: find an item on the queue by its number or its words.
//
// Drawn imperatively, outside render(), so a redraw never steals the cursor
// from the search field.

import { searchQueue } from "../queries/search.js";
import { element, find } from "./dom.js";
import { stateOf } from "./header.js";

let matches = [];
let active = 0;
let pick = () => {};

/**
 * Open the search, or close it when it is already open.
 *
 * @param {object} app the application
 * @param {(entry: object) => void} onPick what opening an entry does
 * @returns {void}
 */
export function togglePalette(app, onPick) {
  if (!find("palette").hidden) return closePalette();

  pick = onPick;
  find("palette").hidden = false;
  find("palette-backdrop").hidden = false;

  const input = find("palette-input");

  input.value = "";
  input.oninput = () => search(app);
  input.onkeydown = (event) => steer(event);
  search(app);
  input.focus();
}

/**
 * @returns {void}
 */
export function closePalette() {
  find("palette").hidden = true;
  find("palette-backdrop").hidden = true;
}

function search(app) {
  matches = searchQueue([...app.queue(), ...app.dismissed()], find("palette-input").value);
  active = 0;
  draw();
}

function steer(event) {
  if (event.key === "ArrowDown") active = Math.min(active + 1, matches.length - 1);
  else if (event.key === "ArrowUp") active = Math.max(active - 1, 0);
  else if (event.key === "Enter") return choose(matches[active]);
  else if (event.key === "Escape") return closePalette();
  else return;

  event.preventDefault();
  draw();
}

function choose(entry) {
  if (!entry) return;

  closePalette();
  pick(entry);
}

function draw() {
  const list = find("palette-results");

  list.replaceChildren();

  if (!matches.length) {
    list.append(element("div", "palette-empty", "Nothing on the queue matches."));
    return;
  }

  matches.forEach((entry, index) => {
    const row = element("button", "palette-row");
    const { tone, word } = stateOf(entry);

    row.setAttribute("aria-selected", String(index === active));
    row.append(
      element("span", "palette-number mono", `#${entry.number}`),
      element("span", "palette-title", entry.title),
      element("span", "palette-repo mono", `${entry.owner}/${entry.repo}`),
      element("span", `state ${tone}`, word),
    );
    row.addEventListener("click", () => choose(entry));
    list.append(row);

    if (index === active) row.scrollIntoView?.({ block: "nearest" });
  });
}
