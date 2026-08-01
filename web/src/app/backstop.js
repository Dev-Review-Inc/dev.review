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
    report(event.reason?.message, "error");
  });

  scope.addEventListener("error", (event) => {
    report(event.error?.message || event.message, "error");
  });
}
