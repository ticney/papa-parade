// Checks behind designTokens.test.ts: tokens.css mirrors the DESIGN.md frontmatter 1:1, and the
// UI stylesheets use those variables instead of literal colours (story 1.5, UX-DR1).
import type { YamlMap, YamlValue } from './yamlSubset.ts';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const SIDE_TOKENS = new Set(['screen-margin', 'hud-inset']);
/** DESIGN.md writes `44pt` (iOS points = CSS px); tokens.css must say `44px` (story 1.5, D6). */
const POINT_TOKENS = new Set(['touch-target-min']);
const TYPOGRAPHY_FIELDS: Record<string, string> = {
  fontFamily: 'family',
  fontSize: 'size',
  fontWeight: 'weight',
  lineHeight: 'line-height',
  letterSpacing: 'letter-spacing',
};
/** Groups of variables that must exist in the frontmatter (the others may hold helpers). */
const TOKEN_PREFIXES = ['--pp-color-', '--pp-font-', '--pp-rounded-', '--pp-spacing-'];

export interface ExpectedToken {
  name: string;
  value: string;
}

function group(frontmatter: YamlMap, name: string): Record<string, YamlValue> {
  const value = frontmatter[name];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`DESIGN.md frontmatter has no "${name}" map`);
  }
  return value;
}

function text(value: YamlValue | undefined, where: string): string {
  if (typeof value !== 'string') throw new Error(`DESIGN.md ${where} is not a scalar`);
  return value;
}

/** Every variable tokens.css must define, with the value DESIGN.md gives it. */
export function expectedTokens(frontmatter: YamlMap): ExpectedToken[] {
  const tokens: ExpectedToken[] = [];
  for (const [name, value] of Object.entries(group(frontmatter, 'colors'))) {
    tokens.push({ name: `--pp-color-${name}`, value: text(value, `colors.${name}`) });
  }
  for (const [name, fields] of Object.entries(group(frontmatter, 'typography'))) {
    if (typeof fields !== 'object' || Array.isArray(fields)) {
      throw new Error(`DESIGN.md typography.${name} is not a map`);
    }
    for (const [field, value] of Object.entries(fields)) {
      const suffix = TYPOGRAPHY_FIELDS[field];
      if (suffix === undefined) throw new Error(`DESIGN.md typography.${name}.${field} is unknown`);
      tokens.push({
        name: `--pp-font-${name}-${suffix}`,
        value: text(value, `typography.${name}.${field}`),
      });
    }
  }
  for (const [name, value] of Object.entries(group(frontmatter, 'rounded'))) {
    tokens.push({ name: `--pp-rounded-${name}`, value: text(value, `rounded.${name}`) });
  }
  for (const [name, value] of Object.entries(group(frontmatter, 'spacing'))) {
    const written = text(value, `spacing.${name}`);
    if (SIDE_TOKENS.has(name)) {
      for (const side of SIDES) {
        tokens.push({
          name: `--pp-spacing-${name}-${side}`,
          value: written.replaceAll('safe-area-inset-*', `safe-area-inset-${side}`),
        });
      }
    } else {
      const value = POINT_TOKENS.has(name) ? written.replace(/pt$/, 'px') : written;
      tokens.push({ name: `--pp-spacing-${name}`, value });
    }
  }
  return tokens;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Custom properties declared in a stylesheet, by name (the last declaration wins). */
export function declaredVariables(css: string): Map<string, string> {
  const variables = new Map<string, string>();
  for (const match of stripComments(css).matchAll(/(--pp-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
    variables.set(match[1] as string, (match[2] as string).trim());
  }
  return variables;
}

/** A value reduced to what must match: no quotes, no spaces around separators, numbers as numbers. */
export function normaliseValue(value: string): string {
  let result = value.trim().replace(/\s+/g, ' ').replace(/["']/g, '');
  result = result
    .replace(/\s*,\s*/g, ',')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
  result = result.toLowerCase();
  // Biome may write `1.0` as `1`, or `.5` as `0.5`; hex colours are left alone.
  if (!result.startsWith('#')) {
    result = result.replace(/-?\d*\.?\d+/g, (number) => String(Number(number)));
  }
  return result;
}

/** One message per way tokens.css differs from the frontmatter. */
export function checkTokens(frontmatter: YamlMap, css: string): string[] {
  const problems: string[] = [];
  const declared = declaredVariables(css);
  const expected = expectedTokens(frontmatter);
  const expectedNames = new Set(expected.map((token) => token.name));
  for (const { name, value } of expected) {
    const actual = declared.get(name);
    if (actual === undefined) problems.push(`missing ${name} (DESIGN.md: ${value})`);
    else if (normaliseValue(actual) !== normaliseValue(value)) {
      problems.push(`${name} is "${actual}" but DESIGN.md says "${value}"`);
    }
  }
  for (const name of declared.keys()) {
    if (TOKEN_PREFIXES.some((prefix) => name.startsWith(prefix)) && !expectedNames.has(name)) {
      problems.push(`${name} is not in the DESIGN.md frontmatter`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// UI stylesheets
// ---------------------------------------------------------------------------------------------

const COLOUR_KEYWORDS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet ' +
    'brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
    'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta ' +
    'darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue ' +
    'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey ' +
    'dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray ' +
    'green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush ' +
    'lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray ' +
    'lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon ' +
    'mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin ' +
    'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna ' +
    'silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle ' +
    'tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);
const COLOUR_PROPERTY =
  /color|background|border|outline|shadow|fill|stroke|filter|accent|caret|text-decoration/;
const COLOUR_FUNCTION = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/;
const HEX_COLOUR = /#[0-9a-fA-F]{3,8}\b/;
const LAYOUT_PROPERTY = /^(width|height|top|right|bottom|left|margin|padding|inset|all)(-|$)/;

interface Declaration {
  property: string;
  value: string;
}

function declarations(css: string): Declaration[] {
  const found: Declaration[] = [];
  for (const segment of css.split(/[;{}]/)) {
    const colon = segment.indexOf(':');
    if (colon === -1) continue;
    const property = segment.slice(0, colon).trim().toLowerCase();
    if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(property)) continue;
    found.push({ property, value: segment.slice(colon + 1).trim() });
  }
  return found;
}

/** The text inside each `@keyframes name { … }` block. */
function keyframeBodies(css: string): string[] {
  const bodies: string[] = [];
  for (const match of css.matchAll(/@(?:-webkit-)?keyframes\s+[\w-]+\s*\{/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    bodies.push(css.slice(start, i - 1));
  }
  return bodies;
}

/** Problems of one UI stylesheet (everything but tokens.css and fonts.css). */
export function checkStylesheet(css: string): string[] {
  const problems: string[] = [];
  const source = stripComments(css);

  if (/backdrop-filter/i.test(source)) problems.push('backdrop-filter is not allowed (no blur)');
  const hex = source.match(HEX_COLOUR);
  if (hex !== null) problems.push(`hard-coded colour ${hex[0]}: use a --pp-color-* variable`);
  const fn = source.match(COLOUR_FUNCTION);
  if (fn !== null) problems.push(`hard-coded colour ${fn[1]}(): use a --pp-color-* variable`);

  for (const { property, value } of declarations(source)) {
    if (property.startsWith('--')) continue;
    if (COLOUR_PROPERTY.test(property)) {
      const bare = value.replace(/var\([^)]*\)/g, ' ').replace(/url\([^)]*\)/g, ' ');
      for (const word of bare.toLowerCase().match(/[a-z]+/g) ?? []) {
        if (COLOUR_KEYWORDS.has(word)) problems.push(`named colour "${word}" in ${property}`);
      }
    }
    if (property === 'transition' || property === 'transition-property') {
      for (const word of value.toLowerCase().match(/[a-z-]+/g) ?? []) {
        if (LAYOUT_PROPERTY.test(word)) problems.push(`${property} animates "${word}" (layout)`);
      }
    }
  }
  for (const body of keyframeBodies(source)) {
    for (const { property } of declarations(body)) {
      if (LAYOUT_PROPERTY.test(property)) {
        problems.push(`@keyframes animates "${property}" (layout)`);
      }
    }
  }
  return problems;
}
