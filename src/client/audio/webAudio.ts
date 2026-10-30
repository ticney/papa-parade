// The slice of the Web Audio API the engine uses, as interfaces: Vitest runs in Node, where there
// is no Web Audio, so every module of `client/audio` takes its context as a parameter and the tests
// pass a fake. The real `AudioContext` satisfies `AudioContextLike`.

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTimeS: number): unknown;
  linearRampToValueAtTime(value: number, endTimeS: number): unknown;
  cancelScheduledValues(startTimeS: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  readonly frequency: AudioParamLike;
}

export interface AudioBufferLike {
  readonly duration: number;
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  readonly playbackRate: AudioParamLike;
  onended: ((event: never) => unknown) | null;
  start(whenS?: number): void;
  stop(whenS?: number): void;
}

/** `AudioContextState` plus `interrupted`, which Safari reports after a phone call. */
export type AudioContextStateName = 'suspended' | 'running' | 'closed' | 'interrupted';

export interface AudioContextLike {
  readonly state: AudioContextStateName;
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  readonly baseLatency?: number;
  createGain(): GainNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBufferSource(): BufferSourceLike;
  createBuffer(channelCount: number, length: number, sampleRateHz: number): AudioBufferLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  addEventListener(type: 'statechange', listener: () => void): void;
}

/** What `data-pp-audio` shows: `none` until the first gesture creates the context. */
export type AudioStateName = 'none' | AudioContextStateName;
