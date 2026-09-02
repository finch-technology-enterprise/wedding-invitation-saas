/**
 * Tiny DOM helpers.
 *
 * Everything is built with createElement/textContent rather than
 * innerHTML so configured copy can never be interpreted as markup.
 */

/**
 * @param {string} tag
 * @param {object} [props]  className | text | html-safe attributes
 * @param {Array<Node|string|null|undefined|false>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key === "style") {
      for (const [prop, v] of Object.entries(value)) {
        if (v !== null && v !== undefined) node.style.setProperty(prop, String(v));
      }
    } else if (key === "dataset") {
      for (const [prop, v] of Object.entries(value)) node.dataset[prop] = String(v);
    } else if (key in node && key !== "list") {
      node[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }

  return node;
}

/** Namespaced element factory for inline SVG icons. */
export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

/** Render an array of strings as separate <p> lines. */
export function lines(list, className) {
  return list.map((line) => el("p", { class: className, text: line }));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
