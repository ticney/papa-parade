import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkContent, stripComments } from '../../tools/content/contentChecks.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let root: string;

async function put(relativePath: string, text: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function mutateJson(relativePath: string, change: (json: Record<string, unknown>) => void) {
  const path = join(root, relativePath);
  const json = JSON.parse(await readFile(path, 'utf8'));
  change(json);
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pp-content-'));
  await cp(join(REPO, 'content'), join(root, 'content'), { recursive: true });
  await mkdir(join(root, 'src', 'client'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('checkContent on the real repository', () => {
  it('finds nothing to report', async () => {
    expect(await checkContent(REPO)).toEqual([]);
  });
});

describe('checkContent', () => {
  it('accepts the copy of the real content', async () => {
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports a JSON file that has no registered schema', async () => {
    await put('content/extra.json', '{}');
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/extra.json', jsonPath: '' }),
    ]);
  });

  it('reports a registered file in a place the registry does not know', async () => {
    await put('content/threats/feel.json', '{}');
    const problems = await checkContent(root);
    expect(problems.map((problem) => problem.file)).toEqual(['content/threats/feel.json']);
  });

  it('reports an invalid feel file with its JSON path', async () => {
    await mutateJson('content/feel.json', (feel) => {
      (feel.timing as Record<string, unknown>).windowMs = 'x';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/feel.json', jsonPath: 'timing.windowMs' }),
    ]);
  });

  it('reports a stray key', async () => {
    await mutateJson('content/feel.json', (feel) => {
      feel.stray = 1;
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/feel.json', jsonPath: 'stray' }),
    ]);
  });

  it('ignores whatever is under _schemas/ (but not its freshness)', async () => {
    await put('content/_schemas/notes.json', 'not even json');
    expect(await checkContent(root)).toEqual([]);
  });

  it('ignores files that are not JSON', async () => {
    await put('content/README.md', '# hello');
    expect(await checkContent(root)).toEqual([]);
  });

  it('fails on a t() call with a key the strings file lacks, passes on a known one', async () => {
    await put('src/client/x.ts', "t('missing.key');\nt('start.tap_to_start');\n");
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: 'src/client/x.ts',
        message: expect.stringContaining('line 1: string key "missing.key"'),
      }),
    ]);
  });

  it('ignores a non-literal t() argument', async () => {
    await put(
      'src/client/x.ts',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text of a template literal
      'const key = pick();\nt(key);\nt(`a.${key}`);\nformat.t("nope.nope");\n',
    );
    expect(await checkContent(root)).toEqual([]);
  });

  it('ignores the same call inside comments', async () => {
    await put('src/client/x.ts', "// t('missing.key')\n/* t('missing.key')\n  t('other.key') */\n");
    expect(await checkContent(root)).toEqual([]);
  });

  it('ignores test, spec and fixture files', async () => {
    await put('src/client/x.test.ts', "t('missing.key');\n");
    await put('src/client/x.spec.ts', "t('missing.key');\n");
    await put('src/client/fixtures/y.ts', "t('missing.key');\n");
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports schema drift and tells how to fix it', async () => {
    await writeFile(join(root, 'content/_schemas/feel.schema.json'), '{}\n');
    const problems = await checkContent(root);
    expect(problems).toEqual([
      expect.objectContaining({ file: 'content/_schemas/feel.schema.json' }),
    ]);
    expect(problems[0]?.message).toContain('npm run content:schemas');
  });

  it('reports a missing generated schema', async () => {
    await rm(join(root, 'content/_schemas/strings.schema.json'));
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/_schemas/strings.schema.json' }),
    ]);
  });
});

describe('stripComments', () => {
  it('keeps comment markers that sit inside strings', () => {
    const source = "const url = 'http://x//y'; t('a.b') // t('gone.key')";
    expect(stripComments(source)).toBe("const url = 'http://x//y'; t('a.b') \n");
  });

  it('keeps line numbers across block comments', () => {
    expect(stripComments('a /* x\ny */ b').split('\n')).toHaveLength(2);
  });
});
