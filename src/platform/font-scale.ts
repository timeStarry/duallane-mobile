import { useSyncExternalStore } from 'react';
import { Dimensions, NativeEventEmitter, NativeModules, Platform, useWindowDimensions } from 'react-native';
import { z } from 'zod';

const snapshotSchema = z.object({ fontScale: z.number().finite().positive(), revision: z.number().int().nonnegative().safe() });
interface FontScaleModule {
  getFontScale(): Promise<unknown>;
  addListener(event: string): void;
  removeListeners(count: number): void;
}
interface FontScaleStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): number;
}
const stores = new WeakMap<FontScaleModule, FontScaleStore>();
const noSubscribe = () => () => {};

function nativeModule(): FontScaleModule | undefined {
  const module: unknown = Platform.OS === 'android' ? NativeModules.DualLaneFontScale : undefined;
  if (typeof module !== 'object' || module === null || !('getFontScale' in module) || typeof module.getFontScale !== 'function'
    || !('addListener' in module) || typeof module.addListener !== 'function'
    || !('removeListeners' in module) || typeof module.removeListeners !== 'function') return undefined;
  return module as FontScaleModule;
}

function storeFor(module: FontScaleModule): FontScaleStore {
  const existing = stores.get(module);
  if (existing) return existing;
  let fontScale = Dimensions.get('window').fontScale, revision = -1, generation = 0;
  const listeners = new Set<() => void>();
  const emitter = new NativeEventEmitter(module);
  let subscription: ReturnType<typeof emitter.addListener> | undefined;
  const store: FontScaleStore = {
    getSnapshot: () => fontScale,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        const activeGeneration = ++generation;
        const receive = (value: unknown) => {
          if (activeGeneration !== generation || listeners.size === 0) return;
          const parsed = snapshotSchema.safeParse(value);
          if (!parsed.success || parsed.data.revision <= revision) return;
          revision = parsed.data.revision;
          if (fontScale === parsed.data.fontScale) return;
          fontScale = parsed.data.fontScale;
          listeners.forEach(notify => notify());
        };
        // Listen first: a configuration change may happen while the snapshot crosses the bridge.
        subscription = emitter.addListener('DualLaneFontScaleChanged', receive);
        void module.getFontScale().then(receive, () => {});
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          generation++;
          subscription?.remove();
          subscription = undefined;
        }
      };
    },
  };
  stores.set(module, store);
  return store;
}

export function useFontScale(): number {
  const fallback = useWindowDimensions().fontScale;
  const module = nativeModule();
  const store = module ? storeFor(module) : undefined;
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getSnapshot ?? (() => fallback));
}
