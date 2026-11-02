import { log } from '@shared/log';
import {
  type AnimationAction,
  AnimationMixer,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  type Object3D,
  SkinnedMesh,
} from 'three';
import type { CharacterAsset } from '../../assets/gltf.ts';
import { addOutlineHulls, type OutlineKit } from '../materials/outlineHull.ts';
import { swapToToon, type ToonMaterialCache } from '../materials/toonMaterial.ts';

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
 * One character's mesh, skeleton and clips (story 7.2). Its one `AnimationMixer` moves only when
 * `update` is told a time (D6), and clips are told what to play by the view each frame, so nothing
 * here reads the sim, real time or a clock. Allocates nothing once the clips have played once.
 */
export interface CharacterRig {
  /** The file's scene: the view adds it under the group it moves. */
  readonly root: Object3D;
  /** The named bone or node of the file. A name the file lacks is one `warn` and a detached stand-in. */
  node(name: string): Object3D;
  /** The looping clip the character's state says now, at `timeScale`. It fades in, or waits for a one-shot to end. */
  play(clip: string, timeScale?: number): void;
  /** Plays a clip once, over the loop, and fades back to whatever `play` says by then (D5). The same clip running goes on. */
  playOnce(clip: string): void;
  /** Advances the mixer by `dtMs` of sim time; 0 holds the pose (a pause, a hitstop). */
  update(dtMs: number): void;
  /** The clip the player sees: the one-shot, else the loop, else null. */
  readonly clipName: string | null;
  /** Whether the mixer is running this clip, weighted or fading: a clip no longer needed costs nothing. */
  isClipRunning(clip: string): boolean;
  /** The mixer's own clock, in ms: it stands still with the sim's. */
  readonly mixerTimeMs: number;
  /** Stops every clip and sets the mixer's clock to 0 (a restart, a stopped loop). */
  reset(): void;
  /** Frees the mixer's caches, each skeleton's bone texture and the geometries (D11). The materials are the toon cache's. */
  dispose(): void;
}

/**
 * Takes `asset` over: gives its meshes an ink hull (story 7.3; first, the swap loses the material
 * names), swaps its materials for shared toon ones by colour (the scene's swap walks the room only),
 * never culls its skinned meshes (three's bounds are the rest pose's, and a clip can leave them, D12),
 * and makes one action per clip up front. `crossFadeMs` is the feedback table's.
 */
export function createCharacterRig(
  asset: CharacterAsset,
  toon: ToonMaterialCache,
  crossFadeMs: number,
  outlines: OutlineKit,
): CharacterRig {
  const root = asset.scene;
  addOutlineHulls(root, outlines);
  const skinned: SkinnedMesh[] = [];
  root.traverse((node) => {
    if (!(node instanceof Mesh) || node.material === outlines.material) return;
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
  let loop: ClipTrack | null = null;
  let oneShot: ClipTrack | null = null;
  const warned = new Set<string>();

  const warnOnce = (message: string, name: string): void => {
    if (warned.has(name)) return;
    warned.add(name);
    log.warn('render', message, { name });
  };

  const trackOf = (name: string): ClipTrack | null => {
    const track = tracks.get(name);
    if (track === undefined) warnOnce('a character has no such clip: nothing plays', name);
    return track ?? null;
  };

  /** Makes `track` the one clip fading in, and every other live one give way. The very first plays at once. */
  const fadeTo = (track: ClipTrack): void => {
    const isFirst = live.length === 0;
    incoming = track;
    if (!track.isLive) {
      track.isLive = true;
      track.weight = isFirst ? 1 : 0;
      track.action.reset();
      track.action.setEffectiveWeight(track.weight);
      track.action.play();
      live.push(track);
    }
  };

  /**
   * The incoming clip gains `dtMs / crossFadeMs`; the others share what is left in the proportions
   * they had, so the weights always add up to 1. A fade cut short by a third clip must not leave
   * less: three fills the missing share from the bind pose, and the character dips toward it.
   */
  const stepWeights = (dtMs: number): void => {
    if (incoming === null || !(dtMs > 0)) return;
    incoming.weight = Math.min(1, incoming.weight + dtMs / crossFadeMs);
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
    node(name) {
      const found = root.getObjectByName(name);
      if (found !== undefined) return found;
      warnOnce('a character has no such node: nothing will show it', name);
      return new Group();
    },
    play(clip, timeScale = 1) {
      if (loop === null || loop.name !== clip) {
        const track = trackOf(clip);
        if (track === null) return;
        loop = track;
        track.action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY);
        track.action.clampWhenFinished = false;
        if (oneShot === null) fadeTo(track);
      }
      loop.action.timeScale = timeScale;
    },
    playOnce(clip) {
      if (oneShot?.name === clip) return;
      const track = trackOf(clip);
      if (track === null) return;
      oneShot = track;
      track.action.setLoop(LoopOnce, 1);
      track.action.clampWhenFinished = true;
      track.action.timeScale = 1;
      // A clip still fading out from before starts over, not where it stood.
      if (track.isLive) track.action.reset();
      fadeTo(track);
    },
    update(dtMs) {
      stepWeights(dtMs);
      mixer.update(dtMs / 1000);
      if (oneShot !== null) {
        const leftS = oneShot.action.getClip().duration - oneShot.action.time;
        if (leftS * 1000 <= crossFadeMs) {
          oneShot = null;
          if (loop !== null) fadeTo(loop);
        }
      }
    },
    get clipName() {
      return oneShot?.name ?? loop?.name ?? null;
    },
    isClipRunning(clip) {
      return tracks.get(clip)?.isLive === true;
    },
    get mixerTimeMs() {
      return mixer.time * 1000;
    },
    reset() {
      mixer.stopAllAction();
      for (const track of live) {
        track.isLive = false;
        track.weight = 0;
      }
      live.length = 0;
      incoming = null;
      loop = null;
      oneShot = null;
      mixer.setTime(0);
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
