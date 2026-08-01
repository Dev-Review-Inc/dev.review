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
//
// The split between what is described here and what the stylesheet says: the
// geometry is here and is set inline, where no rule in that sheet can reach
// it, which is what keeps one height from becoming eight again. The colour is
// in the sheet, keyed on the role class below, because colour has states - a
// hover, a second click - and an inline declaration beats every :hover an
// author can write. ROLES is still where the colours are decided; scale.test.js
// reads the sheet and holds it to them.

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
  //
  // Read against its own fill rather than against the page: --accentFg is the
  // ink every other filled control in this app already used, and in dark the
  // accent is a light blue that near-white ink cannot be read on.
  primary: {
    background: "var(--accent)",
    color: "var(--accentFg)",
    border: "none",
    weight: "700",
    fills: true,
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

// What a fill can say beyond "this is the action". The send button wears the
// verdict it would send, and the verdict is the only thing allowed to change
// the colour: not the height, not the padding, not the weight.
export const TONES = { ok: "var(--green)", critical: "var(--red)" };

const PROPS = new Set([
  "label",
  "role",
  "tone",
  "compact",
  "icon",
  "arms",
  "link",
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
 * @param {string} [props.tone] a key of TONES, for a role that fills
 * @param {boolean} [props.compact] shorter, for dense chrome
 * @param {string} [props.icon] svg markup, for the icon role
 * @param {boolean} [props.arms] whether arm() gives it a second click
 * @param {boolean} [props.link] whether it navigates, and so is an anchor
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

  const { label = "", role = "ghost", tone = "", compact = false, icon = "" } = props;
  const { arms = false, link = false, pressed, disabled = false } = props;
  const { title = "", submits = false, onClick } = props;

  const look = ROLES[role];

  if (!look) throw new Error(`${role} is not a button role`);
  if (look.square && !icon) throw new Error("an icon button needs an icon");
  if (!look.square && !label) throw new Error("a button needs a label");
  if (tone && !TONES[tone]) throw new Error(`${tone} is not a button tone`);
  if (tone && !look.fills) throw new Error(`a ${role} button has no fill to tone`);

  return {
    tag: link ? "a" : "button",
    className: [
      "ui-button",
      `ui-button--${role}`,
      ...(compact && !look.square ? ["is-compact"] : []),
      ...(tone ? [`is-${tone}`] : []),
    ].join(" "),
    text: look.square ? "" : label,
    icon: look.square ? icon : "",
    attributes: {
      // An anchor navigates, so it has no type and no form to submit to.
      ...(link ? {} : { type: submits ? "submit" : "button" }),
      ...(title ? { title } : {}),
      ...(pressed === undefined ? {} : { "aria-pressed": String(pressed) }),
      ...(disabled ? { disabled: "" } : {}),
      // Declared unarmed rather than left off, so the state a second click
      // depends on is in the page from the start and its look is one selector.
      ...(arms ? { "data-armed": "false" } : {}),
    },
    style: look.square ? squareStyle(arms) : labelStyle(compact),
    onClick,
  };
}

function squareStyle(arms) {
  return {
    height: heightToken(CONTROL_HEIGHTS.icon),
    // Armed, arm() puts a question where the glyph was, and a question is
    // words. A square that cannot grow clips it, so the square is a floor.
    ...(arms
      ? { "min-width": heightToken(CONTROL_HEIGHTS.icon), padding: "0 var(--space1)" }
      : { width: heightToken(CONTROL_HEIGHTS.icon), padding: "0" }),
    "border-radius": "var(--radiusTight)",
    "line-height": "var(--leadControl)",
  };
}

function labelStyle(compact) {
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
  };
}
