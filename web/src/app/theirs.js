// Whether this browser has been set up by the reader, and what the root does
// about it.
//
// The site takes the root of this origin and the interface sits under /app/. A
// reader who has attached storage of their own has read the pitch already, so
// the root stops being a pitch and becomes the way in. That decision cannot be
// made on the server: what a reader has attached is in this browser and nowhere
// else, and this app keeps it that way on purpose.
//
// One flag, in local storage rather than in the event log, because the site
// reads it before any of the app has loaded and an IndexedDB read is neither
// synchronous nor free. It records one bit that is already implied by the log,
// so losing it costs a reader one look at the pitch and nothing more.

// The flag. Read by the site, written by the app, so it lives here and neither
// side keeps a second spelling of it.
export const KEY = "reviewer.theirs";

/**
 * Whether storage or a destination has been attached by the reader here.
 *
 * @param {Storage} store local storage, or anything shaped like it
 * @returns {boolean} true when this browser has been set up
 */
export function remembered(store) {
  // A browser with storage turned off throws on the way in rather than
  // answering. The pitch is the safe reply, and this is not worth taking the
  // page down over.
  try {
    return store?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Remember that the reader attached something of their own.
 *
 * Called from the two App methods the reader's own forms reach, and from
 * nowhere else. The demo attaches its sample storage through the commands
 * underneath those, which is what keeps a homepage visitor a homepage visitor:
 * the frame on the pitch would otherwise mark every reader as set up and send
 * them past the very page they were reading.
 *
 * @param {Storage} store local storage, or anything shaped like it
 * @returns {void}
 */
export function remember(store) {
  try {
    store?.setItem(KEY, "1");
  } catch {
    // A reader who cannot be remembered sees the pitch again. That is a worse
    // greeting, not a broken one.
  }
}

/**
 * Where the root should send this reader, if anywhere.
 *
 * @param {Storage} store local storage, or anything shaped like it
 * @param {{search: string, top: boolean}} at the page's query and whether it is the top window
 * @returns {string} where to go, or "" to stay
 */
export function entering(store, at) {
  // The homepage pins the interface into itself. A framed copy that followed
  // this would load the interface where the demo should be, and one that sent
  // its parent would take the pitch off the screen of someone reading it.
  if (!at.top) return "";

  // The way back to the pitch, for the people most likely to want to link to
  // it. Without this the site becomes unreachable to exactly them.
  if (new URLSearchParams(at.search).has("site")) return "";

  return remembered(store) ? "/app/" : "";
}
