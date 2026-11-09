import type { BabySlice, BabyState, PapaSlice, PapaState, SimEvent } from '@sim';
import { GAG_PRESENTATIONS } from '../gags.ts';

// Which clip each state and event plays (story 7.2, D5). Pure, no Three. It takes Papa, the baby and
// event arguments and never a threat, so no clip can read a hidden answer (D9): a test scans this file.

/** `Record<PapaState, …>`: a new state with no clip is a type error. `onToilet` is `idle`: `setAway` hides him. */
const PAPA_LOOPS: Readonly<Record<PapaState, string>> = {
  idle: 'idle',
  walkPath: 'walk',
  walkDir: 'walk',
  glide: 'glide',
  drink: 'drink',
  asleep: 'asleep',
  onPhone: 'on_phone',
  onToilet: 'idle',
  // The shock of the outlet (the hair stays on end, `gags.ts`), the baby carried up the stairs, a debris picked up.
  electrified: 'gag_shock',
  carryingUp: 'carry_idle',
  // A debris picked up (story 7.12, D3): one cycle over the sim's busy span, at the pace the view fits.
  pickingUp: 'pick_up',
  // A house chore (story 9.4): its station's own loop (`feedback.json › characters.choreClips`, story 7.12,
  // D2) is given to `papaClipOf`; a station with none stands `idle`.
  chore: 'idle',
};

/** `wander` and `approach` crawl; a laid baby has no loop of his own: `carried`, lowered by `layDownPct`. */
const BABY_LOOPS: Readonly<Record<BabyState, string>> = {
  wander: 'crawl',
  babble: 'babble',
  targetLocked: 'locked',
  approach: 'crawl',
  act: 'act',
  mischiefSilent: 'sneak',
  carried: 'carried',
  // Left at the bottom of the stairs, and carried back up (story 3.15): he babbles, delighted, then is carried.
  downstairs: 'babble',
  carriedUp: 'carried',
};

/**
 * Papa's states that travel (story 7.8, D4): a passage into one is a start, out of one a stop. By state,
 * not by `clipSpeeds`, so that `glide` (which has no speed row on purpose) is one. A new state is a type error.
 */
export const PAPA_TRAVELLING: Readonly<Record<PapaState, boolean>> = {
  idle: false,
  walkPath: true,
  walkDir: true,
  glide: true,
  drink: false,
  asleep: false,
  onPhone: false,
  onToilet: false,
  electrified: false,
  carryingUp: false,
  pickingUp: false,
  chore: false,
};

/** The baby's states that travel (story 7.8, D4): he crawls in each. */
export const BABY_TRAVELLING: Readonly<Record<BabyState, boolean>> = {
  wander: true,
  babble: false,
  targetLocked: false,
  approach: true,
  act: false,
  mischiefSilent: true,
  carried: false,
  downstairs: false,
  carriedUp: false,
};

/**
 * Whether the baby's clip travels now (D4). His cry is a timer apart from his state and overlays any of
 * them with a still clip: a crawler who starts to cry is stopping, not crawling.
 */
export function isBabyTravelling(baby: Readonly<BabySlice>): boolean {
  return baby.cryEndsAt === null && BABY_TRAVELLING[baby.state];
}

/**
 * The loop Papa's state says now; the baby's state alone says whether he carries (there is no `papa.carrying`).
 * In a stealth step (`isStealth`, story 7.11, D5) he walks on tiptoe: a boolean, never a threat. At a chore's
 * station he plays `choreClip`, the station's loop (story 7.12, D2), or `idle` when it has none.
 */
export function papaClipOf(
  papa: Readonly<PapaSlice>,
  baby: Readonly<BabySlice>,
  isStealth: boolean,
  choreClip: string | null,
): string {
  const clip = papa.state === 'chore' ? (choreClip ?? 'idle') : PAPA_LOOPS[papa.state];
  if (baby.state !== 'carried') return isStealth && clip === 'walk' ? 'tiptoe' : clip;
  if (clip === 'idle') return 'carry_idle';
  if (clip === 'walk') return 'carry_walk';
  return clip;
}

/** Papa's idles (story 7.11, D1), in the order the schedule's variant index reads them. */
export const PAPA_IDLE_CLIPS = ['idle_scratch', 'idle_neck', 'idle_stretch'] as const;

/**
 * Papa's « acting » one-shots (story 7.11, D1): they decorate a state and carry none, so anything cuts
 * them (D11). The event one-shots (gags, responses, the coffee kick, the finale) are not here.
 */
export const PAPA_ACTING_CLIPS: readonly string[] = [
  ...PAPA_IDLE_CLIPS,
  'walk_start',
  'walk_stop',
  // The sigh after a success late in its window (story 7.12, D5): a reaction a tap cuts.
  'sigh_relief',
];

/**
 * Papa's two Parries (story 7.12, D4), in the order `parryVariantOf` reads them: a judged Parry success
 * plays one, alternating on `world.score.successes`. Both keep the Parry silhouette (a hand forward).
 */
export const PAPA_PARRY_CLIPS = ['respond_parry', 'respond_parry_sweep'] as const;

/** The baby's idles while seated (story 7.12, D8), in the order the schedule's variant index reads them. */
export const BABY_IDLE_CLIPS = ['clap'] as const;

/**
 * The baby's « acting » one-shots (story 7.12, D7, D8): the sit-down after his pause and his idles. They
 * decorate a state and carry none, so his own changes cut them (D9).
 */
export const BABY_ACTING_CLIPS: readonly string[] = ['sit_down', ...BABY_IDLE_CLIPS];

/** The baby's two laughs (story 7.12, D10), alternated by the scene: never the same twice in a row. */
export const BABY_LAUGH_CLIPS = ['laugh', 'laugh_belly'] as const;

/**
 * The events by which the view sees, in the frame of the step that applies it, that a command of the
 * player was accepted (story 7.11, D12): each cuts an acting one-shot at once. `PapaStateChanged` is one
 * too (read here and from the loop change). Each command a player can send to an idle Papa emits one of
 * these in its applying step (`tests/bots/papaActingLive.test.ts`).
 */
export const PAPA_ACTING_CUT_EVENTS: readonly SimEvent['type'][] = [
  'PapaStateChanged',
  'PapaPathPlanned',
  'PapaGlideStarted',
  'ObjectTapped',
  'PapaBlocked',
  'TapRefused',
  'ResponseHeld',
  'ResponseResolved',
  'BabyPickedUp',
  'BabyPutDown',
  'BreathHeld',
  'ChoreRefused',
  'ToiletRefused',
  'BeatHit',
  'BeatStrayTapped',
  'DecoyTapped',
];

/**
 * The loop the baby's state says now. His cry is a timer apart from his state, and it overlays any of them.
 * Stopped (`babble`) and still on all fours (`isPaused`, story 7.12, D7), he pauses before he sits.
 */
export function babyClipOf(baby: Readonly<BabySlice>, isPaused: boolean): string {
  if (baby.cryEndsAt !== null) return 'cry';
  return isPaused && baby.state === 'babble' ? 'crawl_pause' : BABY_LOOPS[baby.state];
}

/** Papa's one-shot for a sim event, or null. A response is not here: its clip waits for his arrival (P3). */
export function papaOneShotOf(event: Readonly<SimEvent>): string | null {
  switch (event.type) {
    case 'GagTriggered':
      return GAG_PRESENTATIONS[event.gag].papaClip;
    case 'PapaBlocked':
      return 'stumble';
    case 'PapaSnored':
      return 'snore';
    case 'CoffeeDrunk':
      return 'coffee_kick';
    // The level's finale (story 7.4, D14): his victory dance belongs to the celebration.
    case 'FinaleReached':
      return 'victory_dance';
    // Mama came home early (story 3.16), the lost level only: he collapses, a gag with no injury (NFR9).
    case 'LevelEnded':
      return event.reason === 'mamaHome' ? 'collapse' : null;
    default:
      return null;
  }
}

/** Papa's one-shots that stay on their last frame (story 7.4): he stays down once he has collapsed. */
export const PAPA_HELD_ONE_SHOTS: readonly string[] = ['collapse'];

/**
 * Papa's one-shots that wait for his glide and his response pose to end instead of being dropped (story
 * 7.4): the finale comes in the very step of the last response, while he glides to it.
 */
export const PAPA_DEFERRED_ONE_SHOTS: readonly string[] = ['victory_dance'];

/** The baby's one-shot for a sim event, or null. */
export function babyOneShotOf(event: Readonly<SimEvent>): string | null {
  switch (event.type) {
    case 'GagTriggered':
      return GAG_PRESENTATIONS[event.gag].babyClip;
    case 'BabyPickedUp':
      return 'laugh';
    case 'BabyPutDown':
      return 'stir';
    case 'WaitFeintGiven':
      return 'eyes_peek';
    case 'WaitSignalGiven':
      return 'eyes_open';
    case 'BabyWoke':
      return 'wake';
    case 'BabyStirred':
      return 'stir';
    default:
      return null;
  }
}

/** Papa's pose for a response: perfect beats success. A Do Nothing has none: nothing is its point.
 * A Parry success plays `PAPA_PARRY_CLIPS[parryVariant]` (story 7.12, D4: the scene draws the variant, 0 in a duel or
 * stealth step); a variant out of the list is the first Parry.
 */
export function responseClipOf(
  response: string,
  quality: string,
  parryVariant: number,
): string | null {
  if (response === 'nothing') return null;
  if (quality === 'perfect') return 'respond_perfect';
  if (response === 'firm') return 'respond_firm';
  if (response === 'parry') return PAPA_PARRY_CLIPS[parryVariant] ?? 'respond_parry';
  return 'respond_parry';
}

/** How shut the baby's lids are after the feint: halfway, the eye that peeks. */
const BABY_LIDS_PEEK = 0.5;

/**
 * How shut the baby's lids are after `event`, 0 to 1, given `current`. Only what the player is told
 * moves them (D9): the feint, the signal (the eyes close, stories 4.6 and 4.7), the gag, the end. The
 * next round's telegraph opens them again, and it is public: the marker shows it.
 */
export function babyLidsAfter(event: Readonly<SimEvent>, current: number): number {
  switch (event.type) {
    case 'WaitFeintGiven':
      return BABY_LIDS_PEEK;
    case 'WaitSignalGiven':
      return 1;
    case 'ThreatTelegraphed':
    case 'GagTriggered':
    case 'BabyWoke':
    case 'SequenceEnded':
      return 0;
    default:
      return current;
  }
}

/** Papa's contract with his `.glb` (`characterArt.ts` checks the committed file against it). */
export const PAPA_CONTRACT = {
  /** The v2 skeleton (story 7.9, D1): elbows, knees, ankles, a pelvis, a neck, the brows and the forelock. */
  bones: [
    'root',
    'pelvis',
    'spine',
    'neck',
    'head',
    'eyes',
    'eyelids',
    'brow_l',
    'brow_r',
    'forelock',
    'arm_l',
    'forearm_l',
    'hand_l',
    'arm_r',
    'forearm_r',
    'hand_r',
    'leg_l',
    'shin_l',
    'foot_l',
    'leg_r',
    'shin_r',
    'foot_r',
  ],
  visibleNodes: ['papa_body', 'papa_shirt'],
  hiddenNodes: [
    'papa_mug',
    'papa_mug_steam',
    'papa_handset',
    'papa_blabla',
    'papa_hair',
    'papa_look_mash',
    'papa_look_shirt',
    // The puffed cheeks of a held breath (story 7.11, D2): shown by the view.
    'papa_cheeks',
  ],
  clips: [
    'idle',
    'walk',
    'glide',
    'drink',
    'asleep',
    'on_phone',
    'carry_idle',
    'carry_walk',
    'respond_parry',
    'respond_firm',
    'respond_perfect',
    'gag_hit',
    'gag_shock',
    'stumble',
    'snore',
    'coffee_kick',
    'victory_dance',
    'collapse',
    // The first wave of story 7.11 (D1): a start, a brake, the tiptoe loop, three idles.
    'walk_start',
    'walk_stop',
    'tiptoe',
    'idle_scratch',
    'idle_neck',
    'idle_stretch',
    // The second half of the first wave (story 7.12, D1): the stir, the pick-up, a second Parry, the sigh.
    'stir_pot',
    'pick_up',
    'respond_parry_sweep',
    'sigh_relief',
  ],
  /** The lids, the brows (his expressions, story 7.10) and the forelock's pendulum (story 7.9, D3, D7). */
  codeDrivenBones: ['eyelids', 'brow_l', 'brow_r', 'forelock'],
  /** The steam sways and the bla-bla bubble wobbles by code on the sim clock, so reduced motion can hold them (D3). */
  codeDrivenNodes: ['papa_mug_steam', 'papa_blabla'],
  /** Where the forelock's tip is at rest: the pendulum chases it (story 7.9, D7). */
  markerNodes: ['papa_forelock_tip'],
} as const;

/**
 * The baby's contract with his `.glb`: `head` turns to the gaze and `eyelids` follow the duel, both by
 * code; the brows carry his expressions (story 7.10). The v2 skeleton (story 7.9, D1) adds elbows, wrists, knees, ankles.
 */
export const BABY_CONTRACT = {
  bones: [
    'root',
    'spine',
    'neck',
    'head',
    'eyelids',
    'brow_l',
    'brow_r',
    'arm_l',
    'forearm_l',
    'hand_l',
    'arm_r',
    'forearm_r',
    'hand_r',
    'leg_l',
    'shin_l',
    'foot_l',
    'leg_r',
    'shin_r',
    'foot_r',
  ],
  visibleNodes: ['baby_body'],
  hiddenNodes: [],
  clips: [
    'babble',
    'crawl',
    'locked',
    'act',
    'sneak',
    'carried',
    'cry',
    'gag_delight',
    'eyes_peek',
    'eyes_open',
    'sat_up',
    'stir',
    'wake',
    'laugh',
    // Story 7.12 (D1): the pause on all fours, the sit-down, the clap, a second laugh.
    'crawl_pause',
    'sit_down',
    'clap',
    'laugh_belly',
  ],
  codeDrivenBones: ['head', 'eyelids', 'brow_l', 'brow_r'],
  codeDrivenNodes: [],
  markerNodes: [],
} as const;
