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
import { HelpMenu } from "@/components/HelpMenu";
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
  /**
   * Whether the Run action is available. False for signed-out visitors
   * targeting the hosted engine (execution is sign-in gated); the button is
   * disabled with a localized sign-in hint as its tooltip.
   */
  canRun: boolean;
  onRun: () => void;
  onToggleShortcuts: () => void;
  /** Restarts the onboarding tour from the help popover. */
  onReplayTour: () => void;
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
  canRun,
  onRun,
  onToggleShortcuts,
  onReplayTour,
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
          data-tour="triggers"
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
        <Button
          data-tour="ask"
          variant="ghost"
          size="sm"
          onClick={onOpenAsk}
          title={t("app.toolbar.askAiTitle")}
        >
          <Command className="mr-1.5 size-3.5" />
          {t("app.toolbar.askAi")}
          <Badge variant="outline" className="ml-2 px-1 font-mono text-[10px]">
            ⌘K
          </Badge>
        </Button>
        {/* Disabled buttons do not receive pointer or focus events, so the
            wrapper owns the signed-out popover interaction. */}
        <span
          className="group/run relative inline-flex"
          tabIndex={canRun ? undefined : 0}
          aria-describedby={canRun ? undefined : "run-pipeline-sign-in-hint"}
        >
          <Button
            data-tour="run"
            variant="default"
            size="sm"
            onClick={onRun}
            disabled={isRunning || !canRun}
          >
            <Play className="mr-1.5 size-3.5" />
            {isRunning ? t("app.toolbar.running") : t("app.toolbar.runPipeline")}
          </Button>
          {!canRun && (
            <span
              id="run-pipeline-sign-in-hint"
              role="tooltip"
              className="pointer-events-none invisible absolute right-0 top-full z-50 mt-2 w-72 translate-y-1 rounded-md border bg-popover px-3 py-2 text-sm font-normal leading-snug text-popover-foreground opacity-0 shadow-md transition-[opacity,transform,visibility] duration-150 group-hover/run:visible group-hover/run:translate-y-0 group-hover/run:opacity-100 group-focus/run:visible group-focus/run:translate-y-0 group-focus/run:opacity-100"
            >
              {t("app.toolbar.runSignedOut")}
            </span>
          )}
        </span>
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
        <HelpMenu onReplayTour={onReplayTour} onOpenShortcuts={onToggleShortcuts} />
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
