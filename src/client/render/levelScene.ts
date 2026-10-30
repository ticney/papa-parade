import { looksLikeGameplayNode, parseNodeName } from '@content/levelNodeNames';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { PAPA_TARGET_ANCHOR_ID, STEP_MS } from '@shared/constants';
import { log } from '@shared/log';
import type { RealMs, SimMs } from '@shared/time';
import type { GagId, PropSlice, World } from '@sim';
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  type Material,
  Mesh,
  type Object3D,
  Scene,
} from 'three';
import type { LevelAssets } from '../assets/loadLevelAssets.ts';
import { addBlobShadows } from './blobShadow.ts';
import { createGagFx } from './gags.ts';
import type { RoomSize } from './isoCamera.ts';
import { PALETTE } from './materials/palette.ts';
import { createToonMaterialCache } from './materials/toonMaterial.ts';
import { createLiftFx } from './vfx/liftHop.ts';
import { createParticles, type ParticleStyle } from './vfx/particles.ts';
import { createShake } from './vfx/shake.ts';
import { createSoundWaves } from './vfx/soundWaves.ts';
import { createBabyView } from './views/babyView.ts';
import { createPapaView, type PapaPose } from './views/papaView.ts';
import { createPropView, type PropView } from './views/propView.ts';
import { createViewPool, type ViewPool } from './views/viewPool.ts';
import { createViewRegistry } from './views/viewRegistry.ts';

// Art direction, not GDD numbers: Geo tunes the light here until the final art (E7).
const AMBIENT_INTENSITY = 0.9;
const SUN_INTENSITY = 1.3;
/** Where the sun sits relative to the room centre: the camera side, high, in metres. */
const SUN_OFFSET_M: readonly [number, number, number] = [5, 9, 7];
/** Half extents of the box drawn for a prop kind that has no model node and no prop in the geometry, in metres. */
const DEFAULT_PROP_HALF_EXTENTS_M: readonly [number, number, number] = [0.05, 0.05, 0.05];

/** The sizes of the agents the scene draws, in metres (the feel's, passed by the session). */
export interface SceneBodies {
  papaRadiusM: number;
  babyRadiusM: number;
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
  realFxState(): { shakeOffsetXM: number; shakeOffsetZM: number; particlesAlive: number };
  /** Where Papa was last drawn (interpolated), for the markers that follow him. */
  readonly papaPose: Readonly<PapaPose>;
  /**
   * Ends the effects under way (rings hidden, shake offset back to zero, lights back, hair down,
   * baby on the floor). Effects advance only
   * while the game loop runs; call it when the loop stops, so a frozen mid-effect frame is not what
   * `drawStatic` shows behind the loading or error screen.
   */
  resetFx(): void;
  /** Frees geometries, materials and textures. Call it when a new level replaces this one. */
  dispose(): void;
}

/**
 * How shut Papa's eyelids are, 0 to 1: while the micro-sleep (the threat that stands on him) is
 * announced they lower with the telegraph's progress, from its entry to the opening of the window,
 * and they stay shut while the window is open. Read from the world each frame (story 1.19), so a
 * pause or a slow-mo freezes it. Allocation-free.
 */
export function eyelidsAmountAt(world: Readonly<World>, clockMs: number): number {
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as World['threats'][number];
    if (threat.anchorId !== PAPA_TARGET_ANCHOR_ID) continue;
    if (threat.state === 'windowOpen') return 1;
    if (threat.state !== 'telegraph') return 0;
    const spanMs = threat.windowOpenAt - threat.enteredAt;
    if (!(spanMs > 0)) return 1;
    return Math.min(1, Math.max(0, (clockMs - threat.enteredAt) / spanMs));
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

function disposeMaterial(material: Material | Material[]): void {
  for (const one of Array.isArray(material) ? material : [material]) one.dispose();
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

function originalColor(material: Material | Material[]): Color {
  const one = Array.isArray(material) ? material[0] : material;
  const color = (one as { color?: unknown } | undefined)?.color;
  return color instanceof Color ? color : new Color(PALETTE.cream);
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
 * swapped for a shared toon one (keeping each mesh's colour), lights, blob shadows (no shadow map),
 * Papa, the baby and the props (pooled views, one pool per kind, made here so that nothing is
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

  const toon = createToonMaterialCache();
  model.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const original = node.material;
    node.material = toon.get(originalColor(original));
    disposeMaterial(original);
  });
  // The room, its shadows, Papa, the baby and the waves live under one root: a shake moves the
  // root, not the camera, so the framing and the world UI layer stay put. The lights stay outside.
  const content = new Group();
  content.name = 'content_root';
  scene.add(content);
  content.add(model);

  const room = roomOf(geometry);
  const centerX = room.centerXM ?? 0;
  const centerZ = room.centerZM ?? 0;
  const ambient = new AmbientLight(0xffffff, AMBIENT_INTENSITY);
  scene.add(ambient);
  const sun = new DirectionalLight(0xffffff, SUN_INTENSITY);
  sun.position.set(centerX + SUN_OFFSET_M[0], SUN_OFFSET_M[1], centerZ + SUN_OFFSET_M[2]);
  sun.target.position.set(centerX, 0, centerZ);
  scene.add(sun, sun.target);

  const shadows = addBlobShadows(content, geometry.colliders);

  // The props: the model's PROP_ nodes are templates, the views are pooled per kind.
  const { templates, taken: propNodes } = takePropNodes(model, geometry);
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

  const papa = createPapaView(content, toon, shadows.kit, bodies.papaRadiusM);
  const baby = createBabyView(content, toon, shadows.kit, bodies.babyRadiusM);
  const waves = createSoundWaves(content, PALETTE.ink);
  const shake = createShake(content);
  const particles = createParticles(content);
  // The gags move the lights (the room's lights are « the lamp » until E7), Papa's hair and the
  // baby's slide; the hop moves the baby too. Both on the sim clock.
  const gags = createGagFx({
    setLightsFactor: (factor) => {
      ambient.intensity = AMBIENT_INTENSITY * factor;
      sun.intensity = SUN_INTENSITY * factor;
    },
    setHairAmount: (amount) => papa.setHair(amount),
    setBabySlide: (offsetXM, offsetZM) => baby.setSlideM(offsetXM, offsetZM),
  });
  const lift = createLiftFx((heightM) => baby.setLiftM(heightM));
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
      };
    },
    update(world, alpha, nowReal) {
      papa.update(world.papa, alpha);
      baby.update(world.baby, alpha, world.papa);
      props.sync(world.props, alpha);
      const clockMs = world.time.sim + alpha * STEP_MS;
      // Papa's nap, coffee and call, from the world every frame (stories 1.19, 1.20; diegetic, no overlay).
      papa.setEyelids(eyelidsAmountAt(world, clockMs));
      papa.setAsleep(world.papa.state === 'asleep', clockMs);
      papa.setDrinking(world.papa.state === 'drink');
      papa.setOnPhone(world.papa.state === 'onPhone');
      waves.update(clockMs);
      shake.update(nowReal);
      particles.update(nowReal);
      gags.update(clockMs);
      lift.update(clockMs);
    },
    resetFx() {
      waves.reset();
      shake.reset();
      particles.reset();
      gags.reset();
      lift.reset();
    },
    dispose() {
      props.dispose();
      waves.dispose();
      particles.dispose();
      disposeObject(scene);
      // The templates are not in the scene any more: free their geometry too (the materials are the toon cache's).
      for (const node of propNodes) {
        node.traverse((child) => {
          if (child instanceof Mesh) child.geometry.dispose();
        });
      }
      toon.dispose();
      shadows.dispose();
      scene.clear();
    },
  };
}
