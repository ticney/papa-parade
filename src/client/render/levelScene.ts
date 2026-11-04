import { looksLikeGameplayNode, parseNodeName } from '@content/levelNodeNames';
import type { FeedbackTable } from '@content/schemas/feedback';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { PAPA_TARGET_ANCHOR_ID, STEP_MS } from '@shared/constants';
import { log } from '@shared/log';
import type { RealMs, SimMs } from '@shared/time';
import type { GagId, PropSlice, SimEvent, World } from '@sim';
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
import { addBlobShadows } from './blobShadow.ts';
import { createDimFx } from './dimFx.ts';
import { createGagFx } from './gags.ts';
import type { RoomSize } from './isoCamera.ts';
import { addOutlineHulls, createOutlineKit } from './materials/outlineHull.ts';
import { PALETTE } from './materials/palette.ts';
import { createToonMaterialCache, swapToToon } from './materials/toonMaterial.ts';
import { createDangerTint } from './vfx/dangerTint.ts';
import { createLiftFx } from './vfx/liftHop.ts';
import { createMischiefDecals } from './vfx/mischiefDecals.ts';
import { createParticles, type ParticleStyle } from './vfx/particles.ts';
import { createShake } from './vfx/shake.ts';
import { createSoundWaves } from './vfx/soundWaves.ts';
import { createBabyView, layDownProgressPct } from './views/babyView.ts';
import {
  babyLidsAfter,
  babyOneShotOf,
  papaOneShotOf,
  responseClipOf,
} from './views/characterClips.ts';
import { createCharacterRig } from './views/characterRig.ts';
import { createDoorView, type DoorLook, doorPlacementOf } from './views/doorView.ts';
import { createPapaView, type PapaLook, type PapaPose } from './views/papaView.ts';
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
  /** The ids of the level's threats aimed at an anchor: only they show the alert tint (story 7.3, D6). */
  anchorThreatDefIds: readonly string[];
  /** The height of the baby's centre once laid on the mattress, in metres (`feedback.json › bombDrop.laidHeightM`). */
  laidHeightM: number;
  /** How the characters move (`feedback.json › characters`). */
  characters: FeedbackTable['characters'];
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
  /** Papa's pose for a response he has arrived at (P3: the sound fired at the judgement). */
  playResponseClip(response: string, quality: string): void;
  /**
   * What a sim event plays on the characters: one-shots, the baby's lids and, unless `isMotionReduced`,
   * the squash. The clips stay under reduced motion: a pose carries state (story 7.2, D7).
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
    /** How far the carried baby was drawn lowered onto the mattress, 0 to 100 (story 4.8). */
    babyLayDownPct: number;
    /** The clip Papa is seen playing, or null. */
    papaClip: string | null;
    /** The clip the baby is seen playing, or null. */
    babyClip: string | null;
    /** Papa's mixer clock, in sim ms. */
    papaMixerMs: number;
    /** How far the door was drawn open, in degrees; 0 while it is shut (story 3.5). */
    doorOpenDeg: number;
    /** How many alert glows stand on the room's dangers (story 7.3). */
    dangerTintsShown: number;
    /** The factor the 3D lights are scaled by: the darker of the outlet's flash and the pénombre (story 3.15). */
    lightsFactor: number;
    /** How many mischief decals lie on the floor (story 3.15). */
    mischiefDecals: number;
  };
  /** Shows the parts of Papa's look. Nothing in a game sets it until story 3.7 (story 7.2, D2). */
  setPapaLook(look: Readonly<PapaLook>): void;
  /** Where Papa was last drawn (interpolated), for the markers that follow him. */
  readonly papaPose: Readonly<PapaPose>;
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

/**
 * The camera box of a level: its bounds, down to the lowest point below the floor (y = 0) if
 * something such as a stairwell goes there.
 */
export function roomOf(geometry: LevelGeometry): RoomSize {
  const [minX, minY, minZ] = geometry.boundsMinM;
  const [maxX, maxY, maxZ] = geometry.boundsMaxM;
  const floorYM = Math.min(0, minY);
  return {
    widthM: maxX - minX,
    depthM: maxZ - minZ,
    heightM: maxY - floorYM,
    floorYM,
    centerXM: (minX + maxX) / 2,
    centerZM: (minZ + maxZ) / 2,
  };
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
  const ambient = new AmbientLight(new Color(lights.ambientColor), lights.ambientIntensity);
  scene.add(ambient);
  const sun = new DirectionalLight(new Color(lights.sunColor), lights.sunIntensity);
  const [sunX, sunY, sunZ] = render.sunOffsetM;
  sun.position.set(centerX + sunX, sunY, centerZ + sunZ);
  sun.target.position.set(centerX, 0, centerZ);
  scene.add(sun, sun.target);

  const shadows = addBlobShadows(content, geometry.colliders, render.blobSkipColliderIds);
  // The mess a silence's mischief leaves, from `world.afterEffects.mischiefMarks` (story 3.15): the photo shows it too.
  const decals = createMischiefDecals(content, geometry.colliders, toon);

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

  const { crossFadeMs, turnRateDegPerSec, clipSpeeds, squash } = bodies.characters;
  const motion = { turnRateDegPerSec, clips: clipSpeeds };
  const papa = createPapaView(
    content,
    toon,
    shadows.kit,
    bodies.papaRadiusM,
    createCharacterRig(assets.characters.papa, toon, crossFadeMs, outlines),
    motion,
  );
  const baby = createBabyView(
    content,
    shadows.kit,
    bodies.babyRadiusM,
    createCharacterRig(assets.characters.baby, toon, crossFadeMs, outlines),
    motion,
    bodies.laidHeightM,
  );
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
  const applyLights = (): void => {
    const factor = Math.min(flashLightsFactor, dimLightsFactor);
    ambient.intensity = lights.ambientIntensity * factor;
    sun.intensity = lights.sunIntensity * factor;
  };
  // Papa's hair: the gag's snap, or on end for as long as he is electrified.
  let gagHairAmount = 0;
  let isHairHeld = false;
  const applyHair = (): void => papa.setHair(Math.max(gagHairAmount, isHairHeld ? 1 : 0));
  const gags = createGagFx({
    setLightsFactor: (factor) => {
      flashLightsFactor = factor;
      applyLights();
    },
    setHairAmount: (amount) => {
      gagHairAmount = amount;
      applyHair();
    },
    setBabySlide: (offsetXM, offsetZM, dropM) => baby.setSlideM(offsetXM, offsetZM, dropM),
  });
  const lift = createLiftFx((heightM) => baby.setLiftM(heightM));
  /** The lowering of the baby as last drawn (story 4.8), read by the debug `fx()`. */
  let drawnLayDownPct = 0;
  /** The clock of the last frame: the mixers advance by its difference alone (D6). */
  let lastClockMs: number | null = null;
  let babyLids = 0;
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
    playResponseClip(response, quality) {
      const clip = responseClipOf(response, quality);
      if (clip !== null) papa.playOnce(clip);
    },
    playCharacterEvent(event, world, isMotionReduced) {
      const papaClip = papaOneShotOf(event);
      // A gag during a glide plays as his squash alone: the glide's loop goes on (P3).
      if (papaClip !== null && world.papa.state !== 'glide') papa.playOnce(papaClip);
      const babyClip = babyOneShotOf(event);
      if (babyClip !== null) baby.playOnce(babyClip);
      babyLids = babyLidsAfter(event, babyLids);
      baby.setEyelids(babyLids);
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
    get papaPose() {
      return papa.pose;
    },
    realFxState() {
      return {
        shakeOffsetXM: shake.offsetM.x,
        shakeOffsetZM: shake.offsetM.z,
        particlesAlive: particles.aliveCount,
        babyLayDownPct: drawnLayDownPct,
        papaClip: papa.clipName,
        babyClip: baby.clipName,
        papaMixerMs: papa.mixerTimeMs,
        doorOpenDeg: door?.openAngleDeg ?? 0,
        dangerTintsShown: dangerTint.shownCount,
        lightsFactor: Math.min(flashLightsFactor, dimLightsFactor),
        mischiefDecals: decals.count,
      };
    },
    setPapaLook(look) {
      papa.setLook(look);
    },
    update(world, alpha, nowReal) {
      papa.update(world.papa, alpha);
      const clockMs = world.time.sim + alpha * STEP_MS;
      drawnLayDownPct = layDownPctAt(world, clockMs, bodies.layDownDefIds);
      baby.update(world.baby, alpha, world.papa, drawnLayDownPct);
      // The sim's clock drives the mixers: it stands still in a pause and a hitstop, slows in a slow-mo.
      // `alpha` can step back at a boundary, and a negative time would run a clip backwards (D6).
      const dtMs = lastClockMs === null ? 0 : Math.max(0, clockMs - lastClockMs);
      lastClockMs = clockMs;
      papa.animate(world.papa, world.baby, dtMs);
      baby.animate(world.baby, dtMs);
      applySquash(papaSquash, clockMs, setPapaSquash);
      applySquash(babySquash, clockMs, setBabySquash);
      props.sync(world.props, alpha);
      decals.sync(world.afterEffects.mischiefMarks);
      // Papa's nap, coffee and call, from the world every frame (stories 1.19, 1.20; diegetic, no overlay).
      papa.setEyelids(eyelidsAmountAt(world, clockMs, bodies.microSleepDefId));
      papa.setAsleep(world.papa.state === 'asleep', clockMs);
      papa.setDrinking(world.papa.state === 'drink');
      papa.setOnPhone(world.papa.state === 'onPhone');
      // Out of the room, in the toilet (story 4.3): not him, not his shadow.
      papa.setAway(world.papa.state === 'onToilet');
      // The door, from the rush's start on the sim clock: a pause or a slow-mo holds it (story 3.5).
      door?.update(world.flow.finalRushAt, clockMs, bodies.isMotionReduced());
      dangerTint.update(world, clockMs, bodies.isMotionReduced());
      waves.update(clockMs);
      shake.update(nowReal);
      particles.update(nowReal);
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
    resetFx() {
      dangerTint.reset();
      waves.reset();
      shake.reset();
      particles.reset();
      gags.reset();
      decals.clear();
      dim.reset();
      dimLightsFactor = 1;
      flashLightsFactor = 1;
      isHairHeld = false;
      gagHairAmount = 0;
      applyLights();
      lift.reset();
      lastClockMs = null;
      papaSquash.startAt = null;
      babySquash.startAt = null;
      babyLids = 0;
      papa.resetAnimation();
      baby.resetAnimation();
    },
    dispose() {
      // Skeletons first: `disposeObject` handles meshes only and would leave their bone textures (D11).
      papa.dispose();
      baby.dispose();
      props.dispose();
      decals.dispose();
      waves.dispose();
      particles.dispose();
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
      shadows.dispose();
      scene.clear();
    },
  };
}
