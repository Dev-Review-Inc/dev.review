import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");

/** The declared flex shorthand of the first rule for a selector. */
function flex(selector) {
  const at = css.indexOf(`  ${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);

  const body = css.slice(at, css.indexOf("}", at));
  const value = body.match(/flex:\s*(\d+)\s+(\d+)\s+(\d+)px/);
  assert.ok(value, `no flex on ${selector}`);

  return { grow: Number(value[1]), basis: Number(value[3]) };
}

test("board columns share the spare width and start wide enough to read a finding", () => {
  const column = flex(".board-column");

  assert.equal(column.grow, 1);
  assert.ok(column.basis >= 340, `basis is ${column.basis}px`);
});
