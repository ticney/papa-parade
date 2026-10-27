import type {
  AudioBufferLike,
  AudioContextLike,
  AudioContextStateName,
  AudioNodeLike,
  AudioParamLike,
  BufferSourceLike,
  GainNodeLike,
} from '../../src/client/audio/webAudio.ts';

// A Web Audio context for Node tests: it records what the engine builds and does, and can be made
// to throw or reject on demand. It is a test double, not a model of the audio clock: time is
// whatever the test sets `currentTime` to.

export interface FakeParam extends AudioParamLike {
  /** `setValueAtTime` and `linearRampToValueAtTime` calls, in order. */
  readonly events: { kind: 'set' | 'ramp' | 'cancel'; value: number; timeS: number }[];
}

export interface FakeNode extends AudioNodeLike {
  connections: AudioNodeLike[];
  isDisconnected: boolean;
}

export interface FakeGain extends GainNodeLike, FakeNode {
  readonly gain: FakeParam;
}

export interface FakeSource extends BufferSourceLike, FakeNode {
  readonly startCalls: (number | undefined)[];
  readonly stopCalls: (number | undefined)[];
}

export interface FakeAudioContext extends AudioContextLike {
  state: AudioContextStateName;
  currentTime: number;
  readonly gains: FakeGain[];
  readonly sources: FakeSource[];
  readonly buffers: { channelCount: number; length: number; sampleRateHz: number }[];
  readonly decoded: ArrayBuffer[];
  readonly calls: string[];
  /** Each of these, set to an error, makes the method throw (`createGain`...) or reject (`resume`...). */
  failures: Partial<
    Record<
      | 'createGain'
      | 'createBufferSource'
      | 'createBuffer'
      | 'decode'
      | 'resume'
      | 'suspend'
      | 'start',
      Error
    >
  >;
  /** Fires the `statechange` listeners after setting the state, as a browser does. */
  setState(state: AudioContextStateName): void;
}

function createParam(initial = 1): FakeParam {
  const events: FakeParam['events'] = [];
  return {
    value: initial,
    events,
    setValueAtTime(value, timeS) {
      events.push({ kind: 'set', value, timeS });
    },
    linearRampToValueAtTime(value, timeS) {
      events.push({ kind: 'ramp', value, timeS });
    },
    cancelScheduledValues(timeS) {
      events.push({ kind: 'cancel', value: 0, timeS });
    },
  };
}

/** Gives `target` the recording `connect` and `disconnect` of a node. */
function withNode<T extends object>(target: T): T & FakeNode {
  const node = target as T & FakeNode;
  node.connections = [];
  node.isDisconnected = false;
  node.connect = (destination) => {
    node.connections.push(destination);
  };
  node.disconnect = () => {
    node.isDisconnected = true;
  };
  return node;
}

/** A decoded buffer reports `byteLength / 1000` as its duration, in s. */
export function createFakeAudioContext(
  options: { state?: AudioContextStateName; baseLatency?: number } = {},
): FakeAudioContext {
  const listeners: (() => void)[] = [];
  const context: FakeAudioContext = {
    state: options.state ?? 'suspended',
    currentTime: 0,
    baseLatency: options.baseLatency ?? 0.01,
    destination: withNode({}),
    gains: [],
    sources: [],
    buffers: [],
    decoded: [],
    calls: [],
    failures: {},
    createGain() {
      context.calls.push('createGain');
      if (context.failures.createGain !== undefined) throw context.failures.createGain;
      const gain = withNode({ gain: createParam() }) as FakeGain;
      context.gains.push(gain);
      return gain;
    },
    createBufferSource() {
      context.calls.push('createBufferSource');
      if (context.failures.createBufferSource !== undefined) {
        throw context.failures.createBufferSource;
      }
      const source = withNode({
        buffer: null,
        loop: false,
        onended: null,
        startCalls: [] as (number | undefined)[],
        stopCalls: [] as (number | undefined)[],
        start(whenS?: number) {
          if (context.failures.start !== undefined) throw context.failures.start;
          source.startCalls.push(whenS);
        },
        stop(whenS?: number) {
          source.stopCalls.push(whenS);
        },
      }) as FakeSource;
      context.sources.push(source);
      return source;
    },
    createBuffer(channelCount, length, sampleRateHz) {
      context.calls.push('createBuffer');
      if (context.failures.createBuffer !== undefined) throw context.failures.createBuffer;
      context.buffers.push({ channelCount, length, sampleRateHz });
      return { duration: length / sampleRateHz };
    },
    decodeAudioData(data) {
      context.calls.push('decodeAudioData');
      context.decoded.push(data);
      if (context.failures.decode !== undefined) return Promise.reject(context.failures.decode);
      const buffer: AudioBufferLike = { duration: data.byteLength / 1000 };
      return Promise.resolve(buffer);
    },
    resume() {
      context.calls.push('resume');
      if (context.failures.resume !== undefined) return Promise.reject(context.failures.resume);
      context.setState('running');
      return Promise.resolve();
    },
    suspend() {
      context.calls.push('suspend');
      if (context.failures.suspend !== undefined) return Promise.reject(context.failures.suspend);
      context.setState('suspended');
      return Promise.resolve();
    },
    addEventListener(_type, listener) {
      listeners.push(listener);
    },
    setState(state) {
      if (context.state === state) return;
      context.state = state;
      for (const listener of listeners) listener();
    },
  };
  return context;
}
