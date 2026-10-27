const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A decorative SVG element tree (icons carry no text: their button has an `aria-label`). `doc`
 * makes the elements (the browser's `document`; a double in tests).
 */
export function svgElement(
  tag: string,
  attributes: Readonly<Record<string, string>>,
  children: readonly SVGElement[] = [],
  doc: Pick<Document, 'createElementNS'> = document,
): SVGElement {
  const node = doc.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}
