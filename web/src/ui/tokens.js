// The sizing decisions, named once.
//
// These mirror the :root block in index.html. Two copies of a number is how
// they drift, so a test reads the stylesheet and checks these against it
// rather than trusting that both were edited together.

/**
 * The only heights a control is allowed to be.
 *
 * A control is doing one of three jobs: it is a square holding a glyph, it is
 * in dense chrome, or it is a button on a row with other buttons. Anything
 * that seems to need a fourth is a role that has not been thought about.
 */
export const CONTROL_HEIGHTS = { icon: 20, compact: 30, standard: 36 };

/**
 * The stylesheet variable standing for a control height.
 *
 * @param {number} px one of CONTROL_HEIGHTS
 * @returns {string} a var() reference
 */
export function heightToken(px) {
  const role = Object.keys(CONTROL_HEIGHTS).find((name) => CONTROL_HEIGHTS[name] === px);

  if (!role) throw new Error(`${px}px is not a sanctioned control height`);

  return `var(--ctl${role[0].toUpperCase()}${role.slice(1)})`;
}

/**
 * Every custom property a set of descriptions leans on.
 *
 * A var() naming a property nobody declared resolves to nothing and the
 * browser says so to no one, so the names are worth collecting and checking.
 *
 * @param {object[]} descriptions descriptions from a component
 * @returns {string[]} custom property names, each once
 */
export function tokensUsedBy(descriptions) {
  const found = new Set();

  for (const described of descriptions) {
    for (const value of Object.values(described.style)) {
      for (const [, name] of String(value).matchAll(/var\((--[a-zA-Z0-9]+)\)/g)) found.add(name);
    }
  }

  return [...found];
}
