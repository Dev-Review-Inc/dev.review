// Reading the patches GitHub sends for a pull request's files.
//
// A finding is anchored to a path and a line in the file's new state, so the
// diff has to carry both sides' line numbers: the gutter shows them, and a
// finding is placed against the new-side number it names.

// A hunk header, with the line counts optional — git omits a count of 1.
const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse one file's patch into hunks of numbered lines.
 *
 * A file with no patch — a rename, a binary, or one GitHub truncated — yields
 * no hunks rather than failing: there is simply nothing to show.
 *
 * @param {string|undefined} patch the `patch` field of a pull request file
 * @returns {{header: string, oldStart: number, newStart: number, lines: object[]}[]} the hunks
 */
export function parsePatch(patch) {
  if (!patch) return [];

  const hunks = [];
  let hunk = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.split("\n")) {
    const header = line.match(HEADER);

    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk = { header: line, oldStart: oldLine, newStart: newLine, lines: [] };
      hunks.push(hunk);

      continue;
    }

    // Anything before the first header is the file-level preamble, and the
    // no-newline marker is a note about the previous line, not a line itself.
    if (!hunk || line.startsWith("\\")) continue;

    const marker = line[0];
    const text = line.slice(1);

    if (marker === "+") {
      hunk.lines.push({ kind: "add", oldLine: null, newLine, text });
      newLine += 1;
    } else if (marker === "-") {
      hunk.lines.push({ kind: "del", oldLine, newLine: null, text });
      oldLine += 1;
    } else {
      hunk.lines.push({ kind: "context", oldLine, newLine, text });
      oldLine += 1;
      newLine += 1;
    }
  }

  return hunks;
}
