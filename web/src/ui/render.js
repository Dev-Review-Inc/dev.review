// The one place the ui layer touches a document.
//
// Everything above this is a pure function returning a description, so this is
// the only piece a browser is needed to be sure of. Keeping it this small is
// the whole point: there is nothing here to get wrong twice.

/**
 * Turn a description into an element.
 *
 * @param {object} described what a component returned
 * @param {Document} [doc] the document to build in
 * @returns {HTMLElement} the element
 */
export function render(described, doc = document) {
  const node = doc.createElement("button");

  node.className = described.className;

  for (const [name, value] of Object.entries(described.attributes)) {
    node.setAttribute(name, value);
  }

  for (const [property, value] of Object.entries(described.style)) {
    node.style.setProperty(property, value);
  }

  // Markup only where a component put it, which is only ever an icon constant
  // this repo wrote. A label is text, for the same reason element() in dom.js
  // sets textContent: every label could have come from a draft.
  if (described.icon) node.innerHTML = described.icon;
  else node.textContent = described.text;

  if (described.onClick) node.addEventListener("click", described.onClick);

  return node;
}
