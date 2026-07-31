// Running git without inheriting somebody else's git.
//
// Git tells its child processes which repository it is working on through the
// environment: GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE and friends. A hook is a
// child process, so every one of those is set while a pre-commit hook runs.
//
// A test that spawns git and passes `process.env` straight through therefore
// aims at whatever repository invoked the hook, not at its own temporary one.
// `git -C /tmp/whatever config http.receivepack true` writes to the developer's
// repository, because GIT_DIR outranks -C. That is not hypothetical: it set
// `core.bare` and `http.receivepack` on this repository and broke every
// worktree until they were unpicked by hand.
//
// So the environment is emptied of git rather than added to. An allowlist of
// the variables that have caused trouble would need to be right about a list
// that grows with git; dropping the prefix outright cannot be wrong, because a
// test that needs one says so itself.

/**
 * The environment, with every trace of a calling git taken out of it.
 *
 * @param {object} [extra] variables this caller does want git to see
 * @returns {object} an environment safe to hand a child git
 */
export function gitEnvironment(extra = {}) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );

  return {
    ...environment,
    // Nothing here may stop to ask a question. A test that hangs on a prompt
    // reads as a test that is slow.
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}
