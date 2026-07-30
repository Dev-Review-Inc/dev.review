// The contract between the review sweep and this interface.
//
// A draft is a JSON document written to the drafts directory. It is not parsed
// out of prose: the sweep states its verdict and hands over the exact comment
// it would post, so rewording the review template can never change what this
// client believes a review says.
//
// The section bodies and the comment are markdown, rendered by render.js.

// The only shape this client knows how to read. A draft written to a later
// schema is refused rather than half-understood.
const SCHEMA = 3;

// The review events GitHub accepts, and the only verdicts a draft may carry.
const VERDICTS = ["APPROVE", "COMMENT", "REQUEST_CHANGES"];

// The colours a section may pick. Named rather than free: the app maps these
// onto its own palette, so no draft can produce an unreadable pane.
const COLORS = ["neutral", "ok", "warn", "critical", "accent"];

// What a QA scenario can report. Anything else, including nothing, is a skip:
// silence is not a pass.
const VERDICTS_QA = ["pass", "fail", "skip"];

/**
 * A section's reader-facing name, defaulting to its key made presentable.
 *
 * @param {object} section one entry of a draft's sections
 * @returns {string} the label to show
 */
function labelOf(section) {
  if (typeof section.label === "string" && section.label.trim()) return section.label;

  const spaced = section.key.replace(/-/g, " ");

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Check the sections, which are optional but must be well formed.
 *
 * What the sections are is the drafting agent's business, not this client's: it
 * renders whatever it is handed. Only the shape is checked, never the keys.
 *
 * @param {*} sections the sections field of a draft
 * @returns {{key: string, label: string, color: string, count: number|null, body: string}[]}
 * @throws {Error} if any section lacks a key or a body, or a key repeats
 */
function sectionsOf(sections, findings) {
  if (sections === undefined || sections === null) return [];

  if (!Array.isArray(sections)) {
    throw new Error("draft sections must be a list");
  }

  const keys = new Set();

  return sections.map((section) => {
    if (!section || typeof section.key !== "string" || !section.key.trim()) {
      throw new Error("draft section must have a key");
    }

    // Keys identify filters, so a repeat would make one section unreachable.
    if (keys.has(section.key)) {
      throw new Error(`draft section ${section.key} appears more than once`);
    }

    keys.add(section.key);

    return {
      key: section.key,
      label: labelOf(section),
      // An unrecognised colour degrades rather than failing the draft: a
      // mis-picked name should never cost the reader a review.
      color: COLORS.includes(section.color) ? section.color : "neutral",
      // The agent should not have to keep a tally in step with its own
      // findings, so the count is derived unless it is explicitly overridden.
      count: Number.isInteger(section.count)
        ? section.count
        : findings.filter((finding) => finding.section === section.key).length,
      body: typeof section.body === "string" ? section.body : "",
    };
  });
}

/**
 * Check the kinds, the coined categories findings carry, each optionally
 * carrying a summary of what the category means in this change.
 *
 * @param {*} kinds the kinds field of a draft
 * @returns {{key: string, body: string}[]}
 * @throws {Error} if a kind lacks a key
 */
function kindsOf(kinds) {
  if (kinds === undefined || kinds === null) return [];

  if (!Array.isArray(kinds)) {
    throw new Error("draft kinds must be a list");
  }

  return kinds.map((kind) => {
    if (!kind || typeof kind.key !== "string" || !kind.key.trim()) {
      throw new Error("draft kind must have a key");
    }

    return {
      key: kind.key,
      body: typeof kind.body === "string" ? kind.body : "",
    };
  });
}

/**
 * Check the reviewer's own progress note, written on incremental saves so
 * the reader can see where an unfinished review has got to.
 *
 * @param {*} progress the progress field of a draft
 * @returns {{note: string, percent: number|null}}
 */
function progressOf(progress) {
  const source = progress || {};

  return {
    note: typeof source.note === "string" ? source.note : "",
    percent: typeof source.percent === "number" && Number.isFinite(source.percent)
      ? Math.max(0, Math.min(100, source.percent))
      : null,
  };
}

/**
 * A path that must stay inside the drafts directory.
 *
 * The app reads video from that directory and nowhere else, so a draft must not
 * be able to name a file outside it — the draft is written by an agent, and an
 * agent reads other people's branches.
 *
 * @param {*} value the path as written, relative to the drafts directory
 * @param {string} field what it is, for the error message
 * @returns {string|null} the path, or null when there is none
 * @throws {Error} if the path is absolute or climbs out
 */
function contained(value, field) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value !== "string") {
    throw new Error(`draft ${field} must be a path`);
  }

  const escapes =
    value.startsWith("/") ||
    value.startsWith("~") ||
    value.split("/").includes("..");

  if (escapes) {
    throw new Error(`draft ${field} must stay inside the drafts directory`);
  }

  return value;
}

/**
 * Check the findings: the individual comments, each anchored to a line.
 *
 * @param {*} findings the findings field of a draft
 * @returns {object[]} the findings, in the order written
 * @throws {Error} if any finding lacks an id, an anchor or a body
 */
function findingsOf(findings) {
  if (findings === undefined || findings === null) return [];

  if (!Array.isArray(findings)) {
    throw new Error("draft findings must be a list");
  }

  const ids = new Set();

  return findings.map((finding) => {
    const source = finding || {};

    if (typeof source.id !== "string" || !source.id.trim()) {
      throw new Error("draft finding must have an id");
    }

    if (typeof source.path !== "string" || !source.path.trim()) {
      throw new Error(`draft finding ${source.id} must have a path`);
    }

    if (!Number.isInteger(source.line) || source.line < 1) {
      throw new Error(`draft finding ${source.id} must have a line`);
    }

    if (typeof source.body !== "string" || !source.body.trim()) {
      throw new Error(`draft finding ${source.id} must have a body`);
    }

    // Ids are how the app remembers what you kept and dropped, so a repeat
    // would silently apply one decision to two comments.
    if (ids.has(source.id)) {
      throw new Error(`draft finding ${source.id} appears more than once`);
    }

    ids.add(source.id);

    return {
      id: source.id,
      path: source.path,
      line: source.line,
      section: typeof source.section === "string" ? source.section : "",
      kind: typeof source.kind === "string" ? source.kind : "",
      color: COLORS.includes(source.color) ? source.color : "neutral",
      // Whether this blocks merge on its own, so the footer can warn a reader
      // who approves anyway.
      blocking: source.blocking === true,
      body: source.body,
      suggestion: typeof source.suggestion === "string" ? source.suggestion : null,
      // Written by the app, not the agent: whether the reader dropped this,
      // what it said before they edited it, and when they posted it on its
      // own ahead of the review.
      dropped: source.dropped === true,
      drafted: typeof source.drafted === "string" ? source.drafted : null,
      posted: typeof source.posted === "string" ? source.posted : null,
    };
  });
}

/**
 * Check the QA record: what was actually run against the change.
 *
 * @param {*} qa the qa field of a draft
 * @returns {{note: string, scenarios: object[]}} the QA record
 * @throws {Error} if a scenario lacks an id or names a video outside the drafts directory
 */
function qaOf(qa) {
  const source = qa || {};
  const scenarios = Array.isArray(source.scenarios) ? source.scenarios : [];

  return {
    note: typeof source.note === "string" ? source.note : "",
    scenarios: scenarios.map((scenario) => {
      const run = scenario || {};

      if (typeof run.id !== "string" || !run.id.trim()) {
        throw new Error("draft qa scenario must have an id");
      }

      return {
        id: run.id,
        url: typeof run.url === "string" ? run.url : "",
        what: typeof run.what === "string" ? run.what : "",
        // Absent means nobody said it passed, which is not the same as passing.
        verdict: VERDICTS_QA.includes(run.verdict) ? run.verdict : "skip",
        video: contained(run.video, `qa scenario ${run.id} video`),
        frames: Number.isInteger(run.frames) ? run.frames : null,
        durationMs: Number.isInteger(run.durationMs) ? run.durationMs : null,
      };
    }),
  };
}

/**
 * Read a draft written by the review sweep.
 *
 * @param {object} payload the decoded JSON document
 * @returns {{title: string, url: string, reviewedAt: string, draftedAt: string, verdict: string, summary: string, sections: object[], comment: string}}
 * @throws {Error} if the draft is not a shape this client can act on
 */
export function parseDraft(payload) {
  const draft = payload || {};

  if (draft.schema !== SCHEMA) {
    throw new Error(`draft schema ${draft.schema} is not readable by this client`);
  }

  if (!VERDICTS.includes(draft.verdict)) {
    throw new Error(`draft verdict ${draft.verdict} is not a review event`);
  }

  const findings = findingsOf(draft.findings);

  return {
    title: draft.title || "",
    url: draft.url || "",
    reviewedAt: draft.reviewedAt || "",
    draftedAt: draft.draftedAt || "",
    finishedAt: draft.finishedAt || "",
    // Written by the app when the reader posts: the draft stays as the
    // record of what was sent, rather than vanishing.
    postedAt: typeof draft.postedAt === "string" ? draft.postedAt : "",
    postedUrl: typeof draft.postedUrl === "string" ? draft.postedUrl : "",
    verdict: draft.verdict,
    summary: draft.summary || "",
    findings,
    qa: qaOf(draft.qa),
    sections: sectionsOf(draft.sections, findings),
    kinds: kindsOf(draft.kinds),
    progress: progressOf(draft.progress),
    // Empty is a legitimate summary: the findings can be the whole review.
    comment: typeof draft.comment === "string" ? draft.comment : "",
  };
}
