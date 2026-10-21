// What version this repository is at, and whether a tag agrees with it.
//
// Three files carry the number by hand: tauri.conf.json is what the installer
// and the app report, Cargo.toml is what the crate publishes as, and
// ios-project.yml is what xcodegen writes into the Xcode project - twice,
// because the widget extension carries its own Info.plist. None is derived from
// another and none is derived from the tag, so they all drift independently and
// the build says nothing about it.
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

  // Every target's marketing version, in file order. Read as lines rather than
  // as YAML because the file carries `{{apple.development-team}}` placeholders
  // that tauri substitutes and a YAML parser rejects. Quoted or bare, since
  // both are valid there.
  const ios = [...read("ios-project.yml").matchAll(/^\s*CFBundleShortVersionString:\s*"?([^"\s]+)"?\s*$/gm)].map(
    (match) => match[1],
  );

  return { conf: JSON.parse(read("tauri.conf.json")).version, cargo, ios };
}

// The message a human needs, or null when the tag is safe to build.
export function disagreement(tag, found = versions()) {
  const { conf, cargo, ios } = found;

  if (conf !== cargo) {
    return `tauri.conf.json says ${conf} and Cargo.toml says ${cargo}`;
  }

  if (ios.length === 0) {
    return "src-tauri/ios-project.yml names no CFBundleShortVersionString";
  }

  const strayed = ios.find((version) => version !== conf);

  if (strayed) {
    return `src-tauri/ios-project.yml says ${strayed} and tauri.conf.json says ${conf}`;
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
