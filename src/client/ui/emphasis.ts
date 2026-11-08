/** A run of a line: `isEmphasized` for what sat between two asterisks. */
export interface EmphasisSegment {
  readonly text: string;
  readonly isEmphasized: boolean;
}

/**
 * Cuts a line of Mama's (story 3.8, UX-DR13) at its asterisks: `*Encore* l'escalier ?!` is « Encore »
 * (emphasized) then « l'escalier ?! ». The asterisks are never part of a segment. The schema keeps them
 * in pairs; an unpaired last one still opens nothing, so the text after it is plain. Empty runs are dropped.
 */
export function emphasisSegmentsOf(text: string): readonly EmphasisSegment[] {
  const parts = text.split('*');
  // An odd count of asterisks leaves the last part after an opening one that nothing closes: it is plain.
  const unclosedIndex = parts.length % 2 === 0 ? parts.length - 1 : -1;
  const segments: EmphasisSegment[] = [];
  parts.forEach((part, index) => {
    if (part === '') return;
    segments.push({ text: part, isEmphasized: index % 2 === 1 && index !== unclosedIndex });
  });
  return segments;
}

/**
 * Appends `text` to `parent` with its `*word*` as `<em>word</em>`. It builds text nodes and `em`
 * elements, never `innerHTML`: a line is content (`content/mama-lines.json`), and the bubble it goes in
 * is a live region. `parent` is not cleared first.
 */
export function appendEmphasizedText(
  parent: Pick<ParentNode, 'append'>,
  text: string,
  doc: Pick<Document, 'createElement' | 'createTextNode'>,
): void {
  for (const segment of emphasisSegmentsOf(text)) {
    if (segment.isEmphasized) {
      const emphasis = doc.createElement('em');
      emphasis.append(doc.createTextNode(segment.text));
      parent.append(emphasis);
    } else {
      parent.append(doc.createTextNode(segment.text));
    }
  }
}
