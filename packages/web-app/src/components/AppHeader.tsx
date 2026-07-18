/**
 * Top toolbar — wordmark, engine status, and the primary workspace actions
 * (save, cloud, triggers, AI helpers, run, dialogs, overflow menu). Purely
 * presentational: all state lives in App and flows in as props.
 */

import {
  Cloud,
  Command,
  Keyboard,
  Play,
  Save,
  Settings as SettingsIcon,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import type { ReactElement } from "react";

import { EngineStatus } from "@/components/EngineStatus";
import { Wordmark } from "@/components/Logo";
import { ToolbarOverflowMenu } from "@/components/ToolbarOverflowMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EngineClient } from "@/lib/EngineClient";
import { canSaveInPlace } from "@/lib/fileSystemAccess";
import { useI18n } from "@/lib/i18n";

interface AppHeaderProps {
  engineClient: EngineClient;
  saveStatus: "idle" | "saving" | "saved";
  /** Whether a save-in-place file handle exists (drives the Save tooltip). */
  hasSaveTarget: boolean;
  onSave: () => void;
  /** Signed-in users get the Cloud notebooks button. */
  isSignedIn: boolean;
  onOpenCloud: () => void;
  triggersCount: number;
  onOpenTriggers: () => void;
  isExplaining: boolean;
  onExplain: () => void;
  onOpenCompose: () => void;
  onOpenAsk: () => void;
  isRunning: boolean;
  onRun: () => void;
  onToggleShortcuts: () => void;
  onToggleSettings: () => void;
  /** Active notebook name — forwarded to the overflow menu's Jupyter action. */
  notebookName: string;
  onDownloadWorkspace: () => void;
  onDownloadAll: () => void;
  onReingest: () => void;
}

export function AppHeader({
  engineClient,
  saveStatus,
  hasSaveTarget,
  onSave,
  isSignedIn,
  onOpenCloud,
  triggersCount,
  onOpenTriggers,
  isExplaining,
  onExplain,
  onOpenCompose,
  onOpenAsk,
  isRunning,
  onRun,
  onToggleShortcuts,
  onToggleSettings,
  notebookName,
  onDownloadWorkspace,
  onDownloadAll,
  onReingest,
}: AppHeaderProps): ReactElement {
  const { t } = useI18n();

  return (
    <header className="flex items-center gap-3 border-b bg-card px-4 py-2.5">
      <Wordmark />
      <EngineStatus client={engineClient} />
      <div className="ml-auto flex items-center gap-2">
        {canSaveInPlace && (
          <Button
            variant="outline"
            size="sm"
            onClick={onSave}
            disabled={saveStatus === "saving"}
            title={
              hasSaveTarget ? t("app.toolbar.saveTitleAgain") : t("app.toolbar.saveTitleFirst")
            }
          >
            <Save className="mr-1.5 size-3.5" />
            {saveStatus === "saving"
              ? t("app.toolbar.saving")
              : saveStatus === "saved"
                ? t("app.toolbar.saved")
                : t("app.toolbar.save")}
          </Button>
        )}
        {isSignedIn && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenCloud}
            title={t("app.toolbar.cloudTitle")}
          >
            <Cloud className="mr-1.5 size-3.5" />
            {t("app.toolbar.cloud")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenTriggers}
          title={t("app.toolbar.triggersTitle")}
        >
          <Zap className="mr-1.5 size-3.5" />
          {t("app.toolbar.triggers")}
          {triggersCount > 0 && (
            <Badge variant="outline" className="ml-2 px-1 font-mono text-[10px]">
              {triggersCount}
            </Badge>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onExplain}
          disabled={isExplaining}
          title={t("app.toolbar.explainTitle")}
        >
          <Sparkles className="mr-1.5 size-3.5" />
          {isExplaining ? t("app.toolbar.explaining") : t("app.toolbar.explain")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenCompose}
          title={t("app.toolbar.composeTitle")}
        >
          <Wand2 className="mr-1.5 size-3.5" />
          {t("app.toolbar.compose")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenAsk} title={t("app.toolbar.askAiTitle")}>
          <Command className="mr-1.5 size-3.5" />
          {t("app.toolbar.askAi")}
          <Badge variant="outline" className="ml-2 px-1 font-mono text-[10px]">
            ⌘K
          </Badge>
        </Button>
        <Button variant="default" size="sm" onClick={onRun} disabled={isRunning}>
          <Play className="mr-1.5 size-3.5" />
          {isRunning ? t("app.toolbar.running") : t("app.toolbar.runPipeline")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="px-2"
          title={t("app.toolbar.shortcutsTitle")}
          aria-label={t("app.toolbar.shortcuts")}
          onClick={onToggleShortcuts}
        >
          <Keyboard className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="px-2"
          title={t("app.toolbar.settings")}
          aria-label={t("app.toolbar.settings")}
          onClick={onToggleSettings}
        >
          <SettingsIcon className="size-4" />
        </Button>
        <ToolbarOverflowMenu
          notebookName={notebookName}
          onDownloadWorkspace={onDownloadWorkspace}
          onDownloadAll={onDownloadAll}
          onReingest={onReingest}
        />
      </div>
    </header>
  );
}
