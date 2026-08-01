// The one rule for a url this interface will let the reader follow.
//
// Every url on the screen came out of a draft file or a recorded event, both
// written by an agent while it read somebody else's branch. A browser takes
// the scheme off the front of an href and runs `javascript:` as code on the
// origin the link was clicked from, and that origin holds the reader's GitHub
// token and their storage keys. A pull request link is the most ordinary thing
// on the screen to click, so the scheme is checked where the href is set and
// nowhere else is trusted to have done it.
//
// The markdown renderer has always held its links to http(s) for the same
// reason. This is that rule, in one place, so the interface's own links and
// the ones inside a draft's prose cannot drift apart.

// No leading whitespace or control characters: a browser strips those before
// it reads the scheme, so " javascript:" is the same url to it as
// "javascript:" and has to be the same url here. Nothing that would end an
// attribute anywhere in the rest, so what passes is also safe to place in one.
const WEB = /^https?:\/\/[^"'<>\s]+$/i;

/**
 * The url if a link may follow it, and "" if it may not.
 *
 * @param {*} value a url from a draft, a recorded event, or a destination
 * @returns {string} the url, or "" when it is not an http(s) address
 */
export function webUrl(value) {
  return typeof value === "string" && WEB.test(value) ? value : "";
}
