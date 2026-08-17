import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

/** The declared font-size of a rule, as written in the page's stylesheet. */
function fontSize(selector) {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);

  const body = css.slice(at, css.indexOf("}", at));
  const size = body.match(/font-size:\s*(var\(--\w+\)|[\d.]+px)/);
  assert.ok(size, `no font-size on ${selector}`);

  return size[1];
}

test("diff lines read at the same size wherever they are shown", () => {
  const comment = fontSize(".finding-code");

  assert.equal(fontSize(".line"), comment);
  assert.equal(fontSize(".suggestion pre"), comment);
});
