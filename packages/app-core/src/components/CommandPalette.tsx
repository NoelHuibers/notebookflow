/**
 * CommandPalette — the single ⌘K AI command surface. Fully controlled: every
 * command's prompt, busy flag, result, and error live in the host; the palette
 * owns only its ephemeral view state (search query, list selection, and which
 * command is currently revealed).
 *
 * It is a *router*, not a rewrite of the AI flows: it opens on a filterable
 * list of AI commands (Ask, Create node, Compose, Explain). Picking
 * Ask/Compose/Create node reveals that command's textarea + result inline and
 * calls back into the host's existing handlers; picking Explain fires the
 * host's explain handler immediately and closes (its banner shows the result).
 *
 * i18n follows the app-core labels pattern: every user-facing string is a label
 * with an English default a host overrides via the optional `labels` prop.
 * Rendering without one yields the exact English strings.
 */

import { ArrowLeft, Command as CommandIcon, Plus, Sparkles, Wand2, X } from "lucide-react";
import type { KeyboardEvent, ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../lib/utils";
import type { AskAnswer, PipelineProposal } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

export type CommandId = "ask" | "createNode" | "compose" | "explain";

/** One row in the command list. `disabled` rows render greyed with a "coming
 * soon" hint and can't be picked or navigated onto. */
export interface CommandDescriptor {
  id: CommandId;
  title: string;
  description: string;
  disabled: boolean;
}

export interface CommandPaletteLabels {
  title: string;
  dismiss: string;
  searchPlaceholder: string;
  noResults: string;
  comingSoon: string;
  back: string;
  navHint: string;
  submitHint: string;
  askTitle: string;
  askDescription: string;
  createNodeTitle: string;
  createNodeDescription: string;
  composeTitle: string;
  composeDescription: string;
  explainTitle: string;
  explainDescription: string;
  askPlaceholder: string;
  askSubmit: string;
  askThinking: string;
  composePlaceholder: string;
  composeSubmit: string;
  composeDrafting: string;
  composeApply: string;
  createNodePlaceholder: string;
  createNodeSubmit: string;
  createNodeCreating: string;
  createNodePlaced: string;
}

// English defaults. The command bodies reuse the same wording the standalone
// Ask/Compose dialogs shipped, so the consolidated surface reads identically.
export const defaultCommandPaletteLabels: CommandPaletteLabels = {
  title: "AI commands",
  dismiss: "Dismiss",
  searchPlaceholder: "Search commands…",
  noResults: "No commands match",
  comingSoon: "Soon",
  back: "Back to commands",
  navHint: "↑↓ to navigate · Enter to select · Esc to close",
  submitHint: "Enter to send · Shift+Enter for a new line · Esc to close",
  askTitle: "Ask AI",
  askDescription: "Ask anything about your pipeline or pandas",
  createNodeTitle: "Create node",
  createNodeDescription: "Describe a node and drop it on the canvas",
  composeTitle: "Compose a pipeline",
  composeDescription: "Draft a whole notebook from one sentence",
  explainTitle: "Explain pipeline",
  explainDescription: "Get a prose walkthrough of the current graph",
  askPlaceholder:
    "Ask anything — describe what you want to do, request an explanation, or ask a pandas question",
  askSubmit: "Ask",
  askThinking: "Thinking…",
  composePlaceholder: "e.g. Load customers.csv, filter for EU rows, plot revenue by region",
  composeSubmit: "Draft pipeline",
  composeDrafting: "Drafting…",
  composeApply: "Replace notebook with draft",
  createNodePlaceholder: "e.g. Keep only rows where revenue is above 1000",
  createNodeSubmit: "Create node",
  createNodeCreating: "Creating…",
  createNodePlaced: "Node placed on the canvas.",
};

// --- Pure command-routing helpers (unit-tested in CommandPalette.test.ts) ---

/** The command list in display order, built from the merged labels. */
export function buildCommands(labels: CommandPaletteLabels): CommandDescriptor[] {
  return [
    { id: "ask", title: labels.askTitle, description: labels.askDescription, disabled: false },
    {
      id: "createNode",
      title: labels.createNodeTitle,
      description: labels.createNodeDescription,
      disabled: false,
    },
    {
      id: "compose",
      title: labels.composeTitle,
      description: labels.composeDescription,
      disabled: false,
    },
    {
      id: "explain",
      title: labels.explainTitle,
      description: labels.explainDescription,
      disabled: false,
    },
  ];
}

/** Match the trimmed, lower-cased query against command titles and
 * descriptions. An empty query returns the list unchanged. */
export function filterCommands(commands: CommandDescriptor[], query: string): CommandDescriptor[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return commands;
  }
  return commands.filter(
    (command) =>
      command.title.toLowerCase().includes(q) || command.description.toLowerCase().includes(q),
  );
}

/** Step from `current` by `delta`, wrapping around the ends and skipping
 * disabled rows. Returns `current` when nothing is selectable. */
export function nextSelectableIndex(
  commands: CommandDescriptor[],
  current: number,
  delta: 1 | -1,
): number {
  const n = commands.length;
  if (n === 0) {
    return current;
  }
  for (let step = 1; step <= n; step += 1) {
    const index = (((current + delta * step) % n) + n) % n;
    if (commands[index]?.disabled === false) {
      return index;
    }
  }
  return current;
}

/** The first selectable row, or 0 when the list is empty / all-disabled. */
export function firstSelectableIndex(commands: CommandDescriptor[]): number {
  const index = commands.findIndex((command) => !command.disabled);
  return index === -1 ? 0 : index;
}

// --- Controlled prop shape ---

/** Ask command state, wired straight to the host's existing Ask flow. */
export interface CommandPaletteAsk {
  prompt: string;
  isAsking: boolean;
  result: AskAnswer | null;
  errorMessage: string | null;
  onPromptChange: (next: string) => void;
  onSubmit: () => void;
}

/** Compose command state, wired straight to the host's existing Compose flow. */
export interface CommandPaletteCompose {
  prompt: string;
  isComposing: boolean;
  result: PipelineProposal | null;
  errorMessage: string | null;
  onPromptChange: (next: string) => void;
  onSubmit: () => void;
  onApply: () => void;
}

/**
 * Create-node command state (#19). One-shot: submitting authors a single node
 * and auto-places it on the canvas. `backend` is set once a node has been
 * placed (the inline confirmation + warnings then render); `warnings` carries
 * the template-fallback notice when no key is configured. No regenerate.
 */
export interface CommandPaletteCreateNode {
  prompt: string;
  isCreating: boolean;
  errorMessage: string | null;
  /** The backend that authored the placed node, or null before one is placed. */
  backend: string | null;
  warnings: string[];
  onPromptChange: (next: string) => void;
  onSubmit: () => void;
}

/** Explain command — fire-and-close; the host's banner renders the result. */
export interface CommandPaletteExplain {
  isExplaining: boolean;
  onExplain: () => void;
}

export interface CommandPaletteProps {
  ask: CommandPaletteAsk;
  createNode: CommandPaletteCreateNode;
  compose: CommandPaletteCompose;
  explain: CommandPaletteExplain;
  onClose: () => void;
  labels?: Partial<CommandPaletteLabels>;
}

type ActiveCommand = "ask" | "createNode" | "compose" | null;

function iconFor(id: CommandId): ReactElement {
  switch (id) {
    case "ask":
      return <CommandIcon className="size-4 text-primary" />;
    case "createNode":
      return <Plus className="size-4 text-primary" />;
    case "compose":
      return <Wand2 className="size-4 text-primary" />;
    case "explain":
      return <Sparkles className="size-4 text-primary" />;
  }
}

export function CommandPalette({
  ask,
  createNode,
  compose,
  explain,
  onClose,
  labels,
}: CommandPaletteProps): ReactElement {
  const merged = useMemo<CommandPaletteLabels>(
    () => ({ ...defaultCommandPaletteLabels, ...labels }),
    [labels],
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<ActiveCommand>(null);
  const [selected, setSelected] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const commands = useMemo(() => buildCommands(merged), [merged]);
  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Keep the selection in range and on a selectable row as the filter changes.
  useEffect(() => {
    setSelected((current) =>
      current < filtered.length && filtered[current]?.disabled === false
        ? current
        : firstSelectableIndex(filtered),
    );
  }, [filtered]);

  // Focus the search box on open / when returning to the list, and the
  // textarea when a command is revealed.
  useEffect(() => {
    if (active === null) {
      searchRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [active]);

  function runCommand(id: CommandId): void {
    if (id === "explain") {
      explain.onExplain();
      onClose();
      return;
    }
    setActive(id);
  }

  function submitActive(): void {
    if (active === "ask") {
      ask.onSubmit();
    } else if (active === "createNode") {
      createNode.onSubmit();
    } else if (active === "compose") {
      compose.onSubmit();
    }
  }

  // Escape is owned by the palette everywhere inside it: stopPropagation keeps
  // the app-global Escape handler (collapse sidebar / close shortcuts) from
  // also firing while a command palette is open.
  function handleRootKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((current) => nextSelectableIndex(filtered, current, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((current) => nextSelectableIndex(filtered, current, -1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[selected];
      if (command !== undefined && !command.disabled) {
        runCommand(command.id);
      }
    }
  }

  // Enter (or ⌘/Ctrl+Enter) submits the revealed command; Shift+Enter inserts a
  // newline so multi-line prompts stay possible.
  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitActive();
    }
  }

  const backButton = (
    <button
      type="button"
      onClick={() => {
        setActive(null);
      }}
      className="flex items-center gap-1.5 self-start text-[11px] text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      {merged.back}
    </button>
  );

  const headerTitle =
    active === "ask"
      ? merged.askTitle
      : active === "createNode"
        ? merged.createNodeTitle
        : active === "compose"
          ? merged.composeTitle
          : merged.title;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={headerTitle}
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 pt-[15vh] backdrop-blur"
      onKeyDown={handleRootKeyDown}
    >
      <div className="flex max-h-[70vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-md border bg-card p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <CommandIcon className="size-4 text-primary" />
            {headerTitle}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5"
            onClick={onClose}
            aria-label={merged.dismiss}
          >
            <X className="size-3.5" />
          </Button>
        </div>

        {active === null && (
          <>
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={merged.searchPlaceholder}
              aria-label={merged.searchPlaceholder}
              className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <ScrollArea className="min-h-[160px] flex-1">
              {filtered.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{merged.noResults}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {filtered.map((command, index) => (
                    <li key={command.id}>
                      <button
                        type="button"
                        disabled={command.disabled}
                        onClick={() => {
                          runCommand(command.id);
                        }}
                        onMouseEnter={() => {
                          if (!command.disabled) {
                            setSelected(index);
                          }
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                          index === selected ? "bg-muted" : "hover:bg-muted/60",
                          command.disabled && "cursor-not-allowed opacity-50",
                        )}
                      >
                        {iconFor(command.id)}
                        <span className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {command.title}
                            {command.disabled && (
                              <Badge variant="outline" className="px-1 text-[10px]">
                                {merged.comingSoon}
                              </Badge>
                            )}
                          </span>
                          <span className="truncate text-[11px] text-muted-foreground">
                            {command.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
            <span className="text-[10px] text-muted-foreground">{merged.navHint}</span>
          </>
        )}

        {active === "ask" && (
          <>
            {backButton}
            <textarea
              ref={textareaRef}
              rows={3}
              value={ask.prompt}
              onChange={(event) => {
                ask.onPromptChange(event.target.value);
              }}
              onKeyDown={handleTextareaKeyDown}
              placeholder={merged.askPlaceholder}
              aria-label={merged.askTitle}
              className="resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {ask.errorMessage !== null && (
              <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                {ask.errorMessage}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button variant="default" size="sm" onClick={ask.onSubmit} disabled={ask.isAsking}>
                {ask.isAsking ? merged.askThinking : merged.askSubmit}
              </Button>
              {ask.result !== null && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {ask.result.backend}
                </Badge>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground">{merged.submitHint}</span>
            </div>
            {ask.result !== null && (
              <ScrollArea className="min-h-[120px] flex-1 rounded border bg-muted/30 p-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{ask.result.answer}</p>
                {ask.result.warnings.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                    {ask.result.warnings.map((warning, idx) => (
                      <li key={`ask-warning-${String(idx)}`}>• {warning}</li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            )}
          </>
        )}

        {active === "createNode" && (
          <>
            {backButton}
            <textarea
              ref={textareaRef}
              rows={3}
              value={createNode.prompt}
              onChange={(event) => {
                createNode.onPromptChange(event.target.value);
              }}
              onKeyDown={handleTextareaKeyDown}
              placeholder={merged.createNodePlaceholder}
              aria-label={merged.createNodeTitle}
              className="resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {createNode.errorMessage !== null && (
              <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                {createNode.errorMessage}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={createNode.onSubmit}
                disabled={createNode.isCreating}
              >
                {createNode.isCreating ? merged.createNodeCreating : merged.createNodeSubmit}
              </Button>
              {createNode.backend !== null && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {createNode.backend}
                </Badge>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground">{merged.submitHint}</span>
            </div>
            {createNode.backend !== null && (
              <div className="rounded border bg-muted/30 p-3 text-[11px]">
                <p className="text-sm">{merged.createNodePlaced}</p>
                {createNode.warnings.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                    {createNode.warnings.map((warning, idx) => (
                      <li key={`create-warning-${String(idx)}`}>• {warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {active === "compose" && (
          <>
            {backButton}
            <textarea
              ref={textareaRef}
              rows={4}
              value={compose.prompt}
              onChange={(event) => {
                compose.onPromptChange(event.target.value);
              }}
              onKeyDown={handleTextareaKeyDown}
              placeholder={merged.composePlaceholder}
              aria-label={merged.composeTitle}
              className="resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {compose.errorMessage !== null && (
              <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                {compose.errorMessage}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={compose.onSubmit}
                disabled={compose.isComposing}
              >
                {compose.isComposing ? merged.composeDrafting : merged.composeSubmit}
              </Button>
              {compose.result !== null && compose.result.cellSources.length > 0 && (
                <Button variant="outline" size="sm" onClick={compose.onApply}>
                  {merged.composeApply}
                </Button>
              )}
              {compose.result !== null && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {compose.result.backend}
                </Badge>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground">{merged.submitHint}</span>
            </div>
            {compose.result !== null && (
              <ScrollArea className="min-h-[120px] flex-1 rounded border bg-muted/30 p-2">
                <ul className="flex flex-col gap-1.5 text-[11px] font-mono">
                  {compose.result.nodes.map((node, idx) => (
                    <li
                      key={`node-${String(idx)}`}
                      className="rounded border bg-background px-2 py-1"
                    >
                      <span className="font-semibold">
                        {idx + 1}. {node.name}
                      </span>
                      <span className="ml-2 text-muted-foreground">{node.manifestId}</span>
                    </li>
                  ))}
                </ul>
                {compose.result.edges.length > 0 && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {compose.result.edges.map((edge) => `${edge.from} → ${edge.to}`).join("  ·  ")}
                  </p>
                )}
                {compose.result.warnings.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                    {compose.result.warnings.map((warning, idx) => (
                      <li key={`warning-${String(idx)}`}>• {warning}</li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            )}
          </>
        )}
      </div>
    </div>
  );
}
