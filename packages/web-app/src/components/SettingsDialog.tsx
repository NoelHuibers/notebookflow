import { LogOut, Settings as SettingsIcon, X } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import type { UserSettings } from "@/lib/settings";

interface SettingsDialogProps {
  settings: UserSettings;
  onChange: (next: UserSettings) => void;
  onClose: () => void;
  // Account (#59) — the signed-in user's email + sign-out, or null when signed out.
  email: string | null;
  onSignOut: () => void;
  // Opt-in server-side key storage (#61). Only shown when signed in.
  signedIn: boolean;
  accountKeyState: "none" | "saved" | "saving";
  onSaveKeyToAccount: () => void;
  onRemoveKeyFromAccount: () => void;
}

export function SettingsDialog({
  settings,
  onChange,
  onClose,
  email,
  onSignOut,
  signedIn,
  accountKeyState,
  onSaveKeyToAccount,
  onRemoveKeyFromAccount,
}: SettingsDialogProps): ReactElement {
  // Esc closes the modal, matching the other overlays.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 pt-[10vh] backdrop-blur">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-md border bg-card p-4 text-xs shadow-xl">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <SettingsIcon className="size-4 text-primary" />
            Settings
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X className="size-3.5" />
          </Button>
        </div>

        <div className="rounded-md border bg-background/40 p-3">
          {signedIn && email !== null ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Account
                </div>
                <div className="truncate text-[13px] font-medium">{email}</div>
              </div>
              <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onSignOut}>
                <LogOut className="size-3.5" />
                Sign out
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">
                Not signed in — your work stays in this browser only.
              </span>
              <a href="/login" className="shrink-0 font-medium text-primary hover:underline">
                Sign in
              </a>
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Engine URL override</span>
          <input
            type="text"
            value={settings.engineUrlOverride}
            onChange={(event) => {
              onChange({ ...settings, engineUrlOverride: event.target.value });
            }}
            placeholder="ws://localhost:8765/ws  (leave blank to use VITE_NOTEBOOKFLOW_ENGINE_URL)"
            className="rounded-md border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-[10px] italic text-muted-foreground">
            Connects to a different engine on the next pipeline run. Leave blank to use the env-var
            default.
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Theme</span>
          <select
            value={settings.theme}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "light" || value === "dark" || value === "system") {
                onChange({ ...settings, theme: value });
              }
            }}
            className="rounded-md border bg-background px-2 py-1 text-[11px]"
          >
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>

        <div className="mt-1 border-t pt-3">
          <span className="font-semibold tracking-tight">AI provider (bring your own key)</span>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Provider</span>
              <select
                value={settings.llmProvider}
                onChange={(event) => {
                  onChange({ ...settings, llmProvider: event.target.value });
                }}
                className="rounded-md border bg-background px-2 py-1 text-[11px]"
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
                <option value="moonshot">Moonshot (Kimi)</option>
                <option value="deepseek">DeepSeek</option>
                <option value="qwen">Qwen</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Model</span>
              <input
                type="text"
                value={settings.llmModel}
                onChange={(event) => {
                  onChange({ ...settings, llmModel: event.target.value });
                }}
                placeholder="(provider default)"
                className="rounded-md border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">API key</span>
              <input
                type="password"
                value={settings.llmApiKey}
                onChange={(event) => {
                  onChange({ ...settings, llmApiKey: event.target.value });
                }}
                placeholder="sk-…"
                autoComplete="off"
                className="rounded-md border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
              />
            </label>
          </div>
          <span className="mt-1 block text-[10px] italic text-muted-foreground">
            Used for Ask / Compose / Explain / node synthesis. Stored in this browser and sent per
            request. Leave the key blank to use the engine's own key or the template fallback.
          </span>

          {signedIn && (
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={accountKeyState === "saving" || settings.llmApiKey.trim() === ""}
                onClick={onSaveKeyToAccount}
                title="Encrypt and store this key in your account so it loads on any device"
              >
                {accountKeyState === "saving" ? "Saving…" : "Save key to account"}
              </Button>
              {accountKeyState === "saved" && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-muted-foreground hover:text-destructive"
                    onClick={onRemoveKeyFromAccount}
                  >
                    Remove from account
                  </Button>
                  <span className="text-[10px] text-muted-foreground">Saved (encrypted)</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
