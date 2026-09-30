import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseRules, readRules, actionFor } from "../rules.js";

const rules = (...list) => parseRules(JSON.stringify({ rules: list }));

test("a pull request no rule names is drafted, as it always was", () => {
  assert.strictEqual(actionFor([], { author: "priya" }), "draft");
  assert.strictEqual(
    actionFor(rules({ when: { author: "tomas" }, then: "post" }), { author: "priya" }),
    "draft",
  );
});

test("an author rule matches whatever the case", () => {
  const list = rules({ when: { author: "Priya" }, then: "post" });
  assert.strictEqual(actionFor(list, { author: "priya" }), "post");
});

test("the first matching rule wins", () => {
  const list = rules(
    { when: { repo: "org/app" }, then: "skip" },
    { when: { author: "priya" }, then: "post" },
  );
  assert.strictEqual(actionFor(list, { author: "priya", repo: "org/app" }), "skip");
});

test("every condition in a rule has to hold", () => {
  const list = rules({ when: { author: "priya", verdict: "COMMENT" }, then: "post" });
  assert.strictEqual(actionFor(list, { author: "priya", verdict: "APPROVE" }), "draft");
  assert.strictEqual(actionFor(list, { author: "priya", verdict: "COMMENT" }), "post");
});

test("a list of values matches any one of them", () => {
  const list = rules({ when: { verdict: ["COMMENT", "APPROVE"] }, then: "post" });
  assert.strictEqual(actionFor(list, { verdict: "APPROVE" }), "post");
  assert.strictEqual(actionFor(list, { verdict: "REQUEST_CHANGES" }), "draft");
});

test("a label rule matches any label the pull request carries", () => {
  const list = rules({ when: { label: "dependencies" }, then: "skip" });
  assert.strictEqual(actionFor(list, { labels: ["bug", "Dependencies"] }), "skip");
  assert.strictEqual(actionFor(list, { labels: [] }), "draft");
});

test("isDraft is matched as a boolean", () => {
  const list = rules({ when: { isDraft: true }, then: "skip" });
  assert.strictEqual(actionFor(list, { isDraft: true }), "skip");
  assert.strictEqual(actionFor(list, { isDraft: false }), "draft");
});

test("a fact nobody knows yet never satisfies a condition on it", () => {
  const list = rules({ when: { author: "priya", verdict: "COMMENT" }, then: "post" });
  assert.strictEqual(actionFor(list, { author: "priya" }), "draft");
  assert.strictEqual(actionFor(rules({ when: { isDraft: false }, then: "post" }), {}), "draft");
});

test("refuses a file it only half understands", () => {
  assert.throws(() => parseRules("{"), /rules\.json/);
  assert.throws(() => parseRules("[]"), /rules/);
  assert.throws(() => rules({ when: { auther: "priya" }, then: "post" }), /auther/);
  assert.throws(() => rules({ when: { author: "priya" }, then: "merge" }), /merge/);
  assert.throws(() => rules({ when: {}, then: "post" }), /condition/);
  assert.throws(() => rules({ when: { author: 7 }, then: "post" }), /author/);
  assert.throws(() => rules({ when: { isDraft: "yes" }, then: "skip" }), /isDraft/);
});

test("a drafts directory with no rules file has no rules", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
  assert.deepStrictEqual(readRules(dir), []);
});

test("reads the rules file that sits in the drafts directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-"));
  fs.writeFileSync(
    path.join(dir, "rules.json"),
    JSON.stringify({ rules: [{ when: { author: "priya" }, then: "post" }] }),
  );
  assert.strictEqual(actionFor(readRules(dir), { author: "priya" }), "post");
});
