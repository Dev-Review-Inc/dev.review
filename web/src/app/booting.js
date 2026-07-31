// Starting up.
//
// Everything the interface needs arrives at a different moment: the log from
// disk, the login and the queue from the destination, the drafts from the
// source, the diff from the destination again. Drawing each one as it lands
// makes the interface assemble itself in front of the reader, over a shell
// whose defaults claim there is no source and nothing to review while both are
// still on their way.
//
// So the whole start up is one moment. Nothing is drawn until all of it is in,
// and the curtain over it is lifted once, on an interface already whole.

// How long the curtain stays up at the least. A start up that beats this is
// the good case, and showing it for eighty milliseconds would put a flash of
// loading exactly where the staggered paints used to be.
export const FLOOR = 500;

/**
 * Start the interface up behind the curtain.
 *
 * Failures are reported and then passed over: an app that could not reach its
 * destination still has an interface, and leaving the reader under the curtain
 * would be the one outcome worse than the empty one.
 *
 * @param {object} options how to start
 * @param {() => Promise<void>} options.boot bring the app back to where it was
 * @param {() => Promise<void>} options.open open the first ready review, if there is one
 * @param {() => void} options.render draw everything
 * @param {() => void} options.reveal lift the curtain
 * @param {(failure: Error) => void} options.failed say what went wrong
 * @param {(ms: number) => Promise<void>} [options.wait] hold for this long
 * @param {() => number} [options.now] what time it is
 * @returns {Promise<void>} when the interface is on screen
 */
export async function startup({
  boot,
  open,
  render,
  reveal,
  failed,
  wait = sleep,
  now = () => Date.now(),
}) {
  const started = now();

  try {
    await boot();
    await open();
  } catch (failure) {
    failed(failure);
  }

  render();

  await wait(Math.max(0, FLOOR - (now() - started)));

  reveal();
}

/**
 * @param {number} ms how long
 * @returns {Promise<void>} when it has passed
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
