/**
 * User settings — engine URL override, theme, and bring-your-own-key LLM
 * credentials. Persisted to localStorage; never sent server-side except the
 * BYOK credentials, which travel per AI request.
 */

export const SETTINGS_STORAGE_KEY = "notebookflow.settings.v1";

export type Theme = "light" | "dark" | "system";

export interface UserSettings {
  engineUrlOverride: string;
  theme: Theme;
  // Bring-your-own-key: the LLM provider, model, and key sent with each AI
  // request. Stored only in this browser, never server-side.
  llmProvider: string;
  llmModel: string;
  llmApiKey: string;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  engineUrlOverride: "",
  theme: "system",
  llmProvider: "anthropic",
  llmModel: "",
  llmApiKey: "",
};

export function readUserSettings(): UserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_USER_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_USER_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      engineUrlOverride:
        typeof parsed.engineUrlOverride === "string" ? parsed.engineUrlOverride : "",
      theme:
        parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system"
          ? parsed.theme
          : "system",
      llmProvider: typeof parsed.llmProvider === "string" ? parsed.llmProvider : "anthropic",
      llmModel: typeof parsed.llmModel === "string" ? parsed.llmModel : "",
      llmApiKey: typeof parsed.llmApiKey === "string" ? parsed.llmApiKey : "",
    };
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") {
    return;
  }
  const wantDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", wantDark);
}
