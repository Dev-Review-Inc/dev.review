// What version this repository is at, and whether a tag agrees with it.
//
// Two files carry the number by hand: tauri.conf.json is what the installer and
// the app report, Cargo.toml is what the crate publishes as. Neither is derived
// from the other and neither is derived from the tag, so all three drift
// independently and the build says nothing about it.
//
// Run it with a tag to have it say so and exit non-zero:
//
//   node .github/version.mjs v0.1.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (file) => readFileSync(path.join(root, "src-tauri", file), "utf8");

export function versions() {
  // Only the first version after [package], because the dependency table is
  // full of version keys and any of them would match a looser pattern.
  const cargo = read("Cargo.toml")
    .split(/^\[/m)
    .find((section) => section.startsWith("package]"))
    ?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

  return { conf: JSON.parse(read("tauri.conf.json")).version, cargo };
}

// The message a human needs, or null when the tag is safe to build.
export function disagreement(tag) {
  const { conf, cargo } = versions();

  if (conf !== cargo) {
    return `tauri.conf.json says ${conf} and Cargo.toml says ${cargo}`;
  }

  return tag === `v${conf}` ? null : `tag ${tag} does not name version ${conf}`;
}

// Only when run directly, so importing it from a test costs nothing.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problem = disagreement(process.argv[2]);

  if (problem) {
    console.error(`Refusing to release: ${problem}.`);
    process.exit(1);
  }

  console.log(`Releasing ${process.argv[2]}.`);
}
