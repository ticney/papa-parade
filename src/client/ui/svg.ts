const SVG_NS = 'http://www.w3.org/2000/svg';

/** A decorative SVG element tree (icons carry no text: their button has an `aria-label`). */
export function svgElement(
  tag: string,
  attributes: Readonly<Record<string, string>>,
  children: readonly SVGElement[] = [],
): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}
