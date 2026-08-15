import test from "node:test";
import assert from "node:assert";

import { parseDraft } from "../web/src/domain/draft.js";

const DRAFT = {
  schema: 3,
  owner: "org",
  repo: "app",
  number: 42,
  title: "Re-root the Records Store errors",
  url: "https://github.com/org/app/pull/42",
  reviewedAt: "e612b1b",
  draftedAt: "2026-07-29T15:36:52Z",
  finishedAt: "2026-07-29T15:41:10Z",
  verdict: "COMMENT",
  summary: "Re-rooted correctly, but the family catch-all is now inert.",
  sections: [
    { key: "general", label: "General", color: "warn", count: 2, body: "Small and nearly all right." },
    { key: "data-loss", body: "One of the four examples cannot fail." },
  ],
  comment: "**Comment** — a family catch-all that is now inert.\n\n### 👓 QA\n\nSkipped.",
};

// draft returns the fixture with one field replaced.
const draft = (changes) => parseDraft({ ...DRAFT, ...changes });

test("carries the fields the interface shows", () => {
  const parsed = parseDraft(DRAFT);

  assert.strictEqual(parsed.title, "Re-root the Records Store errors");
  assert.strictEqual(parsed.verdict, "COMMENT");
  assert.strictEqual(parsed.reviewedAt, "e612b1b");
  assert.match(parsed.comment, /family catch-all/);
});

test("carries the kinds with their summaries, tolerating their absence", () => {
  const parsed = draft({
    kinds: [{ key: "transition-debt", body: "Old surface carried forward." }, { key: "robustness" }],
  });

  assert.deepStrictEqual(parsed.kinds, [
    { key: "transition-debt", body: "Old surface carried forward." },
    { key: "robustness", body: "" },
  ]);

  assert.deepStrictEqual(draft({ kinds: undefined }).kinds, []);
});

test("carries the reviewer's progress, tolerating junk and absence", () => {
  const parsed = draft({ progress: { note: "QA: scenario 2 of 3", percent: 60 } });

  assert.deepStrictEqual(parsed.progress, { note: "QA: scenario 2 of 3", percent: 60 });
  assert.deepStrictEqual(draft({ progress: undefined }).progress, { note: "", percent: null });
  assert.deepStrictEqual(draft({ progress: { percent: "most" } }).progress, { note: "", percent: null });
  assert.strictEqual(draft({ progress: { percent: 250 } }).progress.percent, 100);
});

test("carries when and where the reader posted the whole review", () => {
  const parsed = draft({ postedAt: "2026-07-30T02:00:00Z", postedUrl: "https://github.com/org/app/pull/1#pullrequestreview-9" });

  assert.strictEqual(parsed.postedAt, "2026-07-30T02:00:00Z");
  assert.strictEqual(parsed.postedUrl, "https://github.com/org/app/pull/1#pullrequestreview-9");
  assert.strictEqual(parseDraft(DRAFT).postedAt, "");
});

test("carries finishedAt, and reads its absence as still in progress", () => {
  assert.strictEqual(parseDraft(DRAFT).finishedAt, "2026-07-29T15:41:10Z");
  assert.strictEqual(draft({ finishedAt: undefined }).finishedAt, "");
});

test("keeps the sections in the order the agent wrote them", () => {
  assert.deepStrictEqual(
    parseDraft(DRAFT).sections.map((section) => section.key),
    ["general", "data-loss"],
  );
});

test("accepts a draft with no sections at all", () => {
  assert.deepStrictEqual(draft({ sections: undefined }).sections, []);
});

test("lets the agent name sections this client has never heard of", () => {
  const parsed = draft({ sections: [{ key: "rollback", body: "no down migration" }] });

  assert.strictEqual(parsed.sections[0].key, "rollback");
  assert.strictEqual(parsed.sections[0].body, "no down migration");
});

test("makes a label out of the key when none is given", () => {
  assert.strictEqual(draft({ sections: [{ key: "data-loss", body: "x" }] }).sections[0].label, "Data loss");
});

test("prefers the label the agent supplied", () => {
  assert.strictEqual(
    draft({ sections: [{ key: "ui-and-ux", label: "UI and UX", body: "x" }] }).sections[0].label,
    "UI and UX",
  );
});

test("accepts each colour a section may pick", () => {
  for (const color of ["neutral", "ok", "warn", "critical", "accent"]) {
    assert.strictEqual(draft({ sections: [{ key: "k", color, body: "x" }] }).sections[0].color, color);
  }
});

test("degrades an unrecognised colour instead of failing the draft", () => {
  assert.strictEqual(draft({ sections: [{ key: "k", color: "#ff0000", body: "x" }] }).sections[0].color, "neutral");
  assert.strictEqual(draft({ sections: [{ key: "k", body: "x" }] }).sections[0].color, "neutral");
});

test("counts nothing for a section no finding points at", () => {
  assert.strictEqual(draft({ sections: [{ key: "k" }], findings: [] }).sections[0].count, 0);
});

test("refuses two sections sharing a key, which would hide one filter", () => {
  assert.throws(
    () => draft({ sections: [{ key: "k", body: "a" }, { key: "k", body: "b" }] }),
    /more than once/,
  );
});

test("refuses a schema this client does not know how to read", () => {
  assert.throws(() => draft({ schema: 4 }), /schema/);
  assert.throws(() => draft({ schema: undefined }), /schema/);
});

test("refuses a verdict that is not a GitHub review event", () => {
  assert.throws(() => draft({ verdict: "LGTM" }), /verdict/);
});

test("accepts a draft with no verdict when it proposes a comment", () => {
  assert.strictEqual(draft({ verdict: undefined }).verdict, "");
  assert.strictEqual(draft({ verdict: "" }).verdict, "");
});

test("accepts a draft proposing only a ticket description", () => {
  const parsed = draft({ verdict: undefined, comment: "", description: "New body." });

  assert.strictEqual(parsed.verdict, "");
  assert.strictEqual(parsed.description, "New body.");
});

test("treats a non-string description as absent", () => {
  assert.strictEqual(draft({ description: 42 }).description, "");
  assert.strictEqual(parseDraft(DRAFT).description, "");
});

test("refuses a draft that proposes nothing at all", () => {
  assert.throws(() => draft({ verdict: undefined, comment: "" }), /proposes nothing/);
  assert.throws(() => draft({ verdict: undefined, comment: "  ", description: " " }), /proposes nothing/);
});

test("carries a proposal to close the ticket", () => {
  assert.deepStrictEqual(draft({ close: { reason: "not_planned" } }).close, {
    reason: "not_planned",
    of: null,
  });
  assert.deepStrictEqual(draft({ close: { reason: "completed" } }).close, {
    reason: "completed",
    of: null,
  });
});

test("reads an absent close as no proposal at all", () => {
  assert.strictEqual(parseDraft(DRAFT).close, null);
  assert.strictEqual(draft({ close: null }).close, null);
});

test("refuses a close reason GitHub would not accept", () => {
  assert.throws(() => draft({ close: { reason: "wontfix" } }), /close reason/);
  assert.throws(() => draft({ close: {} }), /close reason/);
});

test("a duplicate must name the ticket it duplicates", () => {
  assert.deepStrictEqual(draft({ close: { reason: "duplicate", of: 41 } }).close, {
    reason: "duplicate",
    of: 41,
  });
  assert.throws(() => draft({ close: { reason: "duplicate" } }), /duplicates/);
  assert.throws(() => draft({ close: { reason: "duplicate", of: 0 } }), /duplicates/);
  assert.throws(() => draft({ close: { reason: "duplicate", of: "41" } }), /duplicates/);
});

test("other reasons ignore whatever of says", () => {
  assert.strictEqual(draft({ close: { reason: "completed", of: 41 } }).close.of, null);
});

test("accepts a draft proposing only a close", () => {
  const parsed = draft({ verdict: undefined, comment: "", close: { reason: "not_planned" } });

  assert.deepStrictEqual(parsed.close, { reason: "not_planned", of: null });
});

test("accepts each verdict a review can carry", () => {
  for (const verdict of ["APPROVE", "COMMENT", "REQUEST_CHANGES"]) {
    assert.strictEqual(draft({ verdict }).verdict, verdict);
  }
});

test("accepts an empty comment — the findings can be the whole review", () => {
  assert.strictEqual(draft({ comment: "" }).comment, "");
  assert.strictEqual(draft({ comment: undefined }).comment, "");
});

test("refuses a section without a key", () => {
  assert.throws(() => draft({ sections: [{ body: "x" }] }), /must have a key/);
  assert.throws(() => draft({ sections: [{ key: "  " }] }), /must have a key/);
  assert.throws(() => draft({ sections: "General" }), /must be a list/);
});

test("accepts a section with no body, which is now just a filter", () => {
  assert.strictEqual(draft({ sections: [{ key: "general" }] }).sections[0].body, "");
});

test("carries the one-line summary the pane shows under the sections", () => {
  assert.match(parseDraft(DRAFT).summary, /family catch-all is now inert/);
});


// Findings ------------------------------------------------------------------

const FINDING = { id: "f1", path: "lib/thing.rb", line: 12, body: "wrong" };

const withFindings = (...findings) => draft({ findings });

test("carries a finding anchored to a file and line", () => {
  const [finding] = withFindings(FINDING).findings;

  assert.strictEqual(finding.path, "lib/thing.rb");
  assert.strictEqual(finding.line, 12);
  assert.strictEqual(finding.body, "wrong");
});

test("keeps findings in the order the agent wrote them", () => {
  const findings = withFindings(
    { ...FINDING, id: "a" },
    { ...FINDING, id: "b" },
    { ...FINDING, id: "c" },
  ).findings;

  assert.deepStrictEqual(findings.map((finding) => finding.id), ["a", "b", "c"]);
});

test("defaults a finding's colour and leaves its kind alone", () => {
  const [plain] = withFindings(FINDING).findings;

  assert.strictEqual(plain.color, "neutral");
  assert.strictEqual(plain.kind, "");

  const [badged] = withFindings({ ...FINDING, kind: "bug", color: "critical" }).findings;

  assert.strictEqual(badged.kind, "bug");
  assert.strictEqual(badged.color, "critical");
});

test("degrades a finding's unrecognised colour rather than failing the draft", () => {
  assert.strictEqual(withFindings({ ...FINDING, color: "puce" }).findings[0].color, "neutral");
});

test("carries a committable suggestion when there is one", () => {
  assert.strictEqual(withFindings({ ...FINDING, suggestion: "x = 1\n" }).findings[0].suggestion, "x = 1\n");
  assert.strictEqual(withFindings(FINDING).findings[0].suggestion, null);
});

test("carries when the reader posted a finding on its own", () => {
  assert.strictEqual(withFindings({ ...FINDING, posted: "2026-07-30T01:00:00Z" }).findings[0].posted, "2026-07-30T01:00:00Z");
  assert.strictEqual(withFindings(FINDING).findings[0].posted, null);
});

test("defaults a finding to not blocking, but carries an explicit flag", () => {
  assert.strictEqual(withFindings(FINDING).findings[0].blocking, false);
  assert.strictEqual(withFindings({ ...FINDING, blocking: true }).findings[0].blocking, true);
  assert.strictEqual(withFindings({ ...FINDING, blocking: "yes" }).findings[0].blocking, false);
});

test("refuses a finding missing its anchor or its body", () => {
  assert.throws(() => withFindings({ id: "f", line: 1, body: "x" }), /path/);
  assert.throws(() => withFindings({ id: "f", path: "a.rb", body: "x" }), /line/);
  assert.throws(() => withFindings({ id: "f", path: "a.rb", line: 0, body: "x" }), /line/);
  assert.throws(() => withFindings({ id: "f", path: "a.rb", line: 1 }), /body/);
  assert.throws(() => withFindings({ path: "a.rb", line: 1, body: "x" }), /id/);
});

test("refuses two findings sharing an id, which would confuse what you dropped", () => {
  assert.throws(() => withFindings(FINDING, { ...FINDING }), /more than once/);
});

test("counts a section's findings so the agent need not", () => {
  const parsed = draft({
    sections: [{ key: "general" }, { key: "quiet" }],
    findings: [
      { ...FINDING, id: "a", section: "general" },
      { ...FINDING, id: "b", section: "general" },
    ],
  });

  assert.strictEqual(parsed.sections[0].count, 2);
  assert.strictEqual(parsed.sections[1].count, 0);
});

test("lets a section override its own count", () => {
  const parsed = draft({ sections: [{ key: "general", count: 9 }], findings: [] });

  assert.strictEqual(parsed.sections[0].count, 9);
});

// QA ------------------------------------------------------------------------

const SCENARIO = { id: "s1", url: "/members", what: "proves it", verdict: "pass" };

const withQa = (qa) => draft({ qa });

test("carries the QA note and scenarios", () => {
  const parsed = withQa({ note: "skipped", scenarios: [SCENARIO] });

  assert.strictEqual(parsed.qa.note, "skipped");
  assert.strictEqual(parsed.qa.scenarios[0].url, "/members");
  assert.strictEqual(parsed.qa.scenarios[0].verdict, "pass");
});

test("treats a scenario with no verdict as skipped rather than passing", () => {
  assert.strictEqual(withQa({ scenarios: [{ id: "s" }] }).qa.scenarios[0].verdict, "skip");
});

test("has an empty QA record when a draft says nothing about it", () => {
  assert.deepStrictEqual(draft({ qa: undefined }).qa, { note: "", scenarios: [] });
});

test("keeps a video path that stays inside the drafts directory", () => {
  assert.strictEqual(withQa({ scenarios: [{ id: "s", video: "qa/run.mp4" }] }).qa.scenarios[0].video, "qa/run.mp4");
});

test("refuses a video path that climbs out of the drafts directory", () => {
  for (const video of ["../secrets.mp4", "/etc/passwd", "qa/../../out.mp4", "~/x.mp4"]) {
    assert.throws(() => withQa({ scenarios: [{ id: "s", video }] }), /video/, `allowed ${video}`);
  }
});

// Fields the app writes back ------------------------------------------------

test("tolerates the fields the app adds when you work on a draft", () => {
  const parsed = draft({
    findings: [{ ...FINDING, dropped: true, drafted: "what the agent first wrote" }],
  });

  assert.strictEqual(parsed.findings[0].body, "wrong");
});

test("reports which findings the reader dropped", () => {
  const parsed = draft({
    findings: [
      { ...FINDING, id: "kept" },
      { ...FINDING, id: "gone", dropped: true },
    ],
  });

  assert.deepStrictEqual(
    parsed.findings.filter((finding) => finding.dropped).map((finding) => finding.id),
    ["gone"],
  );
});

test("remembers what the agent wrote once a finding is edited", () => {
  const parsed = draft({
    findings: [{ ...FINDING, body: "my words", drafted: "their words" }],
  });

  assert.strictEqual(parsed.findings[0].drafted, "their words");
});
