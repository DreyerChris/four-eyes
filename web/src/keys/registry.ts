export const KEY_SCOPES = ["global", "list", "review", "summary", "overlay"] as const;
export type KeyScope = (typeof KEY_SCOPES)[number];

export interface KeyBinding {
  readonly id: string;
  readonly key: string;
  readonly scope: KeyScope;
  readonly description: string;
  readonly handler: (event: KeyboardEvent) => void;
  readonly showInStatusBar?: boolean;
  readonly allowInInput?: boolean;
}

export interface KeyHint {
  readonly key: string;
  readonly description: string;
}

type Listener = () => void;

const MODIFIER_ORDER = ["ctrl", "meta", "alt", "shift"] as const;

/** Normalises "Ctrl+K", "shift+Enter", "?" etc. so registry keys and events compare equal. */
export const normalizeCombo = (combo: string): string => {
  const parts = combo.split("+").filter((part) => part !== "");
  const key = parts.length === 0 && combo.includes("+") ? "+" : (parts.pop() ?? "");
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  const prefix = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return [...prefix, key.length === 1 ? key : key.toLowerCase()].join("+");
};

/** Combo for a keyboard event. Shift is only included for named keys, since "?" or "G" already encode it. */
export const comboFromEvent = (event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string => {
  const named = event.key.length > 1;
  const modifiers = [
    event.ctrlKey ? "ctrl" : null,
    event.metaKey ? "meta" : null,
    event.altKey ? "alt" : null,
    named && event.shiftKey ? "shift" : null,
  ].filter((modifier): modifier is string => modifier !== null);
  return normalizeCombo([...modifiers, event.key].join("+"));
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};

export interface KeyRegistry {
  readonly register: (binding: KeyBinding) => () => void;
  readonly pushScope: (scope: Exclude<KeyScope, "global">) => () => void;
  readonly activeScopes: () => readonly KeyScope[];
  readonly hints: () => readonly KeyHint[];
  readonly dispatch: (event: KeyboardEvent) => boolean;
  readonly subscribe: (listener: Listener) => () => void;
}

/**
 * Bindings fire for the top-most pushed scope first, then for "global" unless the top scope is "overlay".
 * Two bindings with the same key in the same scope is a bug: the later one wins and a warning is logged.
 */
export const createKeyRegistry = (): KeyRegistry => {
  let bindings: readonly KeyBinding[] = [];
  let scopeStack: readonly { readonly token: symbol; readonly scope: KeyScope }[] = [];
  let hintCache: readonly KeyHint[] | null = null;
  const listeners = new Set<Listener>();

  const notify = (): void => {
    hintCache = null;
    listeners.forEach((listener) => listener());
  };

  const activeScopes = (): readonly KeyScope[] => {
    const top = scopeStack[scopeStack.length - 1]?.scope;
    if (top === undefined) return ["global"];
    return top === "overlay" ? ["overlay"] : [top, "global"];
  };

  const register = (binding: KeyBinding): (() => void) => {
    const combo = normalizeCombo(binding.key);
    const clash = bindings.find((b) => b.scope === binding.scope && normalizeCombo(b.key) === combo && b.id !== binding.id);
    if (clash) {
      console.warn(`[keys] "${binding.id}" and "${clash.id}" both bind "${combo}" in scope "${binding.scope}"`);
    }
    const entry: KeyBinding = { ...binding, key: combo };
    bindings = [...bindings.filter((b) => b.id !== binding.id), entry];
    notify();
    return () => {
      bindings = bindings.filter((b) => b !== entry);
      notify();
    };
  };

  const pushScope = (scope: Exclude<KeyScope, "global">): (() => void) => {
    const token = Symbol(scope);
    scopeStack = [...scopeStack, { token, scope }];
    notify();
    return () => {
      scopeStack = scopeStack.filter((entry) => entry.token !== token);
      notify();
    };
  };

  const findBinding = (combo: string): KeyBinding | undefined =>
    activeScopes()
      .map((scope) => bindings.filter((b) => b.scope === scope && b.key === combo).at(-1))
      .find((binding): binding is KeyBinding => binding !== undefined);

  const dispatch = (event: KeyboardEvent): boolean => {
    if (event.defaultPrevented || event.isComposing) return false;
    const binding = findBinding(comboFromEvent(event));
    if (!binding) return false;
    if (isEditableTarget(event.target) && !binding.allowInInput) return false;
    event.preventDefault();
    binding.handler(event);
    return true;
  };

  const hints = (): readonly KeyHint[] => {
    if (hintCache) return hintCache;
    const seen = new Set<string>();
    hintCache = activeScopes()
      .flatMap((scope) => bindings.filter((b) => b.scope === scope && b.showInStatusBar !== false))
      .filter((b) => (seen.has(b.key) ? false : (seen.add(b.key), true)))
      .map((b) => ({ key: b.key, description: b.description }));
    return hintCache;
  };

  const subscribe = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { register, pushScope, activeScopes, hints, dispatch, subscribe };
};

/** The app-wide registry. Features register through the hooks in ./hooks. */
export const keyRegistry: KeyRegistry = createKeyRegistry();
