import { useId, useState, type FormEvent, type ReactElement } from "react";
import {
  MODEL_IDS,
  THEMES,
  VERBOSITIES,
  type ClaudeExecutableSource,
  type ModelSettings,
  type Settings,
  type Theme,
  type Verbosity,
} from "@shared/domain";
import { useClaudeExecutable, useSettings, useUpdateSettings } from "../../../api/queries";
import type { Route } from "../../../app/router";
import { flashStatus } from "../../../bus/context";
import { useAppEvent } from "../../../bus/events";
import { useKeyBinding } from "../../../keys/hooks";
import { Overlay } from "../overlay/Overlay";
import { closeOverlay, openOverlay, useIsOverlayOpen } from "../overlay/store";
import styles from "./SettingsPanel.module.css";

export interface SettingsPanelProps {
  readonly route: Route;
}

const MODEL_FIELDS: readonly { readonly key: keyof ModelSettings; readonly label: string }[] = [
  { key: "chunking", label: "Chunking model" },
  { key: "review", label: "Review model" },
  { key: "qa", label: "Q&A model" },
  { key: "qaOpus", label: "Q&A model when “ask Opus” is on" },
];

const SOURCE_LABELS: Readonly<Record<ClaudeExecutableSource, string>> = {
  settings: "from settings",
  env: "from FOUR_EYES_CLAUDE_PATH",
  path: "found on PATH",
};

const ClaudeExecutableStatusLine = ({ id }: { readonly id: string }): ReactElement => {
  const { data, error, isPending } = useClaudeExecutable();
  const text = isPending
    ? "Checking which claude will be used…"
    : error
      ? `Could not check the Claude binary: ${error.message}`
      : data?.ok
        ? `Using ${data.path} (${data.version}), ${SOURCE_LABELS[data.source]}`
        : data?.error ?? "";
  const failed = error !== null || data?.ok === false;
  return (
    <p id={id} aria-live="polite" className={failed ? styles.error : styles.hint}>
      {text}
    </p>
  );
};

const VERBOSITY_LABELS: Readonly<Record<Verbosity, string>> = {
  brief: "brief: a sentence or two",
  standard: "standard",
  detailed: "detailed: full explanations",
};

const THEME_LABELS: Readonly<Record<Theme, string>> = {
  dark: "dark",
  light: "light",
  "tokyo-night": "Tokyo Night",
  "catppuccin-mocha": "Catppuccin Mocha",
  "catppuccin-latte": "Catppuccin Latte (light)",
  dracula: "Dracula",
  gruvbox: "Gruvbox",
  nord: "Nord",
  "rose-pine": "Rosé Pine",
  synthwave: "Synthwave '84",
};

const isTheme = (value: string): value is Theme => (THEMES as readonly string[]).includes(value);
const isVerbosity = (value: string): value is Verbosity => (VERBOSITIES as readonly string[]).includes(value);

const SettingsForm = ({ settings }: { readonly settings: Settings }): ReactElement => {
  const baseId = useId();
  const update = useUpdateSettings();
  const [models, setModels] = useState<ModelSettings>(settings.models);
  const [inlineFindings, setInlineFindings] = useState(settings.inlineFindings);
  const [suggestPrs, setSuggestPrs] = useState(settings.suggestPrs);
  const [suggestOnlyReviewedRepos, setSuggestOnlyReviewedRepos] = useState(settings.suggestOnlyReviewedRepos);
  const [theme, setTheme] = useState<Theme>(settings.theme);
  const [verbosity, setVerbosity] = useState<Verbosity>(settings.verbosity);
  const [claudePath, setClaudePath] = useState(settings.claudePath ?? "");
  const blankModel = MODEL_FIELDS.find((field) => models[field.key].trim() === "");

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (blankModel) return;
    const trimmed: ModelSettings = {
      chunking: models.chunking.trim(),
      review: models.review.trim(),
      qa: models.qa.trim(),
      qaOpus: models.qaOpus.trim(),
    };
    update.mutate(
      { models: trimmed, inlineFindings, suggestPrs, suggestOnlyReviewedRepos, theme, verbosity, claudePath: claudePath.trim() === "" ? null : claudePath.trim() },
      {
        onSuccess: () => {
          flashStatus("Settings saved");
          closeOverlay("settings");
        },
      },
    );
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <fieldset className={styles.fieldset}>
        <legend>Models</legend>
        <datalist id={`${baseId}-models`}>
          {Object.values(MODEL_IDS).map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        {MODEL_FIELDS.map((field) => (
          <div key={field.key} className={styles.row}>
            <label htmlFor={`${baseId}-${field.key}`}>{field.label}</label>
            <input
              id={`${baseId}-${field.key}`}
              list={`${baseId}-models`}
              value={models[field.key]}
              onChange={(event) => setModels((previous) => ({ ...previous, [field.key]: event.target.value }))}
              aria-invalid={models[field.key].trim() === ""}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        ))}
      </fieldset>
      <fieldset className={styles.fieldset}>
        <legend>Claude Code</legend>
        <div className={styles.row}>
          <label htmlFor={`${baseId}-claude-path`}>Claude executable</label>
          <input
            id={`${baseId}-claude-path`}
            value={claudePath}
            onChange={(event) => setClaudePath(event.target.value)}
            placeholder="automatic: claude on PATH"
            aria-describedby={`${baseId}-claude-status`}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <ClaudeExecutableStatusLine id={`${baseId}-claude-status`} />
      </fieldset>
      <fieldset className={styles.fieldset}>
        <legend>Review</legend>
        <div className={styles.row}>
          <label htmlFor={`${baseId}-verbosity`}>Claude's output length</label>
          <select
            id={`${baseId}-verbosity`}
            value={verbosity}
            aria-describedby={`${baseId}-verbosity-hint`}
            onChange={(event) => {
              if (isVerbosity(event.target.value)) setVerbosity(event.target.value);
            }}
          >
            {VERBOSITIES.map((level) => (
              <option key={level} value={level}>
                {VERBOSITY_LABELS[level]}
              </option>
            ))}
          </select>
        </div>
        <p id={`${baseId}-verbosity-hint`} className={styles.hint}>
          How much Claude writes in chunk explanations, findings, the verdict and answers. Applies to new reviews and questions.
        </p>
        <div className={styles.check}>
          <input
            id={`${baseId}-inline`}
            type="checkbox"
            checked={inlineFindings}
            onChange={(event) => setInlineFindings(event.target.checked)}
          />
          <label htmlFor={`${baseId}-inline`}>Show Claude's findings inline while stepping (otherwise only on the summary)</label>
        </div>
      </fieldset>
      <fieldset className={styles.fieldset}>
        <legend>Suggestions</legend>
        <div className={styles.check}>
          <input id={`${baseId}-suggest`} type="checkbox" checked={suggestPrs} onChange={(event) => setSuggestPrs(event.target.checked)} />
          <label htmlFor={`${baseId}-suggest`}>
            Suggest open PRs from repos you reviewed recently and people you reviewed before (checks GitHub every 15 minutes)
          </label>
        </div>
        <div className={styles.check}>
          <input
            id={`${baseId}-reviewed-repos`}
            type="checkbox"
            checked={suggestOnlyReviewedRepos}
            disabled={!suggestPrs}
            onChange={(event) => setSuggestOnlyReviewedRepos(event.target.checked)}
          />
          <label htmlFor={`${baseId}-reviewed-repos`}>Only suggest PRs in repos you have reviewed before</label>
        </div>
      </fieldset>
      <fieldset className={styles.fieldset}>
        <legend>Look</legend>
        <div className={styles.row}>
          <label htmlFor={`${baseId}-theme`}>Theme</label>
          <select
            id={`${baseId}-theme`}
            value={theme}
            onChange={(event) => {
              if (isTheme(event.target.value)) setTheme(event.target.value);
            }}
          >
            {THEMES.map((option) => (
              <option key={option} value={option}>
                {THEME_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      {blankModel ? (
        <p role="alert" className={styles.error}>
          {blankModel.label} cannot be empty.
        </p>
      ) : null}
      {update.error ? (
        <p role="alert" className={styles.error}>
          Could not save settings: {update.error.message}
        </p>
      ) : null}
      <div className={styles.buttons}>
        <button type="submit" disabled={update.isPending || blankModel !== undefined}>
          {update.isPending ? "saving…" : "save"}
        </button>
        <button type="button" onClick={() => closeOverlay("settings")}>
          cancel
        </button>
      </div>
    </form>
  );
};

const SettingsDialog = (): ReactElement => {
  const { data, error, isPending } = useSettings();
  return (
    <Overlay name="settings" title="settings">
      {isPending ? <p>Loading settings…</p> : null}
      {error ? <p role="alert">Could not load settings: {error.message}</p> : null}
      {data ? <SettingsForm settings={data} /> : null}
    </Overlay>
  );
};

/** Settings panel (models, Claude executable, output length, inline findings, PR suggestions, theme). Renders as a fixed-position overlay; returns null while closed. */
export const SettingsPanel = (_props: SettingsPanelProps): ReactElement | null => {
  const open = useIsOverlayOpen("settings");
  useKeyBinding({ id: "shell-settings", key: ",", scope: "global", description: "settings", handler: () => openOverlay("settings") });
  useAppEvent("open-settings", () => openOverlay("settings"));
  return open ? <SettingsDialog /> : null;
};
