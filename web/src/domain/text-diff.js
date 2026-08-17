// Diffing a proposed issue body against the live one.
//
// A reader keeps or rejects whole hunks, and the decision has to survive the
// live body drifting underneath the proposal. So each hunk gets an id hashed
// from what it changes — not where — and applyHunks rebuilds the final text
// from whichever hunks the reader kept.
//
// The hunk shape matches diff.js's parsePatch, so the same renderer draws both.

const CONTEXT = 3;

// A body is a list of lines; an empty body has none, not one empty line.
function toLines(text) {
  return text === "" ? [] : text.split("\n");
}

// FNV-1a, hex. Cheap, stable, and eight characters is plenty for one diff.
function hash(str) {
  let h = 0x811c9dc5;

  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0;
  }

  return h.toString(16).padStart(8, "0");
}

// Classic LCS by dynamic programming — issue bodies are small enough that the
// quadratic table costs nothing and the answer is exactly minimal.
function editScript(oldLines, newLines) {
  const n = oldLines.length;
  const m = newLines.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        oldLines[i] === newLines[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    if (i < n && j < m && oldLines[i] === newLines[j]) {
      ops.push({ kind: "context", oldLine: i + 1, newLine: j + 1, text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) {
      ops.push({ kind: "del", oldLine: i + 1, newLine: null, text: oldLines[i] });
      i += 1;
    } else {
      ops.push({ kind: "add", oldLine: null, newLine: j + 1, text: newLines[j] });
      j += 1;
    }
  }

  return ops;
}

/**
 * Diff two texts into parsePatch-shaped hunks, each with a content-derived id.
 *
 * The id hashes only the hunk's del/add lines, so an identical edit keeps its
 * id when everything above it shifts; identical edits within one diff are told
 * apart by an occurrence suffix.
 *
 * @param {string} oldText the live body
 * @param {string} newText the proposed body
 * @returns {{id: string, header: string, oldStart: number, newStart: number, lines: object[]}[]} the hunks
 */
export function diffText(oldText, newText) {
  const ops = editScript(toLines(oldText), toLines(newText));

  // Group changed runs, folding two runs together when their context regions
  // would touch — the same rule that keeps unified diffs from overlapping.
  const spans = [];

  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i].kind === "context") continue;

    const last = spans[spans.length - 1];

    if (last && i - last.to - 1 <= CONTEXT * 2) last.to = i;
    else spans.push({ from: i, to: i });
  }

  const seen = new Map();

  return spans.map(({ from, to }) => {
    const lines = ops.slice(Math.max(0, from - CONTEXT), Math.min(ops.length, to + CONTEXT + 1));

    // A side with no lines at all starts at 0, git's way of writing "nowhere".
    const oldStart = lines.find((line) => line.oldLine !== null)?.oldLine ?? 0;
    const newStart = lines.find((line) => line.newLine !== null)?.newLine ?? 0;
    const oldCount = lines.filter((line) => line.oldLine !== null).length;
    const newCount = lines.filter((line) => line.newLine !== null).length;

    const changes = lines
      .filter((line) => line.kind !== "context")
      .map((line) => (line.kind === "del" ? "-" : "+") + line.text)
      .join("\n");
    const base = hash(changes);
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);

    return {
      id: nth === 0 ? base : `${base}-${nth}`,
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      oldStart,
      newStart,
      lines,
    };
  });
}

/**
 * Rebuild the text from the hunks the reader kept.
 *
 * With nothing rejected this reproduces the proposed text exactly; with
 * everything rejected it returns the old text untouched.
 *
 * @param {string} oldText the live body the hunks were diffed against
 * @param {object[]} hunks the hunks from diffText, in order
 * @param {string[]} rejectedIds ids of the hunks the reader turned down
 * @returns {string} the resulting body
 */
export function applyHunks(oldText, hunks, rejectedIds) {
  const rejected = new Set(rejectedIds);
  const oldLines = toLines(oldText);
  const out = [];
  let cursor = 0;

  for (const hunk of hunks) {
    if (rejected.has(hunk.id)) continue;

    const first = hunk.lines.find((line) => line.oldLine !== null);
    const start = first ? first.oldLine - 1 : cursor;

    while (cursor < start) out.push(oldLines[cursor++]);

    for (const line of hunk.lines) {
      if (line.kind === "add") out.push(line.text);
      else if (line.kind === "del") cursor += 1;
      else out.push(oldLines[cursor++]);
    }
  }

  while (cursor < oldLines.length) out.push(oldLines[cursor++]);

  return out.join("\n");
}
