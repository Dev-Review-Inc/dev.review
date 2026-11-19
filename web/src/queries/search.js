// Finding an entry on the queue by what the reader remembers of it.

/**
 * The entries that match a query, best first.
 *
 * A number ranks the exact match first, then the numbers that start with it.
 * Any other entry matches when its text holds every word of the query.
 *
 * @param {object[]} entries the queue, in its own order
 * @param {string} query what the reader typed
 * @returns {object[]} the matches
 */
export function searchQueue(entries, query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (!words.length) return entries;

  const digits = /^#?(\d+)$/.exec(words.join(""))?.[1];
  const rank = (entry) => {
    const number = String(entry.number);

    if (digits && number === digits) return 0;
    if (digits && number.startsWith(digits)) return 1;

    const text = `${entry.owner}/${entry.repo}#${number} ${entry.title} ${entry.author}`.toLowerCase();

    return words.every((word) => text.includes(word)) ? 2 : null;
  };

  return entries
    .map((entry) => ({ entry, rank: rank(entry) }))
    .filter((found) => found.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((found) => found.entry);
}
