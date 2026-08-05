// The last place a failure can be noticed.
//
// This is a backstop. It is NOT somewhere to handle a failure, and adding a
// case to it is never the fix for one. A failure belongs to the code that
// caused it, because only there is it known what was being attempted, what the
// reader was told was happening, and what has to be put back. All that is known
// here is that something went wrong somewhere, which is the least useful thing
// anyone can be told.
//
// So anything that ever arrives here is a missing catch somewhere else. It is
// registered because the alternative is worse: without it a promise nobody held
// fails into the browser console, and the reader watches a button do nothing
// and is never told why.

/**
 * Notice what nobody caught.
 *
 * @param {EventTarget} scope the window
 * @param {(message: *, tone: string) => void} report how to tell the reader
 * @returns {void}
 */
export function backstop(scope, report) {
  // Not prevented: the console record is still what a developer needs to find
  // the catch that is missing, and taking it away would hide the evidence.
  scope.addEventListener("unhandledrejection", (event) => {
    if (harmless(event.reason?.message)) return;

    report(event.reason?.message, "error");
  });

  scope.addEventListener("error", (event) => {
    const message = event.error?.message || event.message;

    if (harmless(message)) return;

    report(message, "error");
  });
}

// The one message this backstop knows by name rather than by a missing catch.
// The browser fires it as a real error event when a ResizeObserver callback's
// own layout change would trigger another resize in the same frame, so it
// defers what it cannot deliver this frame instead - a scheduling detail, not
// a promise anyone forgot to hold, and it says nothing about any catch this
// app is missing. Reporting it to the reader as if it were their draft's
// problem would be a false alarm on every browser that fires it, which is
// every Chromium one.
function harmless(message) {
  return typeof message === "string" && message.startsWith("ResizeObserver loop");
}
