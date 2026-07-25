/**
 * "?" help popover in the toolbar — replay the onboarding tour, open the
 * keyboard-shortcuts dialog, install either editor extension, or jump to the
 * documentation. Owns its own open state (same pattern as ToolbarOverflowMenu).
 */

import { BookOpen, CircleHelp, Code2, Compass, Keyboard, Package } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

const DOCS_URL = "https://github.com/NoelHuibers/notebookflow#readme";
const JUPYTERLAB_PACKAGE_URL = "https://pypi.org/project/notebookflow-app/";
const VSCODE_MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=notebookflow.notebookflow-vscode";

interface HelpMenuProps {
  onReplayTour: () => void;
  onOpenShortcuts: () => void;
}

export function HelpMenu({ onReplayTour, onOpenShortcuts }: HelpMenuProps): ReactElement {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="px-2"
        onClick={() => {
          setIsOpen((open) => !open);
        }}
        title={t("onboarding.help.label")}
        aria-label={t("onboarding.help.label")}
      >
        <CircleHelp className="size-4" />
      </Button>
      {isOpen && (
        <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border bg-popover text-popover-foreground shadow-md">
          <button
            type="button"
            onClick={() => {
              onReplayTour();
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-muted/70"
          >
            <Compass className="size-3.5" />
            {t("onboarding.help.replayTour")}
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenShortcuts();
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-muted/70"
          >
            <Keyboard className="size-3.5" />
            {t("onboarding.help.shortcuts")}
          </button>
          <a
            href={JUPYTERLAB_PACKAGE_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-muted/70"
          >
            <Package className="size-3.5" />
            {t("onboarding.help.jupyterLab")}
          </a>
          <a
            href={VSCODE_MARKETPLACE_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-muted/70"
          >
            <Code2 className="size-3.5" />
            {t("onboarding.help.vscode")}
          </a>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-muted/70"
          >
            <BookOpen className="size-3.5" />
            {t("onboarding.help.documentation")}
          </a>
        </div>
      )}
    </div>
  );
}
