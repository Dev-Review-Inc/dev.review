// Bot pull requests are dependency bumps. A review draft for one says nothing
// worth reading, and a catch-all CODEOWNERS puts every one of them in front of
// a team review request, crowding real pull requests out of the result limit.
const EXCLUDED_AUTHORS = ["app/dependabot"];

/**
 * Argv for one `gh search prs` call. Exclusions go after `--`, or gh reads a
 * leading `-` as one of its own flags. `author`, `isDraft` and `labels` are the
 * facts the reader's rules are checked against.
 *
 * @param {string} qualifier e.g. "--review-requested=@me"
 * @returns {string[]} arguments to pass to `gh`
 */
export function searchArgs(qualifier) {
  return [
    "search", "prs",
    qualifier,
    "--state=open",
    "--limit", "40",
    "--json", "number,title,repository,url,updatedAt,author,isDraft,labels",
    "--",
    ...EXCLUDED_AUTHORS.map((author) => `-author:${author}`),
  ];
}
