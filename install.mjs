#!/usr/bin/env node
// A wizard for install.md, for the questions a human kept having to ask an
// agent to walk them through: where drafts live, whether they're backed by a
// git remote, and what to do when the target folder already has files in it.
//
// Everything it writes to the drafts directory or to git is announced before
// it happens, and nothing is committed or pushed without being asked first —
// this project's storage is the user's, not ours, and a wizard that pushes as
// a surprise would break that as surely as a backend that phones home.
//
//   node install.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { extractFencedFiles, expandHome, defaultDraftsDir, classifyDirectory, draftsDirPlan, claudeMdLine, upsertDraftsLine } from "./install-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();

// readline/promises' own rl.question() only ever resolves once against piped
// (non-TTY) stdin — the second call hangs forever, which is exactly the input
// method a wizard test or a scripted run uses. Reading the interface as an
// async iterator instead delivers every line, piped or typed.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();

async function ask(question) {
  process.stdout.write(question);
  const { value } = await lines.next();

  return value ?? "";
}

/** A yes/no prompt, defaulting to whichever answer is capitalised in the label. */
async function confirm(question, fallback) {
  const hint = fallback ? "Y/n" : "y/N";
  const answer = (await ask(`${question} [${hint}] `)).trim().toLowerCase();

  if (!answer) return fallback;

  return answer.startsWith("y");
}

/** Run a git command in `cwd`, or return null instead of throwing. */
function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Ask where drafts should live and how the target directory should be
 * reconciled, looping if the user picks a different path. Returns once a plan
 * is settled that will not silently touch an occupied directory.
 *
 * @returns {Promise<{draftsDir: string, plan: {createDir: boolean, setupGit: boolean}}>}
 */
async function chooseDraftsDir() {
  const suggestion = defaultDraftsDir(home);

  for (;;) {
    const typed = await ask(`Where should drafts live? [${suggestion}] `);
    const draftsDir = expandHome(typed || suggestion, home);

    const entries = fs.existsSync(draftsDir) ? fs.readdirSync(draftsDir) : null;
    const state = classifyDirectory(entries);

    let plan;

    if (state === "occupied") {
      console.log(`\n${draftsDir} already has ${entries.length} file(s) in it.`);
      const choice = (
        await ask(
          "  1) keep it local, don't touch git\n" +
            "  2) attach it to a git remote (nothing is committed or pushed without asking)\n" +
            "  3) use a different directory instead\n" +
            "Reconcile how? [1] ",
        )
      ).trim();

      const reconcile = { "2": "attach-remote", "3": "different-dir" }[choice] || "local-only";

      plan = draftsDirPlan({ state, reconcile });
    } else {
      const wantsGit = await confirm("Back it with a git remote, for syncing across devices?", false);

      plan = draftsDirPlan({ state, wantsGit });
    }

    if (plan.restart) continue;

    if (plan.createDir) {
      if (!(await confirm(`Create ${draftsDir}?`, true))) continue;
      fs.mkdirSync(draftsDir, { recursive: true });
    }

    return { draftsDir, plan };
  }
}

/** Init a repo if needed and point origin at the given remote. Never commits, never pushes. */
async function setupGitRemote(draftsDir) {
  const isRepo = git(draftsDir, ["rev-parse", "--is-inside-work-tree"]) === "true";

  if (!isRepo) {
    console.log(`Running: git init in ${draftsDir}`);
    execFileSync("git", ["init"], { cwd: draftsDir, stdio: "ignore" });
  }

  const remote = (await ask("Git remote URL: ")).trim();

  if (!remote) {
    console.log("No remote given — staying local for now.");
    return;
  }

  const existing = git(draftsDir, ["remote", "get-url", "origin"]);

  if (existing === remote) {
    console.log("origin already points there.");
  } else if (existing) {
    if (await confirm(`origin is already set to ${existing}. Replace it?`, false)) {
      execFileSync("git", ["remote", "set-url", "origin", remote], { cwd: draftsDir });
    }
  } else {
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: draftsDir });
  }

  console.log("Nothing has been committed or pushed.");

  const untracked = git(draftsDir, ["status", "--porcelain"]);

  if (untracked) {
    if (await confirm("There are local changes. Stage, commit, and push them now?", false)) {
      execFileSync("git", ["add", "-A"], { cwd: draftsDir });
      execFileSync("git", ["commit", "-m", "Import existing drafts"], { cwd: draftsDir });

      const branch = git(draftsDir, ["branch", "--show-current"]) || "main";
      const pushed = git(draftsDir, ["push", "-u", "origin", branch]);

      console.log(pushed === null ? "Push failed — run it yourself once the remote is ready." : `Pushed to ${branch}.`);
    } else {
      console.log(`When you're ready: cd ${draftsDir} && git add -A && git commit -m "..." && git push -u origin <branch>`);
    }
  }
}

/** Name the drafts directory in CLAUDE.md, or tell the user the line to add themselves. */
async function recordInClaudeMd(draftsDir) {
  const claudeMdPath = path.join(home, ".claude", "CLAUDE.md");
  const line = claudeMdLine(draftsDir);

  if (await confirm(`Add "${line}" to ${claudeMdPath}?`, true)) {
    const content = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, "utf8") : "";

    fs.mkdirSync(path.dirname(claudeMdPath), { recursive: true });
    fs.writeFileSync(claudeMdPath, upsertDraftsLine(content, draftsDir));
    console.log(`Updated ${claudeMdPath}.`);
  } else {
    console.log(`Add this yourself when you're ready:\n  ${line}`);
  }
}

/** Write every skill and collector file install.md carries, exactly as it reads there. */
function installSkills() {
  const installMd = fs.readFileSync(path.join(here, "install.md"), "utf8");
  const files = extractFencedFiles(installMd).filter((file) => file.path.startsWith("~/.claude/skills/"));

  for (const file of files) {
    const dest = expandHome(file.path, home);

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `${file.content}\n`);
    console.log(`Installed ${dest}`);
  }
}

async function main() {
  console.log("dev.review install wizard — a handful of questions, then it writes the files.\n");

  const { draftsDir, plan } = await chooseDraftsDir();

  if (plan.setupGit) await setupGitRemote(draftsDir);

  await recordInClaudeMd(draftsDir);

  console.log("\nInstalling skills…");
  installSkills();

  rl.close();

  console.log(`\nDone. Drafts directory: ${draftsDir}`);
  console.log("Point a source in the app at the same directory, then run /dev-review-sweep to draft what's waiting on you.");
}

main().catch((error) => {
  rl.close();
  console.error(error.message);
  process.exit(1);
});
