import test from "node:test";
import assert from "node:assert";

import { renderBody } from "../web/src/domain/render.js";

test("renders a heading", () => {
  assert.match(renderBody("### 👓 QA"), /<h3>👓 QA<\/h3>/);
});

test("renders bold and inline code", () => {
  const html = renderBody("**Requesting changes** — see `app/models/total.rb`");

  assert.match(html, /<strong>Requesting changes<\/strong>/);
  assert.match(html, /<code>app\/models\/total\.rb<\/code>/);
});

test("keeps allowlisted html inside a code span as text, not markup", () => {
  const html = renderBody("as_markdown emits an `<a>`, and this prose must stay plain");

  assert.match(html, /<code>&lt;a&gt;<\/code>/);
  assert.doesNotMatch(html, /<a>/);
});

test("leaves asterisks inside code spans out of emphasis", () => {
  const html = renderBody("a bad `icon:` value in `data/site/**/.yml` and `marketing_icon(name, **options)` stay plain");

  assert.match(html, /<code>data\/site\/\*\*\/\.yml<\/code>/);
  assert.match(html, /<code>marketing_icon\(name, \*\*options\)<\/code>/);
  assert.doesNotMatch(html, /<em>|<strong>/);
});

test("renders a numbered list as an ordered list", () => {
  const html = renderBody("1. first point\n2. second point");

  assert.match(html, /<ol>\s*<li>first point<\/li>\s*<li>second point<\/li>\s*<\/ol>/);
});

test("renders a markdown table with a header row", () => {
  const html = renderBody("| Field | Meaning |\n|---|---|\n| `key` | Stable identifier |\n| `label` | What the reader sees |");

  assert.match(html, /<table>/);
  assert.match(html, /<th>Field<\/th>\s*<th>Meaning<\/th>/);
  assert.match(html, /<td><code>key<\/code><\/td>\s*<td>Stable identifier<\/td>/);
  assert.doesNotMatch(html, /---/);
  assert.doesNotMatch(html, /<p>\|/);
});

test("renders a fenced code block", () => {
  const html = renderBody("```\nrescue Totals::Error\n```");

  assert.match(html, /<pre><code>rescue Totals::Error\n<\/code><\/pre>/);
});

test("renders a markdown link", () => {
  const html = renderBody("[44](https://github.com/org/app/pull/44)");

  assert.match(
    html,
    /<a href="https:\/\/github\.com\/org\/app\/pull\/44">44<\/a>/,
  );
});

test("keeps the allowlisted inline html the comment template uses", () => {
  const html = renderBody('<sub>verified against <a href="https://x/y">abc1234</a></sub>');

  assert.match(html, /<sub>verified against <a href="https:\/\/x\/y">abc1234<\/a><\/sub>/);
});

// Everything below is why this renderer exists rather than a markdown library.
// A draft quotes titles and diff hunks written by other people, and the GitHub
// token is in local storage on this origin.

test("escapes a script tag quoted out of a diff instead of executing it", () => {
  const html = renderBody("The title is <script>alert(1)</script> today");

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("escapes an event handler smuggled into an allowlisted tag", () => {
  const html = renderBody('<a href="https://x/y" onclick="alert(1)">click</a>');

  assert.doesNotMatch(html, /<a /, "the tag must not be restored at all");
  assert.match(html, /&lt;a href=&quot;https:\/\/x\/y&quot; onclick=/, "it stays inert text");
});

test("refuses a javascript: link target written as markdown", () => {
  const html = renderBody("[click](javascript:alert(1))");

  assert.doesNotMatch(html, /<a /);
});

test("refuses a javascript: link target written as html", () => {
  const html = renderBody('<a href="javascript:alert(1)">click</a>');

  assert.doesNotMatch(html, /<a /);
});

test("escapes an img with an onerror handler", () => {
  const html = renderBody('<img src="x" onerror="alert(1)">');

  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("does not leave a live closing tag behind a rejected opening tag", () => {
  const html = renderBody('<a href="javascript:alert(1)">click</a>');

  assert.doesNotMatch(html, /<\/a>/);
});

test("escapes a quote that would break out of an attribute", () => {
  assert.doesNotMatch(renderBody('title is " onmouseover="alert(1)'), /onmouseover="alert/);
});
