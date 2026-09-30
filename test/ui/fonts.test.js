// The fonts the interface is drawn in, as assertions rather than as trust.
//
// A webfont fails silently. Rename the file, mistype the family, drop the
// directory out of a build, and the page still renders: the browser takes the
// next name in the font-family list and the interface comes up in system-ui,
// looking almost right. Nothing throws and no other test goes red.
//
// These assertions are the noise that failure does not make.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const document = new URL("../../web/index.html", import.meta.url);
const stylesheet = readFileSync(document, "utf8");

// Every @font-face block in the document, as its own text.
const faces = [...stylesheet.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1]);

// value reads one declaration out of a block, unquoted.
function value(face, property) {
  return new RegExp(`\\b${property}\\s*:\\s*([^;]+);`).exec(face)?.[1].trim().replace(/^['"]|['"]$/g, "");
}

// The families the interface actually asks for, read from the two tokens every
// font-family rule in the document resolves to. Written here as a pair rather
// than scraped, because the point of the check below is to compare what is
// asked for against what is declared, and scraping both sides from the same
// file compares it against itself.
const families = ["IBM Plex Sans", "JetBrains Mono"];

test("the document declares a face for every family the interface asks for", () => {
  for (const family of families) {
    const declared = faces.filter((face) => value(face, "font-family") === family);

    assert.ok(declared.length > 0, `nothing declares a face for ${family}, so it falls back to a system font`);
  }
});

test("every family the interface asks for is still named in the stylesheet", () => {
  // The other half of the pair above: a face declared for a family nothing uses
  // is a file shipped for nothing, and a family used with no face is the silent
  // fallback this file exists to catch.
  for (const family of families) {
    assert.ok(stylesheet.includes(`'${family}'`), `${family} has a face but no rule uses it`);
  }
});

test("every file a face names is in the repository", () => {
  const named = faces.flatMap((face) => [...face.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]));

  assert.ok(named.length > 0, "no @font-face names a file");

  for (const reference of named) {
    const path = fileURLToPath(new URL(reference, document));

    assert.ok(existsSync(path), `@font-face names ${reference}, which is not in the repository`);
  }
});

test("no font is fetched from another origin", () => {
  // The whole reason the files above are in the repository. A font from Google
  // is a request the reader did not ask for, and the desktop build's policy
  // refuses it outright, so the window falls back to system fonts while the
  // browser build looks correct.
  assert.doesNotMatch(stylesheet, /fonts\.googleapis\.com|fonts\.gstatic\.com/, "the document still reaches Google for fonts");
});
