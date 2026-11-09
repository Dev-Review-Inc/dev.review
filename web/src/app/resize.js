// Dragging the rail and the terminal dock to a width. Each width is a CSS
// variable on <main>, kept across launches.

const CODE = 320;
const RAIL = { min: 200, variable: "--rail-width", key: "reviewer.railWidth" };
const DOCK = { min: 280, variable: "--dock-width", key: "reviewer.dockWidth" };

const clamp = (want, min, max) => Math.round(Math.max(min, Math.min(want, max)));

/**
 * The rail's width with the pointer at `x`.
 *
 * @param {{left: number, width: number}} main main's box
 * @param {number} x the pointer
 * @param {number} dock the dock's width, 0 when there is none
 * @returns {number} the width, in px
 */
export function railWidth(main, x, dock) {
  return clamp(x - main.left, RAIL.min, main.width - dock - CODE);
}

/**
 * The dock's width with the pointer at `x`.
 *
 * @param {{right: number, width: number}} main main's box
 * @param {number} x the pointer
 * @param {number} rail the rail's width
 * @returns {number} the width, in px
 */
export function dockWidth(main, x, rail) {
  return clamp(main.right - x, DOCK.min, main.width - rail - CODE);
}

function store(key, value) {
  try {
    if (value == null) return globalThis.localStorage?.getItem(key);
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Not kept: the next launch starts at the default width.
  }
}

const width = (node) => node?.getBoundingClientRect().width || 0;

function grip(handle, edge, measure) {
  handle.addEventListener("pointerdown", (down) => {
    const main = document.querySelector("main");

    down.preventDefault();
    handle.setPointerCapture(down.pointerId);
    main.classList.add("dragging");

    const move = (event) => {
      const px = `${measure(main.getBoundingClientRect(), event.clientX)}px`;

      main.style.setProperty(edge.variable, px);
      main.classList.add(`${edge === RAIL ? "rail" : "dock"}-sized`);
      store(edge.key, px);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      main.classList.remove("dragging");
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

/**
 * Let the rail's grip drag it, and put back the widths last chosen.
 *
 * @returns {void}
 */
export function resizableRail() {
  const main = document.querySelector("main");

  for (const edge of [RAIL, DOCK]) {
    const kept = store(edge.key);

    if (kept) {
      main.style.setProperty(edge.variable, kept);
      main.classList.add(`${edge === RAIL ? "rail" : "dock"}-sized`);
    }
  }

  const dock = () => document.getElementById("terminal-dock");

  grip(document.getElementById("rail-grip"), RAIL, (box, x) =>
    railWidth(box, x, dock().hidden || dock().classList.contains("collapsed") ? 0 : width(dock())),
  );
}

/**
 * Let a grip on the dock's left edge drag it.
 *
 * @param {HTMLElement} handle the grip
 * @returns {void}
 */
export function resizableDock(handle) {
  grip(handle, DOCK, (box, x) => dockWidth(box, x, width(document.querySelector(".pane"))));
}
