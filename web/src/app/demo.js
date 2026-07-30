// The demo, attached on first sight of a page that asked for one.
//
// A marketing page embeds this app exactly as it ships and hands it sample data
// instead of a token. Nothing here is a mode: the demo is two ordinary sources
// and an ordinary destination, added through the same commands the setup form
// uses, and everything downstream of that is the real app.

// The sample data is served beside the app rather than at the origin root: the
// marketing site owns "/", and the app sits under whatever prefix that site
// gives it.
const seedUrl = (name) => new URL(`../../demo/${name}.json`, import.meta.url).href;

// Two ways in. One is a walk through what the app does; the other is a review
// of real work, for a reader who would rather see the thing than be shown it.
const SOURCES = [
  { name: "Take the tour", seed: "tour" },
  { name: "A real review", seed: "real" },
];

// The queue is one list covering both sources, because a destination answers
// for every pull request either source has a draft about.
const QUEUE = "queue";

/**
 * Whether this page asked for the demo.
 *
 * The query string is passed in rather than read here, so what decides this is
 * testable without a browser.
 *
 * @param {string} search the page's query string
 * @returns {boolean} whether the demo should be attached
 */
export function demoWanted(search) {
  return new URLSearchParams(search).has("demo");
}

/**
 * Attach the demo, unless this browser already has something attached.
 *
 * Idempotent on purpose. It runs on every load of a page carrying the demo
 * flag, and a reader who has been through it once should come back to their own
 * decisions rather than to a second copy of the sample data.
 *
 * @param {object} app the application, restored but not yet opened
 * @returns {Promise<{source: object, destination: object}|null>} what it attached, or null if it left well alone
 */
export async function installDemo(app) {
  if (app.queries.allSources().length) return null;

  const sources = [];

  for (const source of SOURCES) {
    sources.push(
      await app.commands.addSource({
        name: source.name,
        adapter: { type: "demo", label: source.name, seed: seedUrl(source.seed) },
      }),
    );
  }

  const destination = await app.commands.addDestination({
    type: "demo",
    label: "Demo",
    seed: seedUrl(QUEUE),
  });

  await app.state.setPreference("source", sources[0].id);
  await app.state.setPreference("destination", destination.id);

  // Which one opens is a decision made here, in the order the sources are
  // listed: the tour first, because it is the one that explains itself.
  return { source: sources[0], destination };
}

/**
 * Whether everything attached here is sample data.
 *
 * @param {object} app the application
 * @returns {boolean} whether there is nothing of the reader's own to lose
 */
function onlyTheDemo(app) {
  const sources = app.queries.allSources();
  const destinations = app.queries.allDestinations();

  return (
    sources.length > 0 &&
    sources.every((source) => source.adapter?.type === "demo") &&
    destinations.every((destination) => destination.type === "demo")
  );
}

/**
 * Put the demo back the way it was written.
 *
 * Decisions persist, which is the point of it and also its trap: a visitor who
 * triages everything is left looking at an empty marketing page, and so is the
 * next person to open that browser. Dropping the sources takes their decision
 * logs with them, so what comes back is the sample data rather than the sample
 * data plus a history.
 *
 * It refuses to touch a browser holding anything real. The demo flag is a query
 * parameter, so anyone can put it on a URL, and it must not be a way to talk
 * somebody's own reader into deleting itself.
 *
 * @param {object} app the application
 * @returns {Promise<void>} when the demo is as it started
 */
export async function resetDemo(app) {
  if (!onlyTheDemo(app)) return;

  for (const source of app.queries.allSources()) await app.removeSource(source);
  for (const destination of app.queries.allDestinations()) {
    await app.removeDestination(destination);
  }

  const attached = await installDemo(app);

  if (!attached) return;

  // Boot opens the source and destination after installing them. This runs long
  // after boot, so it has to do that part itself, or the reader is left looking
  // at sample data that is attached but not open.
  //
  // It opens exactly what was attached rather than whichever source happens to
  // be listed first, which is how a reset ended up on the review instead of the
  // tour it is supposed to start on.
  await app.switchSource(attached.source);
  await app.switchDestination(attached.destination);
}
