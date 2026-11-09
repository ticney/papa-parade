import { log } from '@shared/log';
import {
  type AnimationAction,
  AnimationMixer,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  type Object3D,
  type Quaternion,
  SkinnedMesh,
} from 'three';
import type { CharacterAsset } from '../../assets/gltf.ts';
import { addOutlineHulls, type OutlineKit } from '../materials/outlineHull.ts';
import { swapToToon, type ToonMaterialCache } from '../materials/toonMaterial.ts';
import { smoothstep } from './characterFades.ts';

/** The scale of the `eyelids` bone with the lids fully open: nothing, without a degenerate matrix. Both views write it. */
export const EYELIDS_OPEN_SCALE = 0.02;

/** A clip of the mixer with its weight. Made up front: nothing is allocated per frame. */
interface ClipTrack {
  readonly name: string;
  readonly action: AnimationAction;
  weight: number;
  isLive: boolean;
}

/**
 * A bone the life layer writes over the clips (story 7.8, D3), with the pose it goes back to before the
 * mixer: the last the clips gave it, which is its rest until a clip keys it.
 */
interface LifeBone {
  readonly bone: Object3D;
  readonly base: Quaternion;
}

/**
 * One character's mesh, skeleton and clips (story 7.2). Its one `AnimationMixer` moves only when
 * `update` is told a time (D6), and clips are told what to play by the view each frame, so nothing
 * here reads the sim, real time or a clock. Allocates nothing once the clips have played once.
 */
export interface CharacterRig {
  /** The file's scene: the view adds it under the group it moves. */
  readonly root: Object3D;
  /** The named bone or node of the file. A name the file lacks is one `warn` and a detached stand-in. */
  node(name: string): Object3D;
  /**
   * The looping clip the character's state says now, at `timeScale`. A new loop fades in over `fadeMs`
   * (story 7.8: the view says which passage it is), or waits for a one-shot to end. The same loop goes on.
   */
  play(clip: string, timeScale: number, fadeMs: number): void;
  /**
   * Plays a clip once, over the loop, fading in over `fadeMs`. The same clip running goes on. With
   * `holdsLastPose` it never hands back to the loop: it stays on its last frame until the next one-shot
   * or `reset` (Papa's collapse, story 7.4).
   */
  playOnce(clip: string, fadeMs: number, holdsLastPose?: boolean): void;
  /**
   * Drops the one-shot under way, held or not, and fades the loop in from this call over `fadeMs` (story
   * 7.11, D11): `clipName` is the loop at once. With no one-shot under way, nothing changes.
   */
  cutOnce(fadeMs: number): void;
  /** The one-shot under way, or null (story 7.11): what an acting one-shot checks it still is. */
  readonly oneShotName: string | null;
  /**
   * Takes the life layer's offsets back off its bones, then advances the mixer by `dtMs` of sim time (0 holds the
   * pose: a pause, a hitstop). A one-shot hands back to the loop `returnFadeMs` before its end, and fades
   * out over that long. The view multiplies its life offsets onto the bones after this (D3).
   */
  update(dtMs: number, returnFadeMs: number): void;
  /** The clip the player sees: the one-shot, else the loop, else null. */
  readonly clipName: string | null;
  /** Whether the mixer is running this clip, weighted or fading: a clip no longer needed costs nothing. */
  isClipRunning(clip: string): boolean;
  /** The weight the mixer gives `clip` now, 0 to 1 (the debug and the tests). */
  weightOf(clip: string): number;
  /** The mixer's own clock, in ms: it stands still with the sim's. */
  readonly mixerTimeMs: number;
  /** Stops every clip and sets the mixer's clock to 0 (a restart, a stopped loop). */
  reset(): void;
  /** Frees the mixer's caches, each skeleton's bone texture and the geometries (D11). The materials are the toon cache's. */
  dispose(): void;
}

/**
 * Takes `asset` over: gives its meshes an ink hull (story 7.3; first, the swap loses the material
 * names), swaps its materials for toon ones by colour (the characters' own cache, story 7.8: the scene's
 * swap walks the room only), never culls its skinned meshes (three's bounds are the rest pose's, and a
 * clip can leave them, D12), and makes one action per clip up front. `lifeBones` are the bones the life
 * layer writes over the clips (story 7.8, D3): they go back each frame to what the clips gave them.
 */
export function createCharacterRig(
  asset: CharacterAsset,
  toon: ToonMaterialCache,
  outlines: OutlineKit,
  lifeBones: readonly string[] = [],
): CharacterRig {
  const root = asset.scene;
  addOutlineHulls(root, outlines);
  const skinned: SkinnedMesh[] = [];
  root.traverse((node) => {
    if (!(node instanceof Mesh) || outlines.isHull(node.material)) return;
    swapToToon(node, toon);
    if (node instanceof SkinnedMesh) {
      node.frustumCulled = false;
      skinned.push(node);
    }
  });
  const mixer = new AnimationMixer(root);
  const tracks = new Map<string, ClipTrack>();
  for (const clip of asset.animations) {
    tracks.set(clip.name, {
      name: clip.name,
      action: mixer.clipAction(clip),
      weight: 0,
      isLive: false,
    });
  }
  /** The tracks with a weight or on their way to one: the only ones the mixer runs. */
  const live: ClipTrack[] = [];
  /** The one clip fading in: every other live track gives way to it. */
  let incoming: ClipTrack | null = null;
  /** The incoming clip's linear progress, 0 to 1: its weight is the eased progress. */
  let incomingProgress = 1;
  let incomingFadeMs = 0;
  let loop: ClipTrack | null = null;
  let oneShot: ClipTrack | null = null;
  // The one-shot under way stays on its last frame (story 7.4): no hand-back to the loop.
  let isOneShotHeld = false;
  const warned = new Set<string>();

  const warnOnce = (message: string, name: string): void => {
    if (warned.has(name)) return;
    warned.add(name);
    log.warn('render', message, { name });
  };

  const nodeOf = (name: string): Object3D => {
    const found = root.getObjectByName(name);
    if (found !== undefined) return found;
    warnOnce('a character has no such node: nothing will show it', name);
    return new Group();
  };

  const life: LifeBone[] = lifeBones.map((name) => {
    const bone = nodeOf(name);
    return { bone, base: bone.quaternion.clone() };
  });
  /**
   * Takes the life offsets back off (D3): each life bone gets the pose the clips last gave it. A bone no
   * running clip keys keeps what it was given, so an offset multiplied every frame would pile up; and
   * three's mixer writes a bone only when its value changed (`PropertyMixer.apply`), so a held clip or a
   * frozen clock would leave the bone at the rest if this put the rest back. Also before any `play()`,
   * where three saves a bone's « original » value when a clip binds it first: not last frame's offset.
   */
  const restoreLifeBones = (): void => {
    for (let i = 0; i < life.length; i++) {
      const one = life[i] as LifeBone;
      one.bone.quaternion.copy(one.base);
    }
  };
  /** Records what the clips gave each life bone, before the view multiplies its offsets on. */
  const captureLifeBones = (): void => {
    for (let i = 0; i < life.length; i++) {
      const one = life[i] as LifeBone;
      one.base.copy(one.bone.quaternion);
    }
  };

  const trackOf = (name: string): ClipTrack | null => {
    const track = tracks.get(name);
    if (track === undefined) warnOnce('a character has no such clip: nothing plays', name);
    return track ?? null;
  };

  /** The progress whose eased value is `weight`: the inverse of `smoothstep`, so a clip coming back goes on from where it is. */
  const progressOfWeight = (weight: number): number => {
    if (weight <= 0) return 0;
    if (weight >= 1) return 1;
    return 0.5 - Math.sin(Math.asin(1 - 2 * weight) / 3);
  };

  /** Makes `track` the one clip fading in over `fadeMs`, and every other live one give way. The very first plays at once. */
  const fadeTo = (track: ClipTrack, fadeMs: number): void => {
    const isFirst = live.length === 0;
    incoming = track;
    incomingFadeMs = fadeMs;
    if (!track.isLive) {
      restoreLifeBones();
      track.isLive = true;
      track.weight = isFirst ? 1 : 0;
      track.action.reset();
      track.action.setEffectiveWeight(track.weight);
      track.action.play();
      live.push(track);
    }
    incomingProgress = progressOfWeight(track.weight);
  };

  /**
   * The incoming clip's progress gains `dtMs / fadeMs` and its weight is the eased progress (story 7.8);
   * the others share what is left in the proportions they had, so the weights always add up to 1. A
   * fade cut short by a third clip must not leave less: three fills the missing share from the bind
   * pose, and the character dips toward it. A fade of 0 is a cut.
   */
  const stepWeights = (dtMs: number): void => {
    if (incoming === null) return;
    if (incomingFadeMs > 0) {
      if (!(dtMs > 0)) return;
      incomingProgress = Math.min(1, incomingProgress + dtMs / incomingFadeMs);
    } else {
      incomingProgress = 1;
    }
    incoming.weight = smoothstep(incomingProgress);
    incoming.action.setEffectiveWeight(incoming.weight);
    let othersWeight = 0;
    for (let i = 0; i < live.length; i++) {
      const track = live[i] as ClipTrack;
      if (track !== incoming) othersWeight += track.weight;
    }
    const share = 1 - incoming.weight;
    for (let i = live.length - 1; i >= 0; i--) {
      const track = live[i] as ClipTrack;
      if (track === incoming) continue;
      track.weight = othersWeight > 0 ? (track.weight * share) / othersWeight : 0;
      if (track.weight > 0) {
        track.action.setEffectiveWeight(track.weight);
        continue;
      }
      track.action.stop();
      track.isLive = false;
      live[i] = live[live.length - 1] as ClipTrack;
      live.pop();
    }
  };

  return {
    root,
    node: nodeOf,
    play(clip, timeScale, fadeMs) {
      if (loop === null || loop.name !== clip) {
        const track = trackOf(clip);
        if (track === null) return;
        loop = track;
        track.action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY);
        track.action.clampWhenFinished = false;
        if (oneShot === null) fadeTo(track, fadeMs);
      }
      loop.action.timeScale = timeScale;
    },
    playOnce(clip, fadeMs, holdsLastPose = false) {
      if (oneShot?.name === clip) return;
      const track = trackOf(clip);
      if (track === null) return;
      oneShot = track;
      isOneShotHeld = holdsLastPose;
      track.action.setLoop(LoopOnce, 1);
      track.action.clampWhenFinished = true;
      track.action.timeScale = 1;
      // A clip still fading out from before starts over, not where it stood.
      if (track.isLive) track.action.reset();
      fadeTo(track, fadeMs);
    },
    cutOnce(fadeMs) {
      if (oneShot === null) return;
      oneShot = null;
      isOneShotHeld = false;
      // The one-shot gives way as any track does: the loop is the one clip fading in from now.
      if (loop !== null) fadeTo(loop, fadeMs);
    },
    get oneShotName() {
      return oneShot?.name ?? null;
    },
    update(dtMs, returnFadeMs) {
      restoreLifeBones();
      stepWeights(dtMs);
      mixer.update(dtMs / 1000);
      captureLifeBones();
      if (oneShot !== null && !isOneShotHeld) {
        const durationS = oneShot.action.getClip().duration;
        const leftS = durationS - oneShot.action.time;
        // Never more than half the clip: a hot `returnMs` must not hand a short one-shot back at its
        // first update, before it was ever seen (the schema allows up to 200 ms).
        const handBackMs = Math.min(returnFadeMs, (durationS * 1000) / 2);
        if (leftS * 1000 <= handBackMs) {
          oneShot = null;
          if (loop !== null) fadeTo(loop, handBackMs);
        }
      }
    },
    get clipName() {
      return oneShot?.name ?? loop?.name ?? null;
    },
    isClipRunning(clip) {
      return tracks.get(clip)?.isLive === true;
    },
    weightOf(clip) {
      const track = tracks.get(clip);
      return track?.isLive === true ? track.weight : 0;
    },
    get mixerTimeMs() {
      return mixer.time * 1000;
    },
    reset() {
      // The offsets off first; then `stopAllAction` gives each bone a clip bound its original back.
      restoreLifeBones();
      mixer.stopAllAction();
      for (const track of live) {
        track.isLive = false;
        track.weight = 0;
      }
      live.length = 0;
      incoming = null;
      incomingProgress = 1;
      incomingFadeMs = 0;
      loop = null;
      oneShot = null;
      isOneShotHeld = false;
      mixer.setTime(0);
      captureLifeBones();
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      for (const mesh of skinned) mesh.skeleton.dispose();
      root.traverse((node) => {
        if (node instanceof Mesh) node.geometry.dispose();
      });
      root.removeFromParent();
    },
  };
}
