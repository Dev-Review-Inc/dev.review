// Pure decision logic for install.mjs, kept out of the readline loop so it can
// be tested without faking a terminal.
//
//   extractFencedFiles   reads the skill/collector files out of install.md
//   expandHome           resolves "~" the way a shell would, without a shell
//   draftsDirPlan        what to do with the drafts directory, before touching disk
//   upsertDraftsLine     the CLAUDE.md line that names the drafts directory

import path from "node:path";

/**
 * The installable files named in install.md, in the order they appear.
 *
 * install.md is generated from skills/*.md and skills/collector/*.js
 * (skills/install-doc.mjs), but it is also hand-edited in the field ahead of a
 * regeneration landing here, so it — not the generator's source files — is
 * the copy actually meant for installing right now. Reading it back out this
 * way means the wizard installs exactly what a human reading the file by hand
 * would paste, nothing rebuilt from a source that might be a step behind.
 *
 * A heading (`### \`path\``) is followed by a fenced block; the fence is
 * whatever length the heading's block opens with, so an inner fence — shorter
 * by construction — never ends the block early.
 *
 * @param {string} markdown the contents of install.md
 * @returns {{path: string, content: string}[]} one entry per fenced file
 */
export function extractFencedFiles(markdown) {
  const lines = markdown.split("\n");
  const files = [];

  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^### `(.+)`$/);

    if (!heading) continue;

    let open = i + 1;

    while (open < lines.length && !/^`{3,}/.test(lines[open])) open++;

    const fence = lines[open]?.match(/^(`{3,})\S*\s*$/);

    if (!fence) continue;

    const marker = fence[1];
    let close = open + 1;

    while (close < lines.length && lines[close] !== marker) close++;

    files.push({ path: heading[1], content: lines.slice(open + 1, close).join("\n") });
    i = close;
  }

  return files;
}

/**
 * Resolve a user-typed path the way a shell would expand it, without a shell.
 *
 * @param {string} input what the user typed
 * @param {string} home the user's home directory
 * @returns {string} an absolute path
 */
export function expandHome(input, home) {
  const trimmed = input.trim();

  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return path.join(home, trimmed.slice(2));
  if (path.isAbsolute(trimmed)) return trimmed;

  return path.resolve(home, trimmed);
}

/**
 * Where drafts live when the user has no opinion.
 *
 * @param {string} home the user's home directory
 * @returns {string} a suggested drafts directory
 */
export function defaultDraftsDir(home) {
  return path.join(home, "reviewer-drafts");
}

/**
 * What is already at the target path.
 *
 * @param {string[]|null} entries `fs.readdirSync(dir)`, or null when the
 *   directory does not exist
 * @returns {"missing"|"empty"|"occupied"} the directory's state
 */
export function classifyDirectory(entries) {
  if (entries === null) return "missing";

  return entries.length === 0 ? "empty" : "occupied";
}

/**
 * What the wizard does with the drafts directory, decided before anything
 * touches disk. Keeping this pure means the one branch that must never
 * silently clobber existing drafts — an occupied directory — is provable
 * without a filesystem.
 *
 * @param {object} answers
 * @param {"missing"|"empty"|"occupied"} answers.state what is already at the target path
 * @param {"local-only"|"attach-remote"|"different-dir"} [answers.reconcile] required, and only meaningful, when state is "occupied"
 * @param {boolean} [answers.wantsGit] required, and only meaningful, when state is "missing" or "empty"
 * @returns {{createDir: boolean, setupGit: boolean, restart: boolean}} what to do next
 */
export function draftsDirPlan({ state, reconcile, wantsGit }) {
  if (state === "occupied") {
    if (reconcile === "different-dir") return { createDir: false, setupGit: false, restart: true };

    return { createDir: false, setupGit: reconcile === "attach-remote", restart: false };
  }

  return { createDir: state === "missing", setupGit: Boolean(wantsGit), restart: false };
}

/** Matches the drafts-dir line this wizard writes, however it was phrased before. */
const DRAFTS_LINE = /^My dev review drafts dir is .*\.$/im;

/**
 * The CLAUDE.md line that names the drafts directory.
 *
 * @param {string} draftsDir the chosen drafts directory
 * @returns {string} the line to add
 */
export function claudeMdLine(draftsDir) {
  return `My dev review drafts dir is ${draftsDir}.`;
}

/**
 * CLAUDE.md with the drafts-dir line set, replacing a previous one rather
 * than piling up a second when the wizard is run again with a new path.
 *
 * @param {string} content the current CLAUDE.md, or "" if there is none yet
 * @param {string} draftsDir the chosen drafts directory
 * @returns {string} CLAUDE.md with the line set
 */
export function upsertDraftsLine(content, draftsDir) {
  const line = claudeMdLine(draftsDir);

  if (DRAFTS_LINE.test(content)) return content.replace(DRAFTS_LINE, line);

  const trimmed = content.replace(/\n+$/, "");

  return trimmed ? `${trimmed}\n\n${line}\n` : `${line}\n`;
}
