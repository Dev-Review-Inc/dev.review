// Builds install.md out of the files it installs.
//
// The install document carries the skills and the collector inline, so that one
// fetch of one URL is the whole install and nothing has to be chased down
// afterwards. That means every embedded file is a second copy of a file that
// already exists in this repository, and a second copy is a thing that drifts.
//
// So it is generated rather than written, and a test rebuilds it and compares.
// Editing a skill and forgetting the install document turns that test red
// instead of quietly shipping an installer for last month's skill.
//
//   node skills/install-doc.mjs      rewrite install.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Each skill, and where it has to land for Claude Code to find it.
const SKILLS = [
  {
    file: "dev-review.md",
    to: "~/.claude/skills/dev-review/SKILL.md",
    what: "Drafts one pull request into the schema.",
  },
  {
    file: "dev-review-sweep.md",
    to: "~/.claude/skills/dev-review-sweep/SKILL.md",
    what: "Finds what is waiting and runs the first over each.",
  },
];

// The sweep's queue helper. It is four modules that import each other by
// relative path, so they go into one directory together or none of them works.
const COLLECTOR = ["queue.js", "select-new.js", "draft-path.js", "resolve-repo.js", "prune-drafts.js"];
const COLLECTOR_TO = "~/.claude/skills/dev-review-sweep/collector";

const read = (name) => fs.readFileSync(path.join(here, name), "utf8").trimEnd();

// The skills carry fenced blocks of their own, so the fence that wraps them has
// to be longer than the longest one inside or the first inner fence ends the
// outer block and the rest of the file spills onto the page as prose.
function fence(body) {
  const longest = (body.match(/^`{3,}/gm) || []).reduce((most, run) => Math.max(most, run.length), 0);

  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * The install document, as it should be on disk.
 *
 * @returns {string} the markdown
 */
export function buildInstall() {
  const out = [];

  out.push("# Install");
  out.push("");
  out.push(
    "Two skills that draft code reviews and post nothing. Everything they need is in this file, so there is nothing else to fetch.",
  );
  out.push("");
  out.push("**Reading this as an agent?** Write each block below to the path above it, exactly as it is. Then tell the reader which skills are installed and what to set as their drafts directory.");
  out.push("");
  out.push("**Reading this yourself?** Same thing: each fenced block is one file, and the line above it says where it goes.");
  out.push("");
  out.push("You need the `gh` CLI, authenticated, and node. Nothing here posts to GitHub, and nothing here needs a token of ours, because there is no account to have.");
  out.push("");
  out.push("## The skills");
  out.push("");

  for (const skill of SKILLS) {
    out.push(`### \`${skill.to}\``);
    out.push("");
    out.push(skill.what);
    out.push("");
    const body = read(skill.file);
    const wrap = fence(body);

    out.push(`${wrap}markdown`);
    out.push(body);
    out.push(wrap);
    out.push("");
  }

  out.push("## The queue helper");
  out.push("");
  out.push(
    `The sweep asks this which pull requests have no draft yet. The four modules import each other by relative path, so they belong in \`${COLLECTOR_TO}/\` together.`,
  );
  out.push("");

  for (const name of COLLECTOR) {
    out.push(`### \`${COLLECTOR_TO}/${name}\``);
    out.push("");
    const body = read(path.join("collector", name));
    const wrap = fence(body);

    out.push(`${wrap}javascript`);
    out.push(body);
    out.push(wrap);
    out.push("");
  }

  out.push("## After installing");
  out.push("");
  out.push(
    "Name a drafts directory in your `CLAUDE.md`, and point a source in the app at the same directory. The sweep writes there and the app reads there; that is the whole integration.",
  );
  out.push("");
  out.push("Run `/dev-review-sweep` to draft what is waiting on you, then open the app to read it. What reaches GitHub is what you send.");
  out.push("");

  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(here, "..", "install.md"), buildInstall());
  console.log("wrote install.md");
}
