import type { StepContext } from '../context.ts';
import type { ThreatInstance, World } from '../world.ts';

/**
 * Whether a threat is announced, open for a response or hidden (a silence not yet found): the states
 * that count against a wave's limit.
 */
export function isThreatActive(threat: ThreatInstance): boolean {
  return threat.state === 'hidden' || threat.state === 'telegraph' || threat.state === 'windowOpen';
}

/**
 * A wave is closed to new telegraphs (story 1.18 D7) when its time has come (`closesAtMs`, the end
 * of the wave minus its lull), or the director has moved on to a later wave, or the director is
 * still in this wave but its next telegraph is already due past the close (so the telegraph just
 * made was the last one). Pure: reads `World` and `ctx.level`, writes and emits nothing.
 */
export function isWaveClosed(world: World, ctx: StepContext, waveIndex: number): boolean {
  const wave = ctx.level.waves[waveIndex];
  if (wave === undefined) return false;
  const { director } = world;
  if (world.time.sim >= wave.closesAtMs) return true;
  if (director.waveIndex > waveIndex) return true;
  return director.waveIndex === waveIndex && director.nextAt >= wave.closesAtMs;
}

/**
 * Whether `threat`, which has just been answered well, is the last threat of its wave: its wave is
 * closed to new telegraphs and no other threat of that wave is still active. A threat no wave
 * planned (`waveIndex` -1, the micro-sleep of story 1.19) never is. If the director was held up
 * and nothing of the wave is active when it closes, the wave has no last threat, hence no
 * slow-mo: rare and harmless (D7). Pure, like {@link isWaveClosed}.
 */
export function isLastOfWave(world: World, ctx: StepContext, threat: ThreatInstance): boolean {
  const { waveIndex } = threat;
  if (waveIndex < 0) return false;
  const { threats } = world;
  for (let i = 0; i < threats.length; i++) {
    const other = threats[i] as ThreatInstance;
    if (other !== threat && other.waveIndex === waveIndex && isThreatActive(other)) return false;
  }
  return isWaveClosed(world, ctx, waveIndex);
}
