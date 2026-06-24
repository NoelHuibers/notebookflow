import { ChevronDown, ChevronRight, Copy, Play, Plus, Trash2, X, Zap } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { EngineClient, TriggerFiring, TriggerKind, TriggerSpec } from "@/lib/EngineClient";
import { truncate } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Triggers (#20). Backed by the /triggers REST surface that shipped with #8.
// The default on_fire callback on the engine just logs -- "this trigger
// fired" is the signal, "the pipeline auto-ran" is future work. We hide
// pipelineId from the form to avoid implying otherwise.
// ---------------------------------------------------------------------------

const TRIGGER_KIND_LABEL: Record<TriggerKind, string> = {
  manual: "Manual",
  cron: "Cron",
  file_watch: "File watch",
  webhook: "Webhook",
};

const CRON_PRESETS: { label: string; expression: string }[] = [
  { label: "Every 5 min", expression: "*/5 * * * *" },
  { label: "Hourly", expression: "0 * * * *" },
  { label: "Daily 9am", expression: "0 9 * * *" },
];

const CRON_REGEX = /^(\S+\s+){4}\S+$/;

interface TriggersDialogProps {
  client: EngineClient;
  triggers: TriggerSpec[];
  errorMessage: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  onClose: () => void;
}

export function TriggersDialog({
  client,
  triggers,
  errorMessage,
  isLoading,
  onRefresh,
  onClose,
}: TriggersDialogProps): ReactElement {
  const [isCreating, setIsCreating] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 pt-[10vh] backdrop-blur">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-md border bg-card p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="size-4 text-primary" />
            Triggers
            <Badge variant="outline" className="font-mono text-[10px]">
              {triggers.length}
            </Badge>
          </span>
          <div className="flex items-center gap-1">
            {!isCreating && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsCreating(true);
                }}
              >
                <Plus className="mr-1.5 size-3.5" />
                New trigger
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1.5"
              onClick={onClose}
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
        {errorMessage !== null && (
          <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
            {errorMessage}
          </p>
        )}
        {isCreating ? (
          <TriggerCreateForm
            client={client}
            onCancel={() => {
              setIsCreating(false);
            }}
            onCreated={() => {
              setIsCreating(false);
              onRefresh();
            }}
          />
        ) : (
          <ScrollArea className="min-h-[200px] flex-1 rounded border bg-muted/30 p-2">
            {triggers.length === 0 ? (
              <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                {isLoading
                  ? "Loading triggers…"
                  : "No triggers yet. Click 'New trigger' to register one."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {triggers.map((trigger) => (
                  <TriggerListItem
                    key={trigger.id}
                    client={client}
                    trigger={trigger}
                    onChanged={onRefresh}
                  />
                ))}
              </ul>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

interface TriggerCreateFormProps {
  client: EngineClient;
  onCancel: () => void;
  onCreated: () => void;
}

function TriggerCreateForm({ client, onCancel, onCreated }: TriggerCreateFormProps): ReactElement {
  const [kind, setKind] = useState<TriggerKind>("manual");
  const [id, setId] = useState(() => `trigger-${Date.now().toString(36)}`);
  const [expression, setExpression] = useState("");
  const [pathsText, setPathsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cronShapeOk = expression.trim() === "" || CRON_REGEX.test(expression.trim());

  async function handleSubmit(): Promise<void> {
    if (id.trim() === "") {
      setError("Trigger id can't be empty.");
      return;
    }
    let config: Record<string, unknown> = {};
    if (kind === "cron") {
      if (expression.trim() === "") {
        setError("Cron expression required.");
        return;
      }
      config = { expression: expression.trim() };
    } else if (kind === "file_watch") {
      const paths = pathsText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      if (paths.length === 0) {
        setError("Add at least one path to watch.");
        return;
      }
      config = { paths };
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await client.registerTrigger({
        id: id.trim(),
        kind,
        pipelineId: "default",
        config,
      });
      onCreated();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(TRIGGER_KIND_LABEL) as TriggerKind[]).map((k) => (
          <Button
            key={k}
            variant={kind === k ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setKind(k);
              setError(null);
            }}
          >
            {TRIGGER_KIND_LABEL[k]}
          </Button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-[11px]">
        <span className="text-muted-foreground">Trigger id</span>
        <input
          value={id}
          onChange={(event) => {
            setId(event.target.value);
          }}
          className="rounded border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
          aria-label="Trigger id"
        />
      </label>
      {kind === "cron" && (
        <div className="flex flex-col gap-1.5 text-[11px]">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Cron expression (5 fields)</span>
            <input
              value={expression}
              onChange={(event) => {
                setExpression(event.target.value);
              }}
              placeholder="*/5 * * * *"
              className="rounded border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
              aria-label="Cron expression"
            />
          </label>
          {!cronShapeOk && (
            <span className="text-[10px] text-amber-600">
              5 whitespace-separated fields expected; engine validates on save.
            </span>
          )}
          <div className="flex flex-wrap gap-1">
            {CRON_PRESETS.map((preset) => (
              <Button
                key={preset.expression}
                variant="outline"
                size="sm"
                className="h-6 px-2 font-mono text-[10px]"
                onClick={() => {
                  setExpression(preset.expression);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      {kind === "file_watch" && (
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted-foreground">Paths (one per line)</span>
          <textarea
            value={pathsText}
            onChange={(event) => {
              setPathsText(event.target.value);
            }}
            rows={3}
            placeholder="./data&#10;./inputs"
            className="resize-none rounded border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
            aria-label="Paths to watch"
          />
          <span className="text-[10px] text-muted-foreground">
            Engine-host paths. Directories are watched recursively.
          </span>
        </label>
      )}
      {kind === "webhook" && (
        <p className="text-[11px] text-muted-foreground">
          A POST URL will be generated after you save. Anyone posting to it fires this trigger.
        </p>
      )}
      {kind === "manual" && (
        <p className="text-[11px] text-muted-foreground">
          Fires only when you click <strong>Fire now</strong> in the list.
        </p>
      )}
      {error !== null && (
        <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving…" : "Save trigger"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface TriggerListItemProps {
  client: EngineClient;
  trigger: TriggerSpec;
  onChanged: () => void;
}

function TriggerListItem({ client, trigger, onChanged }: TriggerListItemProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(false);
  const [firings, setFirings] = useState<TriggerFiring[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isFiring, setIsFiring] = useState(false);
  const [copied, setCopied] = useState(false);

  // Manual triggers only fire from this UI -- no point polling them.
  const shouldPoll = isExpanded && trigger.kind !== "manual";

  useEffect(() => {
    if (!isExpanded) {
      return;
    }
    let cancelled = false;
    async function refresh(): Promise<void> {
      try {
        const list = await client.listFirings(trigger.id);
        if (!cancelled) {
          setFirings(list);
        }
      } catch {
        // Quietly drop; the firings count badge stays at its prior value.
      }
    }
    void refresh();
    if (!shouldPoll) {
      return () => {
        cancelled = true;
      };
    }
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [client, trigger.id, isExpanded, shouldPoll]);

  async function handleFire(): Promise<void> {
    setIsFiring(true);
    setActionError(null);
    try {
      const firing = await client.fireTrigger(trigger.id);
      setFirings((prev) => [...prev, firing]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setActionError(`Fire failed: ${message}`);
    } finally {
      setIsFiring(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setActionError(null);
    try {
      await client.unregisterTrigger(trigger.id);
      onChanged();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error";
      setActionError(`Delete failed: ${message}`);
    }
  }

  const webhookUrl = trigger.kind === "webhook" ? client.webhookUrl(trigger.id) : "";

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setActionError("Copy failed; select the URL manually.");
    }
  }

  return (
    <li className="rounded border bg-background p-2 text-[12px]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setIsExpanded((prev) => !prev);
          }}
          className="flex flex-1 items-center gap-2 text-left"
          aria-label={isExpanded ? "Collapse trigger" : "Expand trigger"}
        >
          {isExpanded ? (
            <ChevronDown className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground" />
          )}
          <Badge variant="outline" className="font-mono text-[10px]">
            {TRIGGER_KIND_LABEL[trigger.kind]}
          </Badge>
          <span className="truncate font-mono text-[11px]">{trigger.id}</span>
          <span className="text-[10px] text-muted-foreground">
            {firings.length > 0 && `${String(firings.length)} firings`}
          </span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => {
            void handleFire();
          }}
          disabled={isFiring}
        >
          <Play className="mr-1 size-3" />
          Fire now
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-destructive"
          onClick={() => {
            void handleDelete();
          }}
          aria-label="Delete trigger"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
      {actionError !== null && (
        <p className="mt-1.5 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[10px] text-destructive">
          {actionError}
        </p>
      )}
      {isExpanded && trigger.kind === "webhook" && (
        <div className="mt-2 flex flex-col gap-1 rounded border bg-muted/50 p-2 font-mono text-[10px]">
          <div className="flex items-center justify-between gap-2">
            <code className="break-all">POST {webhookUrl}</code>
            <Button
              variant="outline"
              size="sm"
              className="h-6 shrink-0 px-2 text-[10px]"
              onClick={() => {
                void handleCopy();
              }}
            >
              <Copy className="mr-1 size-3" />
              {copied ? "Copied" : "Copy URL"}
            </Button>
          </div>
          <span className="text-muted-foreground">
            Content-Type: application/json · Body: {"{"}&quot;payload&quot;: {"{...}"}
            {"}"}
          </span>
          <span className="text-muted-foreground">
            If NOTEBOOKFLOW_AUTH_TOKEN is set on your engine, include Authorization: Bearer
            &lt;token&gt;.
          </span>
        </div>
      )}
      {isExpanded && Object.keys(trigger.config).length > 0 && trigger.kind !== "webhook" && (
        <pre className="mt-2 overflow-x-auto rounded border bg-muted/50 px-2 py-1 font-mono text-[10px]">
          {JSON.stringify(trigger.config, null, 2)}
        </pre>
      )}
      {isExpanded && (
        <div className="mt-2 flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground">
            Firings (last {firings.length}){shouldPoll && " · refreshes every 5s"}
          </span>
          {firings.length === 0 ? (
            <p className="rounded border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
              No firings yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5 font-mono text-[10px]">
              {firings
                .slice()
                .reverse()
                .map((firing, idx) => (
                  <li
                    key={`${String(firing.firedAt)}-${String(idx)}`}
                    className="rounded border bg-muted/30 px-2 py-1"
                  >
                    <span className="text-muted-foreground">
                      {new Date(firing.firedAt * 1000).toLocaleTimeString()}
                    </span>
                    {Object.keys(firing.payload).length > 0 && (
                      <span className="ml-2 text-foreground/70">
                        {truncate(JSON.stringify(firing.payload), 80)}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
