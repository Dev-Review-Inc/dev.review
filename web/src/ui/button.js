// A button, described rather than built.
//
// Two things about the shape of this. It returns a plain object because the
// project has no jsdom and no dependency to fetch one, so anything that
// touched document could only ever be checked by eye - and the rule this
// component exists to hold was already written in a comment and already
// broken. A description is checked by assertion. And it takes plain props
// rather than app, because a function reaching into application state is a
// function nobody can call twice with different arguments.
//
// The rule: a role decides the height, radius, family and size. The caller
// picks a role. It cannot pick a height, because letting each call site pick
// is how one sheet ended up with eight of them.

import { heightToken, CONTROL_HEIGHTS } from "./tokens.js";

// What a role is for, and the colours it says it in. Colour is a token
// reference and never a literal, so light and dark stay one decision.
export const ROLES = {
  // The workhorse: an action offered beside other actions of equal weight.
  ghost: {
    background: "var(--panel2)",
    color: "var(--dim)",
    border: "1px solid var(--border)",
  },
  // The same button, for something that cannot be taken back.
  danger: {
    background: "var(--panel2)",
    color: "var(--red)",
    border: "1px solid var(--redBd)",
  },
  // The one thing on the row being asked for. It is louder by weight and fill,
  // never by being taller, which is the difference a reader reads as broken.
  primary: {
    background: "var(--accent)",
    color: "var(--postFg)",
    border: "none",
    weight: "700",
  },
  // The way out beside a primary. Present, and saying so quietly.
  quiet: {
    background: "none",
    color: "var(--faint)",
    border: "none",
  },
  // A square around a glyph. No label, so nothing about type applies.
  icon: {
    background: "none",
    color: "var(--dim2)",
    border: "none",
    square: true,
  },
};

const PROPS = new Set([
  "label",
  "role",
  "compact",
  "icon",
  "pressed",
  "disabled",
  "title",
  "submits",
  "onClick",
]);

/**
 * Describe a button.
 *
 * @param {object} props what the button is
 * @param {string} [props.label] the word on it, for every role but icon
 * @param {string} [props.role] a key of ROLES
 * @param {boolean} [props.compact] shorter, for dense chrome
 * @param {string} [props.icon] svg markup, for the icon role
 * @param {boolean} [props.pressed] present when the button is a toggle
 * @param {boolean} [props.disabled] whether it can be pressed
 * @param {string} [props.title] the hover text
 * @param {boolean} [props.submits] whether it submits the form it is in
 * @param {() => void} [props.onClick] what pressing it does
 * @returns {object} a description for render()
 */
export function button(props) {
  for (const name of Object.keys(props)) {
    if (!PROPS.has(name)) throw new Error(`button does not take ${name}`);
  }

  const { label = "", role = "ghost", compact = false, icon = "" } = props;
  const { pressed, disabled = false, title = "", submits = false, onClick } = props;

  const look = ROLES[role];

  if (!look) throw new Error(`${role} is not a button role`);
  if (look.square && !icon) throw new Error("an icon button needs an icon");
  if (!look.square && !label) throw new Error("a button needs a label");

  return {
    className: `ui-button ui-button--${role}${compact && !look.square ? " is-compact" : ""}`,
    text: look.square ? "" : label,
    icon: look.square ? icon : "",
    attributes: {
      type: submits ? "submit" : "button",
      ...(title ? { title } : {}),
      ...(pressed === undefined ? {} : { "aria-pressed": String(pressed) }),
      ...(disabled ? { disabled: "" } : {}),
    },
    style: look.square ? squareStyle(look) : labelStyle(look, compact),
    onClick,
  };
}

function squareStyle(look) {
  return {
    height: heightToken(CONTROL_HEIGHTS.icon),
    width: heightToken(CONTROL_HEIGHTS.icon),
    padding: "0",
    "border-radius": "var(--radiusTight)",
    "line-height": "var(--leadControl)",
    background: look.background,
    color: look.color,
    border: look.border,
  };
}

function labelStyle(look, compact) {
  return {
    height: heightToken(compact ? CONTROL_HEIGHTS.compact : CONTROL_HEIGHTS.standard),
    // One horizontal padding for every labelled button. The twelve rules this
    // replaces spread from 10px to 18px around a median of 12.
    padding: "0 var(--space4)",
    "border-radius": "var(--radius)",
    "font-family": "var(--mono)",
    "font-size": "var(--textSmall)",
    // Set, so the box is the height it says. Nothing else in the sheet does,
    // which is why the controls with no height float on their font metrics.
    "line-height": "var(--leadControl)",
    ...(look.weight ? { "font-weight": look.weight } : {}),
    background: look.background,
    color: look.color,
    border: look.border,
  };
}
