import { X } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import type { UserSettings } from "@/lib/settings";

interface SettingsDialogProps {
  settings: UserSettings;
  onChange: (next: UserSettings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, onChange, onClose }: SettingsDialogProps): ReactElement {
  return (
    <div className="border-b bg-card/95 backdrop-blur px-4 py-3 shadow-sm">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-semibold tracking-tight">Settings</span>
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
            Used for Ask / Compose / Explain / node synthesis. Stored only in this browser and sent
            per request — never saved on the server. Leave the key blank to use the engine's own key
            or the template fallback.
          </span>
        </div>
      </div>
    </div>
  );
}
