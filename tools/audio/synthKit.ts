// What the placeholder synths share (`makePlaceholderAudio.ts`, `cultSounds.ts`): the sample rate,
// the seed their noise starts from, the loudest peak, and the two helpers every synth needs.
// Pure arithmetic, no library; Node only, never imported by `src/`.

export const SAMPLE_RATE_HZ = 44_100;
/** Every noise generator seeds `createRng(SEED + n)` with its own `n`, so no two share a stream. */
export const SEED = 0x9a9a;
/** Loudest sample of a clip, as a share of full scale (-6 dBFS is 0.501). */
export const PEAK_LOUD = 0.45;

export const samplesOf = (ms: number): number => Math.round((ms / 1000) * SAMPLE_RATE_HZ);

/** Scales `samples` so that the loudest one is `peak`. */
export function normalize(samples: Float32Array, peak: number): void {
  let loudest = 0;
  for (const value of samples) loudest = Math.max(loudest, Math.abs(value));
  if (loudest === 0) return;
  const gain = peak / loudest;
  for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] as number) * gain;
}

/**
 * A two-pole resonator (a band-pass peak) at `frequencyHz` with quality `q` (bandwidth = f / q):
 * `y[n] = b0·x[n] − a1·y[n−1] − a2·y[n−2]`, `r = exp(−π·BW/fs)`, `a1 = −2r·cos(2πf/fs)`,
 * `a2 = r²`, `b0 = 1 − r`. Returns a new buffer; `input` is left alone.
 */
export function resonate(input: Float32Array, frequencyHz: number, q: number): Float32Array {
  const bandwidthHz = frequencyHz / q;
  const r = Math.exp((-Math.PI * bandwidthHz) / SAMPLE_RATE_HZ);
  const a1 = -2 * r * Math.cos((2 * Math.PI * frequencyHz) / SAMPLE_RATE_HZ);
  const a2 = r * r;
  const b0 = 1 - r;
  const out = new Float32Array(input.length);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const y = b0 * (input[i] as number) - a1 * y1 - a2 * y2;
    out[i] = y;
    y2 = y1;
    y1 = y;
  }
  return out;
}
