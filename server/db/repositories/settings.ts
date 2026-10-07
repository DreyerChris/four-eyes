import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from "@shared/domain";
import type { UpdateSettingsRequest } from "@shared/api";
import { settings } from "../schema";
import type { DbExecutor } from "../types";

const parseStoredValue = (key: string, value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Corrupt settings value for "${key}": ${error instanceof Error ? error.message : String(error)}`);
  }
};

/** Stored settings merged over the defaults. Unknown or invalid stored keys fall back to defaults. */
export const getSettings = (db: DbExecutor): Settings => {
  const stored = Object.fromEntries(
    db
      .select()
      .from(settings)
      .all()
      .map((row) => [row.key, parseStoredValue(row.key, row.value)]),
  );
  const storedModels = typeof stored.models === "object" && stored.models !== null ? stored.models : {};
  const merged = { ...DEFAULT_SETTINGS, ...stored, models: { ...DEFAULT_SETTINGS.models, ...storedModels } };
  const parsed = SettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
};

export const updateSettings = (db: DbExecutor, patch: UpdateSettingsRequest): Settings => {
  const current = getSettings(db);
  const next = SettingsSchema.parse({
    ...current,
    ...patch,
    models: { ...current.models, ...(patch.models ?? {}) },
  });
  Object.entries(next).forEach(([key, value]) => {
    const serialized = JSON.stringify(value);
    db.insert(settings).values({ key, value: serialized }).onConflictDoUpdate({ target: settings.key, set: { value: serialized } }).run();
  });
  return next;
};
