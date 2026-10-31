import { readFileSync } from 'node:fs';
import { formatJsonPath } from '@content/jsonPath';
import { parseContentFile } from '@content/parseContentFile';
import {
  FORBIDDEN_FAILURE_WORDS,
  STRING_KEY_PATTERN,
  StringsSchema,
} from '@content/schemas/strings';
import { describe, expect, it } from 'vitest';

// Keys are pinned (code depends on them), texts are not (Geo may reword them).
const REQUIRED_KEYS = [
  'start.tap_to_start',
  'fridge.title',
  'fridge.new_unlock',
  'calibration.audio_prompt',
  'calibration.visual_prompt',
  'calibration.too_few_taps',
  'calibration.skip_audio',
  'calibration.done',
  'loading.line_bottle',
  'loading.line_toys',
  'loading.line_keys',
  'age.first_level',
  'age.crawler',
  'age.early_childhood',
  'age.childhood',
  'age.adolescence',
  'age.adult',
  'verb.lift',
  'verb.firm',
  'verb.swap',
  'verb.put_down_first',
  'verb.rock',
  'verb.dodge',
  'stamp.perfect_parry',
  'stamp.replay',
  'silence.bubble',
  'gauge.fatigue',
  'gauge.noise',
  'gauge.urge',
  'key.space',
  'pause.title',
  'pause.resume',
  'pause.restart',
  'pause.settings',
  'pause.quit_to_fridge',
  'pause.gamepad_disconnected',
  'countdown.step_3',
  'countdown.step_2',
  'countdown.step_1',
  'result.mama_woke',
  'result.next_age_unlocked',
  'result.score_laughs',
  'result.score_baby_state',
  'result.score_no_sigh',
  'result.score_no_scream',
  'result.star_lost',
  'result.replay_button',
  'result.next_age',
  'result.fridge',
  'result.unlock_hint',
  'result.assist_card',
  'result.copy_log',
  'result.log_copied',
  'result.download_log',
  'settings.title',
  'settings.back',
  'settings.difficulty',
  'settings.tier_assistance',
  'settings.tier_assistance_hint',
  'settings.tier_normal',
  'settings.tier_normal_hint',
  'settings.tier_experienced',
  'settings.tier_experienced_hint',
  'settings.applies_next_game',
  'settings.volume_music',
  'settings.volume_sfx',
  'settings.volume_voice',
  'settings.volume_ui',
  'settings.haptics',
  'settings.reduced_motion',
  'settings.reduced_motion_device',
  'settings.large_verbs',
  'settings.recalibrate',
  'settings.credits',
  'credits.title',
  'credits.body',
  'oops.message',
  'oops.retry',
  'portrait.rotate',
];

const FILE = 'content/strings.fr.json';
const realText = readFileSync(new URL('../../content/strings.fr.json', import.meta.url), 'utf8');
const real = JSON.parse(realText) as Record<string, string>;

function parse(value: unknown) {
  return parseContentFile(FILE, JSON.stringify(value), StringsSchema);
}

function failures(value: unknown) {
  const result = parse(value);
  return result.ok ? [] : result.error;
}

describe('content/strings.fr.json', () => {
  it('parses against StringsSchema', () => {
    expect(parse(real).ok).toBe(true);
  });

  it('contains every seeded key', () => {
    expect(REQUIRED_KEYS.filter((key) => !(key in real))).toEqual([]);
  });

  it('names failure nowhere and says « tu » everywhere (every value)', () => {
    for (const [key, value] of Object.entries(real)) {
      expect(FORBIDDEN_FAILURE_WORDS.test(value), key).toBe(false);
      expect(/(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu.test(value), key).toBe(false);
    }
  });

  it('has no duplicate key in the raw text', () => {
    const keys = [...realText.matchAll(/^ {2}"([^"]+)":/gm)].map((match) => match[1]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('forbidden failure words', () => {
  it.each([
    'ÉCHEC',
    'perdu',
    'Game Over',
    'Le niveau sera perdu.',
    'mort',
    'Échecs',
    'Tu as perdu',
    'Tu perds',
    'On perd',
    'Tu as échoué',
    'Raté !',
    'Game-Over',
    'GAMEOVER',
    'Défaite',
  ])('matches %s', (text) => {
    expect(FORBIDDEN_FAILURE_WORDS.test(text)).toBe(true);
  });

  it.each(['Recommencer', 'dormir', 'permet', 'Amortir', 'Réessayer', 'mortier'])(
    'lets %s through',
    (text) => {
      expect(FORBIDDEN_FAILURE_WORDS.test(text)).toBe(false);
    },
  );
});

describe('StringsSchema', () => {
  it.each(['Bad Key', 'single', 'UPPER.case', 'a.', '.a', 'a..b', '1a.b'])(
    'rejects the key %s',
    (key) => {
      expect(STRING_KEY_PATTERN.test(key)).toBe(false);
      expect(failures({ [key]: 'x' }).map((problem) => problem.jsonPath)).toContain(
        formatJsonPath([key]),
      );
    },
  );

  it('tells the author which rule a bad key breaks', () => {
    expect(failures({ 'Bad Key': 'x' })[0]?.message).toMatch(/group\.lower_snake_case/);
  });

  it('accepts well-formed keys', () => {
    for (const key of ['a.b', 'start.tap_to_start', 'countdown.step_3', 'a.b.c']) {
      expect(STRING_KEY_PATTERN.test(key), key).toBe(true);
    }
  });

  it('rejects an empty value and a blank one', () => {
    expect(failures({ 'a.b': '' })).toEqual([expect.objectContaining({ jsonPath: '["a.b"]' })]);
    expect(failures({ 'a.b': '   ' })).toEqual([expect.objectContaining({ jsonPath: '["a.b"]' })]);
  });

  it('rejects a value that names failure', () => {
    const [problem] = failures({ 'quit.armed': 'Sûr ? Le niveau sera perdu.' });
    expect(problem?.jsonPath).toBe('["quit.armed"]');
    expect(problem?.message).toMatch(/failure/);
  });

  it('rejects the vouvoiement', () => {
    expect(failures({ 'a.b': 'Touchez votre écran' })).toHaveLength(1);
  });

  it('accepts the verb of patience, « ATTENDS… », and nothing looser (story 4.6)', () => {
    expect(parse({ 'verb.wait': 'ATTENDS…' }).ok).toBe(true);
    expect(failures({ 'verb.wait': 'Attends…' })).toHaveLength(1);
    expect(failures({ 'verb.wait': 'ATTENDS...' })).toHaveLength(1);
    expect(failures({ 'verb.wait': 'ATTENDS' })).toHaveLength(1);
  });

  it('requires verbs to be uppercase and to end with " !"', () => {
    expect(parse({ 'verb.lift': 'SOULÈVE !', 'verb.put_down_first': "POSE-LE D'ABORD !" }).ok).toBe(
      true,
    );
    expect(failures({ 'verb.lift': 'Soulève !' })).toHaveLength(1);
    expect(failures({ 'verb.lift': 'SOULÈVE!' })).toHaveLength(1);
    expect(failures({ 'verb.lift': 'SOULÈVE' })).toHaveLength(1);
  });

  it('reports a duplicate key by name', () => {
    const result = parseContentFile(FILE, '{"a.b": "x", "a.b": "y"}', StringsSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.message).toMatch(/duplicate key "a\.b"/);
  });
});
