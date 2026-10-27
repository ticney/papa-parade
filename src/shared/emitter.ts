/**
 * A tiny typed event bus. `Events` maps an event name to its payload type. It is client-only: the
 * sim never imports it (it emits `SimEvent`s into an array).
 */
export interface Emitter<Events extends object> {
  /** Subscribes `listener`; returns the function that unsubscribes it (safe to call twice). */
  on<K extends keyof Events>(type: K, listener: (payload: Events[K]) => void): () => void;
  /**
   * Calls the listeners of `type` in subscription order. A listener unsubscribed during the emit,
   * before its turn, is skipped; one subscribed during the emit waits for the next.
   */
  emit<K extends keyof Events>(type: K, payload: Events[K]): void;
}

interface Subscription {
  readonly listener: (payload: never) => void;
  active: boolean;
}

export function createEmitter<Events extends object>(): Emitter<Events> {
  // Copy-on-write lists: `emit` walks the list it started with, so changes made by a listener
  // during the walk cannot corrupt it, and `emit` itself allocates nothing.
  const subscriptions = new Map<keyof Events, readonly Subscription[]>();

  return {
    on(type, listener) {
      const subscription: Subscription = {
        listener: listener as (payload: never) => void,
        active: true,
      };
      subscriptions.set(type, [...(subscriptions.get(type) ?? []), subscription]);
      return () => {
        if (!subscription.active) return;
        subscription.active = false;
        const remaining = (subscriptions.get(type) ?? []).filter((other) => other !== subscription);
        subscriptions.set(type, remaining);
      };
    },
    emit(type, payload) {
      const list = subscriptions.get(type);
      if (list === undefined) return;
      for (let i = 0; i < list.length; i++) {
        const subscription = list[i] as Subscription;
        if (subscription.active) subscription.listener(payload as never);
      }
    },
  };
}
