// The sample data the demo runs on.
//
// A marketing page embeds this app with no token in it, so both halves of the
// app have to come from somewhere that needs no credential: a static JSON file
// served beside the page. The reading half takes the drafts out of it and the
// writing half takes the per-item answers - files, commits, live issue bodies -
// which is why fetching one lives here rather than in either.

/**
 * Read a seed document, answering with what went wrong rather than throwing.
 *
 * Sample data that is not there is a page deployed without its data, which is
 * our mistake and not the reader's. It shows as an empty app carrying an
 * explanation, the same way a bucket that refuses a connection does.
 *
 * @param {string} url where the seed document is served, empty for no seed
 * @param {(url: string) => Promise<object>} fetcher how to fetch it
 * @returns {Promise<{document: object, problem: string}>} the seed, or why there is none
 */
export async function readSeed(url, fetcher) {
  if (!url) return { document: {}, problem: "" };

  try {
    const response = await fetcher(url);

    if (!response.ok) {
      return { document: {}, problem: `the sample data at ${url} is not there` };
    }

    return { document: (await response.json()) || {}, problem: "" };
  } catch (error) {
    return { document: {}, problem: `the sample data at ${url} could not be read: ${error.message}` };
  }
}

/**
 * How the demo names a pull request in its seed document.
 *
 * @param {{owner: string, repo: string, number: number}} pull which pull request
 * @returns {string} e.g. "org/app#1"
 */
export function seedKey(pull) {
  return `${pull.owner}/${pull.repo}#${pull.number}`;
}
