// What the sweep does with a pull request, as its reader configured it.
//
//   <drafts-dir>/rules.json
//   { "rules": [ { "when": { "author": "priya" }, "then": "post" } ] }
//
// The first rule whose every condition holds decides. A pull request no rule
// names is drafted for a person to read, which is what the sweep always did.
// A file that is only half understood is refused whole: a typo in a condition
// must never widen what gets posted.

import fs from "node:fs";
import path from "node:path";

// What a rule can ask for: post the finished draft, never draft it, or leave
// it as a draft for the reader.
export const ACTIONS = ["post", "skip", "draft"];

// Conditions whose value is text (one value, or a list meaning any of them).
const TEXT = ["author", "repo", "verdict", "label"];

// Conditions whose value is true or false.
const FLAGS = ["isDraft"];

/**
 * A condition's value as a lowercased list.
 *
 * @param {string} name the condition, for the error
 * @param {string|string[]} value one value or several
 * @returns {string[]} the values to match any of
 * @throws {Error} if a value is not text
 */
function wanted(name, value) {
  const values = Array.isArray(value) ? value : [value];

  if (!values.length || values.some((one) => typeof one !== "string" || !one)) {
    throw new Error(`rules.json: ${name} must be text, or a list of text`);
  }

  return values.map((one) => one.toLowerCase());
}

/**
 * One rule, checked.
 *
 * @param {object} rule a rule as written in the file
 * @returns {{when: object, then: string}} the rule with its text conditions normalised
 * @throws {Error} if any part of it is not understood
 */
function parseRule(rule) {
  if (!rule || typeof rule !== "object" || !rule.when || typeof rule.when !== "object") {
    throw new Error("rules.json: every rule needs a when and a then");
  }

  if (!ACTIONS.includes(rule.then)) {
    throw new Error(`rules.json: ${rule.then} is not something a rule can do`);
  }

  const names = Object.keys(rule.when);

  if (!names.length) {
    throw new Error("rules.json: a rule needs at least one condition");
  }

  const when = {};

  for (const name of names) {
    if (TEXT.includes(name)) {
      when[name] = wanted(name, rule.when[name]);
    } else if (FLAGS.includes(name)) {
      if (typeof rule.when[name] !== "boolean") {
        throw new Error(`rules.json: ${name} must be true or false`);
      }

      when[name] = rule.when[name];
    } else {
      throw new Error(`rules.json: ${name} is not a condition`);
    }
  }

  return { when, then: rule.then };
}

/**
 * The rules in a rules file.
 *
 * @param {string} json the file's contents
 * @returns {object[]} the rules, in the order they are tried
 * @throws {Error} if the file is not understood in full
 */
export function parseRules(json) {
  let document;

  try {
    document = JSON.parse(json);
  } catch (error) {
    throw new Error(`rules.json: ${error.message}`);
  }

  if (!document || !Array.isArray(document.rules)) {
    throw new Error("rules.json: expected { \"rules\": [ ... ] }");
  }

  return document.rules.map(parseRule);
}

/**
 * The rules a drafts directory carries. No file means no rules.
 *
 * @param {string} draftsDir the drafts directory
 * @returns {object[]} the rules, in the order they are tried
 * @throws {Error} if the file is there and not understood in full
 */
export function readRules(draftsDir) {
  const file = path.join(draftsDir, "rules.json");

  return fs.existsSync(file) ? parseRules(fs.readFileSync(file, "utf8")) : [];
}

/**
 * Whether one condition holds. A fact nobody knows never satisfies it.
 *
 * @param {string} name the condition
 * @param {string[]|boolean} value what the rule asks for
 * @param {object} facts what is known about the pull request
 * @returns {boolean} whether it holds
 */
function holds(name, value, facts) {
  if (FLAGS.includes(name)) return facts[name] === value;

  const known = name === "label" ? facts.labels : facts[name];
  const have = (Array.isArray(known) ? known : [known])
    .filter((one) => typeof one === "string")
    .map((one) => one.toLowerCase());

  return have.some((one) => value.includes(one));
}

/**
 * What to do with a pull request.
 *
 * @param {object[]} rules rules from parseRules
 * @param {{author?: string, repo?: string, verdict?: string, labels?: string[], isDraft?: boolean}} facts what is known about it
 * @returns {string} "post", "skip" or "draft"
 */
export function actionFor(rules, facts) {
  const rule = rules.find(({ when }) =>
    Object.entries(when).every(([name, value]) => holds(name, value, facts)),
  );

  return rule ? rule.then : "draft";
}
