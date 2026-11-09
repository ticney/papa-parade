import { looksLikeGameplayNode, parseNodeName } from '@content/levelNodeNames';
import type { CelebrationSettings, FeedbackTable, FramingGrade } from '@content/schemas/feedback';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { PAPA_TARGET_ANCHOR_ID, STEP_MS } from '@shared/constants';
import { roomOf } from '@shared/followCamera';
import { log } from '@shared/log';
import type { RealMs, SimMs } from '@shared/time';
import {
  type GagId,
  isFlowLive,
  isStealthStepRunning,
  type PapaLook,
  type PropSlice,
  type SimEvent,
  type World,
} from '@sim';
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  type Object3D,
  Scene,
} from 'three';
import type { LevelAssets } from '../assets/loadLevelAssets.ts';
import type { ResponseCue } from '../feedback/responseChoreography.ts';
import { addBlobShadows } from './blobShadow.ts';
import { createDimFx } from './dimFx.ts';
import { createGagFx } from './gags.ts';
import { type GradedLights, gradeLightsInto } from './grade.ts';
import type { RoomSize } from './isoCamera.ts';
import { addOutlineHulls, createOutlineKit } from './materials/outlineHull.ts';
import { PALETTE } from './materials/palette.ts';
import { createToonMaterialCache, swapToToon } from './materials/toonMaterial.ts';
import { type ChoreStationSpec, createChoreShards } from './vfx/choreShards.ts';
import { createDangerTint } from './vfx/dangerTint.ts';
import { createFireworks, fireworkAreaOf } from './vfx/fireworks.ts';
import { createLiftFx } from './vfx/liftHop.ts';
import { createMischiefDecals } from './vfx/mischiefDecals.ts';
import { createParticles, type ParticleStyle } from './vfx/particles.ts';
import { createShake } from './vfx/shake.ts';
import { createSoundWaves } from './vfx/soundWaves.ts';
import { nextLaughVariantOf } from './views/babyActing.ts';
import { BABY_LIFE_BONES, createBabyView, layDownProgressPct } from './views/babyView.ts';
import {
  BABY_LAUGH_CLIPS,
  babyLidsAfter,
  babyOneShotOf,
  PAPA_ACTING_CUT_EVENTS,
  PAPA_DEFERRED_ONE_SHOTS,
  PAPA_HELD_ONE_SHOTS,
  papaOneShotOf,
  responseClipOf,
} from './views/characterClips.ts';
import { createCharacterRig } from './views/characterRig.ts';
import { createDoorView, type DoorLook, doorPlacementOf } from './views/doorView.ts';
import {
  type BabyExpression,
  type BabyFace,
  babyExpressionAt,
  clearExpressions,
  createFaceTrack,
  dropMoment,
  noteBabyEvent,
  notePapaEvent,
  type PapaExpression,
  type PapaFace,
  papaExpressionAt,
} from './views/expressions.ts';
import { babyFocusOf, isPapaTired, isSignalOnly } from './views/faceInputs.ts';
import { type CharactersFeel, createLifeInputs } from './views/lifeLayer.ts';
import { nextParryVariantOf } from './views/papaActing.ts';
import type { PapaGazeKind } from './views/papaGaze.ts';
import { createPapaView, PAPA_LIFE_BONES, type PapaPose } from './views/papaView.ts';
import { createPropView, type PropView } from './views/propView.ts';
import { type SquashScale, squashScaleAt } from './views/squash.ts';
import { createViewPool, type ViewPool } from './views/viewPool.ts';
import { createViewRegistry } from './views/viewRegistry.ts';

/** Half extents of the box drawn for a prop kind that has no model node and no prop in the geometry, in metres. */
const DEFAULT_PROP_HALF_EXTENTS_M: readonly [number, number, number] = [0.05, 0.05, 0.05];

/** The sizes of the agents the scene draws, in metres (the feel's, passed by the session). */
export interface SceneBodies {
  papaRadiusM: number;
  babyRadiusM: number;
  /** The def id of the level's micro-sleep (`gauges.fatigue.microSleepDef`), or null: the only threat Papa's eyelids follow. */
  microSleepDefId: string | null;
  /** The ids of the level's threats judged on a release (story 4.8): the baby is lowered while one runs. */
  layDownDefIds: readonly string[];
  /** The level has a bedtime `cycle` (story 7.10, D8): the baby looks sleepy, outside the signals' moments. */
  hasBedtimeCycle: boolean;
  /** The seed the level's sim was made with: Papa's idles are drawn from it (story 7.11, D8), never from `world.rng`. */
  levelSeed: number;
  /** The ids of the level's threats aimed at an anchor: only they show the alert tint (story 7.3, D6). */
  anchorThreatDefIds: readonly string[];
  /**
   * The level's chore stations (story 9.6), index-aligned with `world.chores`: where each stands and what a
   * missed beat breaks, for the shards drawn in front of it.
   */
  choreStations: readonly ChoreStationSpec[];
  /** The height of the baby's centre once laid on the mattress, in metres (`feedback.json › bombDrop.laidHeightM`). */
  laidHeightM: number;
  /** How the characters move (`feedback.json › characters`): squash, clip speeds, facings, busy props. */
  characters: FeedbackTable['characters'];
  /**
   * The life layer and the characters' look (`world.feel.characters`, story 7.8), read at each call and
   * never copied: a change in the feel panel shows on the next frame.
   */
  liveCharacters(): CharactersFeel;
  /** The door panel's numbers (`feedback.json › door`, story 3.5). */
  door: DoorLook;
  /** The final look (`feedback.json › render`, story 7.3). */
  render: FeedbackTable['render'];
  /** Read each frame: under reduced motion the door jumps open instead of swinging (story 3.5). */
  isMotionReduced(): boolean;
}

/**
 * What the feedback director plays in the 3D world. The rings, the gags and the hop run on the
 * sim clock (a pause freezes them, a slow-mo slows them, a restart frees them; times are sim ms);
 * the shake and the particles run on **real** time (`startAtReal`), so they play during the
 * hitstop, when the sim clock stands still.
 */
export interface LevelFx {
  /** An ink ring on the floor at (`xM`, `zM`) that grows to `maxRadiusM` and fades over `durationMs`. */
  soundWave(xM: number, zM: number, maxRadiusM: number, durationMs: number, startAt: SimMs): void;
  /**
   * Shakes the room (not the camera) by up to `amplitudeM` for `durationMs` real ms, wobbling at
   * `frequencyHz`.
   */
  shake(amplitudeM: number, durationMs: number, frequencyHz: number, startAtReal: RealMs): void;
  /** A burst of `count` particles from the floor point (`xM`, `zM`), for `lifeMs` real ms. */
  particles(
    style: ParticleStyle,
    count: number,
    speedMps: number,
    lifeMs: number,
    sizeM: number,
    xM: number,
    zM: number,
    startAtReal: RealMs,
  ): void;
  /**
   * Presents a gag (`GAG_PRESENTATIONS`): the lights go out and come back, Papa's hair stands up,
   * the baby slides along (`slideDirX`, `slideDirZ`) and back. With `isMotionReduced` the hair
   * stays flat and the baby stays put (the lights alone carry the gag).
   */
  gag(
    gag: GagId,
    startAt: SimMs,
    isMotionReduced?: boolean,
    slideDirX?: number,
    slideDirZ?: number,
  ): void;
  /** The provisional « lift the baby » pose: a short hop of the baby. */
  liftBaby(startAt: SimMs): void;
  /**
   * Papa's pose for a response he has arrived at (P3: the sound fired at the judgement), from the world of its
   * judgement (story 7.12, D6): a Parry success plays one of his two Parries (D4), and a success late in its
   * window arms his sigh of relief, played once the pose has handed back (D5).
   */
  playResponseClip(cue: Readonly<ResponseCue>): void;
  /**
   * What a sim event plays on the characters: one-shots, the baby's lids, the moments of their faces (story
   * 7.10: none while only the signals count) and, unless `isMotionReduced`, the squash. The clips and the
   * faces stay under reduced motion: a pose carries state (story 7.2, D7). A state change of Papa's or the
   * event of an accepted command (`PAPA_ACTING_CUT_EVENTS`) first cuts his idle, start or brake (story 7.11).
   */
  playCharacterEvent(
    event: Readonly<SimEvent>,
    world: Readonly<World>,
    isMotionReduced: boolean,
  ): void;
}

export interface LevelScene {
  /** The level id (`salon_crawler`). */
  readonly id: string;
  readonly scene: Scene;
  /** The box the camera fits, from the bounds of the visual nodes. */
  readonly room: RoomSize;
  /** The effects of the level; they die with it. */
  readonly fx: LevelFx;
  /**
   * Where the baby's view is displaced from his sim point, in metres on the floor (the stairs gag's
   * slide, story 3.15): a tap aims at where he is drawn. Read at call time.
   */
  readonly babySlideM?: Readonly<{ xM: number; zM: number }>;
  /**
   * Moves what the world moves: Papa, the baby and the props, drawn `alpha` of the way from the
   * last step to the next; then the sim-clocked effects on the interpolated sim clock, and the
   * real-time ones (shake, particles) at `nowReal`, the frame's timestamp: they move on every
   * rendered frame, frozen by a hitstop or not.
   */
  update(world: Readonly<World>, alpha: number, nowReal: RealMs): void;
  /** What the real-time effects are doing right now, read at call time (the debug `fx()`). */
  realFxState(): {
    shakeOffsetXM: number;
    shakeOffsetZM: number;
    particlesAlive: number;
    /** The finale's sparks drawn or waiting to burst (story 7.4). */
    fireworksAlive: number;
    /** The film grammar's grade factor on the lights now (story 7.4); 1 with no grade. */
    gradeLightsFactor: number;
    /** How far the carried baby was drawn lowered onto the mattress, 0 to 100 (story 4.8). */
    babyLayDownPct: number;
    /** The clip Papa is seen playing, or null. */
    papaClip: string | null;
    /** The clip the baby is seen playing, or null. */
    babyClip: string | null;
    /** Papa's mixer clock, in sim ms. */
    papaMixerMs: number;
    /** The way Papa's drawn body faces, in radians: it turns for the camera and away from the baby (story 2.13). */
    papaBodyYawRad: number;
    /** How far the coffee steam leans, in degrees; 0 while hidden or held (story 2.13). */
    papaSteamSwayDeg: number;
    /** How far the bla-bla bubble tilts, in degrees; 0 while hidden or held (story 2.13). */
    papaBlablaTiltDeg: number;
    /** How far the door was drawn open, in degrees; 0 while it is shut (story 3.5). */
    doorOpenDeg: number;
    /** How many alert glows stand on the room's dangers (story 7.3). */
    dangerTintsShown: number;
    /** The factor the 3D lights are scaled by: the darker of the outlet's flash and the pénombre (story 3.15). */
    lightsFactor: number;
    /** How many mischief decals lie on the floor (story 3.15). */
    mischiefDecals: number;
    /** How many broken plates' shards lie on the floor in front of the stations (story 9.6). */
    choreShards: number;
    /** The look the view draws: the world's, or the debug overlay's (story 3.7). */
    papaLook: Readonly<PapaLook>;
    /** Papa's lean into a start or a stop, in degrees (story 7.8); 0 under reduced motion. */
    papaLeanDeg: number;
    /** Papa's fatigue stoop, in degrees forward (story 7.8). */
    papaStoopDeg: number;
    /** Papa's head turn from his body, in degrees, positive toward his left (story 7.8). */
    papaHeadYawDeg: number;
    /** How far Papa's forelock turns from its rest, in degrees (story 7.9). */
    papaForelockDeg: number;
    /** What Papa's head follows (story 7.8). */
    papaGaze: PapaGazeKind;
    /** Papa's breath, in degrees of his torso (story 7.8); 0 held or under reduced motion. */
    papaBreathDeg: number;
    /** The baby's breath, in degrees of his torso (story 7.8); 0 under reduced motion. */
    babyBreathDeg: number;
    /** How shut Papa's eyelids are drawn, 0 (open) to 100: the micro-sleep or his sleep only (story 7.8, D9). */
    papaEyelidsPct: number;
    /** What Papa's face shows now, the debug overlay included (story 7.10). */
    papaExpression: PapaFace;
    /** What the baby's face shows now, the debug overlay included (story 7.10). */
    babyExpression: BabyFace;
    /** Papa's brows' drawn tilt, in degrees, positive inner ends up (story 7.10). */
    papaBrowTiltDeg: number;
    /** Whether Papa's puffed cheeks are shown: while he holds his breath (story 7.11). */
    papaCheeksShown: boolean;
    /** The baby's brows' drawn tilt, in degrees, positive inner ends up (story 7.10). */
    babyBrowTiltDeg: number;
  };
  /**
   * What the screen shows Papa's gaze (story 7.8, D8), from boot after the markers and the bubbles: the
   * baby on screen, and the visible threat whose ring is the most advanced (`hasThreat` false for none).
   * Applied at the next `update`: one frame late, a cosmetic head turn. Allocates nothing.
   */
  setPapaGazeSight(
    isBabyShown: boolean,
    hasThreat: boolean,
    threatXM: number,
    threatZM: number,
  ): void;
  /** Where the baby was last drawn (interpolated, his slide included), for boot's « is he on screen ». */
  readonly babyPoint: Readonly<{ xM: number; zM: number }>;
  /**
   * The debug overlay of Papa's look (story 7.2, D2): a part is shown when the world's `papa.look`
   * (story 3.7: what the gags did) or this overlay says so. Cleared by `resetFx`.
   */
  setPapaLook(look: Readonly<PapaLook>): void;
  /**
   * The debug overlay of the faces (story 7.10, D11): an expression shows over what the game says, `null`
   * gives the face back. Applied at the next `update`, whatever the guard of the signals; cleared by `resetFx`.
   */
  setExpressionOverlay(papa: PapaFace | null, baby: BabyFace | null): void;
  /** Where Papa was last drawn (interpolated), for the markers that follow him. */
  readonly papaPose: Readonly<PapaPose>;
  /**
   * Sets off the finale's fireworks over the room (story 7.4), on real time from `startAtReal`, around the
   * floor point the camera looks at (`centreXM`, `centreZM`). They keep the reduced-motion share of their
   * sparks when `isMotionReduced`. `resetFx` hides them.
   */
  startFireworks(
    settings: CelebrationSettings['fireworks'],
    startAtReal: RealMs,
    isMotionReduced: boolean,
    centreXM: number,
    centreZM: number,
  ): void;
  /** When the last firework spark dies, in real ms, or null with none scheduled. */
  readonly fireworksEndAtReal: number | null;
  /** Hides every firework spark at once (story 7.4: Mama home early ends the celebration). */
  stopFireworks(): void;
  /**
   * The film grammar's grade (story 7.4): the room's lights graded by `grade` at `weight` and by the one
   * still going out, `carried`, at `carriedWeight`, multiplied by the gags' own factor on top. Writes
   * nothing when nothing changed; allocates nothing. `resetFx` puts the level's lights back.
   */
  setGrade(
    grade: FramingGrade | null,
    weight: number,
    carried: FramingGrade | null,
    carriedWeight: number,
  ): void;
  /**
   * Ends the effects under way (rings and glows hidden, shake offset back to zero, lights back, hair down,
   * baby on the floor). Effects advance only
   * while the game loop runs; call it when the loop stops, so a frozen mid-effect frame is not what
   * `drawStatic` shows behind the loading or error screen.
   */
  resetFx(): void;
  /** Frees geometries, materials and textures. Call it when a new level replaces this one. */
  dispose(): void;
}

/**
 * How shut Papa's eyelids are, 0 to 1: while the micro-sleep (the level's `microSleepDefId`) is
 * announced they lower with the telegraph's progress, from its entry to the opening of the window,
 * and they stay shut while the window is open. Read from the world each frame (story 1.19), so a
 * pause or a slow-mo freezes it. Only the micro-sleep: another threat on Papa (the duel's, story
 * 4.6) must not show the time left before its signal. Allocation-free.
 */
export function eyelidsAmountAt(
  world: Readonly<World>,
  clockMs: number,
  microSleepDefId: string | null,
): number {
  if (microSleepDefId === null) return 0;
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as World['threats'][number];
    if (threat.anchorId !== PAPA_TARGET_ANCHOR_ID || threat.defId !== microSleepDefId) continue;
    if (threat.state === 'windowOpen') return 1;
    if (threat.state !== 'telegraph') return 0;
    const spanMs = threat.windowOpenAt - threat.enteredAt;
    if (!(spanMs > 0)) return 1;
    return Math.min(1, Math.max(0, (clockMs - threat.enteredAt) / spanMs));
  }
  return 0;
}

/**
 * How far the baby is lowered, 0 to 100 (story 4.8): the progress of the running threat whose def is
 * one of `layDownDefIds`, or 0. Read from the world each frame, so a pause or a slow-mo holds it.
 * Allocation-free.
 */
export function layDownPctAt(
  world: Readonly<World>,
  clockMs: number,
  layDownDefIds: readonly string[],
): number {
  if (layDownDefIds.length === 0) return 0;
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as World['threats'][number];
    if (threat.state !== 'telegraph' && threat.state !== 'windowOpen') continue;
    if (layDownDefIds.includes(threat.defId)) return layDownProgressPct(threat, clockMs);
  }
  return 0;
}

/** Papa's response poses (`responseClipOf`): while one plays, his eyes are on the job (story 7.8, D8). */
function isResponseClip(clip: string | null): boolean {
  return clip?.startsWith('respond_') === true;
}

/** Nodes the game uses but the player never sees: collision, navigation, zones, anchors (D4). */
function isHiddenInGame(name: string): boolean {
  const parsed = parseNodeName(name);
  if (parsed.ok) return parsed.value.kind !== 'visual' && parsed.value.kind !== 'prop';
  // A mistyped gameplay node (`COL_Sofa`) must not show as a grey box in the room: the extractor
  // and the Blender gate refuse it, so reaching here means a stale or hand-made `.glb`.
  if (looksLikeGameplayNode(name)) {
    log.warn('assets', `hiding a malformed gameplay node: ${parsed.error}`, { name });
    return true;
  }
  return false;
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      for (const one of Array.isArray(child.material) ? child.material : [child.material]) {
        one.dispose();
      }
    }
  });
}

/** A squash under way on one character. Reused: nothing is allocated when one starts. */
interface SquashRun {
  startAt: number | null;
  amountPct: number;
  durationMs: number;
}

/**
 * Takes the `PROP_*` nodes out of the model: they are no longer drawn in place, the pooled prop
 * views are. The first node of each kind becomes that kind's template (its geometry and its toon
 * material are shared by every view of the kind). Returns the templates by kind and every node
 * taken out, so that the scene can free their geometry.
 */
function takePropNodes(
  model: Object3D,
  geometry: LevelGeometry,
): { templates: Map<string, Object3D>; taken: Object3D[] } {
  const templates = new Map<string, Object3D>();
  const taken: Object3D[] = [];
  const kindOfId = new Map(geometry.props.map((prop) => [prop.id, prop.kind]));
  const found: Object3D[] = [];
  model.traverse((node) => {
    const parsed = node === model ? null : parseNodeName(node.name);
    if (parsed?.ok && parsed.value.kind === 'prop') found.push(node);
  });
  for (const node of found) {
    const parsed = parseNodeName(node.name);
    if (!parsed.ok) continue;
    const kind = kindOfId.get(parsed.value.id);
    node.removeFromParent();
    taken.push(node);
    if (kind === undefined) {
      log.warn('assets', 'a PROP_ node of the model is not a prop of the geometry: not drawn', {
        name: node.name,
      });
    } else if (!templates.has(kind)) {
      templates.set(kind, node);
    }
  }
  return { templates, taken };
}

/**
 * The scene of one level: the loaded model with its non-visual nodes removed, every material
 * swapped for a shared toon one (keeping each mesh's colour), the level's lights, blob shadows (no
 * shadow map), ink hulls on the characters and the props (not on the furniture, story 7.3, D2), Papa, the baby and the props (pooled views, one pool per kind, made here so that nothing is
 * built during play). The model is taken over: it belongs to this scene from now on. The bodies'
 * radii are the feel's, read once when the level starts (a `SetFeel` takes effect at the next level).
 */
export function createLevelScene(assets: LevelAssets, bodies: SceneBodies): LevelScene {
  const { geometry, model } = assets;
  const scene = new Scene();
  scene.background = new Color(PALETTE.ink);

  const hidden: Object3D[] = [];
  model.traverse((node) => {
    if (node !== model && isHiddenInGame(node.name)) hidden.push(node);
  });
  for (const node of hidden) {
    disposeObject(node);
    node.removeFromParent();
  }

  const { render } = bodies;
  const toon = createToonMaterialCache(render.toonTones);
  const outlines = createOutlineKit(render.outlines);
  // The characters' own look (story 7.8, D10): their toon materials (a rim, maybe a 4th tone) and their
  // hulls, wider than the props'. Separate from the room's, which stay as they are; no draw call added.
  const characterToon = createToonMaterialCache(render.toonTones, { isCharacters: true });
  const characterOutlines = createOutlineKit(render.outlines);
  const applyCharacterLook = (characters: CharactersFeel): void => {
    characterToon.setLook(characters.look);
    characterOutlines.setWidthM((render.outlines.widthM * characters.look.outlineWidthPct) / 100);
  };
  applyCharacterLook(bodies.liveCharacters());
  // The props leave the model first, and get their hulls before the swap, which loses the material
  // names. `template.clone(true)` then carries the hull into every view.
  const { templates, taken: propNodes } = takePropNodes(model, geometry);
  for (const template of templates.values()) addOutlineHulls(template, outlines);
  for (const root of [model, ...propNodes]) {
    root.traverse((node) => {
      if (node instanceof Mesh && !outlines.isHull(node.material)) swapToToon(node, toon);
    });
  }
  // The room, its shadows, Papa, the baby and the waves live under one root: a shake moves the
  // root, not the camera, so the framing and the world UI layer stay put. The lights stay outside.
  const content = new Group();
  content.name = 'content_root';
  scene.add(content);
  content.add(model);

  const room = roomOf(geometry);
  const centerX = room.centerXM ?? 0;
  const centerZ = room.centerZM ?? 0;
  const lights = render.lights.byLevel[assets.id] ?? render.lights.default;
  // The level's own colours, kept apart: the film grammar's grade lerps from them (story 7.4).
  const levelAmbientColor = new Color(lights.ambientColor);
  const levelSunColor = new Color(lights.sunColor);
  const graded: GradedLights = { factor: 1, ambient: new Color(), sun: new Color() };
  const ambient = new AmbientLight(new Color(lights.ambientColor), lights.ambientIntensity);
  scene.add(ambient);
  const sun = new DirectionalLight(new Color(lights.sunColor), lights.sunIntensity);
  const [sunX, sunY, sunZ] = render.sunOffsetM;
  sun.position.set(centerX + sunX, sunY, centerZ + sunZ);
  sun.target.position.set(centerX, 0, centerZ);
  scene.add(sun, sun.target);

  const shadows = addBlobShadows(content, geometry.colliders, render.blobSkipColliderIds);
  // The mess a silence's mischief leaves, from `world.afterEffects.mischiefMarks` (story 3.15): the photo shows it too.
  const decals = createMischiefDecals(
    content,
    {
      colliders: geometry.colliders,
      wallHeightM: render.decalWallHeightM,
      boundsMinM: geometry.boundsMinM,
      boundsMaxM: geometry.boundsMaxM,
    },
    toon,
  );
  // The shards of the plates a chore broke (story 9.6): from `world.chores`, on the photo too.
  const choreShards = createChoreShards(
    content,
    {
      colliders: geometry.colliders,
      wallHeightM: render.decalWallHeightM,
      boundsMinM: geometry.boundsMinM,
      boundsMaxM: geometry.boundsMaxM,
    },
    toon,
    bodies.choreStations,
  );

  // The props: the model's PROP_ nodes are templates, the views are pooled per kind.
  const pools = new Map<string, ViewPool<PropView>>();
  const poolOf = (kind: string, halfExtentsM: readonly [number, number, number]) => {
    const existing = pools.get(kind);
    if (existing !== undefined) return existing;
    let template = templates.get(kind);
    if (template === undefined) {
      // A prop kind with no PROP_ node in the model, or one the geometry never listed: a grey box
      // of its size, so that the prop is not invisible while it falls.
      log.warn('assets', `no PROP_${kind}_nn node in the model: drawing a plain box`, { kind });
      template = new Mesh(
        new BoxGeometry(halfExtentsM[0] * 2, halfExtentsM[1] * 2, halfExtentsM[2] * 2),
        toon.get(new Color(PALETTE.cream)),
      );
      addOutlineHulls(template, outlines);
      propNodes.push(template);
    }
    const count = geometry.props.filter((prop) => prop.kind === kind).length;
    const pool = createViewPool(() => {
      const view = createPropView(kind, template as Object3D, shadows.kit, { halfExtentsM });
      content.add(view.object);
      return view;
    }, count);
    pools.set(kind, pool);
    return pool;
  };
  for (const prop of geometry.props) poolOf(prop.kind, prop.halfExtentsM);
  const props = createViewRegistry<PropSlice, PropView>({
    keyOf: (prop) => prop.id,
    // A kind the geometry never listed (a world that does not match the scene) gets a pool on demand.
    create: (prop) => poolOf(prop.kind, DEFAULT_PROP_HALF_EXTENTS_M).acquire(),
    update: (view, prop, alpha) => view.update(prop, alpha),
    release: (view) => {
      view.hide();
      pools.get(view.kind)?.release(view);
    },
  });

  const { clipSpeeds, squash, papaClipFacing, busyProps } = bodies.characters;
  const motion = { clips: clipSpeeds, clipFacing: papaClipFacing, busyProps };
  const papa = createPapaView(
    content,
    characterToon,
    shadows.kit,
    bodies.papaRadiusM,
    createCharacterRig(assets.characters.papa, characterToon, characterOutlines, PAPA_LIFE_BONES),
    motion,
  );
  const baby = createBabyView(
    content,
    shadows.kit,
    bodies.babyRadiusM,
    createCharacterRig(assets.characters.baby, characterToon, characterOutlines, BABY_LIFE_BONES),
    motion,
    bodies.laidHeightM,
  );
  // The life layer's inputs (story 7.8), one scratch object filled each frame from the world and the screen.
  const life = createLifeInputs(bodies.liveCharacters());
  /** What boot last said the screen shows Papa's gaze: applied at the next `update`. */
  const pendingSight = { isBabyShown: false, hasThreat: false, threatXM: 0, threatZM: 0 };
  const babyPoint = { xM: 0, zM: 0 };
  /** A one-shot's fade in: the « other » passage of the live feel (D4). */
  const oneShotFadeMs = (): number => bodies.liveCharacters().fades.otherMs;
  // The closed door at `ANCHOR_door` (story 3.5): it opens from `world.flow.finalRushAt`, every frame.
  const doorAnchor = geometry.anchors.find((anchor) => anchor.id === 'door');
  const door =
    doorAnchor === undefined
      ? null
      : createDoorView(
          content,
          toon,
          bodies.door,
          doorPlacementOf(
            doorAnchor.positionM[0],
            doorAnchor.positionM[2],
            geometry.boundsMinM[0],
            geometry.boundsMinM[2],
            geometry.boundsMaxM[0],
            geometry.boundsMaxM[2],
            bodies.door.widthM,
          ),
        );
  const waves = createSoundWaves(content, PALETTE.ink);
  const shake = createShake(content);
  const particles = createParticles(content);
  // The finale's fireworks (story 7.4): a pool of their own, over the room's floor bounds.
  const fireworks = createFireworks(content);
  const fireworkRoom = {
    minXM: geometry.boundsMinM[0],
    minZM: geometry.boundsMinM[2],
    maxXM: geometry.boundsMaxM[0],
    maxZM: geometry.boundsMaxM[2],
  };
  // Under the root: a shake moves the glows with the room.
  const dangerTint = createDangerTint(
    content,
    geometry.anchors,
    render.dangerTint,
    shadows.kit.texture,
    bodies.anchorThreatDefIds,
  );
  // The gags move the lights (the level's own: the outlet does not bring the salon into the bedroom),
  // Papa's hair and the baby's slide; the hop moves the baby too. Both on the sim clock.
  // The lights answer to two things (story 3.15): the outlet's 600 ms flash and the pénombre the sim holds
  // for 6 s (`world.afterEffects.dimUntil`); the room is as dark as the darker of the two. Only the 3D lights:
  // the world UI is DOM over the canvas and is never dimmed.
  const dim = createDimFx();
  let flashLightsFactor = 1;
  let dimLightsFactor = 1;
  // The grade's inputs as last applied (story 7.4): nothing is written again while they are the same.
  let gradeOf: FramingGrade | null = null;
  let gradeWeight = 0;
  let carriedGradeOf: FramingGrade | null = null;
  let carriedGradeWeight = 0;
  const applyLights = (): void => {
    // The grade multiplies the level's lights; the gags' factor multiplies on top (never replaces it).
    const factor = Math.min(flashLightsFactor, dimLightsFactor) * graded.factor;
    ambient.intensity = lights.ambientIntensity * factor;
    sun.intensity = lights.sunIntensity * factor;
  };
  const writeGrade = (
    grade: FramingGrade | null,
    weight: number,
    carried: FramingGrade | null,
    carriedWeight: number,
  ): void => {
    gradeOf = grade;
    gradeWeight = weight;
    carriedGradeOf = carried;
    carriedGradeWeight = carriedWeight;
    gradeLightsInto(
      graded,
      levelAmbientColor,
      levelSunColor,
      grade,
      weight,
      carried,
      carriedWeight,
    );
    ambient.color.copy(graded.ambient);
    sun.color.copy(graded.sun);
    applyLights();
  };
  writeGrade(null, 0, null, 0);
  // Papa's hair: the gag's snap, or on end for as long as he is electrified.
  let gagHairAmount = 0;
  let isHairHeld = false;
  const applyHair = (): void => papa.setHair(Math.max(gagHairAmount, isHairHeld ? 1 : 0));
  // Papa's look (story 3.7): the world's parts or the debug overlay's, in two scratch objects.
  const worldLook: PapaLook = {
    hasMashOnCheek: false,
    hasHairOnEnd: false,
    isShirtInsideOut: false,
  };
  const overlayLook: PapaLook = {
    hasMashOnCheek: false,
    hasHairOnEnd: false,
    isShirtInsideOut: false,
  };
  const drawnLook: PapaLook = {
    hasMashOnCheek: false,
    hasHairOnEnd: false,
    isShirtInsideOut: false,
  };
  const applyLook = (): void => {
    const hasMashOnCheek = worldLook.hasMashOnCheek || overlayLook.hasMashOnCheek;
    const hasHairOnEnd = worldLook.hasHairOnEnd || overlayLook.hasHairOnEnd;
    const isShirtInsideOut = worldLook.isShirtInsideOut || overlayLook.isShirtInsideOut;
    if (
      hasMashOnCheek === drawnLook.hasMashOnCheek &&
      hasHairOnEnd === drawnLook.hasHairOnEnd &&
      isShirtInsideOut === drawnLook.isShirtInsideOut
    ) {
      return;
    }
    drawnLook.hasMashOnCheek = hasMashOnCheek;
    drawnLook.hasHairOnEnd = hasHairOnEnd;
    drawnLook.isShirtInsideOut = isShirtInsideOut;
    papa.setLook(drawnLook);
  };
  const babySlideM = { xM: 0, zM: 0 };
  const gags = createGagFx({
    setLightsFactor: (factor) => {
      flashLightsFactor = factor;
      applyLights();
    },
    setHairAmount: (amount) => {
      gagHairAmount = amount;
      applyHair();
    },
    setBabySlide: (offsetXM, offsetZM, dropM) => {
      babySlideM.xM = offsetXM;
      babySlideM.zM = offsetZM;
      baby.setSlideM(offsetXM, offsetZM, dropM);
    },
  });
  const lift = createLiftFx((heightM) => baby.setLiftM(heightM));
  /** The lowering of the baby as last drawn (story 4.8), read by the debug `fx()`. */
  let drawnLayDownPct = 0;
  /** The clock of the last frame: the mixers advance by its difference alone (D6). */
  let lastClockMs: number | null = null;
  /** A one-shot that waits for Papa's glide and response pose to end (the victory dance, story 7.4). */
  let pendingPapaOneShot: string | null = null;
  /** The sim instant Papa's sigh was armed at (story 7.12, D5), or null: it plays once his pose hands back. */
  let reliefArmedAt: number | null = null;
  /** The baby's last laugh, an index into `BABY_LAUGH_CLIPS` (story 7.12, D10), or null at a level's start. */
  let lastLaughVariant: number | null = null;
  /** Papa's last Parry, an index into `PAPA_PARRY_CLIPS` (story 7.12, D4), or null at a level's start. */
  let lastParryVariant: number | null = null;
  // The loop of each chore station (story 7.12, D2), index-aligned with `world.chores`, resolved once.
  const choreClips = bodies.choreStations.map(
    (station) =>
      bodies.characters.choreClips.find((row) => row.chore === station.defId)?.clip ?? null,
  );
  let babyLids = 0;
  // The faces (story 7.10): one track per character, fed by the events, read each frame with the world.
  const papaFaceTrack = createFaceTrack<PapaExpression>();
  const babyFaceTrack = createFaceTrack<BabyExpression>();
  let overlayPapaFace: PapaFace | null = null;
  let overlayBabyFace: BabyFace | null = null;
  const papaSquash: SquashRun = { startAt: null, amountPct: 0, durationMs: 0 };
  const babySquash: SquashRun = { startAt: null, amountPct: 0, durationMs: 0 };
  const squashScale: SquashScale = { xz: 1, y: 1 };
  /** Writes one character's squash for `clockMs`: only while one runs, and a last time when it ends. */
  const applySquash = (
    run: SquashRun,
    clockMs: number,
    setSquash: (xz: number, y: number) => void,
  ): void => {
    if (run.startAt === null) return;
    const elapsedMs = clockMs - run.startAt;
    squashScaleAt(run.amountPct, elapsedMs, run.durationMs, squashScale);
    setSquash(squashScale.xz, squashScale.y);
    if (elapsedMs >= run.durationMs) run.startAt = null;
  };
  const setPapaSquash = (xz: number, y: number): void => papa.setSquash(xz, y);
  const setBabySquash = (xz: number, y: number): void => baby.setSquash(xz, y);
  const fx: LevelFx = {
    soundWave: (xM, zM, maxRadiusM, durationMs, startAt) =>
      waves.play(xM, zM, maxRadiusM, durationMs, startAt),
    shake: (amplitudeM, durationMs, frequencyHz, startAtReal) =>
      shake.start(amplitudeM, durationMs, frequencyHz, startAtReal),
    particles: (style, count, speedMps, lifeMs, sizeM, xM, zM, startAtReal) =>
      particles.burst(style, count, speedMps, lifeMs, sizeM, xM, zM, startAtReal),
    gag: (gag, startAt, isMotionReduced, slideDirX, slideDirZ) =>
      gags.start(gag, startAt, isMotionReduced, slideDirX, slideDirZ),
    liftBaby: (startAt) => lift.start(startAt),
    playResponseClip(cue) {
      // In a duel or stealth step, no variant and no sigh (principle 5): the first Parry, as always, and the
      // alternation does not move. Otherwise a Parry success is the other Parry than the last one played.
      let variant = 0;
      if (!cue.isSignalOnly && cue.response === 'parry' && cue.quality === 'success') {
        lastParryVariant = nextParryVariantOf(bodies.levelSeed, lastParryVariant);
        variant = lastParryVariant;
      }
      const clip = responseClipOf(cue.response, cue.quality, variant);
      if (clip === null) return;
      papa.playOnce(clip, oneShotFadeMs());
      if (cue.isRelief && !cue.isSignalOnly) reliefArmedAt = cue.cueAt;
    },
    playCharacterEvent(event, world, isMotionReduced) {
      // Story 7.11, D11, D12: the step that applies a command, or changes his state, cuts his acting in
      // this frame, before any one-shot of the event (which then plays on a clean slot).
      if (PAPA_ACTING_CUT_EVENTS.includes(event.type)) papa.cutActing(world.feel.characters.fades);
      // A sigh armed earlier is dropped, never played late (story 7.12, D5), by a command, a state change or a gag
      // that comes after it; the events of its own step (the judgement, the arrival) leave it.
      if (
        reliefArmedAt !== null &&
        event.t > reliefArmedAt &&
        (PAPA_ACTING_CUT_EVENTS.includes(event.type) || event.type === 'GagTriggered')
      ) {
        reliefArmedAt = null;
      }
      const fadeMs = world.feel.characters.fades.otherMs;
      const papaClip = papaOneShotOf(event);
      // A gag during a glide plays as his squash alone: the glide's loop goes on (P3). A held clip (the
      // collapse of a `mamaHome`) is the exception: the sim is frozen from then on, so his glide would
      // run in place for the whole hold. It also cancels a victory dance still waiting for his pose.
      const isHeld = papaClip !== null && PAPA_HELD_ONE_SHOTS.includes(papaClip);
      if (papaClip !== null && (world.papa.state !== 'glide' || isHeld)) {
        if (isHeld) pendingPapaOneShot = null;
        papa.playOnce(papaClip, fadeMs, isHeld);
      } else if (papaClip !== null && PAPA_DEFERRED_ONE_SHOTS.includes(papaClip)) {
        // The finale comes with the last response, mid-glide (story 7.4): the dance waits for his pose.
        pendingPapaOneShot = papaClip;
      }
      let babyClip = babyOneShotOf(event);
      // His two laughs alternate (story 7.12, D10); in a duel or stealth step, the first alone, the memory still.
      if (babyClip === 'laugh' && !isSignalOnly(world)) {
        lastLaughVariant = nextLaughVariantOf(bodies.levelSeed, lastLaughVariant);
        babyClip = BABY_LAUGH_CLIPS[lastLaughVariant] ?? 'laugh';
      }
      if (babyClip !== null) baby.playOnce(babyClip, fadeMs);
      babyLids = babyLidsAfter(event, babyLids);
      baby.setEyelids(babyLids);
      // The faces' moments (D4): none while only the signals count, and the running ones dropped (D5).
      if (isSignalOnly(world)) {
        dropMoment(papaFaceTrack);
        dropMoment(babyFaceTrack);
      } else {
        const faces = world.feel.characters.expressions;
        notePapaEvent(papaFaceTrack, event, world.papa.state === 'asleep', faces.papa);
        noteBabyEvent(babyFaceTrack, event, faces.baby);
      }
      if (isMotionReduced) return;
      for (let i = 0; i < squash.length; i++) {
        const row = squash[i] as (typeof squash)[number];
        if (row.event !== event.type) continue;
        const run = row.character === 'papa' ? papaSquash : babySquash;
        run.startAt = event.t;
        run.amountPct = row.amountPct;
        run.durationMs = row.durationMs;
      }
    },
  };

  return {
    id: assets.id,
    scene,
    room,
    fx,
    babySlideM,
    get papaPose() {
      return papa.pose;
    },
    realFxState() {
      return {
        shakeOffsetXM: shake.offsetM.x,
        shakeOffsetZM: shake.offsetM.z,
        particlesAlive: particles.aliveCount,
        fireworksAlive: fireworks.aliveCount,
        gradeLightsFactor: graded.factor,
        babyLayDownPct: drawnLayDownPct,
        papaClip: papa.clipName,
        babyClip: baby.clipName,
        papaMixerMs: papa.mixerTimeMs,
        papaBodyYawRad: papa.bodyYawRad,
        papaSteamSwayDeg: papa.steamSwayDeg,
        papaBlablaTiltDeg: papa.blablaTiltDeg,
        doorOpenDeg: door?.openAngleDeg ?? 0,
        dangerTintsShown: dangerTint.shownCount,
        lightsFactor: Math.min(flashLightsFactor, dimLightsFactor),
        mischiefDecals: decals.count,
        choreShards: choreShards.plateCount,
        papaLook: { ...drawnLook },
        papaLeanDeg: papa.leanDeg,
        papaStoopDeg: papa.stoopDeg,
        papaHeadYawDeg: papa.headYawDeg,
        papaForelockDeg: papa.forelockDeg,
        papaGaze: papa.gazeKind,
        papaBreathDeg: papa.breathDeg,
        babyBreathDeg: baby.breathDeg,
        papaEyelidsPct: papa.eyelidsPct,
        papaExpression: life.papaExpression,
        babyExpression: life.babyExpression,
        papaBrowTiltDeg: papa.browTiltDeg,
        babyBrowTiltDeg: baby.browTiltDeg,
        papaCheeksShown: papa.isCheeksShown,
      };
    },
    setPapaGazeSight(isBabyShown, hasThreat, threatXM, threatZM) {
      pendingSight.isBabyShown = isBabyShown;
      pendingSight.hasThreat = hasThreat;
      pendingSight.threatXM = threatXM;
      pendingSight.threatZM = threatZM;
    },
    babyPoint,
    setPapaLook(look) {
      overlayLook.hasMashOnCheek = look.hasMashOnCheek;
      overlayLook.hasHairOnEnd = look.hasHairOnEnd;
      overlayLook.isShirtInsideOut = look.isShirtInsideOut;
      applyLook();
    },
    setExpressionOverlay(papaFace, babyFace) {
      overlayPapaFace = papaFace;
      overlayBabyFace = babyFace;
    },
    update(world, alpha, nowReal) {
      papa.update(world.papa, alpha);
      // The look the gags left on Papa (story 3.7), every frame: three booleans, nothing allocated.
      worldLook.hasMashOnCheek = world.papa.look.hasMashOnCheek;
      worldLook.hasHairOnEnd = world.papa.look.hasHairOnEnd;
      worldLook.isShirtInsideOut = world.papa.look.isShirtInsideOut;
      applyLook();
      const clockMs = world.time.sim + alpha * STEP_MS;
      drawnLayDownPct = layDownPctAt(world, clockMs, bodies.layDownDefIds);
      baby.update(world.baby, alpha, world.papa, drawnLayDownPct);
      // The sim's clock drives the mixers: it stands still in a pause and a hitstop, slows in a slow-mo.
      // `alpha` can step back at a boundary, and a negative time would run a clip backwards (D6).
      const dtMs = lastClockMs === null ? 0 : Math.max(0, clockMs - lastClockMs);
      lastClockMs = clockMs;
      // The life layer's inputs (story 7.8), from the world and what boot last said the screen shows.
      const characters = world.feel.characters;
      applyCharacterLook(characters);
      babyPoint.xM = baby.pose.xM + babySlideM.xM;
      babyPoint.zM = baby.pose.zM + babySlideM.zM;
      life.characters = characters;
      life.fatigue = world.gauges.fatigue;
      life.isAlert = world.gauges.catastrophePct > world.feel.catastrophe.alertPct;
      life.isBreathHeld = world.sequence.stealth.breathHeldAt !== null;
      life.isMotionReduced = bodies.isMotionReduced();
      life.isResponding = world.papa.state === 'glide' || isResponseClip(papa.clipName);
      life.babyXM = babyPoint.xM;
      life.babyZM = babyPoint.zM;
      life.gazeSight.isBabyShown = pendingSight.isBabyShown;
      life.gazeSight.hasThreat = pendingSight.hasThreat;
      life.gazeSight.threatXM = pendingSight.threatXM;
      life.gazeSight.threatZM = pendingSight.threatZM;
      // The faces (D3-D8): the moments of the tracks, the lasting states of the world, the guard of the
      // signals every frame, and the debug overlay over all of it (D11). A lasting state that begins is dated
      // with the world's sim time, the clock of the events, never with the interpolated frame clock.
      const isGuarded = isSignalOnly(world);
      // Papa's acting (story 7.11): the same guard, the tiptoe, the seed and the step clock of his idles.
      life.isSignalOnly = isGuarded;
      life.isStealth = isStealthStepRunning(world as World);
      life.levelSeed = bodies.levelSeed;
      life.simMs = world.time.sim;
      // The loop of the chore he works at (story 7.12, D2): `working` while he is at it, nothing allocated.
      life.papaChoreClip = null;
      for (let i = 0; i < world.chores.length; i++) {
        if ((world.chores[i] as World['chores'][number]).state === 'working') {
          life.papaChoreClip = choreClips[i] ?? null;
        }
      }
      const papaFace = papaExpressionAt(
        papaFaceTrack,
        clockMs,
        world.time.sim,
        isPapaTired(world),
        isGuarded,
      );
      const babyFace = babyExpressionAt(
        babyFaceTrack,
        clockMs,
        world.time.sim,
        babyFocusOf(world),
        bodies.hasBedtimeCycle,
        isGuarded,
      );
      life.papaExpression = overlayPapaFace ?? papaFace;
      life.babyExpression = overlayBabyFace ?? babyFace;
      if (
        pendingPapaOneShot !== null &&
        ((world.papa.state !== 'glide' && !isResponseClip(papa.clipName)) || !isFlowLive(world))
      ) {
        papa.playOnce(
          pendingPapaOneShot,
          characters.fades.otherMs,
          PAPA_HELD_ONE_SHOTS.includes(pendingPapaOneShot),
        );
        pendingPapaOneShot = null;
      }
      // His sigh (story 7.12, D5): dropped when he went off since, the baby is in his arms, the guard begins, the
      // level ends, the finale waits, or another one-shot took the pose's place (a dance, a stumble); played once
      // his response pose has handed back, him idle or back at his chore's station (the answer to the pot sends
      // him there, not to idle).
      if (reliefArmedAt !== null) {
        const oneShot = papa.oneShotName;
        if (
          world.papa.enteredAt > reliefArmedAt ||
          world.baby.state === 'carried' ||
          isGuarded ||
          !isFlowLive(world) ||
          pendingPapaOneShot !== null ||
          (oneShot !== null && !isResponseClip(oneShot))
        ) {
          reliefArmedAt = null;
        } else if (
          (world.papa.state === 'idle' || world.papa.state === 'chore') &&
          oneShot === null
        ) {
          papa.playActing('sigh_relief', characters.fades.otherMs);
          reliefArmedAt = null;
        }
      }
      papa.animate(world.papa, world.baby, dtMs, life);
      baby.animate(world.baby, dtMs, life);
      applySquash(papaSquash, clockMs, setPapaSquash);
      applySquash(babySquash, clockMs, setBabySquash);
      props.sync(world.props, alpha);
      decals.sync(world.afterEffects.mischiefMarks, world.feel.fx.photoCamera);
      choreShards.sync(world.chores, world.feel.fx.photoCamera);
      // Papa's nap, coffee and call, from the world every frame (stories 1.19, 1.20; diegetic, no overlay).
      papa.setEyelids(eyelidsAmountAt(world, clockMs, bodies.microSleepDefId));
      papa.setAsleep(world.papa.state === 'asleep', clockMs);
      papa.setDrinking(world.papa.state === 'drink', clockMs, bodies.isMotionReduced());
      papa.setOnPhone(world.papa.state === 'onPhone', clockMs, bodies.isMotionReduced());
      // Out of the room, in the toilet (story 4.3): not him, not his shadow.
      papa.setAway(world.papa.state === 'onToilet');
      // The door, from the rush's start on the sim clock: a pause or a slow-mo holds it (story 3.5).
      door?.update(
        world.flow.finalRushAt,
        clockMs,
        bodies.isMotionReduced(),
        world.flow.endReason === 'mamaHome',
      );
      dangerTint.update(world, clockMs, bodies.isMotionReduced());
      waves.update(clockMs);
      shake.update(nowReal);
      particles.update(nowReal);
      fireworks.update(nowReal);
      const dimFeel = world.feel.fx.dim;
      const nextDimFactor = dim.update(
        world.afterEffects.dimUntil > 0,
        clockMs,
        dimFeel.lightsPct,
        dimFeel.fadeMs,
      );
      if (nextDimFactor !== dimLightsFactor) {
        dimLightsFactor = nextDimFactor;
        applyLights();
      }
      const isElectrified = world.papa.state === 'electrified';
      if (isElectrified !== isHairHeld) {
        isHairHeld = isElectrified;
        applyHair();
      }
      // The baby left at the bottom of the stairs stays there (story 3.15); found there with no gag seen,
      // he is put there at once, facing away from where he looks.
      gags.update(clockMs, world.baby.state === 'downstairs', -world.baby.gazeX, -world.baby.gazeZ);
      lift.update(clockMs);
    },
    startFireworks(settings, startAtReal, isMotionReduced, centreXM, centreZM) {
      const area = fireworkAreaOf(fireworkRoom, centreXM, centreZM, settings.areaHalfM);
      fireworks.start(settings, area, startAtReal, isMotionReduced);
    },
    get fireworksEndAtReal() {
      return fireworks.endsAtReal;
    },
    stopFireworks() {
      fireworks.reset();
    },
    setGrade(grade, weight, carried, carriedWeight) {
      // A null grade ignores its weight: a sequence with no grade moves the blend without any light to write.
      if (
        grade === gradeOf &&
        (grade === null || weight === gradeWeight) &&
        carried === carriedGradeOf &&
        (carried === null || carriedWeight === carriedGradeWeight)
      ) {
        return;
      }
      writeGrade(grade, weight, carried, carriedWeight);
    },
    resetFx() {
      dangerTint.reset();
      waves.reset();
      shake.reset();
      particles.reset();
      fireworks.reset();
      if (gradeOf !== null || carriedGradeOf !== null) writeGrade(null, 0, null, 0);
      gags.reset();
      decals.clear();
      choreShards.clear();
      dim.reset();
      dimLightsFactor = 1;
      flashLightsFactor = 1;
      isHairHeld = false;
      gagHairAmount = 0;
      overlayLook.hasMashOnCheek = false;
      overlayLook.hasHairOnEnd = false;
      overlayLook.isShirtInsideOut = false;
      applyLook();
      applyLights();
      lift.reset();
      lastClockMs = null;
      papaSquash.startAt = null;
      babySquash.startAt = null;
      pendingPapaOneShot = null;
      reliefArmedAt = null;
      lastLaughVariant = null;
      lastParryVariant = null;
      babyLids = 0;
      clearExpressions(papaFaceTrack);
      clearExpressions(babyFaceTrack);
      overlayPapaFace = null;
      overlayBabyFace = null;
      life.papaExpression = 'neutral';
      life.babyExpression = 'neutral';
      papa.resetAnimation();
      baby.resetAnimation();
      pendingSight.isBabyShown = false;
      pendingSight.hasThreat = false;
    },
    dispose() {
      // Skeletons first: `disposeObject` handles meshes only and would leave their bone textures (D11).
      papa.dispose();
      baby.dispose();
      props.dispose();
      decals.dispose();
      choreShards.dispose();
      waves.dispose();
      particles.dispose();
      fireworks.dispose();
      dangerTint.dispose();
      disposeObject(scene);
      // The templates are not in the scene any more: free their geometry too (the materials are the toon cache's).
      for (const node of propNodes) {
        node.traverse((child) => {
          if (child instanceof Mesh) child.geometry.dispose();
        });
      }
      toon.dispose();
      outlines.dispose();
      characterToon.dispose();
      characterOutlines.dispose();
      shadows.dispose();
      scene.clear();
    },
  };
}
