// A parser for the YAML subset the DESIGN.md frontmatter uses: nested maps by indentation, lists of
// scalars, single- or double-quoted and bare scalars, quoted keys. It throws on anything else
// (tabs, flow collections, anchors, multi-line scalars, lists of maps) so that a future change of
// the frontmatter fails loudly instead of being half read. No `yaml` package (story 1.5, D12).

export type YamlValue = string | YamlValue[] | { [key: string]: YamlValue };
export type YamlMap = { [key: string]: YamlValue };

interface Level {
  /** Indentation of the entries of this container. */
  indent: number;
  node: YamlMap | YamlValue[];
}

interface Pending {
  parentIndent: number;
  parent: YamlMap;
  key: string;
}

/** The text between the opening `---` line and the next `---` line of a Markdown file. */
export function extractFrontmatter(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('frontmatter: the file must start with "---"');
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new Error('frontmatter: no closing "---"');
  return lines.slice(1, end).join('\n');
}

function fail(lineNumber: number, message: string): never {
  throw new Error(`yamlSubset line ${lineNumber}: ${message}`);
}

function parseScalar(raw: string, lineNumber: number): string {
  const text = raw.trim();
  if (text.startsWith("'")) {
    let value = '';
    for (let i = 1; i < text.length; i++) {
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          value += "'";
          i++;
        } else if (i === text.length - 1) {
          return value;
        } else {
          return fail(lineNumber, 'unexpected text after a quoted scalar');
        }
      } else {
        value += text[i];
      }
    }
    return fail(lineNumber, 'unterminated single-quoted scalar');
  }
  if (text.startsWith('"')) {
    if (text.length < 2 || !text.endsWith('"') || text.slice(1, -1).includes('"')) {
      return fail(lineNumber, 'unsupported double-quoted scalar (no escapes, one line)');
    }
    return text.slice(1, -1);
  }
  if (/^[[{&*|>!%@`#]/.test(text)) return fail(lineNumber, `unsupported scalar "${text}"`);
  if (/\s#/.test(text)) return fail(lineNumber, `inline comments are not supported ("${text}")`);
  if (/:(\s|$)/.test(text)) return fail(lineNumber, `unquoted scalar contains ": " ("${text}")`);
  return text;
}

/** Splits `key: rest` (the key may be quoted). */
function splitEntry(content: string, lineNumber: number): { key: string; rest: string } {
  let key: string;
  let afterKey: string;
  if (content.startsWith("'") || content.startsWith('"')) {
    const quote = content[0] as string;
    const close = content.indexOf(quote, 1);
    if (close === -1) return fail(lineNumber, 'unterminated quoted key');
    key = content.slice(1, close);
    afterKey = content.slice(close + 1);
    if (!afterKey.startsWith(':')) return fail(lineNumber, 'expected ":" after a quoted key');
    afterKey = afterKey.slice(1);
  } else {
    const colon = content.search(/:(\s|$)/);
    if (colon === -1) return fail(lineNumber, `no "key:" in "${content}"`);
    key = content.slice(0, colon).trim();
    afterKey = content.slice(colon + 1);
    if (key === '') return fail(lineNumber, 'empty key');
  }
  if (afterKey !== '' && !afterKey.startsWith(' '))
    return fail(lineNumber, 'expected a space after ":"');
  return { key, rest: afterKey.trim() };
}

export function parseYamlSubset(text: string): YamlMap {
  const root: YamlMap = {};
  const stack: Level[] = [{ indent: 0, node: root }];
  let pending: Pending | null = null;

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index] as string;
    if (line.includes('\t')) fail(lineNumber, 'tabs are not supported');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const content = line.trim();

    if (pending !== null) {
      if (indent <= pending.parentIndent) {
        fail(lineNumber, `"${pending.key}:" has no value (empty values are not supported)`);
      }
      const child: YamlMap | YamlValue[] = content.startsWith('- ') ? [] : {};
      pending.parent[pending.key] = child;
      stack.push({ indent, node: child });
      pending = null;
    } else {
      while (stack.length > 1 && indent < (stack[stack.length - 1] as Level).indent) stack.pop();
    }

    const top = stack[stack.length - 1] as Level;
    if (indent !== top.indent) fail(lineNumber, `unexpected indentation (${indent})`);

    if (content.startsWith('- ')) {
      if (!Array.isArray(top.node)) fail(lineNumber, 'a list item inside a map');
      const item = content.slice(2);
      if (/^[^'"\s][^:]*:(\s|$)/.test(item)) fail(lineNumber, 'lists of maps are not supported');
      (top.node as YamlValue[]).push(parseScalar(item, lineNumber));
      continue;
    }
    if (Array.isArray(top.node)) fail(lineNumber, 'a map entry inside a list');
    const { key, rest } = splitEntry(content, lineNumber);
    const map = top.node as YamlMap;
    if (Object.hasOwn(map, key)) fail(lineNumber, `duplicate key "${key}"`);
    if (rest === '') pending = { parentIndent: indent, parent: map, key };
    else map[key] = parseScalar(rest, lineNumber);
  }
  if (pending !== null) fail(lines.length, `"${pending.key}:" has no value`);
  return root;
}
