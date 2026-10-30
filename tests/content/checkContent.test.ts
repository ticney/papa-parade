import { readFileSync } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/**
 * Makes `threat` (a copy of a live def, about to be put in the temp tree) point at a telegraph cue
 * of its own: a new cue `tel_<name>` in the temp `feedback.json`, with a copy of the outlet's clip
 * under a new name. Two defs of one content tree may not share a telegraph sound (story 2.3), so
 * a copy of a live def gets its own rather than the rule being relaxed.
 */
async function giveOwnTelegraph(threat: Record<string, unknown>, name: string): Promise<void> {
  const audioDir = join(root, 'public', 'assets', 'audio');
  await cp(join(audioDir, 'tel_outlet.m4a'), join(audioDir, `tel_${name}.m4a`));
  await mutateJson('content/feedback.json', (feedback) => {
    const cues = feedback.cues as Record<string, { audio: { clip: string } }>;
    const copy = structuredClone(cues.tel_outlet) as { audio: { clip: string } };
    copy.audio.clip = `tel_${name}`;
    cues[`tel_${name}`] = copy;
  });
  (threat.feedback as Record<string, string>).telegraph = `tel_${name}`;
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
    loops: { music: { stems: { calm: string; tense: string } } };
  };
  const SIM_EVENT = SIM_EVENT_TYPES[0];
  const CLIENT_EVENT = FEEDBACK_CLIENT_EVENTS[0];
  const cueWithAudio = Object.entries(live.cues).find(([, cue]) => cue.audio !== undefined);
  // A world visual: the `uiElement` ones (story 1.22) are allowed on a client event.
  const cueWithSoundWave = Object.entries(live.cues).find(
    ([, cue]) => (cue.visual as { kind?: string } | undefined)?.kind === 'soundWave',
  );

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
    expect(cueWithSoundWave).toBeDefined();
    await mutateJson('content/feedback.json', (feedback) => {
      (feedback.events as Record<string, string>)[CLIENT_EVENT] = (
        cueWithSoundWave as [string, unknown]
      )[0];
    });
    const problems = await checkContent(root);
    expect(problems).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: `events.${CLIENT_EVENT}` }),
    ]);
    expect(problems[0]?.message).toContain('client event');
  });

  it('accepts a client event whose cue has a uiElement visual (story 1.22 D6)', async () => {
    await mutateJson('content/feedback.json', (feedback) => {
      (feedback.cues as Record<string, unknown>).ui_twin = {
        audio: (cueWithAudio as [string, { audio: unknown }])[1].audio,
        visual: { kind: 'uiElement' },
        haptic: 'light',
      };
      (feedback.events as Record<string, string>)[CLIENT_EVENT] = 'ui_twin';
    });
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports a client event whose cue has a world visual, even beside the uiElement ones', async () => {
    const [cueId] = cueWithSoundWave as [string, unknown];
    await mutateJson('content/feedback.json', (feedback) => {
      (feedback.events as Record<string, string>)[CLIENT_EVENT] = cueId;
    });
    const problems = await checkContent(root);
    expect(problems).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: `events.${CLIENT_EVENT}` }),
    ]);
    expect(problems[0]?.message).toContain(cueId);
  });

  it('reports a sim event whose cue has a uiElement visual, with the path of the kind', async () => {
    await mutateJson('content/feedback.json', (feedback) => {
      (feedback.cues as Record<string, unknown>).ui_twin = { visual: { kind: 'uiElement' } };
      (feedback.events as Record<string, string>)[SIM_EVENT] = 'ui_twin';
    });
    const problems = await checkContent(root);
    expect(problems).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: 'cues.ui_twin.visual.kind' }),
    ]);
    expect(problems[0]?.message).toContain(SIM_EVENT);
    expect(problems[0]?.message).toContain('uiElement');
  });

  it('reports a threat-anchored visual on a cue that an event points at, with the path of the anchor', async () => {
    const [cueId, cue] = cueWithSoundWave as [string, { visual: { anchor: string } }];
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

  it('reports a layer clip with no file, at the path of the layer', async () => {
    await mutateJson('content/feedback.json', (feedback) => {
      const cues = feedback.cues as Record<string, { layers: { clip: string }[] }>;
      for (const layer of cues.resp_parry_perfect?.layers ?? []) layer.clip = 'baby_laugh_oops';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'cues.resp_parry_perfect.layers[0].clip',
        message: expect.stringContaining('npm run assets:audio'),
      }),
    ]);
  });

  it.each(['calm', 'tense'] as const)('reports the %s music stem with no file', async (stem) => {
    await rm(join(root, `public/assets/audio/${live.loops.music.stems[stem]}.m4a`));
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: `loops.music.stems.${stem}` }),
    ]);
  });

  it('reports a music stem that is not in the music category, and accepts music_* stems', async () => {
    const calmFile = join(root, `public/assets/audio/${live.loops.music.stems.calm}.m4a`);
    await copyFile(calmFile, join(root, 'public/assets/audio/papa_stem.m4a'));
    await mutateJson('content/feedback.json', (feedback) => {
      (feedback.loops as { music: { stems: Record<string, string> } }).music.stems.tense =
        'papa_stem';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'loops.music.stems.tense',
        message: expect.stringContaining('music_<name>'),
      }),
    ]);
    await copyFile(calmFile, join(root, 'public/assets/audio/music_other.m4a'));
    await mutateJson('content/feedback.json', (feedback) => {
      (feedback.loops as { music: { stems: Record<string, string> } }).music.stems.tense =
        'music_other';
    });
    expect(await checkContent(root)).toEqual([]);
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

  it('reports a prop whose kind has no feel.physics.kinds entry, with its index', async () => {
    await put_(
      geometryText((level) => {
        (level.props as { kind: string }[]).push({
          id: 'lamp_01',
          kind: 'lamp',
          centerM: [0, 0.2, 0],
          halfExtentsM: [0.1, 0.2, 0.1],
        } as never);
      }),
    );
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'props[1].kind',
        message: 'test_room.geometry.json › props[1].kind "lamp" has no feel.physics.kinds entry',
      }),
    ]);
  });

  describe('physics tuning', () => {
    type Kinds = Record<string, Record<string, number>>;
    const tune = (change: (physics: Record<string, unknown> & { kinds: Kinds }) => void) =>
      mutateJson('content/feel.json', (feel) => {
        change(feel.physics as Record<string, unknown> & { kinds: Kinds });
      });

    it('accepts the shipped tuning', async () => {
      expect(await checkContent(root)).toEqual([]);
    });

    it('reports a breakable kind that breaks under the impact threshold, where it could never break', async () => {
      await tune((physics) => {
        (physics.kinds.vase as Record<string, number>).breakImpulseNs = 0.1;
      });
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({
          file: 'content/feel.json',
          jsonPath: 'physics.kinds.vase.breakImpulseNs',
          message: expect.stringContaining('could never break'),
        }),
      ]);
    });

    it('accepts a kind that is not breakable whatever its break impulse', async () => {
      await tune((physics) => {
        const vase = physics.kinds.vase as Record<string, unknown>;
        vase.breakable = false;
        vase.breakImpulseNs = 0.1;
      });
      expect(await checkContent(root)).toEqual([]);
    });

    it('reports a kind so heavy that it reports an impact all the time it rests', async () => {
      await tune((physics) => {
        (physics.kinds.mug as Record<string, number>).massKg = 40;
      });
      const problems = await checkContent(root);
      expect(problems).toContainEqual(
        expect.objectContaining({
          file: 'content/feel.json',
          jsonPath: 'physics.kinds.mug.massKg',
          message: expect.stringContaining('all the time it rests'),
        }),
      );
    });

    it('reports a kind so light that the largest push could carry it through a wall in one step', async () => {
      await tune((physics) => {
        physics.maxPushImpulseNs = 100;
      });
      const problems = await checkContent(root);
      expect(problems.map((problem) => problem.jsonPath)).toEqual([
        'physics.kinds.mug.massKg',
        'physics.kinds.vase.massKg',
      ]);
      expect(problems[0]?.message).toContain('could cross one');
    });

    it('reports a gag push above the largest push the physics allows, where it would be clamped', async () => {
      await mutateJson('content/feel.json', (feel) => {
        const gags = feel.gags as { tableObjectFall: Record<string, number> };
        gags.tableObjectFall.pushImpulseNs = 5;
      });
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({
          file: 'content/feel.json',
          jsonPath: 'gags.tableObjectFall.pushImpulseNs',
          message: expect.stringContaining('must not be above physics.maxPushImpulseNs'),
        }),
      ]);
    });
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
    const outlet = JSON.parse(await readFile(join(root, FILE), 'utf8'));
    outlet.id = 'plug';
    await giveOwnTelegraph(outlet, 'plug');
    await put('content/threats/plug.json', `${JSON.stringify(outlet, null, 2)}\n`);
    expect(await checkContent(root)).toEqual([]);
  });

  describe('the sounds of a threat (story 2.3)', () => {
    const FEEDBACK = 'content/feedback.json';
    /** The problems about sounds: the cues these tests point at break the haptic, flash and fx rules of stories 2.4 and 2.5 too, which have tests of their own. */
    const soundProblems = async () =>
      (await checkContent(root)).filter(
        (problem) =>
          !/^the cue "[^"]+" (vibrates "|has (a|no) `flash`|has fx ")/.test(problem.message),
      );
    /** Adds cues to the temp `feedback.json` and points one role of the outlet at one of them. */
    const point = async (role: string, cueId: string, cue?: Record<string, unknown>) => {
      if (cue !== undefined) {
        await mutateJson(FEEDBACK, (feedback) => {
          (feedback.cues as Record<string, unknown>)[cueId] = cue;
        });
      }
      await mutateJson(FILE, (threat) => {
        (threat.feedback as Record<string, string>)[role] = cueId;
      });
    };

    it.each(['success', 'perfect'])('reports a %s cue with no audio', async (role) => {
      await point(role, 'quiet_response', { haptic: 'light' });
      expect(await soundProblems()).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: `feedback.${role}`,
          message: expect.stringContaining('audio'),
        }),
      ]);
    });

    it.each([
      ['success', 'resp_firm'],
      ['perfect', 'resp_firm_perfect'],
    ])("reports a parry whose %s plays another response's cult sound", async (role, cueId) => {
      await point(role, cueId);
      expect(await soundProblems()).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: `feedback.${role}`,
          message: expect.stringMatching(/"resp_firm".*"resp_parry"/),
        }),
      ]);
    });

    it('accepts a perfect cue that shares the success clip: the type of response is what you hear', async () => {
      const live = JSON.parse(await readFile(join(root, FEEDBACK), 'utf8'));
      expect(live.cues.resp_parry_perfect.audio.clip).toBe(live.cues.resp_parry.audio.clip);
      expect(await soundProblems()).toEqual([]);
    });

    it('reports a perfect cue with no layers: only the laugh tells it from the success', async () => {
      await point('perfect', 'resp_parry');
      expect(await soundProblems()).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: 'feedback.perfect',
          message: expect.stringMatching(/"resp_parry".*no layers.*laugh/),
        }),
      ]);
    });

    it("reports a success cue that carries layers: the laugh is the perfect's", async () => {
      await point('success', 'resp_parry_perfect');
      expect(await soundProblems()).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: 'feedback.success',
          message: expect.stringMatching(/"resp_parry_perfect".*layers.*only a perfect/),
        }),
      ]);
    });

    it('reports a telegraph cue with no audio', async () => {
      await point('telegraph', 'quiet_telegraph', { haptic: 'light' });
      expect(await soundProblems()).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: 'feedback.telegraph',
          message: expect.stringContaining('audio'),
        }),
      ]);
    });

    it('reports a telegraph whose clip is not a tel_ clip', async () => {
      await point('telegraph', 'gag_outlet');
      expect(await soundProblems()).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: 'feedback.telegraph',
          message: expect.stringMatching(/"gag_outlet".*tel_/),
        }),
      ]);
    });

    it('reports a gag cue with no audio', async () => {
      await point('gag', 'quiet_gag', { haptic: 'light' });
      expect(await soundProblems()).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: 'feedback.gag',
          message: expect.stringContaining('audio'),
        }),
      ]);
    });

    it('reports a gag whose clip is not a gag_ clip', async () => {
      await point('gag', 'tel_outlet');
      expect(await soundProblems()).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: 'feedback.gag',
          message: expect.stringMatching(/"tel_outlet".*gag_/),
        }),
      ]);
    });

    it('reports a second threat that reuses a telegraph sound, naming the first, and accepts one of its own', async () => {
      const outlet = JSON.parse(await readFile(join(root, FILE), 'utf8'));
      outlet.id = 'plug';
      await put('content/threats/plug.json', `${JSON.stringify(outlet, null, 2)}\n`);
      expect(await soundProblems()).toEqual([
        expect.objectContaining({
          file: 'content/threats/plug.json',
          jsonPath: 'feedback.telegraph',
          message: expect.stringMatching(/"tel_outlet".*content\/threats\/outlet\.json/),
        }),
      ]);
      await giveOwnTelegraph(outlet, 'plug');
      await put('content/threats/plug.json', `${JSON.stringify(outlet, null, 2)}\n`);
      expect(await soundProblems()).toEqual([]);
    });

    it("reports a disruption's ring that sounds like a threat's telegraph", async () => {
      const PHONE = 'content/disruptions/phone.json';
      // A ring cue of its own (anchored on an object, as a disruption's must be) that plays the outlet's clip.
      await mutateJson(FEEDBACK, (feedback) => {
        const cues = feedback.cues as Record<string, { audio: { clip: string }; visual: object }>;
        const clash = structuredClone(cues.tel_phone_ring) as (typeof cues)[string];
        clash.audio.clip = 'tel_outlet';
        cues.ring_clash = clash;
      });
      await mutateJson(PHONE, (phone) => {
        (phone.feedback as Record<string, string>).ring = 'ring_clash';
      });
      expect(await soundProblems()).toEqual([
        expect.objectContaining({
          file: PHONE,
          jsonPath: 'feedback.ring',
          message: expect.stringMatching(/"tel_outlet".*content\/threats\/outlet\.json/),
        }),
      ]);
    });
  });

  it('reports an id that differs from the file name', async () => {
    await mutateJson(FILE, (threat) => {
      threat.id = 'plug';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: 'id' }),
    ]);
  });

  describe('a Firmness (story 1.23)', () => {
    const FIRM_FILE = 'content/threats/plug_firm.json';
    const putFirm = async (change: (threat: Record<string, unknown>) => void) => {
      const outlet = JSON.parse(await readFile(join(root, FILE), 'utf8'));
      outlet.id = 'plug_firm';
      outlet.response = 'firm';
      // The Firmness has its own cult sound, and its own telegraph (story 2.3).
      outlet.feedback.success = 'resp_firm';
      outlet.feedback.perfect = 'resp_firm_perfect';
      await giveOwnTelegraph(outlet, 'plug_firm');
      change(outlet);
      await put(FIRM_FILE, `${JSON.stringify(outlet, null, 2)}\n`);
    };
    const feelWindowMs = async () =>
      (
        JSON.parse(await readFile(join(root, 'content/feel.json'), 'utf8')).timing as {
          windowMs: number;
        }
      ).windowMs;

    it('accepts a hold that outlasts the feel window when the def takes the feel window', async () => {
      const windowMs = await feelWindowMs();
      await putFirm((threat) => {
        threat.windowMs = null;
        threat.holdUntilMs = windowMs + 1;
      });
      expect(await checkContent(root)).toEqual([]);
    });

    it('reports a hold that does not outlast the feel window, naming the file and the key', async () => {
      const windowMs = await feelWindowMs();
      await putFirm((threat) => {
        threat.windowMs = null;
        threat.holdUntilMs = windowMs;
      });
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({
          file: FIRM_FILE,
          jsonPath: 'holdUntilMs',
          message: expect.stringContaining('holdUntilMs'),
        }),
      ]);
    });

    it("reports a hold that does not outlast the def's own window", async () => {
      await putFirm((threat) => {
        threat.windowMs = 900;
        threat.holdUntilMs = 800;
      });
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({ file: FIRM_FILE, jsonPath: 'holdUntilMs' }),
      ]);
    });
  });

  it('reports a gag the sim does not know', async () => {
    await mutateJson(FILE, (threat) => {
      threat.gag = 'outlet_hairs';
    });
    const problems = await checkContent(root);
    expect(problems).toContainEqual(
      expect.objectContaining({
        file: FILE,
        jsonPath: 'gag',
        message: expect.stringContaining('outlet_hairs'),
      }),
    );
    // The live level plans the outlet: it reports the gag too, at the wave entry that plans it.
    expect(problems.filter((problem) => problem.file !== FILE)).toEqual([
      expect.objectContaining({
        file: 'content/levels/salon_crawler.json',
        jsonPath: 'waves[0].threats[0].def',
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

  describe('the verb, shape and colour of a threat (story 2.2)', () => {
    it.each(['verbKey', 'iconShape', 'color'])('reports a threat file with no %s', async (key) => {
      await mutateJson(FILE, (threat) => {
        delete threat[key];
      });
      expect(await checkContent(root)).toContainEqual(
        expect.objectContaining({ file: FILE, jsonPath: key }),
      );
    });

    it('reports a verbKey the strings file lacks, naming the key and the strings file', async () => {
      await mutateJson(FILE, (threat) => {
        threat.verbKey = 'verb.no_such_verb';
      });
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: 'verbKey',
          message: expect.stringContaining('"verb.no_such_verb" is not in content/strings.fr.json'),
        }),
      ]);
    });

    it('reports a verbKey outside the verb. group, as a schema problem', async () => {
      await mutateJson(FILE, (threat) => {
        threat.verbKey = 'age.adult';
      });
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({ file: FILE, jsonPath: 'verbKey' }),
      ]);
    });

    it('reports a mismatched shape and colour pair', async () => {
      await mutateJson(FILE, (threat) => {
        threat.color = 'dodge';
      });
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({ file: FILE, jsonPath: 'color' }),
      ]);
    });

    it('reports a triangle / dodge marker until the dodge response exists (story 5.1)', async () => {
      await mutateJson(FILE, (threat) => {
        threat.iconShape = 'triangle';
        threat.color = 'dodge';
      });
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: 'iconShape',
          message: expect.stringContaining('story 5.1'),
        }),
      ]);
    });
  });

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

describe('checkContent on the haptic and visual twins (story 2.4)', () => {
  const OUTLET = 'content/threats/outlet.json';
  const PHONE = 'content/disruptions/phone.json';
  const FEEDBACK = 'content/feedback.json';

  type Cue = Record<string, unknown>;
  /** Adds a copy of the live cue `from`, changed by `change`, and points one role of the outlet at it. */
  const pointOutlet = async (role: string, from: string, change: (cue: Cue) => void) => {
    await mutateJson(FEEDBACK, (feedback) => {
      const cues = feedback.cues as Record<string, Cue>;
      const copy = structuredClone(cues[from]) as Cue;
      change(copy);
      cues.twin_test = copy;
    });
    await mutateJson(OUTLET, (threat) => {
      (threat.feedback as Record<string, string>)[role] = 'twin_test';
    });
  };
  const changeCue = (cueId: string, change: (cue: Cue) => void) =>
    mutateJson(FEEDBACK, (feedback) =>
      change((feedback.cues as Record<string, Cue>)[cueId] as Cue),
    );

  it.each([
    ['medium', 'medium'],
    ['none', undefined],
  ])(
    'reports a telegraph that vibrates %s: it is a short `light` vibration',
    async (_name, haptic) => {
      await changeCue('tel_outlet', (cue) => {
        cue.haptic = haptic;
      });
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({
          file: OUTLET,
          jsonPath: 'feedback.telegraph',
          message: expect.stringMatching(/"tel_outlet".*`light`/),
        }),
      ]);
    },
  );

  it('reports a perfect that does not vibrate heavy', async () => {
    await pointOutlet('perfect', 'resp_parry_perfect', (cue) => {
      cue.haptic = 'medium';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: OUTLET,
        jsonPath: 'feedback.perfect',
        message: expect.stringMatching(/"twin_test".*"medium".*`heavy`/),
      }),
    ]);
  });

  it('reports a perfect that does not flash the screen', async () => {
    await pointOutlet('perfect', 'resp_parry_perfect', (cue) => {
      delete cue.flash;
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: OUTLET,
        jsonPath: 'feedback.perfect',
        message: expect.stringMatching(/"twin_test".*no `flash`/),
      }),
    ]);
  });

  it("reports a success that flashes: the flash is the perfect's mark", async () => {
    await pointOutlet('success', 'resp_parry', (cue) => {
      cue.flash = { peakOpacityPct: 35, durationMs: 180 };
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: OUTLET,
        jsonPath: 'feedback.success',
        message: expect.stringMatching(/"twin_test".*`flash`.*perfect/),
      }),
    ]);
  });

  it('reports a gag that does not vibrate heavy', async () => {
    await pointOutlet('gag', 'gag_outlet', (cue) => {
      cue.haptic = 'light';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: OUTLET,
        jsonPath: 'feedback.gag',
        message: expect.stringMatching(/"twin_test".*"light".*`heavy`/),
      }),
    ]);
  });

  it.each([
    ['telegraph', 'tel_outlet'],
    ['gag', 'gag_outlet'],
  ])(
    "reports a %s that flashes: the flash is the perfect's mark, the others keep their ring",
    async (role, from) => {
      await pointOutlet(role, from, (cue) => {
        cue.flash = { peakOpacityPct: 35, durationMs: 180 };
      });
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({
          file: OUTLET,
          jsonPath: `feedback.${role}`,
          message: expect.stringMatching(/"twin_test".*`flash`.*perfect/),
        }),
      ]);
    },
  );

  it('accepts a flash on the cue of a client event (it needs no world)', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      const cues = feedback.cues as Record<string, Cue>;
      cues.client_flash = { haptic: 'light', flash: { peakOpacityPct: 35, durationMs: 180 } };
      (feedback.events as Record<string, string>).CountdownTicked = 'client_flash';
    });
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports a flash longer than the 3 Hz interval: it would restart on itself', async () => {
    await pointOutlet('perfect', 'resp_parry_perfect', (cue) => {
      cue.flash = { peakOpacityPct: 35, durationMs: 335 };
    });
    expect(await checkContent(root)).not.toEqual([]);
  });

  it('accepts the live cues: light telegraphs, heavy and flashing perfects, silent successes', async () => {
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports a disruption ring that does not vibrate light', async () => {
    await changeCue('tel_phone_ring', (cue) => {
      cue.haptic = 'heavy';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: PHONE,
        jsonPath: 'feedback.ring',
        message: expect.stringMatching(/"tel_phone_ring".*"heavy".*`light`/),
      }),
    ]);
  });

  it('reports ring waves that outlast the 1000 ms between two rings', async () => {
    await changeCue('tel_phone_ring', (cue) => {
      cue.visual = {
        kind: 'soundWave',
        anchor: 'object',
        maxRadiusM: 0.8,
        durationMs: 400,
        pulses: 3,
        pulseIntervalMs: 400,
      };
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: PHONE,
        jsonPath: 'feedback.ring',
        message: expect.stringMatching(/"tel_phone_ring".*1200 ms.*1000 ms/),
      }),
    ]);
  });

  it('accepts ring waves that end exactly when the next ring starts', async () => {
    await changeCue('tel_phone_ring', (cue) => {
      cue.visual = {
        kind: 'soundWave',
        anchor: 'object',
        maxRadiusM: 0.8,
        durationMs: 400,
        pulses: 2,
        pulseIntervalMs: 600,
      };
    });
    expect(await checkContent(root)).toEqual([]);
  });
});

describe('checkContent on level files', () => {
  const FILE = 'content/levels/salon_crawler.json';
  const entry = { def: 'outlet', anchor: 'outlet_01' };
  const wave = (threats: Record<string, unknown>[], fromMs = 0) => ({
    fromMs,
    maxSimultaneous: 1,
    gapMinMs: 1000,
    gapMaxMs: 2000,
    lullMs: 500,
    threats,
  });
  /** One wave per argument, the nth from n minutes (inside the level's 3). */
  const plan = (...waves: Record<string, unknown>[][]) =>
    mutateJson(FILE, (level) => {
      level.waves = waves.map((threats, index) => wave(threats, index * 60000));
    });

  it('accepts a level that plans the outlet at an anchor of its geometry', async () => {
    await plan([entry], [{ def: 'stairs', anchor: 'stairs_top' }]);
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

  it('names the planned threat that does not exist, with its wave and index', async () => {
    await plan([entry], [{ ...entry, def: 'outlett', anchor: 'stairs_top' }]);
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'waves[1].threats[0].def',
        message: expect.stringContaining('outlett'),
      }),
    ]);
  });

  it('names the anchor the geometry lacks', async () => {
    await plan([{ ...entry, anchor: 'outlet_02' }]);
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'waves[0].threats[0].anchor',
        message: expect.stringContaining('outlet_02'),
      }),
    ]);
  });

  it('names the level, the path and the gag when a planned def has a gag the sim does not know', async () => {
    await mutateJson('content/threats/outlet.json', (threat) => {
      threat.gag = 'tickle';
    });
    const problems = await checkContent(root);
    expect(problems).toContainEqual(
      expect.objectContaining({
        file: FILE,
        jsonPath: 'waves[0].threats[0].def',
        message: expect.stringMatching(/outlet.*tickle/),
      }),
    );
  });

  it('names feelOverrides that do not merge into a valid feel, with the path inside it', async () => {
    await mutateJson(FILE, (level) => {
      level.feelOverrides = { timing: { windowMs: -5 } };
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({ file: FILE, jsonPath: 'feelOverrides.timing.windowMs' }),
    );
  });

  it('names a feelOverrides key the feel does not have', async () => {
    await mutateJson(FILE, (level) => {
      level.feelOverrides = { bogus: 1 };
    });
    const problems = await checkContent(root);
    expect(problems).toEqual([expect.objectContaining({ file: FILE })]);
    expect(problems[0]?.jsonPath).toContain('feelOverrides');
  });

  it('accepts feelOverrides that merge into a valid feel', async () => {
    await mutateJson(FILE, (level) => {
      level.feelOverrides = { timing: { windowMs: 250 } };
    });
    expect(await checkContent(root)).toEqual([]);
  });

  it('names the level, the object and the anchor when an object stands at an anchor the geometry lacks', async () => {
    await mutateJson(FILE, (level) => {
      level.objects = [{ id: 'kettle', kind: 'coffee_machine', anchor: 'kettle_spot' }];
      for (const wave of level.waves as Record<string, unknown>[]) wave.disruptions = [];
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'objects[0].anchor',
        message: expect.stringMatching(/salon_crawler.*kettle.*kettle_spot/),
      }),
    ]);
  });

  it('names the object listed twice', async () => {
    await mutateJson(FILE, (level) => {
      level.objects = [
        { id: 'phone', kind: 'phone', anchor: 'phone' },
        { id: 'phone', kind: 'phone', anchor: 'coffee_machine' },
      ];
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'objects[1].id',
        message: expect.stringContaining('phone'),
      }),
    ]);
  });

  it('names the level file, the path and the culprit of a micro-sleep def that has no threat file', async () => {
    await mutateJson(FILE, (level) => {
      level.gauges = { fatigue: { microSleepDef: 'papa_snooze' } };
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'gauges.fatigue.microSleepDef',
        message: expect.stringContaining('papa_snooze'),
      }),
    ]);
  });

  it('names the micro-sleep def whose target is not "papa"', async () => {
    await mutateJson(FILE, (level) => {
      level.gauges = { fatigue: { microSleepDef: 'outlet' } };
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: FILE,
        jsonPath: 'gauges.fatigue.microSleepDef',
        message: expect.stringMatching(/"outlet".*target "anchor".*must have target "papa"/),
      }),
    ]);
  });

  it('names the wave threat whose def has target "papa"', async () => {
    await plan([entry], [{ def: 'papa_microsleep', anchor: 'stairs_top' }]);
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: FILE,
        jsonPath: 'waves[1].threats[0].def',
        message: expect.stringContaining('papa_microsleep'),
      }),
    );
  });

  it('names the wave threat whose def has the gag "papa_asleep"', async () => {
    await mutateJson('content/threats/outlet.json', (threat) => {
      threat.gag = 'papa_asleep';
    });
    await plan([entry]);
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: FILE,
        jsonPath: 'waves[0].threats[0].def',
        message: expect.stringMatching(/"outlet".*gag "papa_asleep".*only the micro-sleep/),
      }),
    );
  });

  it('names the micro-sleep def whose gag is not "papa_asleep"', async () => {
    await mutateJson('content/threats/papa_microsleep.json', (threat) => {
      threat.gag = 'outlet_hair';
    });
    await mutateJson(FILE, (level) => {
      level.gauges = { fatigue: { microSleepDef: 'papa_microsleep' } };
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: FILE,
        jsonPath: 'gauges.fatigue.microSleepDef',
        message: expect.stringMatching(/"papa_microsleep".*gag "outlet_hair".*gag "papa_asleep"/),
      }),
    );
  });

  describe('a hidden-zone threat (the suspicious silence, story 1.21)', () => {
    const SILENCE_FILE = 'content/threats/silence_mischief.json';
    const silence = { def: 'silence_mischief', anchor: 'behind_sofa' };

    it('accepts it planned in a hidden zone of the geometry', async () => {
      await plan([silence]);
      expect(await checkContent(root)).toEqual([]);
    });

    it('names the wave threat planned at an anchor instead of a hidden zone', async () => {
      await plan([{ ...silence, anchor: 'outlet_01' }]);
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: 'waves[0].threats[0].anchor',
          message: expect.stringMatching(
            /the threat "silence_mischief" has target "hiddenZone", so "outlet_01" must be a hidden zone, which content\/.* does not have/,
          ),
        }),
      ]);
    });

    it('names the wave threat planned at a hidden zone when its def has target "anchor"', async () => {
      await plan([{ ...entry, anchor: 'behind_sofa' }]);
      expect(await checkContent(root)).toEqual([
        expect.objectContaining({
          file: FILE,
          jsonPath: 'waves[0].threats[0].anchor',
          message: expect.stringMatching(/"behind_sofa" is not an anchor of content\/.*/),
        }),
      ]);
    });

    it('names a surprise gag the sim does not know, in the def and at the wave entry that plans it', async () => {
      await mutateJson(SILENCE_FILE, (threat) => {
        threat.surpriseGags = ['tissues_everywhere', 'glitter_bomb'];
      });
      await plan([silence]);
      const problems = await checkContent(root);
      expect(problems).toContainEqual(
        expect.objectContaining({
          file: SILENCE_FILE,
          jsonPath: 'surpriseGags[1]',
          message: expect.stringContaining('glitter_bomb'),
        }),
      );
      expect(problems).toContainEqual(
        expect.objectContaining({
          file: FILE,
          jsonPath: 'waves[0].threats[0].def',
          message: expect.stringMatching(/"silence_mischief".*glitter_bomb/),
        }),
      );
    });

    it('names the micro-sleep gag among the surprise gags', async () => {
      await mutateJson(SILENCE_FILE, (threat) => {
        threat.surpriseGags = ['papa_asleep'];
      });
      await plan([silence]);
      const problems = await checkContent(root);
      expect(problems).toContainEqual(
        expect.objectContaining({
          file: SILENCE_FILE,
          jsonPath: 'surpriseGags[0]',
          message: expect.stringMatching(/"papa_asleep".*micro-sleep/),
        }),
      );
      expect(problems).toContainEqual(
        expect.objectContaining({
          file: FILE,
          jsonPath: 'waves[0].threats[0].def',
          message: expect.stringMatching(
            /"silence_mischief".*gag "papa_asleep".*only the micro-sleep/,
          ),
        }),
      );
    });
  });

  it('names a coffee machine in a level with no fatigue gauge', async () => {
    await mutateJson(FILE, (level) => {
      level.gauges = {};
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: FILE,
        jsonPath: 'objects[0].kind',
        message: expect.stringMatching(/"coffee_machine".*coffee_machine.*no gauges\.fatigue/),
      }),
    );
  });

  it('names an object of an unknown kind (the schema refuses it; the drift with the sim is pinned in levelSchema.test.ts)', async () => {
    await mutateJson(FILE, (level) => {
      level.objects = [{ id: 'kettle', kind: 'kettle', anchor: 'phone' }];
    });
    const problems = await checkContent(root);
    expect(problems).toContainEqual(
      expect.objectContaining({ file: FILE, jsonPath: 'objects[0].kind' }),
    );
  });

  it('accepts a level with no objects key at all (it defaults to none), once no disruption rings at one', async () => {
    await mutateJson(FILE, (level) => {
      delete level.objects;
      for (const wave of level.waves as Record<string, unknown>[]) wave.disruptions = [];
    });
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports a level that has no geometry file', async () => {
    await put(
      'content/levels/test_room.json',
      '{ "id": "test_room", "variant": "nap", "durationMs": 1000, "waves": [] }\n',
    );
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: 'content/levels/test_room.json',
        jsonPath: '',
        message: expect.stringContaining('test_room.geometry.json'),
      }),
    ]);
  });

  it('reports a level file that breaks its schema, with the JSON path', async () => {
    await mutateJson(FILE, (level) => {
      level.waves = [wave([entry], -1)];
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: FILE, jsonPath: 'waves[0].fromMs' }),
    ]);
  });

  it('does not report a level twice for a threat file that is broken (it is reported on its own)', async () => {
    await plan([entry]);
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

describe('checkContent on disruptions (story 1.20)', () => {
  const LEVEL = 'content/levels/salon_crawler.json';
  const PHONE = 'content/disruptions/phone.json';
  const FEEDBACK = 'content/feedback.json';

  it('accepts the live phone: a def, an object of its kind and cues that exist', async () => {
    expect(await checkContent(root)).toEqual([]);
  });

  it('names the level, the path and the file of a wave disruption whose def has no file', async () => {
    await rm(join(root, PHONE));
    const problems = await checkContent(root);
    expect(problems).toContainEqual(
      expect.objectContaining({
        file: LEVEL,
        jsonPath: 'waves[2].disruptions[0].def',
        message: expect.stringMatching(/no disruption "phone".*disruptions\/phone\.json/),
      }),
    );
  });

  it('names the object, the def and both kinds when the def kind is not the object kind', async () => {
    await mutateJson(LEVEL, (level) => {
      level.objects = [
        { id: 'coffee_machine', kind: 'coffee_machine', anchor: 'coffee_machine' },
        { id: 'phone', kind: 'coffee_machine', anchor: 'phone' },
      ];
    });
    expect(await checkContent(root)).toContainEqual(
      expect.objectContaining({
        file: LEVEL,
        jsonPath: 'waves[2].disruptions[0].object',
        message: expect.stringMatching(/"phone".*kind "phone".*"phone".*kind "coffee_machine"/),
      }),
    );
  });

  it('names the file, the path and the cue of a disruption feedback cue that is not in feedback.json', async () => {
    await mutateJson(PHONE, (phone) => {
      (phone.feedback as Record<string, string>).ring = 'tel_no_such_ring';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: PHONE,
        jsonPath: 'feedback.ring',
        message: expect.stringContaining('tel_no_such_ring'),
      }),
    ]);
  });

  it('refuses a disruption cue anchored on a threat: its events name an object', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      const cues = feedback.cues as Record<string, { visual: { anchor: string } }>;
      (cues.tel_phone_ring as { visual: { anchor: string } }).visual.anchor = 'threat';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: PHONE,
        jsonPath: 'feedback.ring',
        message: expect.stringContaining('anchored on a threat'),
      }),
    ]);
  });

  it('accepts an object-anchored cue the phone points at (the live ring is one)', async () => {
    const feedback = JSON.parse(await readFile(join(root, FEEDBACK), 'utf8')) as {
      cues: Record<string, { visual?: { anchor: string } }>;
    };
    expect(feedback.cues.tel_phone_ring?.visual?.anchor).toBe('object');
    expect(await checkContent(root)).toEqual([]);
  });

  it('refuses an object-anchored cue that a generic event plays: it names no object', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      (feedback.events as Record<string, string>).PapaBlocked = 'tel_phone_ring';
    });
    const problems = await checkContent(root);
    expect(problems).toEqual([
      expect.objectContaining({
        file: FEEDBACK,
        jsonPath: 'cues.tel_phone_ring.visual.anchor',
        message: expect.stringContaining('PapaBlocked'),
      }),
    ]);
  });

  it('refuses an object-anchored cue that a threat def names: a threat event names no object', async () => {
    await mutateJson('content/threats/outlet.json', (threat) => {
      (threat.feedback as Record<string, string>).telegraph = 'tel_phone_ring';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: 'content/threats/outlet.json',
        jsonPath: 'feedback.telegraph',
        message: expect.stringContaining('anchored on an object'),
      }),
    ]);
  });

  it('refuses a uiElement cue that a threat or a disruption def names: their cues play for sim events (story 1.22)', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      (feedback.cues as Record<string, unknown>).ui_twin = { visual: { kind: 'uiElement' } };
    });
    await mutateJson('content/threats/outlet.json', (threat) => {
      (threat.feedback as Record<string, string>).telegraph = 'ui_twin';
    });
    await mutateJson(PHONE, (phone) => {
      (phone.feedback as Record<string, string>).ring = 'ui_twin';
    });
    expect(await checkContent(root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'content/threats/outlet.json',
          jsonPath: 'feedback.telegraph',
          message: expect.stringContaining('uiElement'),
        }),
        expect.objectContaining({
          file: PHONE,
          jsonPath: 'feedback.ring',
          message: expect.stringContaining('uiElement'),
        }),
      ]),
    );
  });

  it('reports a disruption file whose id is not its file name, or that breaks its schema', async () => {
    await mutateJson(PHONE, (phone) => {
      phone.id = 'ring';
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: PHONE, jsonPath: 'id' }),
    ]);
    await mutateJson(PHONE, (phone) => {
      phone.id = 'phone';
      phone.ringMaxMs = 0;
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: PHONE, jsonPath: 'ringMaxMs' }),
    ]);
  });

  it('reports a stale disruption schema', async () => {
    await writeFile(join(root, 'content/_schemas/disruption.schema.json'), '{}\n');
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({ file: 'content/_schemas/disruption.schema.json' }),
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

describe('checkContent on the fx presets (story 2.5)', () => {
  const OUTLET = 'content/threats/outlet.json';
  const FEEDBACK = 'content/feedback.json';

  type Cue = Record<string, unknown>;
  const pointOutlet = async (role: string, from: string, change: (cue: Cue) => void) => {
    await mutateJson(FEEDBACK, (feedback) => {
      const cues = feedback.cues as Record<string, Cue>;
      const copy = structuredClone(cues[from]) as Cue;
      change(copy);
      cues.fx_test = copy;
    });
    await mutateJson(OUTLET, (threat) => {
      (threat.feedback as Record<string, string>)[role] = 'fx_test';
    });
  };

  it.each([
    ['success', 'resp_parry', 'perfect'],
    ['perfect', 'resp_parry_perfect', 'gag'],
    ['gag', 'gag_outlet', 'success'],
  ])('reports a %s cue that plays another preset', async (role, from, wrong) => {
    await pointOutlet(role, from, (cue) => {
      cue.fx = wrong;
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: OUTLET,
        jsonPath: `feedback.${role}`,
        message: expect.stringMatching(new RegExp(`"fx_test".*"${wrong}".*\`${role}\``)),
      }),
    ]);
  });

  it.each([
    ['success', 'resp_parry'],
    ['perfect', 'resp_parry_perfect'],
    ['gag', 'gag_outlet'],
  ])('reports a %s cue with no fx', async (role, from) => {
    await pointOutlet(role, from, (cue) => {
      delete cue.fx;
    });
    expect(await checkContent(root)).toEqual([
      expect.objectContaining({
        file: OUTLET,
        jsonPath: `feedback.${role}`,
        message: expect.stringMatching(/"fx_test".*"none"/),
      }),
    ]);
  });

  it('accepts the live threat cues, each on its preset', async () => {
    expect(await checkContent(root)).toEqual([]);
  });

  it('reports a cue with an fx and no soundWave, at the path of the fx', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      const cues = feedback.cues as Record<string, Cue>;
      delete (cues.resp_parry as Cue).visual;
      // The twin rules want a visual twin of the sound elsewhere; the flash is not it for a success.
    });
    const problems = await checkContent(root);
    expect(problems).toContainEqual(
      expect.objectContaining({
        file: FEEDBACK,
        jsonPath: 'cues.resp_parry.fx',
        message: expect.stringContaining('soundWave'),
      }),
    );
  });

  it('reports a client event whose cue has an fx: it has no world to shake or burst in', async () => {
    await mutateJson(FEEDBACK, (feedback) => {
      const cues = feedback.cues as Record<string, Cue>;
      cues.client_fx = { haptic: 'light', fx: 'success' };
      (feedback.events as Record<string, string>)[FEEDBACK_CLIENT_EVENTS[0] as string] =
        'client_fx';
    });
    const problems = await checkContent(root);
    expect(problems).toContainEqual(
      expect.objectContaining({
        file: FEEDBACK,
        jsonPath: `events.${FEEDBACK_CLIENT_EVENTS[0]}`,
        message: expect.stringContaining('`fx`'),
      }),
    );
  });
});
