import { useEffect, useRef, useSyncExternalStore } from "react";
import { keyRegistry, type KeyBinding, type KeyHint, type KeyScope } from "./registry";

/** Registers a binding while the component is mounted. The latest handler is always used without re-registering. */
export const useKeyBinding = (binding: KeyBinding, enabled = true): void => {
  const handlerRef = useRef(binding.handler);
  handlerRef.current = binding.handler;
  const { id, key, scope, description, showInStatusBar, allowInInput } = binding;
  useEffect(() => {
    if (!enabled) return undefined;
    return keyRegistry.register({
      id,
      key,
      scope,
      description,
      showInStatusBar,
      allowInInput,
      handler: (event) => handlerRef.current(event),
    });
  }, [id, key, scope, description, showInStatusBar, allowInInput, enabled]);
};

/** Makes `scope` the active key scope while mounted (pages push their page scope, modals push "overlay"). */
export const useKeyScope = (scope: Exclude<KeyScope, "global">, enabled = true): void => {
  useEffect(() => (enabled ? keyRegistry.pushScope(scope) : undefined), [scope, enabled]);
};

export const useKeyHints = (): readonly KeyHint[] => useSyncExternalStore(keyRegistry.subscribe, keyRegistry.hints);

/** Installs the single document keydown listener. Mounted once by the app shell. */
export const useGlobalKeyListener = (): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      keyRegistry.dispatch(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
};
