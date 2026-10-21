// What the board lays out, apart from how it is drawn.
//
// Columns are read off the flags pullState sets, in the same precedence the
// queue row's stateOf reads them, so the board and the queue cannot disagree.

const COLUMNS = ["drafting", "stalled", "ready", "posted", "dismissed"];

function columnOf(entry) {
  if (entry.postedAt) return "posted";
  if (entry.dismissedAt) return "dismissed";
  if (entry.isDrafting) return "drafting";
  if (entry.isStalled) return "stalled";
  if (entry.isReady) return "ready";

  return "not started";
}

/**
 * The board's columns, each with its entries in the order given.
 *
 * @param {object[]} entries pullState entries, queue and dismissed together
 * @returns {{key: string, entries: object[]}[]} every column, plus "not started" when anything is
 */
export function boardColumns(entries) {
  const columns = [...COLUMNS, "not started"].map((key) => ({ key, entries: [] }));

  for (const entry of entries) columns.find((column) => column.key === columnOf(entry)).entries.push(entry);

  return columns.filter((column) => column.key !== "not started" || column.entries.length);
}

/**
 * Findings grouped by kind, in the order each kind first appears.
 *
 * @param {object[]} [findings] a draft's findings
 * @returns {{kind: string, findings: object[]}[]} the groups; "" holds findings with no kind
 */
export function findingsByKind(findings = []) {
  const groups = new Map();

  for (const finding of findings) {
    const kind = finding.kind || "";

    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(finding);
  }

  return [...groups].map(([kind, grouped]) => ({ kind, findings: grouped }));
}

/**
 * The first line of a body that has words on it.
 *
 * @param {string} body markdown
 * @returns {string} that line, trimmed
 */
export function firstLine(body) {
  return (body || "").split("\n").map((line) => line.trim()).find(Boolean) || "";
}
