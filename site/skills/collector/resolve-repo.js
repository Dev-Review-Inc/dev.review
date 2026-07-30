#!/usr/bin/env node

// Resolve a GitHub repository to a checkout already on this machine, so the
// sweep can review where the code already lives instead of cloning it again.
//
//   resolve-repo.js owner/name   -> /path/to/local/checkout
//
// Exits 1 with no output when there is no local checkout.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Where to look for checkouts.
 *
 * Directory names do not match repository names, so every candidate is
 * identified by its origin remote rather than by its path; this only decides
 * which directories are worth listing at all. REVIEWER_CHECKOUTS overrides
 * the fallback, for reviewing away from the checkouts.
 *
 * @param {Object<string,string>} env the environment to read
 * @param {string} fallback the directory to search when nothing is configured
 * @returns {string[]} directories to list
 */
export function searchRoots(env, fallback) {
  const configured = (env.REVIEWER_CHECKOUTS || "").split(":").filter((root) => root.trim());

  return configured.length ? configured : [fallback];
}

/**
 * The folder of checkouts a directory belongs to.
 *
 * Working inside a checkout, the repositories worth searching are its
 * neighbors — the folder holding it. Anywhere else, the directory itself is
 * the place to look.
 *
 * @param {string} dir the directory to start from
 * @returns {string} the folder to search for checkouts
 */
export function neighborhood(dir) {
  return fs.existsSync(path.join(dir, ".git")) ? path.dirname(dir) : dir;
}

const SEARCH_ROOTS = searchRoots(process.env, neighborhood(process.cwd()));

/**
 * The "owner/name" a git remote points at, if it is a GitHub remote.
 *
 * @param {string} url an origin url, ssh or https
 * @returns {string|null} lowercased "owner/name", or null if not GitHub
 */
export function repoFromRemote(url) {
  const match = String(url)
    .trim()
    .match(/^(?:git@github\.com:|https:\/\/(?:[^@/]+@)?github\.com\/)([^/]+)\/(.+?)(?:\.git)?$/i);

  return match ? `${match[1].toLowerCase()}/${match[2].toLowerCase()}` : null;
}

/**
 * The local checkout for a repository, chosen deterministically when more than
 * one directory points at the same remote.
 *
 * @param {string} repo "owner/name" from the GitHub API
 * @param {{path: string, remote: string}[]} candidates local checkouts
 * @returns {string|null} the checkout path, or null when none match
 */
export function pickLocalRepo(repo, candidates) {
  const wanted = repo.toLowerCase();
  const matches = candidates
    .filter((candidate) => repoFromRemote(candidate.remote) === wanted)
    .map((candidate) => candidate.path)
    .sort();

  return matches[0] || null;
}

// Directories that never hold a project checkout, and can hold thousands of
// files. Descending into them is the difference between a scan and a crawl.
const SKIP = new Set(["node_modules", "vendor", "tmp", "log", "target", "dist", "build"]);

// How far below a root to look. Deep enough for a repository filed under a
// couple of grouping folders, shallow enough that a mistaken root does not walk
// a whole home directory.
const MAX_DEPTH = 5;

/**
 * Every git checkout at or below the given folders.
 *
 * A directory holding `.git` is a checkout, and the walk does not descend into
 * one: a repository's own vendored copies and worktrees are not separate
 * projects. Hidden and dependency directories are skipped outright.
 *
 * @param {string[]} roots folders to search
 * @param {{maxDepth?: number}} [options] how far below each root to look
 * @returns {string[]} absolute paths of checkouts, each reported once
 */
export function findCheckouts(roots, options = {}) {
  const limit = options.maxDepth ?? MAX_DEPTH;
  const seen = new Set();

  const walk = (dir, depth) => {
    if (depth > limit) return;

    if (fs.existsSync(path.join(dir, ".git"))) {
      seen.add(fs.realpathSync(dir));

      return;
    }

    let entries = [];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP.has(entry.name)) continue;

      walk(path.join(dir, entry.name), depth + 1);
    }
  };

  for (const root of roots) {
    walk(root, 0);
  }

  return [...seen];
}

/**
 * Every local checkout, with its origin remote.
 *
 * @returns {{path: string, remote: string}[]} local checkouts
 */
export function localCheckouts() {
  return findCheckouts(SEARCH_ROOTS).flatMap((dir) => {
    try {
      const remote = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });

      return [{ path: dir, remote }];
    } catch {
      return [];
    }
  });
}

if (process.argv[1] === import.meta.filename) {
  const wanted = process.argv[2] || "";
  const resolved = pickLocalRepo(wanted, localCheckouts());

  if (!resolved) {
    // Say where we looked. The common cause is a correct repository and a
    // search root that no longer holds the checkouts, which is indistinguishable
    // from "no checkout exists" unless we name the roots.
    console.error(
      `resolve-repo: no checkout of ${wanted} under ${SEARCH_ROOTS.join(", ")}\n` +
        "set REVIEWER_CHECKOUTS to the directory holding your checkouts",
    );
    process.exit(1);
  }

  console.log(resolved);
}
