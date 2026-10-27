import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEEDBACK_CLIENT_EVENTS } from '@client/feedback/feedbackEvents';
import { SIM_EVENT_TYPES } from '@sim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkContent, stripComments } from '../../tools/content/contentChecks.ts';
import { createTestLevelGeometry } from '../support/testLevelGeometry.ts';

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
  // The clip files `feedback.json` names: the check looks for them under the root it is given.
  await cp(join(REPO, 'public', 'assets', 'audio'), join(root, 'public', 'assets', 'audio'), {
    recursive: true,
  });
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
    await put('content/elsewhere/feel.json', '{}');
    const problems = await checkContent(root);
    expect(problems.map((problem) => problem.file)).toEqual(['content/elsewhere/feel.json']);
  });

  it('reports an invalid feel file with its JSON path', async () => {
    await mutateJson('content/feel.json', (feel) => {
      (feel.timing as Record<string, unknown>).windowMs = 'x';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/feel.json', jsonPath: 'timing.windowMs' }),
    ]);
  });

  it('reports an invalid feedback file with its JSON path', async () => {
    await mutateJson('content/feedback.json', (feedback) => {
      (
        (feedback.buses as Record<string, Record<string, unknown>>).sfx as Record<string, unknown>
      ).gainPct = 101;
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/feedback.json', jsonPath: 'buses.sfx.gainPct' }),
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

  it('reports a registered content file that is missing', async () => {
    await rm(join(root, 'content/feel.json'));
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: 'content/feel.json',
        message: expect.stringMatching(/missing/),
      }),
    ]);
  });

  it('reports a generated schema that no content file owns', async () => {
    await put('content/_schemas/orphan.schema.json', '{}\n');
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/_schemas/orphan.schema.json' }),
    ]);
  });

  it('reports a missing generated schema', async () => {
    await rm(join(root, 'content/_schemas/strings.schema.json'));
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/_schemas/strings.schema.json' }),
    ]);
  });
});

describe('checkContent on bots.json references', () => {
  it('reports a tap that is not shorter than the hold that makes a Firmness', async () => {
    const feel = JSON.parse(await readFile(join(root, 'content/feel.json'), 'utf8'));
    await mutateJson('content/bots.json', (bots) => {
      bots.tapMs = feel.input.holdMinMs;
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: 'content/bots.json',
        jsonPath: 'tapMs',
        message: expect.stringContaining('bots.json › tapMs'),
      }),
    ]);
  });

  it('reports a random hold that is not longer than the hold that makes a Firmness', async () => {
    const feel = JSON.parse(await readFile(join(root, 'content/feel.json'), 'utf8'));
    await mutateJson('content/bots.json', (bots) => {
      (bots.random as { maxHoldMs: number }).maxHoldMs = feel.input.holdMinMs;
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/bots.json', jsonPath: 'random.maxHoldMs' }),
    ]);
  });

  it('accepts a tap just under it', async () => {
    const feel = JSON.parse(await readFile(join(root, 'content/feel.json'), 'utf8'));
    await mutateJson('content/bots.json', (bots) => {
      bots.tapMs = feel.input.holdMinMs - 1;
    });
    expect(await checkContent(root)).toEqual([]);
  });
});

describe('checkContent on feedback.json references', () => {
  const FILE = 'content/feedback.json';
  // The ids come from the live file, never typed here: Geo tunes or deletes cues (D13).
  const live = JSON.parse(
    readFileSync(new URL('../../content/feedback.json', import.meta.url), 'utf8'),
  ) as {
    events: Record<string, string>;
    cues: Record<string, { audio?: { clip: string }; visual?: unknown }>;
    loops: { music: { clip: string } };
  };
  const SIM_EVENT = SIM_EVENT_TYPES[0];
  const CLIENT_EVENT = FEEDBACK_CLIENT_EVENTS[0];
  const cueWithAudio = Object.entries(live.cues).find(([, cue]) => cue.audio !== undefined);
  const cueWithVisual = Object.entries(live.cues).find(([, cue]) => cue.visual !== undefined);

  it('reports an event name that no event has, with its JSON path', async () => {
    await mutateJson('content/feedback.json', (feedback) => {
      (feedback.events as Record<string, string>).NoSuchEventHappened = Object.values(
        live.events,
      )[0] as string;
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: 'events.NoSuchEventHappened' }),
    ]);
  });

  it('reports an event that points at a cue that does not exist (the schema refuses it)', async () => {
    await mutateJson('content/feedback.json', (feedback) => {
      (feedback.events as Record<string, string>)[SIM_EVENT] = 'no_such_cue';
    });
    const problems = await checkContent(root);
    expect(problems).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: `events.${SIM_EVENT}` }),
    ]);
    expect(problems[0]?.message).toContain('no_such_cue');
  });

  it('accepts a client event whose cue has neither visual nor camera, as well as a sim event', async () => {
    await mutateJson('content/feedback.json', (feedback) => {
      (feedback.cues as Record<string, unknown>).only_haptic = { haptic: 'light' };
      (feedback.events as Record<string, string>)[CLIENT_EVENT] = 'only_haptic';
      (feedback.events as Record<string, string>)[SIM_EVENT] = 'only_haptic';
    });
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports a client event whose cue has a visual: the director has no world to draw it in', async () => {
    expect(cueWithVisual).toBeDefined();
    await mutateJson('content/feedback.json', (feedback) => {
      (feedback.events as Record<string, string>)[CLIENT_EVENT] = (
        cueWithVisual as [string, unknown]
      )[0];
    });
    const problems = await checkContent(root);
    expect(problems).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: `events.${CLIENT_EVENT}` }),
    ]);
    expect(problems[0]?.message).toContain('client event');
  });

  it('reports a threat-anchored visual on a cue that an event points at, with the path of the anchor', async () => {
    const [cueId, cue] = cueWithVisual as [string, { visual: { anchor: string } }];
    const eventName = Object.entries(live.events).find(([, id]) => id === cueId)?.[0];
    expect(eventName).toBeDefined();
    await mutateJson('content/feedback.json', (feedback) => {
      const cues = feedback.cues as Record<string, { visual: { anchor: string } }>;
      (cues[cueId] as { visual: { anchor: string } }).visual.anchor = 'threat';
    });
    expect(cue.visual).toBeDefined();
    const problems = await checkContent(root);
    expect(problems).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: `cues.${cueId}.visual.anchor` }),
    ]);
    expect(problems[0]?.message).toContain(eventName as string);
  });

  it('accepts a threat-anchored visual on a cue that no event points at', async () => {
    await mutateJson('content/feedback.json', (feedback) => {
      (feedback.cues as Record<string, unknown>).only_threat = {
        visual: { kind: 'soundWave', anchor: 'threat', maxRadiusM: 0.5, durationMs: 300 },
      };
    });
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports a cue clip with no file, and tells how to make the placeholders', async () => {
    expect(cueWithAudio).toBeDefined();
    const [cueId] = cueWithAudio as [string, unknown];
    await mutateJson('content/feedback.json', (feedback) => {
      const cues = feedback.cues as Record<string, { audio: { clip: string } }>;
      (cues[cueId] as { audio: { clip: string } }).audio.clip = 'papa_bonk';
    });
    const problems = await checkContent(root);
    expect(problems).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: `cues.${cueId}.audio.clip` }),
    ]);
    expect(problems[0]?.message).toContain('npm run assets:audio');
  });

  it('reports a loop clip with no file', async () => {
    await rm(join(root, `public/assets/audio/${live.loops.music.clip}.m4a`));
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: 'loops.music.clip' }),
    ]);
  });
});

describe('checkContent on level geometry files', () => {
  const FILE = 'content/levels/test_room.geometry.json';
  const put_ = (text: string) => put(FILE, text);
  const geometryText = (change: (level: Record<string, unknown>) => void = () => {}) => {
    const level = createTestLevelGeometry('test_room') as unknown as Record<string, unknown>;
    change(level);
    return `${JSON.stringify(level, null, 2)}\n`;
  };

  it('accepts a geometry file named after its id', async () => {
    await put_(geometryText());
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports a geometry file that breaks the schema, with the JSON path', async () => {
    await put_(
      geometryText((level) => {
        level.anchors = (level.anchors as { id: string }[]).filter((a) => a.id !== 'phone');
      }),
    );
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: FILE, message: expect.stringContaining('"phone"') }),
    ]);
  });

  it('reports an id that differs from the file name', async () => {
    await put_(
      geometryText((level) => {
        level.id = 'other_room';
      }),
    );
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: 'id' }),
    ]);
  });

  it('still refuses a JSON file in levels/ that matches no pattern', async () => {
    await put('content/levels/Salon.json', '{}');
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/levels/Salon.json' }),
    ]);
  });

  it('reports a stale generated geometry schema', async () => {
    await writeFile(join(root, 'content/_schemas/levelGeometry.schema.json'), '{}\n');
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/_schemas/levelGeometry.schema.json' }),
    ]);
  });
});

describe('checkContent on threat files', () => {
  const FILE = 'content/threats/outlet.json';

  it('accepts a second threat file named after its id', async () => {
    await mutateJson('content/threats/outlet.json', () => {});
    const outlet = await readFile(join(root, FILE), 'utf8');
    await put('content/threats/plug.json', outlet.replace('"id": "outlet"', '"id": "plug"'));
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports an id that differs from the file name', async () => {
    await mutateJson(FILE, (threat) => {
      threat.id = 'plug';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: 'id' }),
    ]);
  });

  it('reports a gag the sim does not know', async () => {
    await mutateJson(FILE, (threat) => {
      threat.gag = 'outlet_hairs';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'gag',
        message: expect.stringContaining('outlet_hairs'),
      }),
    ]);
  });

  it.each(['telegraph', 'success', 'perfect', 'gag'])(
    'reports a %s cue that is not in feedback.json',
    async (role) => {
      await mutateJson(FILE, (threat) => {
        (threat.feedback as Record<string, string>)[role] = 'no_such_cue';
      });
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: `feedback.${role}`,
          message: expect.stringContaining('no_such_cue'),
        }),
      ]);
    },
  );

  it('reports a threat file that breaks its schema, with the JSON path', async () => {
    await mutateJson(FILE, (threat) => {
      threat.cooldownMs = -1;
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: 'cooldownMs' }),
    ]);
  });

  it('reports a stale generated threat schema', async () => {
    await writeFile(join(root, 'content/_schemas/threat.schema.json'), '{}\n');
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/_schemas/threat.schema.json' }),
    ]);
  });
});

describe('checkContent on level files', () => {
  const FILE = 'content/levels/salon_crawler.json';
  const entry = { def: 'outlet', anchor: 'outlet_01', fromMs: 2000 };
  const plan = (...threats: Record<string, unknown>[]) =>
    mutateJson(FILE, (level) => {
      level.threats = threats;
    });

  it('accepts a level that plans the outlet at an anchor of its geometry', async () => {
    await plan(entry, { ...entry, fromMs: 9000 });
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports an id that differs from the file name', async () => {
    await mutateJson(FILE, (level) => {
      level.id = 'salon';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: 'id' }),
    ]);
  });

  it('names the planned threat that does not exist, with its index', async () => {
    await plan(entry, { ...entry, def: 'outlett' });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'threats[1].def',
        message: expect.stringContaining('outlett'),
      }),
    ]);
  });

  it('names the anchor the geometry lacks', async () => {
    await plan({ ...entry, anchor: 'outlet_02' });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'threats[0].anchor',
        message: expect.stringContaining('outlet_02'),
      }),
    ]);
  });

  it('reports a level that has no geometry file', async () => {
    await put('content/levels/test_room.json', '{ "id": "test_room", "threats": [] }\n');
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: 'content/levels/test_room.json',
        jsonPath: '',
        message: expect.stringContaining('test_room.geometry.json'),
      }),
    ]);
  });

  it('reports a level file that breaks its schema, with the JSON path', async () => {
    await plan({ ...entry, fromMs: -1 });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: 'threats[0].fromMs' }),
    ]);
  });

  it('does not report a level twice for a threat file that is broken (it is reported on its own)', async () => {
    await plan(entry);
    await mutateJson('content/threats/outlet.json', (threat) => {
      threat.cooldownMs = -1;
    });
    const problems = await checkContent(root);
    expect(problems.map((problem) => problem.file)).toEqual(['content/threats/outlet.json']);
  });

  it('reports a stale generated level schema', async () => {
    await writeFile(join(root, 'content/_schemas/level.schema.json'), '{}\n');
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/_schemas/level.schema.json' }),
    ]);
  });
});

describe('stripComments', () => {
  it('keeps comment markers that sit inside strings', () => {
    const source = "const url = 'http://x//y'; t('a.b') // t('gone.key')";
    expect(stripComments(source)).toBe("const url = 'http://x//y'; t('a.b') \n");
  });

  it('does not let a quote in a regex literal swallow the next lines', () => {
    expect(stripComments("const quoted = /'/;\n// t('gone.key')\n")).toBe(
      "const quoted = /'/;\n\n",
    );
  });

  it('keeps line numbers across block comments', () => {
    expect(stripComments('a /* x\ny */ b').split('\n')).toHaveLength(2);
  });
});
