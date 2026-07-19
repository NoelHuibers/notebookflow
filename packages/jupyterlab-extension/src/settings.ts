/**
 * Plugin settings — a small snapshot/subscription seam over JupyterLab's
 * ISettingRegistry so the SplitView (and the React surface below it) never
 * touches the registry directly.
 *
 * The accessor is handed out synchronously at activation time while the
 * registry loads in the background: `get()` returns schema defaults until the
 * user's settings arrive, and every `.changed` emission (including the initial
 * load) notifies subscribers.
 */

import type { ISettingRegistry } from "@jupyterlab/settingregistry";

/** Composite plugin settings, with schema defaults filled in. */
export interface NotebookflowSettings {
  llmProvider: string;
  llmModel: string;
  llmApiKey: string;
  engineUrlOverride: string;
}

export const DEFAULT_SETTINGS: NotebookflowSettings = {
  llmProvider: "anthropic",
  llmModel: "",
  llmApiKey: "",
  engineUrlOverride: "",
};

export interface SettingsAccessor {
  /** Current snapshot of the plugin settings (defaults until loaded). */
  get(): NotebookflowSettings;
  /** Subscribe to settings changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/**
 * Build a SettingsAccessor backed by the given settings-registry load promise.
 * Load failures degrade to the schema defaults (and are reported by the
 * caller); the accessor itself never throws.
 */
export function createSettingsAccessor(
  loading: Promise<ISettingRegistry.ISettings>,
  onLoadError: (err: unknown) => void,
): SettingsAccessor {
  let settings: ISettingRegistry.ISettings | null = null;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  loading
    .then((loaded) => {
      settings = loaded;
      loaded.changed.connect(notify);
      notify();
    })
    .catch(onLoadError);

  return {
    get: (): NotebookflowSettings => readSettings(settings),
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function readSettings(settings: ISettingRegistry.ISettings | null): NotebookflowSettings {
  if (settings === null) {
    return DEFAULT_SETTINGS;
  }
  return {
    llmProvider: readString(settings, "llmProvider", DEFAULT_SETTINGS.llmProvider),
    llmModel: readString(settings, "llmModel", DEFAULT_SETTINGS.llmModel),
    llmApiKey: readString(settings, "llmApiKey", DEFAULT_SETTINGS.llmApiKey),
    engineUrlOverride: readString(settings, "engineUrlOverride", DEFAULT_SETTINGS.engineUrlOverride),
  };
}

function readString(
  settings: ISettingRegistry.ISettings,
  key: keyof NotebookflowSettings,
  fallback: string,
): string {
  const value = settings.composite[key];
  return typeof value === "string" ? value : fallback;
}
