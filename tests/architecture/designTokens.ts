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

/** The text inside each top-level `:root { … }` block. */
function rootBlocks(css: string): string[] {
  const source = stripComments(css);
  const blocks: string[] = [];
  let depth = 0;
  let blockStart = -1;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '{') {
      if (depth === 0 && /(^|[}\s;]):root\s*$/.test(source.slice(0, i))) blockStart = i + 1;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && blockStart !== -1) {
        blocks.push(source.slice(blockStart, i));
        blockStart = -1;
      }
    }
  }
  return blocks;
}

function declarationsOf(text: string): Array<{ name: string; value: string }> {
  return [...text.matchAll(/(--pp-[a-z0-9-]+)\s*:\s*([^;}]+)/g)].map((match) => ({
    name: match[1] as string,
    value: (match[2] as string).trim(),
  }));
}

/** Custom properties declared in the top-level `:root` blocks of a stylesheet (the last one wins). */
export function declaredVariables(css: string): Map<string, string> {
  const variables = new Map<string, string>();
  for (const block of rootBlocks(css)) {
    for (const { name, value } of declarationsOf(block)) variables.set(name, value);
  }
  return variables;
}

/** Every `--pp-*` custom property declared anywhere in a stylesheet, under any selector. */
export function declaredNames(css: string): Set<string> {
  return new Set(declarationsOf(stripComments(css)).map((declaration) => declaration.name));
}

/** Names declared somewhere that is not a top-level `:root` block (another selector, a media query). */
function declaredOutsideRoot(css: string): string[] {
  const counts = new Map<string, number>();
  for (const { name } of declarationsOf(stripComments(css)))
    counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const { name } of rootBlocks(css).flatMap(declarationsOf)) {
    counts.set(name, (counts.get(name) ?? 0) - 1);
  }
  return [...counts].filter(([, left]) => left > 0).map(([name]) => name);
}

/** Names declared more than once in the `:root` blocks of a stylesheet. */
function duplicateVariables(css: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const block of rootBlocks(css)) {
    for (const { name } of declarationsOf(block)) {
      if (seen.has(name)) duplicates.add(name);
      seen.add(name);
    }
  }
  return [...duplicates];
}

/** Every `--pp-*` a stylesheet reads through `var()`. */
export function usedVariables(css: string): string[] {
  return [...stripComments(css).matchAll(/var\(\s*(--pp-[a-z0-9-]+)/g)].map(
    (match) => match[1] as string,
  );
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
  // tokens.css holds the tokens and nothing else: helpers belong to ui.css.
  for (const name of declaredNames(css)) {
    if (!expectedNames.has(name)) problems.push(`${name} is not in the DESIGN.md frontmatter`);
  }
  for (const name of declaredOutsideRoot(css)) problems.push(`${name} is declared outside :root`);
  for (const name of duplicateVariables(css)) problems.push(`${name} is declared twice`);
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
// Properties whose animation moves other things (layout) or repaints text: `transform` and `opacity` only.
const LAYOUT_PROPERTY =
  /^(width|height|top|right|bottom|left|margin|padding|inset|all|gap|row-gap|column-gap|flex|flex-basis|font-size|line-height|letter-spacing|border-width|(?:min|max)-(?:width|height))(-|$)/;

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

const FALLBACK_STACKS = /^--pp-fallback-/;

/** The class and id names a stylesheet's selectors use. */
function selectorNames(css: string): string[] {
  const names: string[] = [];
  let prelude = '';
  for (const char of css) {
    if (char === '{') {
      if (!prelude.trim().startsWith('@')) {
        for (const match of prelude.matchAll(/[.#]([A-Za-z_][\w-]*)/g))
          names.push(match[1] as string);
      }
      prelude = '';
    } else if (char === '}' || char === ';') prelude = '';
    else prelude += char;
  }
  return names;
}

/** A shadow with a blur radius is soft depth: sticker depth is hard (`0 4px 0 ink`). */
function hasBlur(value: string): boolean {
  const layers = value.replace(/var\([^)]*\)/g, ' V ').split(',');
  return layers.some((layer) => {
    const lengths = layer.match(/(?<![\w.#-])-?\d*\.?\d+(?:px|em|rem)?(?![\w%])/g) ?? [];
    return lengths.length >= 3 && Number.parseFloat(lengths[2] as string) !== 0;
  });
}

/**
 * Problems of one UI stylesheet (everything but tokens.css and fonts.css). `knownVariables` is every
 * `--pp-*` declared by tokens.css and the stylesheets: a `var()` of another name is a typo.
 */
export function checkStylesheet(css: string, knownVariables?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const source = stripComments(css);

  if (/backdrop-filter/i.test(source)) problems.push('backdrop-filter is not allowed (no blur)');
  const hex = source.match(HEX_COLOUR);
  if (hex !== null) problems.push(`hard-coded colour ${hex[0]}: use a --pp-color-* variable`);
  const fn = source.match(COLOUR_FUNCTION);
  if (fn !== null) problems.push(`hard-coded colour ${fn[1]}(): use a --pp-color-* variable`);

  for (const name of selectorNames(source)) {
    if (!name.startsWith('pp-')) problems.push(`selector "${name}" is not prefixed pp-`);
  }
  if (knownVariables !== undefined) {
    for (const name of new Set(usedVariables(source))) {
      if (!knownVariables.has(name)) problems.push(`var(${name}) is not declared anywhere`);
    }
  }

  for (const { property, value } of declarations(source)) {
    const isCustom = property.startsWith('--');
    // A custom property can hide a colour too (`--pp-outline: 3px solid red`), except the font stacks.
    if (isCustom ? !FALLBACK_STACKS.test(property) : COLOUR_PROPERTY.test(property)) {
      const bare = value.replace(/var\([^)]*\)/g, ' ').replace(/url\([^)]*\)/g, ' ');
      for (const word of bare.toLowerCase().match(/[a-z]+/g) ?? []) {
        if (COLOUR_KEYWORDS.has(word)) problems.push(`named colour "${word}" in ${property}`);
      }
    }
    if ((property === 'box-shadow' || property === 'text-shadow') && hasBlur(value)) {
      problems.push(`${property} "${value}" has a blur: sticker depth is a hard shadow`);
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

/** Every reduced-motion rule is this prefix plus the selector it softens (story 2.10, decision D1). */
export const REDUCED_MOTION_PREFIX = ':where(:root[data-pp-motion="reduced"])';

interface CssRule {
  selectors: string[];
  properties: Declaration[];
}

/** The selectors of a rule's prelude, split on the commas outside parentheses, whitespace collapsed. */
function splitSelectors(prelude: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of prelude) {
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    if (char === ',' && depth === 0) {
      selectors.push(current);
      current = '';
    } else current += char;
  }
  selectors.push(current);
  return selectors.map((selector) => selector.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/**
 * The style rules of a stylesheet in source order, `@media` and `@supports` flattened, `@keyframes` and
 * `@font-face` left out. No nested rules: the stylesheets use none.
 */
function styleRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let prelude = '';
  for (let i = 0; i < css.length; i++) {
    const char = css[i] as string;
    if (char === ';' || char === '}') prelude = '';
    else if (char !== '{') prelude += char;
    else {
      const head = prelude.trim();
      prelude = '';
      if (head.startsWith('@')) {
        if (/^@(?:-webkit-)?keyframes|^@font-face/.test(head)) {
          let depth = 1;
          i++;
          while (i < css.length && depth > 0) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
            i++;
          }
          i--;
        }
        continue;
      }
      const end = css.indexOf('}', i);
      const body = css.slice(i + 1, end === -1 ? css.length : end);
      rules.push({ selectors: splitSelectors(head), properties: declarations(body) });
      i = end === -1 ? css.length : end;
    }
  }
  return rules;
}

const declaresAnimation = (declaration: Declaration): boolean =>
  declaration.property === 'animation' || declaration.property === 'animation-name';

const startsAnimation = (declaration: Declaration): boolean =>
  declaresAnimation(declaration) && declaration.value.toLowerCase().split(/\s+/)[0] !== 'none';

/**
 * Problems of the reduced-motion rules of one stylesheet (story 2.10, AC 7 and 21):
 * - `prefers-reduced-motion` is read in `boot.ts` only: a stylesheet reads `data-pp-motion` through
 *   `:where`, so that the player's setting reaches it too;
 * - every selector that starts an animation has a reduced rule of its own (the same selector behind
 *   {@link REDUCED_MOTION_PREFIX}), after the last rule that animates it: `:where` adds no specificity,
 *   so « same selector, later rule wins » is what makes the reduced rule win.
 * A rule that sets `animation: none` needs none.
 */
export function checkReducedMotion(css: string): string[] {
  const problems: string[] = [];
  const source = stripComments(css);
  if (/prefers-reduced-motion/i.test(source)) {
    problems.push(
      `@media (prefers-reduced-motion) is read in boot.ts only: use ${REDUCED_MOTION_PREFIX} <selector>`,
    );
  }
  const lastAnimated = new Map<string, number>();
  const lastReduced = new Map<string, number>();
  styleRules(source).forEach((rule, index) => {
    for (const selector of rule.selectors) {
      if (selector.startsWith(`${REDUCED_MOTION_PREFIX} `)) {
        if (rule.properties.some(declaresAnimation)) {
          lastReduced.set(selector.slice(REDUCED_MOTION_PREFIX.length + 1), index);
        }
      } else if (rule.properties.some(startsAnimation)) lastAnimated.set(selector, index);
    }
  });
  for (const [selector, animatedAt] of lastAnimated) {
    const reducedAt = lastReduced.get(selector);
    if (reducedAt === undefined) {
      problems.push(`"${selector}" animates and has no reduced-motion rule of its own`);
    } else if (reducedAt < animatedAt) {
      problems.push(
        `the reduced-motion rule of "${selector}" comes before its animation: it loses`,
      );
    }
  }
  return problems;
}

/** A CSS animation that never stops (`infinite`), read from the `animation` shorthand (story 2.10, AC 13). */
export interface RepeatingAnimation {
  selector: string;
  /** The `@keyframes` it runs. */
  name: string;
  /** One cycle, in ms. */
  periodMs: number;
  /** Its keyframes change `opacity`: the element goes on and off, which is what a flash is. */
  animatesOpacity: boolean;
}

/** The body of each `@keyframes name { … }`, by name. */
function keyframesByName(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    found.set(match[1] as string, css.slice(start, i - 1));
  }
  return found;
}

/** Splits on the characters outside parentheses (`steps(1, end)` and `cubic-bezier(…)` hold commas and spaces). */
function splitOutsideParens(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    if (depth === 0 && separator.test(char)) {
      if (current !== '') parts.push(current);
      current = '';
    } else current += char;
  }
  if (current !== '') parts.push(current);
  return parts;
}

const toMs = (token: string): number | null => {
  const match = /^(\d*\.?\d+)(ms|s)$/i.exec(token);
  if (match === null) return null;
  return Number.parseFloat(match[1] as string) * (match[2]?.toLowerCase() === 's' ? 1000 : 1);
};

/**
 * The `infinite` animations of a stylesheet, one per selector and animation of an `animation`
 * shorthand. `problems` lists what the check cannot read (a longhand `animation-iteration-count`,
 * a repeating animation with no duration or no `@keyframes`): a blind spot is a failure, not a pass.
 */
export function repeatingAnimations(css: string): {
  animations: RepeatingAnimation[];
  problems: string[];
} {
  const source = stripComments(css);
  const keyframes = keyframesByName(source);
  const animations: RepeatingAnimation[] = [];
  const problems: string[] = [];
  for (const rule of styleRules(source)) {
    for (const { property, value } of rule.properties) {
      if (property === 'animation-iteration-count' && /\binfinite\b/i.test(value)) {
        problems.push(
          `"${rule.selectors.join(', ')}": animation-iteration-count: infinite — use the \`animation\` shorthand so that the period is checked`,
        );
      }
      if (property !== 'animation') continue;
      for (const part of splitOutsideParens(value, /,/)) {
        const tokens = splitOutsideParens(part, /\s/);
        if (!tokens.some((token) => token.toLowerCase() === 'infinite')) continue;
        const periodMs = tokens.map(toMs).find((ms) => ms !== null) ?? null;
        const name = tokens.find((token) => keyframes.has(token));
        if (periodMs === null || name === undefined) {
          problems.push(
            `"${rule.selectors.join(', ')}": cannot read the period or keyframes of "${part.trim()}"`,
          );
          continue;
        }
        const animatesOpacity = declarations(keyframes.get(name) as string).some(
          (declaration) => declaration.property === 'opacity',
        );
        for (const selector of rule.selectors) {
          animations.push({ selector, name, periodMs, animatesOpacity });
        }
      }
    }
  }
  return { animations, problems };
}

/**
 * Problems of the flash rate of one stylesheet (NFR6, story 2.10 AC 13): a repeating animation whose
 * keyframes animate `opacity` goes on and off once per period, so its period is at least
 * `minPeriodMs` (`SCREEN_FLASH_MIN_INTERVAL_MS`: 3 Hz). Movement (`transform`) is not a flash.
 */
export function checkFlashRate(css: string, minPeriodMs: number): string[] {
  const { animations, problems } = repeatingAnimations(css);
  for (const animation of animations) {
    if (animation.animatesOpacity && animation.periodMs < minPeriodMs) {
      problems.push(
        `"${animation.selector}" repeats ${animation.name} every ${animation.periodMs} ms (${(1000 / animation.periodMs).toFixed(1)} Hz): a flash is at most 3 Hz`,
      );
    }
  }
  return problems;
}
