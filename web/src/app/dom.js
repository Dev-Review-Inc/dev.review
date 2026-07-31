// The small pieces every pane builds from.
//
// Nothing here reads or writes application state. It exists so the panes can be
// about what they show rather than about document.createElement.

// The mark shown beside a section, derived from its colour rather than chosen,
// so a green tick can never sit beside a critical finding.
export const GLYPH = {
  neutral: "·",
  ok: "✓",
  warn: "!",
  critical: "✕",
  accent: "›",
};

// Severity order for picking a chip's tone: the worst wins.
export const TONE_RANK = ["critical", "warn", "accent", "ok", "neutral"];

// Inline so the content security policy stays closed to remote images.
export const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 3.5v-1a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 2.5V8A1.5 1.5 0 0 0 4 9.5h-.5" transform="translate(0 1)" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

// A circling arrow: the draft goes, and one gets written again in its place.
export const REDRAFT_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13.5 1.5v3.5H10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const COPIED_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * @param {string} id an element's id
 * @returns {HTMLElement} the element
 */
export function find(id) {
  return document.getElementById(id);
}

/**
 * Build an element with a class and text.
 *
 * Text, never markup: everything that reaches here came from a draft, a diff or
 * a destination, and the only path from any of those to HTML is renderBody.
 *
 * @param {string} tag the tag name
 * @param {string} className the class attribute
 * @param {string} text the text content
 * @returns {HTMLElement} the element
 */
export function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) node.className = className;
  node.textContent = text;

  return node;
}

/**
 * Human-readable age of a timestamp.
 *
 * @param {string} iso an ISO 8601 timestamp
 * @returns {string} e.g. "3h", "2d"
 */
export function age(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));

  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;

  return `${Math.round(minutes / 1440)}d`;
}

/**
 * A login reduced to what fits in an avatar.
 *
 * @param {string} login a destination login
 * @returns {string} one or two characters
 */
export function initials(login) {
  const parts = String(login).split(/[-_.]/).filter(Boolean);

  return (parts.length > 1 ? parts[0][0] + parts[1][0] : String(login).slice(0, 2)).toUpperCase();
}

/**
 * Report progress or failure in the footer.
 *
 * Every failure the interface meets ends up here. Nothing is allowed to fail
 * quietly and let the panes redraw as though it had worked.
 *
 * @param {string} message what to say
 * @param {string} [tone] "", "ok" or "error"
 * @returns {void}
 */
export function say(message, tone = "") {
  const status = find("status");

  status.textContent = message;
  status.className = tone;
}

/**
 * Do this once the click now under way has been delivered.
 *
 * A mouse takes the focus on the way down and clicks on the way up. Anything
 * that redraws in between moves the page under the pointer, and the click
 * lands on whatever took its target's place, or on nothing at all - so the
 * reader's one click would only tidy up after the last thing they did, and
 * they would have to make it again.
 *
 * @param {() => void} run what to do once the click has landed
 * @returns {void}
 */
export function afterClick(run) {
  let done = false;

  const finish = () => {
    if (done) return;

    done = true;
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointerup", onUp, true);
    run();
  };

  // Capture reaches this before the handlers the click is for; a microtask
  // holds the work until the whole of that click has been dealt with.
  const onClick = () => queueMicrotask(finish);

  // A press let go where no click follows - outside the window, on a
  // scrollbar - still has to release the work waiting on it.
  const onUp = () => setTimeout(finish, 100);

  document.addEventListener("click", onClick, true);
  document.addEventListener("pointerup", onUp, true);
}

/**
 * A composed empty state, so an absence reads as a state rather than a gap.
 *
 * @param {string} mark a glyph
 * @param {string} title what is going on
 * @param {string} text what to do about it
 * @returns {HTMLElement} the block
 */
export function emptyState(mark, title, text) {
  const block = document.createElement("div");
  block.className = "empty";

  const inner = document.createElement("div");
  inner.className = "empty-inner";
  inner.append(
    element("div", "empty-mark", mark),
    element("div", "empty-title", title),
    element("div", "empty-text", text),
  );

  block.append(inner);

  return block;
}

/**
 * One row of the tab rail - Summary, a lens, a theme, or QA evidence.
 *
 * @param {object} row what to render and how it behaves
 * @param {boolean} row.active whether this is the open tab
 * @param {string} row.tone a GLYPH/`is-*` tone key
 * @param {string} row.glyph the leading glyph
 * @param {string} row.label the row's name
 * @param {string} row.count trailing count text, or "" for none
 * @param {() => void} row.onClick what a click does
 * @returns {HTMLElement} the row
 */
export function tabRow({ active, tone, glyph, label, count, onClick }) {
  const row = document.createElement("button");
  row.className = `lens is-${tone}`;
  row.setAttribute("aria-pressed", String(active));
  row.append(
    element("span", "glyph", glyph),
    element("span", "name", label),
    element("span", "count", count),
  );
  row.addEventListener("click", onClick);

  return row;
}

/**
 * The worst tone among a set of findings.
 *
 * @param {object[]} findings the findings to weigh
 * @returns {string} a tone key
 */
export function worstTone(findings) {
  return findings.reduce(
    (tone, finding) =>
      TONE_RANK.indexOf(finding.color) < TONE_RANK.indexOf(tone) ? finding.color : tone,
    "neutral",
  );
}

/**
 * Arm a button on its first click and act on the second.
 *
 * Irreversible actions get two clicks, and the arming lapses on its own so a
 * button left armed cannot be triggered by a stray tap minutes later.
 *
 * A button that wears an icon rather than a word hands over how to put itself
 * back, because the question is text and setting text would eat the icon.
 *
 * @param {HTMLButtonElement} button the button to arm
 * @param {string} question what the armed button says
 * @param {string|(() => void)} settled what it says the rest of the time, or how to restore it
 * @returns {boolean} true when it was already armed and the caller should act
 */
export function arm(button, question, settled) {
  const settle =
    typeof settled === "function"
      ? settled
      : () => {
          button.textContent = settled;
        };

  if (button.dataset.armed === "true") {
    button.dataset.armed = "false";
    settle();

    return true;
  }

  button.dataset.armed = "true";
  button.textContent = question;

  setTimeout(() => {
    if (!button.isConnected) return;

    button.dataset.armed = "false";
    settle();
  }, 2500);

  return false;
}
