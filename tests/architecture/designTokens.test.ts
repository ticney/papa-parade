import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkReducedMotion,
  checkStylesheet,
  checkTokens,
  declaredNames,
  declaredVariables,
  expectedTokens,
  normaliseValue,
  REDUCED_MOTION_PREFIX,
} from './designTokens.ts';
import { extractFrontmatter, parseYamlSubset } from './yamlSubset.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const DESIGN = join(
  repoRoot,
  '_bmad-output',
  'planning-artifacts',
  'ux-designs',
  'ux-papa-parade-2026-10-26',
  'DESIGN.md',
);
const STYLES = join(repoRoot, 'src', 'client', 'ui');

const FRONTMATTER = parseYamlSubset(extractFrontmatter(readFileSync(DESIGN, 'utf8')));

const TINY_FRONTMATTER = parseYamlSubset(
  [
    'colors:',
    "  ink: '#2A2140'",
    "  scrim: 'rgba(42,33,64,0.62)'",
    'typography:',
    '  verb:',
    "    fontFamily: 'Baloo 2'",
    '    fontSize: 40px',
    "    lineHeight: '1.0'",
    'rounded:',
    '  sm: 8px',
    'spacing:',
    "  '1': 4px",
    "  hud-inset: 'max(12px, env(safe-area-inset-*))'",
    '  touch-target-min: 44pt',
  ].join('\n'),
);

const TINY_CSS = `
:root {
  --pp-color-ink: #2a2140;
  --pp-color-scrim: rgba(42, 33, 64, 0.62);
  --pp-font-verb-family: "Baloo 2";
  --pp-font-verb-size: 40px;
  --pp-font-verb-line-height: 1;
  --pp-rounded-sm: 8px;
  --pp-spacing-1: 4px;
  --pp-spacing-hud-inset-top: max(12px, env(safe-area-inset-top));
  --pp-spacing-hud-inset-right: max(12px, env(safe-area-inset-right));
  --pp-spacing-hud-inset-bottom: max(12px, env(safe-area-inset-bottom));
  --pp-spacing-hud-inset-left: max(12px, env(safe-area-inset-left));
  --pp-spacing-touch-target-min: 44px;
}`;

function without(css: string, name: string): string {
  return css
    .split('\n')
    .filter((line) => !line.includes(`${name}:`))
    .join('\n');
}

function listCss(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...listCss(full));
    else if (name.endsWith('.css')) files.push(full);
  }
  return files;
}

describe('expectedTokens', () => {
  it('names variables after the frontmatter keys, with the side and unit decisions of story 1.5', () => {
    const tokens = new Map(expectedTokens(TINY_FRONTMATTER).map((t) => [t.name, t.value]));
    expect(tokens.get('--pp-color-ink')).toBe('#2A2140');
    expect(tokens.get('--pp-font-verb-family')).toBe('Baloo 2');
    expect(tokens.get('--pp-font-verb-line-height')).toBe('1.0');
    expect(tokens.get('--pp-rounded-sm')).toBe('8px');
    expect(tokens.get('--pp-spacing-1')).toBe('4px');
    expect(tokens.get('--pp-spacing-hud-inset-left')).toBe('max(12px, env(safe-area-inset-left))');
    expect(tokens.get('--pp-spacing-touch-target-min')).toBe('44px');
    expect(tokens.has('--pp-spacing-hud-inset')).toBe(false);
  });
});

describe('normaliseValue', () => {
  it('ignores quotes, spacing, case and trailing zeros, but not real differences', () => {
    expect(normaliseValue("'Baloo 2'")).toBe(normaliseValue('"Baloo 2"'));
    expect(normaliseValue('rgba(42, 33, 64, 0.62)')).toBe(normaliseValue('rgba(42,33,64,0.62)'));
    expect(normaliseValue('1.0')).toBe(normaliseValue('1'));
    expect(normaliseValue('.5')).toBe(normaliseValue('0.50'));
    expect(normaliseValue('#2A2140')).toBe(normaliseValue('#2a2140'));
    expect(normaliseValue('#2a2140')).not.toBe(normaliseValue('#2a2141'));
    expect(normaliseValue('40px')).not.toBe(normaliseValue('41px'));
  });
});

describe('checkTokens', () => {
  it('accepts a stylesheet that mirrors the frontmatter', () => {
    expect(checkTokens(TINY_FRONTMATTER, TINY_CSS)).toEqual([]);
  });

  it('flags a missing variable', () => {
    const problems = checkTokens(TINY_FRONTMATTER, without(TINY_CSS, '--pp-color-ink'));
    expect(problems).toEqual(['missing --pp-color-ink (DESIGN.md: #2A2140)']);
  });

  it('flags a wrong value', () => {
    const css = TINY_CSS.replace('--pp-rounded-sm: 8px', '--pp-rounded-sm: 9px');
    expect(checkTokens(TINY_FRONTMATTER, css)).toEqual([
      '--pp-rounded-sm is "9px" but DESIGN.md says "8px"',
    ]);
  });

  it('flags a safe-area side that lost its env()', () => {
    const css = TINY_CSS.replace(
      '--pp-spacing-hud-inset-left: max(12px, env(safe-area-inset-left))',
      '--pp-spacing-hud-inset-left: 12px',
    );
    expect(checkTokens(TINY_FRONTMATTER, css)).toHaveLength(1);
  });

  it('flags a token the frontmatter lacks, and a helper too: tokens.css holds only tokens', () => {
    const extra = TINY_CSS.replace(
      ':root {',
      ':root {\n  --pp-color-neon: #0f0;\n  --pp-helper: 1;',
    );
    expect(checkTokens(TINY_FRONTMATTER, extra)).toEqual([
      '--pp-color-neon is not in the DESIGN.md frontmatter',
      '--pp-helper is not in the DESIGN.md frontmatter',
    ]);
  });

  it('flags a token declared twice in :root', () => {
    const twice = TINY_CSS.replace(':root {', ':root {\n  --pp-rounded-sm: 8px;');
    expect(checkTokens(TINY_FRONTMATTER, twice)).toEqual(['--pp-rounded-sm is declared twice']);
  });

  it('flags a token overridden under another selector or inside a media query', () => {
    const other = `${TINY_CSS}\n.pp-x { --pp-color-ink: red; }`;
    expect(checkTokens(TINY_FRONTMATTER, other)).toEqual([
      '--pp-color-ink is declared outside :root',
    ]);
    const media = `${TINY_CSS}\n@media (min-width: 1px) { :root { --pp-rounded-sm: 99px; } }`;
    expect(checkTokens(TINY_FRONTMATTER, media)).toEqual([
      '--pp-rounded-sm is declared outside :root',
    ]);
  });

  it('flags a touch target that kept the pt unit', () => {
    const css = TINY_CSS.replace(
      '--pp-spacing-touch-target-min: 44px',
      '--pp-spacing-touch-target-min: 44pt',
    );
    expect(checkTokens(TINY_FRONTMATTER, css)).toHaveLength(1);
  });

  it('reads variables through comments', () => {
    expect(declaredVariables('/* --pp-color-x: red; */ :root { --pp-color-y: blue; }')).toEqual(
      new Map([['--pp-color-y', 'blue']]),
    );
  });

  it('tokens.css mirrors DESIGN.md, both ways', () => {
    const css = readFileSync(join(STYLES, 'styles', 'tokens.css'), 'utf8');
    expect(checkTokens(FRONTMATTER, css)).toEqual([]);
  });
});

describe('checkStylesheet', () => {
  it('accepts rules built from variables', () => {
    const css = `
      .pp-button { color: var(--pp-color-ink); background: var(--pp-color-paper) url(x.png);
        border: 3px solid var(--pp-color-ink); box-shadow: 0 4px 0 var(--pp-color-ink);
        background-color: transparent; outline: none; transition: transform 100ms, opacity 100ms; }
      .pp-gauge { transform-origin: left; }
      @keyframes pp-pop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); } }`;
    expect(checkStylesheet(css)).toEqual([]);
  });

  it('flags hex colours, colour functions and named colours', () => {
    expect(checkStylesheet('a { color: #fff; }')).toHaveLength(1);
    expect(checkStylesheet('a { background: rgb(0 0 0); }')).toHaveLength(1);
    expect(checkStylesheet('a { border: 1px solid red; }')).toEqual([
      'named colour "red" in border',
    ]);
    expect(checkStylesheet('a { box-shadow: 0 4px 0 black; }')).toHaveLength(1);
  });

  it('does not take class names, selectors or non-colour properties for colours', () => {
    expect(checkStylesheet('.pp-red:hover { content: "tan"; animation-name: pp-red; }')).toEqual(
      [],
    );
  });

  it('ignores colours in comments', () => {
    expect(checkStylesheet('/* #fff red */ a { color: var(--pp-color-ink); }')).toEqual([]);
  });

  it('flags a colour hidden in a custom property, but not a font stack', () => {
    expect(checkStylesheet(':root { --pp-outline: 3px solid red; }')).toEqual([
      'named colour "red" in --pp-outline',
    ]);
    expect(
      checkStylesheet(':root { --pp-fallback-body: ui-rounded, "Arial Black", sans-serif; }'),
    ).toEqual([]);
  });

  it('flags a selector that is not prefixed pp-, but not at-rules or keyframe steps', () => {
    expect(checkStylesheet('.button { color: var(--pp-color-ink); }')).toEqual([
      'selector "button" is not prefixed pp-',
    ]);
    expect(checkStylesheet('#canvas { display: block; }')).toEqual([
      'selector "canvas" is not prefixed pp-',
    ]);
    expect(
      checkStylesheet(
        '@supports (height: 100dvh) { #pp-canvas { height: 100dvh; } } @keyframes pp-k { 0%, 100% { opacity: 0; } }',
      ),
    ).toEqual([]);
  });

  it('flags a var() of a name nobody declares, when the known names are given', () => {
    const known = new Set(['--pp-color-ink']);
    expect(checkStylesheet('.pp-a { color: var(--pp-color-ink); }', known)).toEqual([]);
    expect(checkStylesheet('.pp-a { color: var(--pp-color-inkk); }', known)).toEqual([
      'var(--pp-color-inkk) is not declared anywhere',
    ]);
    expect(checkStylesheet('.pp-a { color: var(--pp-color-inkk); }')).toEqual([]); // no list, no check
  });

  it('accepts hard shadows and flags a blurred one', () => {
    expect(
      checkStylesheet(
        '.pp-a { box-shadow: 0 4px 0 var(--pp-color-ink), 0 0 0 2px var(--pp-color-paper); text-shadow: 0 4px 0 var(--pp-color-ink); }',
      ),
    ).toEqual([]);
    expect(checkStylesheet('.pp-a { box-shadow: 0 2px 8px var(--pp-color-ink); }')).toHaveLength(1);
    expect(checkStylesheet('.pp-a { text-shadow: 0 0 4px var(--pp-color-ink); }')).toHaveLength(1);
    expect(checkStylesheet('.pp-a { box-shadow: var(--pp-lift); }')).toEqual([]);
  });

  it('flags a transition or keyframe on sizes, gaps, font metrics and borders too', () => {
    for (const property of [
      'gap',
      'min-width',
      'max-height',
      'font-size',
      'line-height',
      'flex-basis',
      'border-width',
    ]) {
      expect(checkStylesheet(`.pp-a { transition: ${property} 1s; }`), property).toHaveLength(1);
      expect(
        checkStylesheet(`@keyframes pp-k { to { ${property}: 1px; } }`),
        property,
      ).toHaveLength(1);
    }
  });

  it('flags backdrop-filter, with or without a prefix', () => {
    expect(checkStylesheet('a { backdrop-filter: blur(4px); }')).toHaveLength(1);
    expect(checkStylesheet('a { -webkit-backdrop-filter: blur(4px); }')).toHaveLength(1);
  });

  it('flags a transition on a layout property, or on all', () => {
    expect(checkStylesheet('a { transition: width 1s; }')).toHaveLength(1);
    expect(checkStylesheet('a { transition: all 1s; }')).toHaveLength(1);
    expect(checkStylesheet('a { transition-property: margin-left, transform; }')).toHaveLength(1);
  });

  it('flags a keyframe on a layout property', () => {
    expect(checkStylesheet('@keyframes k { from { width: 0; } to { width: 10px; } }')).toEqual([
      '@keyframes animates "width" (layout)',
      '@keyframes animates "width" (layout)',
    ]);
    expect(checkStylesheet('@keyframes k { 0% { top: 0; } }')).toHaveLength(1);
  });
});

describe('checkReducedMotion (story 2.10)', () => {
  const P = REDUCED_MOTION_PREFIX;

  it('accepts an animation with a reduced rule of its own, after it', () => {
    const css = `.pp-a { animation: pp-k 1s; } ${P} .pp-a { animation: none; }`;
    expect(checkReducedMotion(css)).toEqual([]);
  });

  it('accepts a reduced rule that swaps the animation for a gentler one', () => {
    const css = `.pp-a { animation-name: pp-pop; } ${P} .pp-a { animation: pp-fade 150ms linear both; }`;
    expect(checkReducedMotion(css)).toEqual([]);
  });

  it('flags any prefers-reduced-motion, which a saved setting would never reach', () => {
    const css = '@media (prefers-reduced-motion: reduce) { .pp-a { animation: none; } }';
    expect(checkReducedMotion(css)).toEqual([
      `@media (prefers-reduced-motion) is read in boot.ts only: use ${P} <selector>`,
    ]);
  });

  it('ignores the words in a comment', () => {
    expect(checkReducedMotion('/* prefers-reduced-motion */ .pp-a { color: red; }')).toEqual([]);
  });

  it('flags an animated selector with no reduced rule', () => {
    expect(checkReducedMotion('.pp-a { animation: pp-k 1s infinite; }')).toEqual([
      '".pp-a" animates and has no reduced-motion rule of its own',
    ]);
    expect(checkReducedMotion('.pp-a { animation-name: pp-k; }')).toHaveLength(1);
  });

  it('flags every selector of a list, and a reduced rule that does not touch the animation', () => {
    const css = `.pp-a, .pp-b { animation: pp-k 1s; } ${P} .pp-a { animation: none; } ${P} .pp-b { color: var(--pp-color-ink); }`;
    expect(checkReducedMotion(css)).toEqual([
      '".pp-b" animates and has no reduced-motion rule of its own',
    ]);
  });

  it('flags a reduced rule that comes before the animation: the later rule would win', () => {
    const css = `${P} .pp-a { animation: none; } .pp-a { animation: pp-k 1s; }`;
    expect(checkReducedMotion(css)).toEqual([
      'the reduced-motion rule of ".pp-a" comes before its animation: it loses',
    ]);
  });

  it('looks inside an @media query, and past keyframes', () => {
    const css =
      '@keyframes pp-k { to { opacity: 0; } } @media (max-width: 600px) { .pp-a { animation: pp-k 1s; } }';
    expect(checkReducedMotion(css)).toEqual([
      '".pp-a" animates and has no reduced-motion rule of its own',
    ]);
    expect(checkReducedMotion(`${css} ${P} .pp-a { animation: none; }`)).toEqual([]);
  });

  it('wants no reduced rule for a rule that stops an animation', () => {
    expect(
      checkReducedMotion('.pp-a { animation: none; } .pp-b { animation-name: none; }'),
    ).toEqual([]);
  });

  it('matches descendant selectors as a whole', () => {
    const css = `.pp-x .pp-a { animation: pp-k 1s; } ${P} .pp-a { animation: none; }`;
    expect(checkReducedMotion(css)).toEqual([
      '".pp-x .pp-a" animates and has no reduced-motion rule of its own',
    ]);
  });

  it('lets the :where selector through checkStylesheet', () => {
    expect(checkStylesheet(`${P} .pp-a { animation: none; }`)).toEqual([]);
  });
});

describe('the UI stylesheets of the repository', () => {
  const all = listCss(STYLES);
  const sheets = all.filter((file) => !/[\\/](tokens|fonts)\.css$/.test(file));
  const known = new Set(all.flatMap((file) => [...declaredNames(readFileSync(file, 'utf8'))]));

  it('include ui.css', () => {
    expect(sheets.map((file) => relative(STYLES, file).replaceAll('\\', '/'))).toContain(
      'styles/ui.css',
    );
  });

  for (const file of sheets) {
    it(`${relative(repoRoot, file).replaceAll('\\', '/')} uses declared variables only, no blur, no layout animation`, () => {
      expect(checkStylesheet(readFileSync(file, 'utf8'), known)).toEqual([]);
    });
    it(`${relative(repoRoot, file).replaceAll('\\', '/')} reads the reduced-motion setting through data-pp-motion, with a reduced rule for every animation`, () => {
      expect(checkReducedMotion(readFileSync(file, 'utf8'))).toEqual([]);
    });
  }

  it('hold every animation of the client: no stylesheet outside src/client/ui escapes the guard', () => {
    const outside = listCss(join(repoRoot, 'src')).filter((file) => !all.includes(file));
    for (const file of outside) {
      expect(checkReducedMotion(readFileSync(file, 'utf8')), file).toEqual([]);
    }
  });
});
