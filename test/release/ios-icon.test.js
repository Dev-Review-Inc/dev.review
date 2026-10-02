// `cargo tauri ios init` fills the iOS asset catalog with Tauri's own logo
// when the project carries no iOS icon. The first TestFlight build shipped
// that logo. These tests read the committed icon set and the script that
// installs it after init.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";

const set = "src-tauri/ios/AppIcon.appiconset";
const script = "src-tauri/ios-prepare.sh";

// A PNG starts with an 8-byte signature, then the IHDR chunk: length, type,
// width, height, bit depth, colour type. Colour type 2 is RGB, 6 is RGBA.
const header = (path) => {
  const png = readFileSync(path);
  assert.equal(png.toString("latin1", 12, 16), "IHDR", `${path} is not a PNG`);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colourType: png[25],
  };
};

const marketing = () =>
  JSON.parse(readFileSync(`${set}/Contents.json`, "utf8")).images.find(
    (image) => image.idiom === "universal" && image.platform === "ios" && image.size === "1024x1024",
  );

describe("the iOS app icon", () => {
  test("names one 1024 iOS image in Contents.json", () => {
    const image = marketing();

    assert.ok(image, "Contents.json has no universal ios 1024x1024 entry");
    assert.ok(image.filename, "the 1024 entry names no file");
  });

  test("is a 1024 square with no alpha channel", () => {
    const { width, height, colourType } = header(`${set}/${marketing().filename}`);

    assert.equal(width, 1024);
    assert.equal(height, 1024);
    assert.equal(colourType, 2, "the App Store refuses an icon with an alpha channel");
  });
});

describe("ios-prepare.sh", () => {
  test("exists and is executable", () => {
    assert.ok(existsSync(script), `${script} is missing`);
    assert.ok(statSync(script).mode & 0o111, `${script} is not executable`);
  });

  test("restores both entitlements files", () => {
    const source = readFileSync(script, "utf8");

    assert.match(source, /reviewer_iOS\.entitlements/);
    assert.match(source, /ReviewerWidget\/ReviewerWidget\.entitlements/);
  });

  test("installs the committed icon set", () => {
    assert.match(readFileSync(script, "utf8"), /ios\/AppIcon\.appiconset/);
  });
});
