// The one place the ui layer touches a document.
//
// Everything above this is a pure function returning a description, so this is
// the only piece a browser is needed to be sure of. Keeping it this small is
// the whole point: there is nothing here to get wrong twice.

// Everything a description can put on an element. Listed so a redraw can take
// off what the last one put on: a button drawn once as disabled, or once as
// armed, would otherwise stay that way for the life of the page.
const ATTRIBUTES = ["type", "title", "aria-pressed", "disabled", "data-armed"];

/**
 * Turn a description into an element.
 *
 * @param {object} described what a component returned
 * @param {Document} [doc] the document to build in
 * @returns {HTMLElement} the element
 */
export function render(described, doc = document) {
  const node = restyle(described, doc.createElement(described.tag));

  if (described.onClick) node.addEventListener("click", described.onClick);

  return node;
}

/**
 * Put a description onto an element that already exists.
 *
 * The send button, the confirm sheet's pair and the celebration's are written
 * into index.html and wired by id when the page boots, and a redraw changes
 * what they say rather than replacing them. Describing them and applying the
 * description is how those keep their listeners and still stop carrying rules
 * of their own.
 *
 * @param {object} described what a component returned
 * @param {HTMLElement} node the element to apply it to
 * @returns {HTMLElement} the same element
 */
export function restyle(described, node) {
  node.className = described.className;

  // Cleared rather than written over: the roles do not all set the same
  // properties, so a button redrawn in a quieter role would keep the weight
  // and the fill of the louder one it was last time.
  node.style.cssText = "";

  for (const name of ATTRIBUTES) {
    if (name in described.attributes) node.setAttribute(name, described.attributes[name]);
    else node.removeAttribute(name);
  }

  for (const [property, value] of Object.entries(described.style)) {
    node.style.setProperty(property, value);
  }

  // Markup only where a component put it, which is only ever an icon constant
  // this repo wrote. A label is text, for the same reason element() in dom.js
  // sets textContent: every label could have come from a draft.
  if (described.icon) node.innerHTML = described.icon;
  else node.textContent = described.text;

  return node;
}
